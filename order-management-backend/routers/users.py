from fastapi import APIRouter, HTTPException, Depends
from typing import List
from uuid import UUID
from models.schemas import ProfileResponse, UserAdminCreate, UserUpdate
from services.auth_service import require_admin, get_current_user
from services.user_service import UserService

router = APIRouter(prefix="/users", tags=["User Management"])

@router.get("/", response_model=List[ProfileResponse])
async def list_users(admin: dict = Depends(require_admin)):
    """取得所有用戶 (僅限 admin)"""
    return await UserService.get_user_list(admin["profile"]["role"])

@router.post("/", response_model=ProfileResponse)
async def create_user(user_data: UserAdminCreate, admin: dict = Depends(require_admin)):
    """管理員新增用戶"""
    return await UserService.create_user_as_admin(user_data, admin)

@router.patch("/{id}", response_model=ProfileResponse)
async def update_user(id: UUID, update_data: UserUpdate, admin: dict = Depends(require_admin)):
    """更新用戶角色或狀態 (僅限 admin)"""
    operator_id = str(admin["profile"]["id"])
    return await UserService.update_user_status_or_role(id, update_data, operator_id)

@router.get("/{id}", response_model=ProfileResponse)
async def get_user(id: UUID, current_user: dict = Depends(get_current_user)):
    """取得單一用戶資料 (admin 可看全部，一般用戶僅能看自己的)"""
    return await UserService.get_user_profile(id, current_user)

@router.delete("/{id}")
async def delete_user(id: UUID, admin: dict = Depends(require_admin)):
    """管理員刪除用戶"""
    operator_id = str(admin["profile"]["id"])
    await UserService.delete_user(id, operator_id)
    return {"message": "使用者已刪除"}
