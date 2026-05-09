from fastapi import APIRouter, HTTPException, Depends
from typing import List
from datetime import datetime
from models.schemas import OrderSchema
from services.supabase_client import get_supabase
from services.auth_service import get_current_user, require_sales_or_admin
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
    if status not in ["處理中", "已完成", "已作廢"]:
        raise HTTPException(status_code=400, detail="無效的狀態值")
        
    supabase = get_supabase()
    
    # 權限檢查
    if user["profile"]["role"] == "sales":
        check = supabase.table("orders").select("owner_id").eq("id", order_id).single().execute()
        if not check.data or check.data["owner_id"] != user["profile"]["employee_id"]:
            raise HTTPException(status_code=403, detail="您無權更新此訂單")
            
    res = supabase.table("orders").update({
        "status": status,
        "updated_at": datetime.now().isoformat()
    }).eq("id", order_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到該訂單")
        
    await log_action(user["profile"]["employee_id"], "UPDATE_ORDER_STATUS", f"Updated order {order_id} to {status}")
    return res.data[0]
