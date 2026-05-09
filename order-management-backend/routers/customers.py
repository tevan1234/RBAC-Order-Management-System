from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime
from models.schemas import CustomerSchema
from services.supabase_client import get_supabase
from services.auth_service import get_current_user, require_sales_or_admin
from services.audit_service import log_action

router = APIRouter(prefix="/customers", tags=["Customer Management"])

@router.get("/", response_model=List[CustomerSchema])
async def list_customers(user: dict = Depends(get_current_user)):
    """列出客戶資料。如果是業務，只能看到自己負責的客戶；管理員可以看到全部。"""
    supabase = get_supabase()
    query = supabase.table("customers").select("*")
    
    # RBAC 過濾
    profile = user["profile"]
    if profile["role"] == "sales":
        query = query.eq("owner_id", profile["employee_id"])
        
    res = query.execute()
    return res.data

@router.post("/")
async def create_customer(req: CustomerSchema, user: dict = Depends(require_sales_or_admin)):
    """建立新客戶"""
    supabase = get_supabase()
    data = req.model_dump()
    data["created_at"] = datetime.now().isoformat()
    data["updated_at"] = datetime.now().isoformat()
    
    res = supabase.table("customers").insert(data).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="建立客戶失敗")
        
    await log_action(user["profile"]["employee_id"], "CREATE_CUSTOMER", f"Created customer: {req.customer_id}")
    return res.data[0]

@router.patch("/{customer_id}")
async def update_customer(customer_id: str, data: dict, user: dict = Depends(require_sales_or_admin)):
    """更新客戶資訊"""
    supabase = get_supabase()
    data["updated_at"] = datetime.now().isoformat()
    
    # 檢查權限：只能更新自己的客戶 (管理員除外)
    if user["profile"]["role"] == "sales":
        check = supabase.table("customers").select("owner_id").eq("customer_id", customer_id).single().execute()
        if not check.data or check.data["owner_id"] != user["profile"]["employee_id"]:
            raise HTTPException(status_code=403, detail="您無權編輯此客戶")

    res = supabase.table("customers").update(data).eq("customer_id", customer_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到該客戶")
        
    await log_action(user["profile"]["employee_id"], "UPDATE_CUSTOMER", f"Updated customer: {customer_id}")
    return res.data[0]
