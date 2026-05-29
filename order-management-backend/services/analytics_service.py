import os
import json
import logging
import time
from functools import lru_cache
import google.generativeai as genai
from fastapi import HTTPException
from services.supabase_client import get_supabase_admin
from repositories import OrderRepository, ProductRepository, ReportHistoryRepository, SubscriptionRepository
from typing import List, Dict, Any
from datetime import datetime, timezone, timedelta
from models.schemas import AIReportResponse

logger = logging.getLogger(__name__)

# 初始化 Gemini API Key
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)


class AnalyticsService:
    @staticmethod
    def _get_order_repo() -> OrderRepository:
        return OrderRepository(get_supabase_admin())

    @staticmethod
    def _get_product_repo() -> ProductRepository:
        return ProductRepository(get_supabase_admin())

    @staticmethod
    def _get_report_history_repo() -> ReportHistoryRepository:
        return ReportHistoryRepository(get_supabase_admin())

    @staticmethod
    def _get_subscription_repo() -> SubscriptionRepository:
        return SubscriptionRepository(get_supabase_admin())


    @staticmethod
    async def aggregate_orders(filters: dict, user: dict) -> dict:
        """
        銷售分析資料聚合運算與硬性角色隔離。
        Admin 與 Viewer 可獲取全局數據；Sales 僅能獲取個人數據。
        """
        # 1. 安全防禦：角色權限硬性隔離驗證
        profile = user.get("profile", user)
        role = profile.get("role")
        employee_id = profile.get("employee_id")

        if role == "sales":
            # Sales 僅能存取自己的資料
            owner_id = employee_id
        elif role in ["admin", "viewer"]:
            # Admin 或 Viewer 擁有全局檢視權限
            owner_id = None
        else:
            raise HTTPException(status_code=403, detail="權限不足，無法存取分析資料")

        # 2. 獲取過濾後的訂單與商品映射
        order_repo = AnalyticsService._get_order_repo()
        product_repo = AnalyticsService._get_product_repo()

        date_from = filters.get("date_from")
        date_to = filters.get("date_to")
        customer_id = filters.get("customer_id")
        product_id = filters.get("product_id")

        orders = order_repo.get_orders_for_analytics(
            owner_id=owner_id,
            date_from=date_from,
            date_to=date_to,
            customer_id=customer_id,
            product_id=product_id
        )

        all_products = product_repo.get_all_products()
        product_map = {p["product_id"]: p.get("name", "未知商品") for p in all_products}

        # 3. 聚合運算
        total_orders = len(orders)
        completed_orders = 0
        total_amount = 0.0
        
        product_agg = {}   # {product_id: {"quantity": int, "total_amount": float}}
        time_series = {}   # {date_str: float}
        status_stats = {}  # {status: int}

        for order in orders:
            amount = float(order.get("amount") or 0.0)
            status = order.get("status") or "未知狀態"
            p_id = order.get("product_id") or "未知商品ID"
            updated_at_str = order.get("updated_at") or order.get("created_at")

            # 按狀態分組
            status_stats[status] = status_stats.get(status, 0) + 1

            # 銷售額/銷售量計算：排除已作廢及處理中的訂單，僅統計「已完成」訂單
            if status == "已完成":
                completed_orders += 1
                total_amount += amount

                # 按產品分組
                if p_id not in product_agg:
                    product_agg[p_id] = {"quantity": 0, "total_amount": 0.0}
                product_agg[p_id]["quantity"] += 1
                product_agg[p_id]["total_amount"] += amount

                # 按時間序列分組 (YYYY-MM-DD)
                if updated_at_str:
                    try:
                        # 統一將 Z 字尾或空格格式化為標準 ISO 格式以利 fromisoformat 解析
                        clean_str = updated_at_str.replace("Z", "+00:00")
                        if " " in clean_str:
                            clean_str = clean_str.replace(" ", "T")
                        
                        dt = datetime.fromisoformat(clean_str)
                        
                        # 轉換為台灣時區 (UTC+8)
                        tz_taipei = timezone(timedelta(hours=8))
                        if dt.tzinfo:
                            dt_taipei = dt.astimezone(tz_taipei)
                        else:
                            dt_taipei = dt.replace(tzinfo=timezone.utc).astimezone(tz_taipei)
                            
                        date_key = dt_taipei.strftime("%Y-%m-%d")
                        time_series[date_key] = time_series.get(date_key, 0.0) + amount
                    except Exception:
                        pass

        # 計算平均金額 (以已完成之有效訂單計算平均)
        average_amount = total_amount / completed_orders if completed_orders > 0 else 0.0

        # 將產品分組轉換成 ProductSalesStats 結構
        product_stats_list = []
        for p_id, stats in product_agg.items():
            product_stats_list.append({
                "product_id": p_id,
                "name": product_map.get(p_id, "未知商品"),
                "quantity": stats["quantity"],
                "total_amount": stats["total_amount"]
            })

        # 按銷售金額由大到小排序，利於商務圖表呈現
        product_stats_list.sort(key=lambda x: x["total_amount"], reverse=True)

        return {
            "total_orders": total_orders,
            "total_amount": total_amount,
            "average_amount": average_amount,
            "product_stats": product_stats_list,
            "time_series": time_series,
            "status_stats": status_stats
        }

    @staticmethod
    async def generate_ai_report(filters: dict, user: dict) -> dict:
        """
        銷售分析 AI 報告生成。
        內部先呼叫 aggregate_orders 進行硬性角色隔離之數據聚合，
        然後依據當前使用者角色提供動態的 AI 商業智慧分析，支援 2 次失敗重試。
        """
        # 獲取使用者 ID
        profile = user.get("profile", user)
        user_id = user.get("id") or profile.get("id")

        # 1. 先行獲取聚合數據，以便計算最新的「動態數據指紋 (Data Fingerprint)」
        #    此步驟僅查詢本地 PostgreSQL，速度極快且不消耗 Gemini API 額度
        aggregated_data = await AnalyticsService.aggregate_orders(filters, user)

        # 2. 計算動態數據指紋以做為快取金鑰的一部分。若訂單狀態、金額或筆數有任何改變，指紋將不同
        import hashlib
        fingerprint_source = f"{aggregated_data.get('total_orders')}_{aggregated_data.get('total_amount')}_{json.dumps(aggregated_data.get('status_stats'), sort_keys=True)}"
        fingerprint = hashlib.md5(fingerprint_source.encode('utf-8')).hexdigest()
        cache_filters = {**filters, "_fingerprint": fingerprint}

        # 3. 每日快取檢查 (Daily Cache Check)：24 小時內且指紋/篩選條件完全相同才命中快取
        if user_id:
            try:
                history_repo = AnalyticsService._get_report_history_repo()
                cached_record = history_repo.get_recent_cache(str(user_id), cache_filters, hours=24)
                if cached_record:
                    logger.info(f"AI 銷售分析快取命中 (Cache HIT)! 使用者 ID: {user_id}, 快取條件: {cache_filters}")
                    return cached_record.get("report_content") or {}
            except Exception as ce:
                logger.error(f"快取檢查過程發生錯誤，將直接呼叫 API 生成: {str(ce)}")

        # 2. 獲取使用者角色並調整分析視角
        role = profile.get("role")

        if role in ["admin", "viewer"]:
            perspective = (
                "您當前扮演『高階商業智慧分析師』，正為系統的管理員(Admin)與檢視者(Viewer)提供『宏觀銷售決策報告』。\n"
                "分析重點：請提供『宏觀營運策略、跨部門/跨產品走勢、大方向調整建議』。"
            )
        elif role == "sales":
            perspective = (
                "您當前扮演『高階商業智慧分析師』，正為負責個人銷售業務的銷售專員(Sales)提供『微觀執行與跟進建議報告』。\n"
                "分析重點：請提供『微觀執行建議、個人客戶跟進提醒、個人暢銷商品組合』。"
            )
        else:
            raise HTTPException(status_code=403, detail="權限不足，無法生成 AI 分析報告")

        # 3. 準備 Prompts
        system_prompt = (
            "您是一位頂尖且經驗豐富的「高階商業智慧分析師」。\n"
            "您的任務是根據系統提供的結構化銷售統計聚合數據，結合使用者的角色視角，撰寫一份具備深度洞察力、精準預測力與高實操性的商業分析報告。\n\n"
            "您必須嚴格回傳一個符合以下 JSON 格式的數據結構，不可包含任何非 JSON 的字串、解釋或 Markdown 區塊包裝：\n\n"
            "{\n"
            '  "summary": "【少於 20 字的簡短報告摘要，必須精煉且具衝擊力】",\n'
            '  "trends": {\n'
            '    "insights": "【詳細的趨勢分析與洞察，解釋銷售的走向與原因】",\n'
            '    "trend_direction": "【趨勢走向描述，如：持續上升、平穩震盪、面臨下滑】",\n'
            '    "chart_data": [\n'
            '      {\n'
            '        "name": "【圖表數值標籤或日期，例如：2026-05-01】",\n'
            '        "value": 12345.6\n'
            "      }\n"
            "    ]\n"
            "  },\n"
            '  "top_products": [\n'
            "    {\n"
            '      "name": "【商品名稱】",\n'
            '      "quantity": 10,\n'
            '      "revenue": 120000.0,\n'
            '      "insights": "【該商品之銷售原因分析及未來推廣洞察】"\n'
            "    }\n"
            "  ],\n"
            '  "forecast": {\n'
            '    "next_30_days_revenue": 150000.0,\n'
            '    "confidence": 0.85,\n'
            '    "recommendation": "【針對未來 30 天營收預測所提出的具體預防性或擴張性運營策略建議】"\n'
            "  },\n"
            '  "recommendations": [\n'
            '    "【具體行動建議 1】",\n'
            '    "【具體行動建議 2】",\n'
            '    "【具體行動建議 3，至少提供兩到三條高度可執行的建議】"\n'
            "  ]\n"
            "}\n\n"
            "請確保：\n"
            "1. `summary` 必須在 20 個字元以內（含標點符號）。\n"
            "2. `forecast.confidence` 必須是 0.0 到 1.0 之間的浮點數，代表您對預測的信心指數。\n"
            "3. `trends.chart_data` 必須是一個包含 `name` (字串) 與 `value` (數字) 鍵值對的物件陣列，可用於繪製銷售趨勢圖。\n"
            "4. 針對不同使用者角色的分析焦點需動態調整（詳細說明將於 User Prompt 中提供）。\n"
            "5. 回傳的 JSON 格式必須 100% 合法，且欄位名稱完全一致。\n"
            "6. 內容必須全部使用繁體中文(zh-TW)撰寫。"
        )

        user_prompt = (
            f"【當前使用者角色與視角】\n"
            f"{perspective}\n\n"
            f"【銷售統計聚合數據】\n"
            f"- 總訂單數: {aggregated_data.get('total_orders')} 筆\n"
            f"- 總銷售金額: {aggregated_data.get('total_amount')} 元\n"
            f"- 平均單筆訂單金額: {aggregated_data.get('average_amount')} 元\n"
            f"- 熱銷商品統計: {json.dumps(aggregated_data.get('product_stats'), ensure_ascii=False)}\n"
            f"- 時間序列銷售趨勢 (每日銷售額): {json.dumps(aggregated_data.get('time_series'), ensure_ascii=False)}\n"
            f"- 訂單狀態統計: {json.dumps(aggregated_data.get('status_stats'), ensure_ascii=False)}\n\n"
            f"請依照 System Prompt 規定的角色視角，深度解讀上述銷售數據。\n"
            f"- 若您為 Admin/Viewer 提供分析：請專注於「整體銷售趨勢、跨產品品類表現、客戶群體大方向變化、中長期營運戰略調整及資源配置建議」。\n"
            f"- 若您為 Sales 提供分析：請專注於「個人負責的熱銷商品組合、特定訂單狀態的跟進提醒、個人客戶回購率與近期互動要點、能直接提升下月個人業績的微觀執行指南」。\n\n"
            f"請產出並回傳嚴格符合 schema 的繁體中文 JSON 數據。"
        )

        # 4. 呼叫 Gemini 服務，具備 2 次失敗重試機制 (共 3 次嘗試)
        model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
        max_retries = 2
        attempt = 0
        last_error = None

        while attempt <= max_retries:
            try:
                # 建立 model 並設定 system_instruction 與 json 輸出格式
                model = genai.GenerativeModel(
                    model_name=model_name,
                    system_instruction=system_prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                
                # 呼叫 API (非同步)
                response = await model.generate_content_async(user_prompt)
                response_text = response.text
                
                if not response_text:
                    raise ValueError("Gemini API 回傳空內容")

                # 清理 Markdown 的 ```json ... ``` 包裝
                cleaned_text = response_text.strip()
                if cleaned_text.startswith("```"):
                    lines = cleaned_text.splitlines()
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    cleaned_text = "\n".join(lines).strip()

                # 解析 JSON 數據
                report_json = json.loads(cleaned_text)

                # 使用 Pydantic 強制進行 schema 驗證與欄位格式清洗
                validated_report = AIReportResponse.model_validate(report_json)
                report_dict = validated_report.model_dump()

                # 5. 生成成功後，非同步寫入歷史紀錄表 (JSONB 快取機制，包含指紋)
                if user_id:
                    try:
                        history_repo = AnalyticsService._get_report_history_repo()
                        history_repo.save_report(
                            user_id=str(user_id),
                            report_type="sales_analytics",
                            filter_parameters=cache_filters,
                            report_content=report_dict
                        )
                        logger.info(f"AI 銷售分析已存入歷史紀錄與快取。使用者 ID: {user_id}")
                    except Exception as he:
                        logger.error(f"寫入銷售報告歷史紀錄失敗: {str(he)}")

                # 驗證成功，直接回傳 model_dump
                return report_dict

            except Exception as e:
                attempt += 1
                last_error = e
                logger.warning(f"AI Report generation attempt {attempt} failed. Error: {str(e)}")
                if attempt > max_retries:
                    break

        # 將詳細的例外記錄於後台 logger，但回傳乾淨、不暴露任何 Provider 資訊的友善繁體中文提示
        logger.exception("AI Report generation completely failed after retries")
        raise HTTPException(
            status_code=502,
            detail="AI 分析服務目前忙碌中，請稍後再試。"
        )

    @staticmethod
    async def get_report_history(user: dict) -> list:
        """
        獲取當前使用者的 AI 銷售分析歷史報告紀錄清單。
        """
        profile = user.get("profile", user)
        user_id = user.get("id") or profile.get("id")
        if not user_id:
            return []

        try:
            history_repo = AnalyticsService._get_report_history_repo()
            records = history_repo.get_by_user(str(user_id), limit=10)
            
            history_list = []
            for r in records:
                history_list.append({
                    "id": r.get("id"),
                    "user_id": r.get("user_id"),
                    "report_type": r.get("report_type"),
                    "filter_parameters": r.get("filter_parameters") or {},
                    "report_content": r.get("report_content") or {},
                    "created_at": r.get("created_at")
                })
            return history_list
        except Exception as e:
            logger.error(f"獲取銷售報告歷史清單失敗 (user_id: {user_id}): {str(e)}")
            return []

    @staticmethod
    async def get_realtime_insights(user: dict) -> dict:
        """
        獲取首頁 AI 銷售速報。
        撈取包含昨天在內的最近 7 天數據，計算 date_from 與 date_to，並呼叫 Gemini 同步生成極簡銷售速報。
        使用 1 小時快取以防止重覆呼叫。
        """
        # 1. 計算日期區間 (完整 7 日，排除當日)
        tz_taipei = timezone(timedelta(hours=8))
        now_taipei = datetime.now(tz_taipei)
        today_taipei = now_taipei.date()
        yesterday = today_taipei - timedelta(days=1)
        
        date_to = yesterday.strftime("%Y-%m-%d")
        date_from = (yesterday - timedelta(days=6)).strftime("%Y-%m-%d")
        
        filters = {
            "date_from": date_from,
            "date_to": date_to
        }
        
        # 2. 獲取角色與聚合數據
        profile = user.get("profile", user)
        role = profile.get("role")
        
        aggregated_data = await AnalyticsService.aggregate_orders(filters, user)
        
        # 3. 取得 1 小時快取窗口與雜湊鍵
        time_window = int(time.time() // 3600)
        aggregated_data_str = json.dumps(aggregated_data, sort_keys=True, ensure_ascii=False)
        
        # 4. 呼叫 cached helper (lru_cache)
        insights = AnalyticsService._get_cached_realtime_insights(time_window, role, aggregated_data_str)
        
        return {
            "insights": insights,
            "date_from": date_from,
            "date_to": date_to
        }

    @staticmethod
    @lru_cache(maxsize=128)
    def _get_cached_realtime_insights(time_window: int, role: str, aggregated_data_str: str) -> str:
        """
        使用 lru_cache 快取極簡銷售速報生成結果。
        """
        # 準備 Prompts
        system_prompt = (
            "您是一位頂尖的「AI 銷售分析專家」。\n"
            "請根據提供的前 7 天銷售聚合數據，撰寫一份極簡、精煉且具穿透力的「過去 7 日銷售速報心得」。\n"
            "請直接輸出分析結論，不要帶有任何 JSON 格式、Markdown 標記或解釋性廢話，字數嚴格控制在 150 字以內，並全部使用繁體中文(zh-TW)撰寫。"
        )
        
        user_prompt = (
            f"【使用者角色】: {role}\n"
            f"【過往 7 天銷售聚合數據】: {aggregated_data_str}\n"
            "請提供精煉的 7 日銷售速報心得（150字以內，繁體中文）。"
        )
        
        model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_prompt
        )
        
        # 同步生成
        response = model.generate_content(user_prompt)
        return response.text.strip() if response.text else "無法取得銷售速報。"

    @staticmethod
    async def background_generate_ai_report(task_id: str, cache_filters: dict, user: dict) -> None:
        """
        非同步背景生成 AI 銷售報告，並在成功或失敗後更新 report_history 資料表。
        """
        profile = user.get("profile", user)
        user_id = user.get("id") or profile.get("id")
        
        try:
            logger.info(f"開始非同步背景生成 AI 報告，任務 ID: {task_id}")
            
            # 獲取聚合數據
            aggregated_data = await AnalyticsService.aggregate_orders(cache_filters, user)
            
            role = profile.get("role")
            if role in ["admin", "viewer"]:
                perspective = (
                    "您當前扮演『高階商業智慧分析師』，正為系統的管理員(Admin)與檢視者(Viewer)提供『宏觀銷售決策報告』。\n"
                    "分析重點：請提供『宏觀營運策略、跨部門/跨產品走勢、大方向調整建議』。"
                )
            elif role == "sales":
                perspective = (
                    "您當前扮演『高階商業智慧分析師』，正為負責個人銷售業務的銷售專員(Sales)提供『微觀執行與跟進建議報告』。\n"
                    "分析重點：請提供『微觀執行建議、個人客戶跟進提醒、個人暢銷商品組合』。"
                )
            else:
                raise ValueError("未授權的角色權限")

            system_prompt = (
                "您是一位頂尖且經驗豐富的「高階商業智慧分析師」。\n"
                "您的任務是根據系統提供的結構化銷售統計聚合數據，結合使用者的角色視角，撰寫一份具備深度洞察力、精準預測力與高實操性的商業分析報告。\n\n"
                "您必須嚴格回傳一個符合以下 JSON 格式的數據結構，不可包含任何非 JSON 的字串、解釋或 Markdown 區塊包裝：\n\n"
                "{\n"
                '  "summary": "【少於 20 字的簡短報告摘要，必須精煉且具衝擊力】",\n'
                '  "trends": {\n'
                '    "insights": "【詳細的趨勢分析與洞察，解釋銷售的走向與原因】",\n'
                '    "trend_direction": "【趨勢走向描述，如：持續上升、平穩震盪、面臨下滑】",\n'
                '    "chart_data": [\n'
                '      {\n'
                '        "name": "【圖表數值標籤或日期，例如：2026-05-01】",\n'
                '        "value": 12345.6\n'
                "      }\n"
                "    ]\n"
                "  },\n"
                '  "top_products": [\n'
                "    {\n"
                '      "name": "【商品名稱】",\n'
                '      "quantity": 10,\n'
                '      "revenue": 120000.0,\n'
                '      "insights": "【該商品之銷售原因分析及未來推廣洞察】"\n'
                "    }\n"
                "  ],\n"
                '  "forecast": {\n'
                '    "next_30_days_revenue": 150000.0,\n'
                '    "confidence": 0.85,\n'
                '    "recommendation": "【針對未來 30 天營收預測所提出的具體預防性或擴張性運營策略建議】"\n'
                "  },\n"
                '  "recommendations": [\n'
                '    "【具體行動建議 1】",\n'
                '    "【具體行動建議 2】",\n'
                '    "【具體行動建議 3，至少提供兩到三條高度可執行的建議】"\n'
                "  ]\n"
                "}\n\n"
                "請確保：\n"
                "1. `summary` 必須在 20 個字元以內（含標點符號）。\n"
                "2. `forecast.confidence` 必須是 0.0 到 1.0 之間的浮點數，代表您對預測的信心指數。\n"
                "3. `trends.chart_data` 必須是一個包含 `name` (字串) 與 `value` (數字) 鍵值對的物件陣列，可用於繪製銷售趨勢圖。\n"
                "4. 針對不同使用者角色的分析焦點需動態調整（詳細說明將於 User Prompt 中提供）。\n"
                "5. 回傳的 JSON 格式必須 100% 合法，且欄位名稱完全一致。\n"
                "6. 內容必須全部使用繁體中文(zh-TW)撰寫。"
            )

            user_prompt = (
                f"【當前使用者角色與視角】\n"
                f"{perspective}\n\n"
                f"【銷售統計聚合數據】\n"
                f"- 總訂單數: {aggregated_data.get('total_orders')} 筆\n"
                f"- 總銷售金額: {aggregated_data.get('total_amount')} 元\n"
                f"- 平均單筆訂單金額: {aggregated_data.get('average_amount')} 元\n"
                f"- 熱銷商品統計: {json.dumps(aggregated_data.get('product_stats'), ensure_ascii=False)}\n"
                f"- 時間序列銷售趨勢 (每日銷售額): {json.dumps(aggregated_data.get('time_series'), ensure_ascii=False)}\n"
                f"- 訂單狀態統計: {json.dumps(aggregated_data.get('status_stats'), ensure_ascii=False)}\n\n"
                f"請依照 System Prompt 規定的角色視角，深度解讀上述銷售數據。\n"
                f"- 若您為 Admin/Viewer 提供分析：請專注於「整體銷售趨勢、跨產品品類表現、客戶群體大方向變化、中長期營運戰略調整及資源配置建議」。\n"
                f"- 若您為 Sales 提供分析：請專注於「個人負責的熱銷商品組合、特定訂單狀態的跟進提醒、個人客戶回購率與近期互動要點、能直接提升下月個人業績的微觀執行指南」。\n\n"
                f"請產出並回傳嚴格符合 schema 的繁體中文 JSON 數據。"
            )

            # 呼叫 Gemini 服務，具備 2 次失敗重試機制
            model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
            max_retries = 2
            attempt = 0
            validated_report = None
            
            while attempt <= max_retries:
                try:
                    model = genai.GenerativeModel(
                        model_name=model_name,
                        system_instruction=system_prompt,
                        generation_config={"response_mime_type": "application/json"}
                    )
                    
                    response = await model.generate_content_async(user_prompt)
                    response_text = response.text
                    
                    if not response_text:
                        raise ValueError("Gemini API 回傳空內容")

                    cleaned_text = response_text.strip()
                    if cleaned_text.startswith("```"):
                        lines = cleaned_text.splitlines()
                        if lines[0].startswith("```"):
                            lines = lines[1:]
                        if lines and lines[-1].startswith("```"):
                            lines = lines[:-1]
                        cleaned_text = "\n".join(lines).strip()

                    report_json = json.loads(cleaned_text)
                    # 確保必要欄位存在以觸發重試
                    required_fields = ["summary", "trends", "top_products", "forecast", "recommendations"]
                    for field in required_fields:
                        if not report_json.get(field):
                            raise ValueError(f"缺少必要欄位: {field}")
                    validated_report = AIReportResponse.model_validate(report_json)
                    break
                except Exception as e:
                    attempt += 1
                    logger.warning(f"背景生成嘗試 {attempt} 失敗: {str(e)}")
                    if attempt > max_retries:
                        raise e
            
            if not validated_report:
                raise ValueError("無法成功解析並驗證 AI 報告")

            report_dict = validated_report.model_dump()
            report_dict["status"] = "success"
            report_dict["task_id"] = task_id
            
            # 更新為成功狀態與完整內容
            history_repo = AnalyticsService._get_report_history_repo()
            history_repo.update({"report_content": report_dict}, {"id": task_id})
            logger.info(f"背景生成 AI 報告成功，任務 ID: {task_id} 已更新。")
            
        except Exception as ex:
            logger.error(f"背景生成 AI 報告時發生致命錯誤，任務 ID: {task_id}, 錯誤: {str(ex)}")
            try:
                history_repo = AnalyticsService._get_report_history_repo()
                failed_content = {
                    "status": "failed",
                    "task_id": task_id,
                    "error": "AI 分析服務目前忙碌中，請稍後再試。"
                }
                history_repo.update({"report_content": failed_content}, {"id": task_id})
            except Exception as ue:
                logger.error(f"更新任務為失敗狀態時也失敗: {str(ue)}")

    @staticmethod
    async def send_report_email_task(
        email: str, 
        filters: dict, 
        report_summary: str, 
        report_content: dict, 
        user: dict,
        raise_on_error: bool = False
    ) -> None:
        """
        雙軌制背景發信任務：
        1. 本地直寄 (ENABLE_SMTP_DIRECT)：生成 PDF / Excel 附件（若為 Viewer 則依 RBAC 安全防禦自動排除 Excel 附件），並使用科技感 HTML 模板發送。
        2. Webhook 擴充 (ENABLE_N8N_WEBHOOK)：將 Payload 發送至指定的 n8n Webhook 串接外部自動化。
        """
        # 延遲導入以解決與 ExportService 之間的 Python 循環引用 (Circular Import) 問題
        from services.export_service import ExportService
        from services.email_service import EmailService
        from services.email_template import render_analytics_report_email

        profile = user.get("profile", user)
        role = profile.get("role", "viewer")
        employee_id = profile.get("employee_id", "")
        user_email = profile.get("email") or user.get("email") or ""

        # 優先解析實際收件者信箱：
        # 如果是真實帳號 EMP0001 且有設定 email，則發送至該使用者的 email；
        # 其餘皆為假資料，防禦性地 fallback 到 .env 中設定的 SMTP_USER 或 SMTP_FROM，確保開發與測試時能收到真實信件。
        if employee_id == "EMP0001" and user_email:
            target_email = user_email
        else:
            target_email = os.getenv("SMTP_USER") or os.getenv("SMTP_FROM") or email

        logger.info(f"開始背景郵件發送任務。原始請求收件者: {email}, 解析後實際發送收件者: {target_email}, 使用者角色: {role}")

        # 1. 處理並組裝附件列表 (本地直寄需要)
        attachments = []
        
        # A. 生成 PDF 報告附件
        try:
            pdf_data = await ExportService.generate_pdf(filters, user)
            if pdf_data:
                attachments.append({
                    "data": pdf_data,
                    "filename": "AI_Sales_Analytics_Report.pdf",
                    "mime_type": "application/pdf"
                })
                logger.info("PDF 報告附件生成成功")
        except Exception as pe:
            logger.error(f"生成 PDF 報告附件失敗: {str(pe)}", exc_info=True)
            if raise_on_error:
                raise pe

        # B. 安全過濾 (RBAC)：如果角色為 viewer (檢視者)，強制進行安全降級，不生成也不夾帶 Excel 原始明細附件
        if role == "viewer":
            logger.info("使用者角色為 Viewer (檢視者)，觸發安全防禦降級機制，排除 Excel 原始明細附件。")
        else:
            try:
                excel_data = await ExportService.generate_excel(filters, user)
                if excel_data:
                    attachments.append({
                        "data": excel_data,
                        "filename": "Sales_Raw_Data_Details.xlsx",
                        "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    })
                    logger.info("Excel 數據明細附件生成成功")
            except Exception as ee:
                logger.warning(f"生成 Excel 數據明細附件失敗或被拒絕: {str(ee)}")
                if raise_on_error:
                    raise ee

        # 2. 軌道一：本地 SMTP 直接發信
        enable_smtp = os.getenv("ENABLE_SMTP_DIRECT", "True").lower() == "true"
        if enable_smtp:
            try:
                # 渲染高質感 HTML 郵件內文
                html_content = render_analytics_report_email(
                    report_summary=report_summary,
                    report_content=report_content,
                    filters=filters,
                    role=role
                )
                
                subject = f"【AI 銷售速報】{report_summary}"
                text_content = f"您的 AI 銷售分析報告已成功生成。\n摘要: {report_summary}\n請查收信件中夾帶的 PDF 與 Excel 附件以檢視完整數據分析。"
                
                # 呼叫非同步 EmailService 發信
                success = await EmailService.send_report_with_attachments(
                    email=target_email,
                    subject=subject,
                    html_content=html_content,
                    text_content=text_content,
                    attachments=attachments,
                    raise_on_error=raise_on_error
                )
                if not success and raise_on_error:
                    raise Exception("本地 SMTP 寄送失敗，功能被禁用或憑證異常。")
            except Exception as se:
                logger.error(f"本地 SMTP 直寄通道發信失敗: {str(se)}", exc_info=True)
                if raise_on_error:
                    raise se

        # 3. 軌道二：外部 n8n Webhook 調用
        enable_n8n = os.getenv("ENABLE_N8N_WEBHOOK", "False").lower() == "true"
        if enable_n8n:
            n8n_url = os.getenv("N8N_WEBHOOK_URL")
            payload = {
                "email": target_email,
                "filters": filters,
                "report_summary": report_summary,
                "report_content": report_content,
                "role": role,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            if n8n_url:
                import httpx
                try:
                    async with httpx.AsyncClient() as client:
                        res = await client.post(n8n_url, json=payload, timeout=10.0)
                        logger.info(f"成功發送 Webhook 至 n8n。狀態碼: {res.status_code}")
                except Exception as ne:
                    logger.error(f"發送 Webhook 至 n8n 失敗: {str(ne)}")
                    if raise_on_error:
                        raise ne
            else:
                logger.warning("[n8n Webhook] n8n Webhook 功能已開啟，但未配置 N8N_WEBHOOK_URL！跳過調用。")
                if raise_on_error:
                    raise Exception("n8n Webhook 功能已啟用，但未配置 N8N_WEBHOOK_URL。")



    @staticmethod
    async def get_subscription(user: dict) -> dict:
        """
        獲取當前使用者的訂閱偏好設定。
        """
        profile = user.get("profile", user)
        user_id = user.get("id") or profile.get("id")
        email = profile.get("email") or ""
        
        if not user_id:
            raise HTTPException(status_code=400, detail="無法識別的使用者 ID")
            
        sub_repo = AnalyticsService._get_subscription_repo()
        sub = sub_repo.get_by_user(str(user_id))
        
        if not sub:
            # 預設回傳未訂閱狀態
            return {
                "user_id": user_id,
                "email": email,
                "is_subscribed": False,
                "frequency": "weekly",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        return sub

    @staticmethod
    async def update_subscription(subscription_update: dict, user: dict) -> dict:
        """
        更新當前使用者的訂閱偏好設定。
        """
        profile = user.get("profile", user)
        user_id = user.get("id") or profile.get("id")
        email = profile.get("email") or ""
        
        if not user_id:
            raise HTTPException(status_code=400, detail="無法識別的使用者 ID")
            
        is_subscribed = subscription_update.get("is_subscribed", False)
        frequency = subscription_update.get("frequency", "weekly")
        
        sub_repo = AnalyticsService._get_subscription_repo()
        res = sub_repo.save_subscription(
            user_id=str(user_id),
            email=email,
            is_subscribed=is_subscribed,
            frequency=frequency
        )
        return res

