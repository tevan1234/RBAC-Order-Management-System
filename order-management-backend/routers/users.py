from fastapi import APIRouter, HTTPException, Depends
from typing import List
from uuid import UUID
from models.schemas import ProfileResponse, UserAdminCreate, UserUpdate
from services.auth_service import require_permission, get_current_user
from services.user_service import UserService

router = APIRouter(prefix="/users", tags=["User Management"])

@router.get("/", response_model=List[ProfileResponse])
async def list_users(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('USER_VIEW'))
):
    """取得所有用戶 (僅限 admin)"""
    return await UserService.get_user_list(user["profile"]["role"])

@router.post("/", response_model=ProfileResponse)
async def create_user(
    user_data: UserAdminCreate,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('USER_CREATE'))
):
    """管理員新增用戶"""
    return await UserService.create_user_as_admin(user_data, user)

@router.patch("/{id}", response_model=ProfileResponse)
async def update_user(
    id: UUID,
    update_data: UserUpdate,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('USER_EDIT'))
):
    """更新用戶基本資料 (不含角色修改，僅限 admin)"""
    operator_id = str(user["profile"]["id"])
    
    # Last Admin Protection: 檢查是否嘗試停用或修改最後一位管理員的角色
    if update_data.status == "inactive" or (update_data.role and update_data.role != "admin"):
        if await UserService.is_last_admin(id):
            raise HTTPException(status_code=400, detail="不可停用或修改最後一位管理員的角色")

    return await UserService.update_user_status_or_role(id, update_data, operator_id)

@router.patch("/{id}/role", response_model=ProfileResponse)
async def change_user_role(
    id: UUID,
    new_role: str,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('USER_MANAGE_ROLE'))
):
    """修改使用者角色 - admin only"""
    operator_id = str(user["profile"]["id"])
    
    # Self Role Modification Protection
    if str(id) == operator_id:
        raise HTTPException(status_code=400, detail="不可修改自己的角色")
    
    # Last Admin Protection
    if new_role != "admin":
        if await UserService.is_last_admin(id):
            raise HTTPException(status_code=400, detail="不可修改最後一位管理員的角色")

    # 封裝成 UserUpdate 物件以符合 Service 介面
    update_data = UserUpdate(role=new_role)
    return await UserService.update_user_status_or_role(id, update_data, operator_id)

@router.get("/{id}", response_model=ProfileResponse)
async def get_user(id: UUID, current_user: dict = Depends(get_current_user)):
    """取得單一用戶資料 (admin 可看全部，一般用戶僅能看自己的)"""
    return await UserService.get_user_profile(id, current_user)

@router.delete("/{id}")
async def delete_user(
    id: UUID,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('USER_DELETE'))
):
    """管理員刪除用戶"""
    operator_id = str(user["profile"]["id"])
    
    # Last Admin Protection
    if await UserService.is_last_admin(id):
        raise HTTPException(status_code=400, detail="不可刪除最後一位管理員")

    await UserService.delete_user(id, operator_id)
    return {"message": "使用者已刪除"}
