from fastapi import HTTPException
from services.supabase_client import get_supabase
from services import audit_service
from models.schemas import OrderSchema, ProductSchema
from typing import List, Optional

# 訂單狀態定義
STATUS_PROCESSING = "處理中"
STATUS_COMPLETED = "已完成"
STATUS_CANCELLED = "已作廢"

class OrderService:
    @staticmethod
    async def get_orders(user: dict) -> List[dict]:
        """
        檢索訂單：
        - admin 或 viewer: 檢索所有訂單
        - sales: 僅檢索自己負責的訂單 (owner_id == employee_id)
        """
        supabase = get_supabase()
        role = user.get("role")
        employee_id = user.get("employee_id")

        query = supabase.table("orders").select("*")

        if role == "sales":
            query = query.eq("owner_id", employee_id)
        elif role not in ["admin", "viewer"]:
            # 若角色不屬於上述任何一種，預設不允許存取或僅限自己
            raise HTTPException(status_code=403, detail="權限不足，無法檢索訂單")

        response = query.execute()
        return response.data

    @staticmethod
    async def get_order_by_id(order_id: str, user: dict) -> dict:
        """
        獲取單筆訂單：
        - admin 或 viewer: 可查看所有
        - sales: 僅能查看自己負責的訂單
        """
        supabase = get_supabase()
        role = user.get("role")
        employee_id = user.get("employee_id")

        query = supabase.table("orders").select("*").eq("id", order_id)
        response = query.execute()

        if not response.data:
            raise HTTPException(status_code=404, detail="找不到訂單")

        order = response.data[0]

        if role == "sales" and order.get("owner_id") != employee_id:
            raise HTTPException(status_code=403, detail="權限不足，您無權查看此訂單")
        elif role not in ["admin", "viewer", "sales"]:
            raise HTTPException(status_code=403, detail="權限不足")

        return order

    @staticmethod
    async def create_order(data: dict, user: dict) -> dict:
        """
        建立訂單：
        - 僅限 admin 或 sales
        - sales 強制設定 owner_id
        - 從 products 獲取價格計算 amount
        - 記錄審計日誌
        """
        role = user.get("role")
        employee_id = user.get("employee_id")

        if role not in ["admin", "sales"]:
            raise HTTPException(status_code=403, detail="僅限 Admin 或 Sales 建立訂單")

        supabase = get_supabase()
        product_id = data.get("product_id")

        if not product_id:
            raise HTTPException(status_code=400, detail="必須提供 product_id")

        # 1. 獲取產品資訊並計算金額
        product_response = supabase.table("products").select("*").eq("product_id", product_id).execute()
        if not product_response.data:
            raise HTTPException(status_code=404, detail=f"找不到產品 ID: {product_id}")
        
        product_info = product_response.data[0]
        price = product_info.get("price", 0)

        # 如果前端沒傳入 amount，則使用單價
        amount = data.get("amount")
        if amount is None:
            amount = price

        # 2. 準備訂單資料
        order_data = {
            "product_id": product_id,
            "amount": amount,
            "status": STATUS_PROCESSING,
            "customer": data.get("customer", "Unknown"),
        }

        # 針對 sales 強制設定 owner_id
        if role == "sales":
            order_data["owner_id"] = employee_id
        else:
            order_data["owner_id"] = data.get("owner_id", employee_id)

        # 3. 寫入資料庫
        response = supabase.table("orders").insert(order_data).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="建立訂單失敗")

        new_order = response.data[0]

        # 4. 記錄審計日誌
        await audit_service.log_action(
            user_id=employee_id,
            action="CREATE_ORDER",
            target=f"Order ID: {new_order.get('id')}"
        )

        return new_order

    @staticmethod
    async def update_order_status(order_id: str, new_status: str, user: dict) -> dict:
        """
        修改訂單狀態：
        - admin: 可修改任何訂單
        - sales: 僅能修改自己負責且狀態為「處理中」的訂單
        - 記錄審計日誌
        """
        role = user.get("role")
        employee_id = user.get("employee_id")
        supabase = get_supabase()

        # 1. 獲取原訂單資訊進行檢查
        order_response = supabase.table("orders").select("*").eq("id", order_id).execute()
        if not order_response.data:
            raise HTTPException(status_code=404, detail="找不到訂單")
        
        current_order = order_response.data[0]

        # 2. 狀態機檢查
        if current_order.get("status") != STATUS_PROCESSING:
            raise HTTPException(status_code=403, detail=f"訂單狀態為 {current_order.get('status')}，不可修改")

        # 3. RBAC 權限檢查
        if role == "sales":
            if current_order.get("owner_id") != employee_id:
                raise HTTPException(status_code=403, detail="您無權修改他人的訂單")
        elif role != "admin":
            raise HTTPException(status_code=403, detail="權限不足，無法修改訂單狀態")

        # 4. 更新狀態
        update_response = supabase.table("orders").update({"status": new_status}).eq("id", order_id).execute()
        if not update_response.data:
            raise HTTPException(status_code=500, detail="更新訂單狀態失敗")

        updated_order = update_response.data[0]

        # 4. 記錄審計日誌
        await audit_service.log_action(
            user_id=employee_id,
            action="UPDATE_ORDER_STATUS",
            target=f"Order ID: {order_id}, New Status: {new_status}"
        )

        return updated_order
