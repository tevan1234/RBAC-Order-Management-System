import os
import json
import logging
import google.generativeai as genai
from fastapi import HTTPException
from services.supabase_client import get_supabase_admin
from repositories import OrderRepository, ProductRepository
from typing import List, Dict, Any
from datetime import datetime
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
        total_amount = 0.0
        
        product_agg = {}   # {product_id: {"quantity": int, "total_amount": float}}
        time_series = {}   # {date_str: float}
        status_stats = {}  # {status: int}

        for order in orders:
            amount = float(order.get("amount") or 0.0)
            status = order.get("status") or "未知狀態"
            p_id = order.get("product_id") or "未知商品ID"
            created_at_str = order.get("created_at")

            # 總金額
            total_amount += amount

            # 按狀態分組
            status_stats[status] = status_stats.get(status, 0) + 1

            # 按產品分組
            if p_id not in product_agg:
                product_agg[p_id] = {"quantity": 0, "total_amount": 0.0}
            product_agg[p_id]["quantity"] += 1
            product_agg[p_id]["total_amount"] += amount

            # 按時間序列分組 (YYYY-MM-DD)
            if created_at_str:
                try:
                    date_key = created_at_str.split("T")[0]
                    time_series[date_key] = time_series.get(date_key, 0.0) + amount
                except Exception:
                    pass

        # 計算平均金額
        average_amount = total_amount / total_orders if total_orders > 0 else 0.0

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

        # 時間序列依日期排序
        sorted_time_series = {k: time_series[k] for k in sorted(time_series.keys())}

        # 4. 組裝回傳字典 (將會自動套用於 AggregatedStats 驗證)
        return {
            "total_orders": total_orders,
            "total_amount": total_amount,
            "average_amount": average_amount,
            "product_stats": product_stats_list,
            "time_series": sorted_time_series,
            "status_stats": status_stats
        }

    @staticmethod
    async def generate_ai_report(filters: dict, user: dict) -> dict:
        """
        銷售分析 AI 報告生成。
        內部先呼叫 aggregate_orders 進行硬性角色隔離之數據聚合，
        然後依據當前使用者角色提供動態的 AI 商業智慧分析，支援 2 次失敗重試。
        """
        # 1. 數據獲取 (包含角色隔離防禦)
        aggregated_data = await AnalyticsService.aggregate_orders(filters, user)

        # 2. 獲取使用者角色並調整分析視角
        profile = user.get("profile", user)
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

                # 驗證成功，直接回傳 model_dump
                return validated_report.model_dump()

            except Exception as e:
                attempt += 1
                last_error = e
                logger.warning(f"AI Report generation attempt {attempt} failed. Error: {str(e)}")
                if attempt > max_retries:
                    break

        raise HTTPException(
            status_code=502,
            detail=f"AI 分析引擎暫時無法使用，請稍後再試。詳細原因: {str(last_error)}"
        )

