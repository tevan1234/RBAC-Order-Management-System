from fastapi import HTTPException
from services.supabase_client import get_supabase_admin
from repositories import OrderRepository, ProductRepository
from typing import List, Dict, Any
from datetime import datetime

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
