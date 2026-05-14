from fastapi import APIRouter, HTTPException, Depends
from typing import List
from models.schemas import OrderSchema, OrderUpdate, OrderCreate
from services.auth_service import get_current_user, require_sales_or_admin
from services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["Order Management"])

@router.get("/", response_model=List[OrderSchema])
async def list_orders(user: dict = Depends(get_current_user)):
    """列出訂單資料。權限與過濾邏輯已移至 Service 層。"""
    return await OrderService.get_orders(user)

@router.post("/")
async def create_order(req: OrderCreate, user: dict = Depends(require_sales_or_admin)):
    """建立新訂單。業務邏輯已移至 Service 層。"""
    return await OrderService.create_order(req.model_dump(), user)

@router.patch("/{order_id}/status")
async def update_order_status(order_id: str, status: str, user: dict = Depends(require_sales_or_admin)):
    """更新訂單狀態 (處理中, 已完成, 已作廢)"""
    return await OrderService.update_order_status(order_id, status, user)

@router.patch("/{order_id}")
async def update_order(order_id: str, req: OrderUpdate, user: dict = Depends(require_sales_or_admin)):
    """更新訂單資訊 (通用)"""
    update_data = req.model_dump(exclude_unset=True)
    return await OrderService.update_order(order_id, update_data, user)

