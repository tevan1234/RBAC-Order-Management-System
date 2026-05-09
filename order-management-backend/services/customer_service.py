from fastapi import HTTPException
from typing import List, Dict, Any
from datetime import datetime
from services.supabase_client import get_supabase
from services.audit_service import log_action
from models.schemas import CustomerSchema

async def get_customers(user: dict) -> List[Dict[str, Any]]:
    """取得客戶資料，支援角色過濾"""
    supabase = get_supabase()
    role = user["profile"].get("role")
    employee_id = user["profile"].get("employee_id")
    
    query = supabase.table("customers").select("*")
    
    if role == "sales":
        # 業務僅能看到自己負責的客戶
        query = query.eq("owner_id", employee_id)
    elif role not in ["admin", "viewer"]:
        raise HTTPException(status_code=403, detail="權限不足，無法讀取客戶資料")
        
    res = query.execute()
    return res.data

async def create_customer(data: Dict[str, Any], user: dict) -> Dict[str, Any]:
    """建立新客戶，限管理員或業務"""
    role = user["profile"].get("role")
    employee_id = user["profile"].get("employee_id")
    
    if role not in ["admin", "sales"]:
        raise HTTPException(status_code=403, detail="權限不足，僅限管理員或業務建立客戶")
        
    supabase = get_supabase()
    
    # 準備資料
    customer_data = data.copy()
    if role == "sales":
        # 強制設定負責人為目前業務
        customer_data["owner_id"] = employee_id
        
    customer_data["created_at"] = datetime.now().isoformat()
    customer_data["updated_at"] = datetime.now().isoformat()
    
    res = supabase.table("customers").insert(customer_data).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="建立客戶失敗")
        
    # 紀錄 Log
    await log_action(employee_id, "CREATE_CUSTOMER", f"Created customer: {customer_data.get('customer_id')}")
    
    return res.data[0]

async def update_customer(customer_id: str, data: Dict[str, Any], user: dict) -> Dict[str, Any]:
    """更新客戶資訊，包含權限檢查"""
    role = user["profile"].get("role")
    employee_id = user["profile"].get("employee_id")
    
    if role not in ["admin", "sales"]:
        raise HTTPException(status_code=403, detail="權限不足，僅限管理員或業務更新客戶")
        
    supabase = get_supabase()
    
    # 權限檢查：業務僅能修改自己負責的客戶
    if role == "sales":
        check_res = supabase.table("customers").select("owner_id").eq("customer_id", customer_id).single().execute()
        if not check_res.data:
            raise HTTPException(status_code=404, detail="找不到該客戶")
        if check_res.data["owner_id"] != employee_id:
            raise HTTPException(status_code=403, detail="您無權編輯此客戶")
            
    # 準備更新資料
    update_data = data.copy()
    update_data["updated_at"] = datetime.now().isoformat()
    
    res = supabase.table("customers").update(update_data).eq("customer_id", customer_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="更新失敗，找不到該客戶")
        
    # 紀錄 Log
    await log_action(employee_id, "UPDATE_CUSTOMER", f"Updated customer: {customer_id}")
    
    return res.data[0]

async def delete_customer(customer_id: str, user: dict) -> bool:
    """刪除客戶，僅限管理員"""
    role = user["profile"].get("role")
    employee_id = user["profile"].get("employee_id")
    
    if role != "admin":
        raise HTTPException(status_code=403, detail="權限不足，僅限管理員刪除客戶")
        
    supabase = get_supabase()
    
    # 1. 檢查是否存在
    check_res = supabase.table("customers").select("customer_id").eq("customer_id", customer_id).execute()
    if not check_res.data:
        raise HTTPException(status_code=404, detail="找不到該客戶")
        
    # 2. 執行刪除
    res = supabase.table("customers").delete().eq("customer_id", customer_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="刪除客戶時發生錯誤")
        
    # 3. 紀錄 Log
    await log_action(employee_id, "DELETE_CUSTOMER", f"Deleted customer: {customer_id}")
    
    return True
