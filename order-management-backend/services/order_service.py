from fastapi import HTTPException
from services.supabase_client import get_supabase, get_supabase_admin
from services import audit_service
from repositories import OrderRepository, ProductRepository
from typing import List, Optional
from datetime import datetime, timezone
import random

# 訂單狀態定義
STATUS_PROCESSING = "處理中"
STATUS_COMPLETED = "已完成"
STATUS_CANCELLED = "已作廢"

class OrderService:
    @staticmethod
    def _get_repo(admin: bool = False):
        client = get_supabase_admin() if admin else get_supabase()
        return OrderRepository(client)

    @staticmethod
    def _get_product_repo(admin: bool = False):
        client = get_supabase_admin() if admin else get_supabase()
        return ProductRepository(client)

    @staticmethod
    async def get_orders(user: dict) -> List[dict]:
        """
        檢索訂單：
        - admin 或 viewer: 檢索所有訂單
        - sales: 僅檢索自己負責的訂單 (owner_id == employee_id)
        """
        profile = user.get("profile", user) # 相容性處理
        role = profile.get("role")
        employee_id = profile.get("employee_id")

        repo = OrderService._get_repo(admin=True)
        
        if role == "sales":
            return repo.get_orders(owner_id=employee_id)
        elif role in ["admin", "viewer"]:
            return repo.get_orders()
        else:
            raise HTTPException(status_code=403, detail="權限不足，無法檢索訂單")

    @staticmethod
    async def get_order_by_id(order_id: str, user: dict) -> dict:
        """
        獲取單筆訂單：
        - admin 或 viewer: 可查看所有
        - sales: 僅能查看自己負責的訂單
        """
        profile = user.get("profile", user)
        role = profile.get("role")
        employee_id = profile.get("employee_id")

        repo = OrderService._get_repo(admin=True)
        order = repo.get_order_by_id(order_id)

        if not order:
            raise HTTPException(status_code=404, detail="找不到訂單")

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
        profile = user.get("profile", user)
        role = profile.get("role")
        employee_id = profile.get("employee_id")

        if role not in ["admin", "sales"]:
            raise HTTPException(status_code=403, detail="僅限 Admin 或 Sales 建立訂單")

        product_id = data.get("product_id")
        if not product_id:
            raise HTTPException(status_code=400, detail="必須提供 product_id")

        # 1. 獲取產品資訊並計算金額 (透過 ProductRepository)
        product_repo = OrderService._get_product_repo()
        product_info = product_repo.get_product_by_id(product_id)
        
        if not product_info:
            raise HTTPException(status_code=404, detail=f"找不到產品 ID: {product_id}")
        
        price = product_info.get("price", 0)
        amount = data.get("amount") or price

        # 2. 驗證客戶權限與準備訂單資料
        customer_id = data.get("customer") # 這裡假設前端傳來的是 customer_id
        repo_admin = OrderService._get_repo(admin=True)
        
        # 獲取客戶資訊以確認歸屬 (透過 CustomerRepository)
        from services.customer_service import _get_repo as _get_customer_repo
        customer_repo = _get_customer_repo(admin=True)
        customer_info = customer_repo.get_customer_by_id(customer_id)
        
        if not customer_info:
            # 相容性處理：如果找不到客戶，可能傳的是名稱而非 ID (舊邏輯)
            customer_owner_id = None
        else:
            customer_owner_id = customer_info.get("owner_id")

        if role == "sales":
            # 檢查是否為自己或 Admin 的客戶
            from services.customer_service import get_admin_employee_ids
            admin_ids = await get_admin_employee_ids()
            if customer_owner_id and customer_owner_id != employee_id and customer_owner_id not in admin_ids:
                raise HTTPException(status_code=403, detail="您無權為此客戶建立訂單")
            
            order_data_owner_id = employee_id
        else:
            order_data_owner_id = data.get("owner_id") or employee_id

        # 3. 準備訂單資料
        order_id = data.get("id") or f"ORD{random.randint(1000, 9999)}"
        order_data = {
            "id": order_id,
            "product_id": product_id,
            "amount": amount,
            "status": STATUS_PROCESSING,
            "customer": customer_id or data.get("customer", "Unknown"),
            "owner_id": order_data_owner_id
        }

        # 4. 若客戶原屬 Admin，以原子操作轉移負責人給當前 Sales
        #    [關鍵修正]：必須在建立訂單前完成轉移，否則失敗時訂單已寫入
        transfer_result = None
        if role == "sales" and customer_info and customer_owner_id in admin_ids:
            transfer_result = customer_repo.update_customer_conditional(
                customer_id,
                update_data={
                    "owner_id": employee_id,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                },
                condition={"owner_id": customer_owner_id}
            )
            if transfer_result is None:
                raise HTTPException(
                    status_code=409,
                    detail="客戶已被其他同事分派，請刷新列表後重試"
                )

        # 5. 寫入訂單資料庫 (透過 OrderRepository)
        new_order = repo_admin.create_order(order_data)
        
        if not new_order:
            raise HTTPException(status_code=500, detail="建立訂單失敗")

        # 6. 記錄審計日誌
        await audit_service.log_action(
            user_id=employee_id,
            action="CREATE_ORDER",
            details={
                "order_id": order_id,
                "customer_id": customer_id,
                "product_id": product_id,
                "amount": amount,
                "customer_transferred": transfer_result is not None
            }
        )

        if transfer_result:
            await audit_service.log_action(
                user_id=employee_id,
                action="TRANSFER_CUSTOMER",
                details={
                    "customer_id": customer_id,
                    "from_owner_id": customer_owner_id,
                    "to_owner_id": employee_id,
                    "trigger_order_id": order_id,
                    "reason": "auto_assign_on_first_order"
                }
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
        profile = user.get("profile", user)
        role = profile.get("role")
        employee_id = profile.get("employee_id")
        
        repo = OrderService._get_repo(admin=True)

        # 1. 獲取原訂單資訊進行檢查
        current_order = repo.get_order_by_id(order_id)
        if not current_order:
            raise HTTPException(status_code=404, detail="找不到訂單")

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
        updated_order = repo.update_order(order_id, {
            "status": new_status,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        
        if not updated_order:
            raise HTTPException(status_code=500, detail="更新訂單狀態失敗")

        # 5. 記錄審計日誌
        await audit_service.log_action(
            user_id=employee_id,
            action="UPDATE_ORDER_STATUS",
            target=f"Order ID: {order_id}, New Status: {new_status}"
        )

        return updated_order

    @staticmethod
    async def update_order(order_id: str, update_data: dict, user: dict) -> dict:
        """
        更新訂單資訊 (通用)
        """
        profile = user.get("profile", user)
        role = profile.get("role")
        employee_id = profile.get("employee_id")
        
        repo = OrderService._get_repo(admin=True)
        current_order = repo.get_order_by_id(order_id)
        
        if not current_order:
            raise HTTPException(status_code=404, detail="找不到訂單")
            
        # 權限檢查
        if role == "sales" and current_order.get("owner_id") != employee_id:
            raise HTTPException(status_code=403, detail="您無權修改此訂單")
        elif role not in ["admin", "sales"]:
             raise HTTPException(status_code=403, detail="權限不足")

        # 注入更新時間
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        updated_order = repo.update_order(order_id, update_data)
        
        await audit_service.log_action(
            user_id=employee_id,
            action="UPDATE_ORDER",
            target=f"Order ID: {order_id}"
        )
        
        return updated_order

