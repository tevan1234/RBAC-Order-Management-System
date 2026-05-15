from fastapi import APIRouter, HTTPException, Depends
from typing import List
from models.schemas import CustomerSchema, CustomerCreate, CustomerUpdate
from services.auth_service import get_current_user, require_permission, require_ownership
from services import customer_service

router = APIRouter(prefix="/customers", tags=["Customer Management"])

@router.get("/", response_model=List[CustomerSchema])
async def list_customers(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("CUSTOMER_VIEW"))
):
    """列出客戶資料。權限與過濾邏輯已移至 Service 層。"""
    return await customer_service.get_customers(user)

@router.post("/")
async def create_customer(
    req: CustomerCreate,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("CUSTOMER_CREATE"))
):
    """建立新客戶。業務邏輯已移至 Service 層。"""
    return await customer_service.create_customer(req.model_dump(exclude_unset=True), user)

@router.get("/{customer_id}", response_model=CustomerSchema)
async def get_customer(
    customer_id: str,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('CUSTOMER_VIEW'))
):
    """查看客戶 - admin, sales, viewer 可操作"""
    return await customer_service.get_customer(customer_id, user)

@router.put("/{customer_id}")
async def update_customer(
    customer_id: str,
    update_data: CustomerUpdate,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('CUSTOMER_EDIT')),
    __: dict = Depends(require_ownership('customer', 'customer_id'))
):
    """編輯客戶 - admin, sales(限自己) 可操作"""
    return await customer_service.update_customer(customer_id, update_data.model_dump(exclude_unset=True), user)

@router.delete("/{customer_id}")
async def delete_customer(
    customer_id: str,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("CUSTOMER_VOID"))
):
    """刪除客戶 (限管理員)"""
    return await customer_service.delete_customer(customer_id, user)

