from fastapi import HTTPException
from typing import List, Dict, Any
from datetime import datetime, timezone
from services.supabase_client import get_supabase, get_supabase_admin
from services.audit_service import log_action
from repositories import CustomerRepository

def _get_repo(admin: bool = False):
    client = get_supabase_admin() if admin else get_supabase()
    return CustomerRepository(client)

async def get_customers(user: dict) -> List[Dict[str, Any]]:
    """取得客戶資料，支援角色過濾 (Sales 可看自己及 Admin 客戶)"""
    profile = user.get("profile", user)
    role = profile.get("role")
    employee_id = profile.get("employee_id")
    
    repo = _get_repo(admin=True)
    
    if role == "sales":
        # 獲取所有 Admin 的 employee_id
        admin_ids = await get_admin_employee_ids()
        owners = [employee_id] + admin_ids
        return repo.get_customers_by_owners(owners)
    else:
        return repo.get_customers()

async def get_admin_employee_ids() -> List[str]:
    """獲取系統中所有 Admin 的 employee_id"""
    from services.supabase_client import get_supabase_admin
    supabase = get_supabase_admin()
    res = supabase.table("profiles").select("employee_id").eq("role", "admin").execute()
    return [r["employee_id"] for r in res.data] if res.data else []

async def get_customer(customer_id: str, user: dict) -> Dict[str, Any]:
    """取得單一客戶資料"""
    profile = user.get("profile", user)
    role = profile.get("role")
    employee_id = profile.get("employee_id")
    
    repo = _get_repo(admin=True)
    customer = repo.get_customer_by_id(customer_id)
    
    if not customer:
        raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
        
    # 權限檢查邏輯 (與 get_customers 一致)
    if role == "sales":
        admin_ids = await get_admin_employee_ids()
        allowed_owners = [employee_id] + admin_ids
        if customer.get("owner_id") not in allowed_owners:
            raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
            
    return customer

async def create_customer(data: Dict[str, Any], user: dict) -> Dict[str, Any]:
    """建立新客戶，限管理員或業務"""
    profile = user.get("profile", user)
    role = profile.get("role")
    employee_id = profile.get("employee_id")
        
    # 寫入操作使用 Admin 權限以繞過 RLS
    repo = _get_repo(admin=True)
    
    # 準備資料
    customer_data = data.copy()
    
    # 生成 ID (如果前端沒給)
    if not customer_data.get("customer_id"):
        import time
        customer_data["customer_id"] = f"CUST{int(time.time()*1000)}"
        
    # 設定負責人 (業務強制設定為自己，管理員若未填則設定為自己)
    if role == "sales":
        customer_data["owner_id"] = employee_id
    elif not customer_data.get("owner_id"):
        customer_data["owner_id"] = employee_id
        
    res = repo.create_customer(customer_data)
    
    if not res:
        raise HTTPException(status_code=400, detail="建立客戶失敗")
        
    # 紀錄 Log
    await log_action(employee_id, "CREATE_CUSTOMER", f"Created customer: {customer_data.get('customer_id')}")
    
    return res

async def update_customer(customer_id: str, data: Dict[str, Any], user: dict) -> Dict[str, Any]:
    """更新客戶資訊，包含權限檢查"""
    profile = user.get("profile", user)
    role = profile.get("role")
    employee_id = profile.get("employee_id")
            
    # 準備更新資料
    update_data = data.copy()

    # 自動補充 UTC 時間戳 (ISO 格式)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # 權限檢查：僅限 admin 可修改狀態
    if "status" in update_data and role != "admin":
        update_data.pop("status")
    
    # 使用 Admin 權限執行更新
    repo_admin = _get_repo(admin=True)
    res = repo_admin.update_customer(customer_id, update_data)
    
    if not res:
        raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
        
    # 紀錄 Log
    await log_action(employee_id, "UPDATE_CUSTOMER", f"Updated customer: {customer_id}")
    
    return res

async def delete_customer(customer_id: str, user: dict) -> bool:
    """刪除客戶，僅限管理員"""
    profile = user.get("profile", user)
    employee_id = profile.get("employee_id")
        
    repo_admin = _get_repo(admin=True)
    
    # 1. 檢查是否存在
    current_customer = repo_admin.get_customer_by_id(customer_id)
    if not current_customer:
        raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
        
    # 2. 執行刪除
    success = repo_admin.delete_customer(customer_id)
    
    if not success:
        raise HTTPException(status_code=400, detail="刪除客戶時發生錯誤")
        
    # 3. 紀錄 Log
    await log_action(employee_id, "DELETE_CUSTOMER", f"Deleted customer: {customer_id}")
    
    return True

