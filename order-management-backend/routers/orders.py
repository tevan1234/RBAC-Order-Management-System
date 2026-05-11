from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from models.schemas import OrderSchema, OrderUpdate
from services.supabase_client import get_supabase
from services.auth_service import get_current_user, require_sales_or_admin
from services.order_service import OrderService
from services.audit_service import log_action

router = APIRouter(prefix="/orders", tags=["Order Management"])

@router.get("/", response_model=List[OrderSchema])
async def list_orders(user: dict = Depends(get_current_user)):
    """列出訂單資料。如果是業務，只能看到自己負責的訂單；管理員可以看到全部。"""
    supabase = get_supabase()
    query = supabase.table("orders").select("*")
    
    profile = user["profile"]
    if profile["role"] == "sales":
        query = query.eq("owner_id", profile["employee_id"])
        
    res = query.execute()
    return res.data

@router.post("/")
async def create_order(req: OrderSchema, user: dict = Depends(require_sales_or_admin)):
    """建立新訂單"""
    supabase = get_supabase()
    data = req.model_dump()
    data["created_at"] = datetime.now().isoformat()
    data["updated_at"] = datetime.now().isoformat()
    
    # 強制設定負責人為目前使用者 (如果是業務)
    if user["profile"]["role"] == "sales":
        data["owner_id"] = user["profile"]["employee_id"]
        
    res = supabase.table("orders").insert(data).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="建立訂單失敗")
        
    await log_action(user["profile"]["employee_id"], "CREATE_ORDER", f"Created order: {req.id}")
    return res.data[0]

@router.patch("/{order_id}/status")
async def update_order_status(order_id: str, status: str, user: dict = Depends(require_sales_or_admin)):
    """更新訂單狀態 (處理中, 已完成, 已作廢)"""
    return await OrderService.update_order_status(order_id, status, user)

@router.patch("/{order_id}")
async def update_order(order_id: str, req: OrderUpdate, user: dict = Depends(require_sales_or_admin)):
    """更新訂單資訊 (通用)"""
    update_data = req.model_dump(exclude_unset=True)
    return await OrderService.update_order(order_id, update_data, user)
