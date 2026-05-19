from fastapi import Header, HTTPException, Depends, Request
from services.supabase_client import get_supabase, get_supabase_admin
from repositories import UserRepository, OrderRepository, CustomerRepository
from typing import List, Optional, Callable, Any
import time
import asyncio
from services.rate_limit_cache import rate_limit_cache
from services.audit_service import log_action

# 簡單的記憶體緩存 (方案 B: 60秒 TTL)
# 格式: {user_id: {"data": profile_dict, "expiry": timestamp}}
_profile_cache = {}
CACHE_TTL = 60

async def get_current_user(authorization: str = Header(...)):
    """從 token 取得目前使用者及其 Profile 角色 (具備 60 秒緩存優化)"""
    try:
        token = authorization.replace("Bearer ", "")
        supabase = get_supabase()
        repo = UserRepository(supabase)
        
        # 取得 Supabase Auth 使用者 (這步通常會解析 JWT，速度較快)
        response = supabase.auth.get_user(token)
        if not response.user:
            raise HTTPException(status_code=401, detail="請先登入")
        
        user_id = response.user.id
        current_time = time.time()
        
        # 檢查緩存是否有效
        cached = _profile_cache.get(user_id)
        if cached and current_time < cached["expiry"]:
            return {
                "id": user_id,
                "email": response.user.email,
                "profile": cached["data"]
            }
        
        # 若無緩存或已過期，則透過 Repository 取得完整資訊
        profile = repo.get_user_by_id(user_id)
        
        if not profile:
            raise HTTPException(status_code=404, detail="找不到使用者設定檔")
            
        # 更新緩存
        _profile_cache[user_id] = {
            "data": profile,
            "expiry": current_time + CACHE_TTL
        }
            
        return {
            "id": user_id,
            "email": response.user.email,
            "profile": profile
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="驗證失敗或 Token 已過期")

# ── 第一層：角色檢查 (Role-Based) ──
def require_role(required_roles: List[str]) -> Callable:
    """
    驗證使用者角色
    用途：檢查使用者是否具有指定的角色
    """
    async def verify(user: dict = Depends(get_current_user)):
        user_role = user["profile"].get("role")
        if user_role not in required_roles:
            raise HTTPException(
                status_code=404,
                detail="找不到資源或無權限存取",
                headers={"X-Required-Roles": ",".join(required_roles)}
            )
        return user
    return verify

# ── 第二層：功能權限檢查 (Permission-Based) ──
def require_permission(permission: str) -> Callable:
    """
    驗證使用者是否擁有特定權限
    用途：更細粒度的功能權限控制
    """
    async def verify(user: dict = Depends(get_current_user)):
        from .permissions import PERMISSIONS
        user_role = user["profile"].get("role")
        
        if permission not in PERMISSIONS:
            raise HTTPException(status_code=500, detail="未定義的權限")
        
        allowed_roles = PERMISSIONS.get(permission, [])
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=404,
                detail="找不到資源或無權限存取"
            )
        
        # Viewer 角色額外檢查
        if user_role == 'viewer' and not permission.endswith('_VIEW'):
            raise HTTPException(
                status_code=404,
                detail="找不到資源或無權限存取"
            )
        
        return user
    return verify

# ── 第三層：資源所有權檢查 (Ownership-Based) ──
def require_ownership(
    resource_type: str,
    resource_id_param: str = "resource_id"
) -> Callable:
    """
    驗證使用者是否擁有指定資源
    用途：確保使用者只能操作自己的資源（對 Sales 角色）
    """
    async def verify(
        request: Request,
        user: dict = Depends(get_current_user)
    ):
        from .permissions import OWNERSHIP_FIELDS
        
        user_role = user["profile"].get("role")
        user_id = user["profile"].get("id") # UUID
        employee_id = user["profile"].get("employee_id")
        
        # Admin 無需檢查所有權
        if user_role == 'admin':
            return user
        
        # Viewer 不允許修改
        if user_role == 'viewer':
            raise HTTPException(
                status_code=404,
                detail="找不到資源或無權限存取"
            )
        
        # Sales 需要檢查所有權
        if user_role == 'sales':
            # 從路徑參數或查詢參數取得資源 ID
            resource_id = request.path_params.get(resource_id_param) or request.query_params.get(resource_id_param)
            
            if not resource_id:
                raise HTTPException(status_code=400, detail="缺少資源 ID")
            
            supabase = get_supabase()
            resource = None
            
            # 取得資源
            if resource_type == 'order':
                repo = OrderRepository(supabase)
                resource = repo.get_order_by_id(resource_id)
            elif resource_type == 'customer':
                repo = CustomerRepository(supabase)
                resource = repo.get_customer_by_id(resource_id)
            elif resource_type == 'user':
                repo = UserRepository(supabase)
                resource = repo.get_user_by_id(resource_id)
            else:
                raise HTTPException(status_code=500, detail="未知資源類型")
            
            if not resource:
                raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
            
            # 檢查所有權
            owner_field = OWNERSHIP_FIELDS.get(resource_type)
            
            # 決定比較對象：user 類型比對 UUID (user_id)，其餘比對 employee_id
            compare_id = user_id if resource_type == 'user' else employee_id
            
            if resource.get(owner_field) != compare_id:
                raise HTTPException(
                    status_code=404,
                    detail="找不到資源或無權限存取"
                )
        
        return user
    return verify

