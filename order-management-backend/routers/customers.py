from fastapi import APIRouter, HTTPException, Depends
from typing import List
from models.schemas import CustomerSchema, CustomerCreate, CustomerUpdate
from services.auth_service import get_current_user, require_sales_or_admin
from services import customer_service

router = APIRouter(prefix="/customers", tags=["Customer Management"])

@router.get("/", response_model=List[CustomerSchema])
async def list_customers(user: dict = Depends(get_current_user)):
    """列出客戶資料。權限與過濾邏輯已移至 Service 層。"""
    return await customer_service.get_customers(user)

@router.post("/")
async def create_customer(req: CustomerCreate, user: dict = Depends(require_sales_or_admin)):
    """建立新客戶。業務邏輯已移至 Service 層。"""
    return await customer_service.create_customer(req.model_dump(exclude_unset=True), user)

@router.patch("/{customer_id}")
async def update_customer(customer_id: str, data: CustomerUpdate, user: dict = Depends(require_sales_or_admin)):
    """更新客戶資訊"""
    return await customer_service.update_customer(customer_id, data.model_dump(exclude_unset=True), user)

@router.delete("/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(require_sales_or_admin)):
    """刪除客戶 (限管理員)"""
    return await customer_service.delete_customer(customer_id, user)

