from fastapi import HTTPException
from typing import List, Optional, Dict, Any
from uuid import UUID
from services.supabase_client import get_supabase
from services import audit_service
import asyncio
from models.schemas import ProfileResponse, UserAdminCreate, UserUpdate

class UserService:
    @staticmethod
    async def create_user_as_admin(user_data: UserAdminCreate, operator: dict) -> Dict[str, Any]:
        """
        管理員建立新帳號：
        - 使用 Supabase Admin API
        - 帶入 metadata 以觸發資料庫 Trigger
        - 記錄審計日誌
        """
        supabase = get_supabase()
        operator_id = str(operator["profile"]["id"])
        
        # 0. 預先檢查 employee_id 是否已存在 (避免產生無效 Auth 帳號)
        check_id = supabase.table("profiles").select("id").eq("employee_id", user_data.employee_id).execute()
        if check_id.data:
            raise HTTPException(status_code=400, detail=f"員工代號 {user_data.employee_id} 已存在")

        try:
            # 1. 建立 Auth 使用者
            auth_res = supabase.auth.admin.create_user({
                "email": user_data.email,
                "password": user_data.password,
                "email_confirm": True,
                "user_metadata": {
                    "name": user_data.name,
                    "employee_id": user_data.employee_id,
                    "role": user_data.role
                }
            })
            
            if not auth_res.user:
                raise HTTPException(status_code=400, detail="建立 Auth 使用者失敗")
            
            # 記錄審計日誌
            await audit_service.log_action(
                user_id=operator_id,
                action="ADMIN_CREATE_USER",
                target=f"User: {user_data.email}, Employee ID: {user_data.employee_id}"
            )
            
            # 獲取自動產生的 Profile (由 Trigger 建立)
            # 加入重試機制解決競爭條件 (Race Condition)
            profile_data = None
            for _ in range(5):  # 最多重試 5 次
                profile_res = supabase.table("profiles").select("*").eq("id", auth_res.user.id).execute()
                if profile_res.data:
                    profile_data = profile_res.data[0]
                    break
                await asyncio.sleep(0.2)  # 每次等待 200ms
            
            if not profile_data:
                raise HTTPException(status_code=500, detail="Auth 帳號已建立，但 Profile 同步超時 (Trigger 延遲)")
                
            return profile_data
            
        except Exception as e:
            detail = str(e)
            if hasattr(e, 'message'):
                detail = e.message
            
            # 處理重複的 employee_id 或 email (Supabase 會在 message 中說明)
            if "already exists" in detail.lower():
                raise HTTPException(status_code=400, detail="帳號、Email 或員工代號已存在")
            
            raise HTTPException(status_code=400, detail=detail)

    @staticmethod
    async def get_user_list(role: str) -> List[Dict[str, Any]]:
        """
        獲取所有使用者列表
        - 僅限 admin 角色
        """
        if role != "admin":
            raise HTTPException(status_code=403, detail="權限不足，僅限管理員查看用戶列表")
            
        supabase = get_supabase()
        res = supabase.table("profiles").select("*").execute()
        return res.data

    @staticmethod
    async def update_user_status_or_role(target_id: UUID, update_data: UserUpdate, operator_id: str) -> Dict[str, Any]:
        """
        更新用戶狀態或角色
        - 記錄審計日誌
        """
        supabase = get_supabase()
        
        # 過濾掉 None 的欄位
        update_dict = {k: v for k, v in update_data.model_dump().items() if v is not None}
        
        if not update_dict:
            raise HTTPException(status_code=400, detail="未提供有效的更新欄位")
            
        res = supabase.table("profiles").update(update_dict).eq("id", str(target_id)).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="找不到該使用者")
            
        # 記錄審計日誌
        await audit_service.log_action(
            user_id=operator_id,
            action="UPDATE_USER_PROFILE",
            target=f"Target User ID: {target_id}, Changes: {update_dict}"
        )
        
        return res.data[0]

    @staticmethod
    async def get_user_profile(target_id: UUID, current_user: dict) -> Dict[str, Any]:
        """
        獲取單一用戶 Profile
        - 權限檢查：管理員可存取所有，一般用戶僅能存取自己
        """
        user_role = current_user["profile"]["role"]
        user_id = str(current_user["profile"]["id"])
        
        if user_role != "admin" and user_id != str(target_id):
            raise HTTPException(status_code=403, detail="權限不足，您僅能查看自己的資料")
            
        supabase = get_supabase()
        res = supabase.table("profiles").select("*").eq("id", str(target_id)).single().execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="找不到該使用者設定檔")
            
        return res.data

    @staticmethod
    async def delete_user(target_id: UUID, operator_id: str) -> bool:
        """
        刪除用戶：
        - 僅限 admin (由 Router 確保角色)
        - 記錄審計日誌
        """
        supabase = get_supabase()
        
        # 1. 獲取用戶資訊以便記錄日誌
        profile_res = supabase.table("profiles").select("email, employee_id").eq("id", str(target_id)).single().execute()
        if not profile_res.data:
            raise HTTPException(status_code=404, detail="找不到該使用者")
        
        user_info = profile_res.data
        
        # 2. 刪除 Auth 使用者 (Supabase 會連動刪除 Profile)
        supabase.auth.admin.delete_user(str(target_id))
        
        # 3. 記錄審計日誌
        await audit_service.log_action(
            user_id=operator_id,
            action="ADMIN_DELETE_USER",
            target=f"User ID: {target_id}, Email: {user_info.get('email')}, EmpID: {user_info.get('employee_id')}"
        )
        
        return True