# ── 便利函數 ──
async def require_admin(user: dict = Depends(get_current_user)):
    """要求 Admin 角色的快捷函數"""
    if user["profile"].get("role") != "admin":
        raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
    return user

async def require_not_readonly(user: dict = Depends(get_current_user)):
    """要求非唯讀角色的快捷函數"""
    if user["profile"].get("role") == "viewer":
        raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
    return user

async def require_sales_or_admin(user: dict = Depends(get_current_user)):
    """驗證是否為 admin 或 sales 權限 (相容性保留)"""
    role = user["profile"].get("role")
    if role not in ["admin", "sales"]:
        raise HTTPException(status_code=404, detail="找不到資源或無權限存取")
    return user

class AuthService:
    @staticmethod
    async def change_password(user_id: str, email: str, current_password: str, new_password: str):
        """修改使用者密碼 (具備防暴力破解的安全機制)"""
        # 0. 檢查是否處於臨時鎖定狀態
        is_locked, remaining_seconds = rate_limit_cache.is_locked(user_id)
        if is_locked:
            minutes = int(remaining_seconds // 60)
            seconds = int(remaining_seconds % 60)
            raise Exception(f"密碼錯誤次數過多，帳號已被臨時鎖定。請於 {minutes} 分 {seconds} 秒後再試。")

        supabase = get_supabase()
        admin_supabase = get_supabase_admin()
        repo_admin = UserRepository(admin_supabase)
        
        # 取得使用者 profile 以獲得 employee_id，以便審計日誌使用
        profile = repo_admin.get_user_by_id(user_id)
        employee_id = profile.get("employee_id") if profile else "unknown"

        # 1. 驗證舊密碼 (嘗試登入)
        try:
            auth_res = supabase.auth.sign_in_with_password({
                "email": email,
                "password": current_password
            })
            if not auth_res.session:
                raise Exception("目前密碼不正確")
        except Exception:
            # 密碼驗證失敗，進行失敗計數與退避延遲
            fail_count, delay = rate_limit_cache.record_failure(user_id)
            
            # 記錄密碼修改失敗審計日誌
            await log_action(
                employee_id, 
                "CHANGE_PASSWORD_FAILED", 
                details={"message": f"Password verification failed. Attempt: {fail_count}", "attempt": fail_count}
            )
            
            # 若觸發鎖定，記錄鎖定日誌
            if fail_count >= 5:
                await log_action(
                    employee_id, 
                    "ACCOUNT_LOCKED", 
                    details={"message": "Account locked for 15 minutes due to 5 consecutive password failures."}
                )
                
                # 指數退避延遲 (5 秒)，使用非同步 sleep 避免阻塞事件循環
                if delay > 0:
                    await asyncio.sleep(delay)
                    
                raise Exception("密碼錯誤次數過多，帳號已被臨時鎖定 15 分鐘。")
            
            # 指數退避延遲 (3-4 次失敗為 2 秒)，使用非同步 sleep 避免阻塞事件循環
            if delay > 0:
                await asyncio.sleep(delay)
                
            raise Exception("目前密碼不正確")

        # 2. 驗證成功，重設快取中的失敗計數
        rate_limit_cache.reset_failures(user_id)

        # 3. 使用 Admin 權限更新密碼
        res = admin_supabase.auth.admin.update_user_by_id(
            user_id,
            {"password": new_password}
        )
        if not res.user:
            raise Exception("修改密碼失敗")
        
        # 同步更新 Profiles 表，取消強制更改密碼標記
        from datetime import datetime, timezone
        repo_admin.update_user(user_id, {
            "must_change_password": False,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        return True

    @staticmethod
    async def update_email(user_id: str, new_email: str):
        """更新使用者 Email"""
        admin_supabase = get_supabase_admin()
        repo_admin = UserRepository(admin_supabase)
        
        res = admin_supabase.auth.admin.update_user_by_id(
            user_id,
            {"email": new_email}
        )
        if not res.user:
            raise Exception("更新 Email 失敗")
            
        # 同步更新 Profiles 表
        from datetime import datetime, timezone
        repo_admin.update_user(user_id, {
            "email": new_email,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
        return True
