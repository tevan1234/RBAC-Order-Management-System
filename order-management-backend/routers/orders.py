from fastapi import APIRouter, HTTPException, Depends, Request
from typing import List
from models.schemas import OrderSchema, OrderUpdate, OrderCreate, OrderStatusUpdate
from services.auth_service import get_current_user, require_permission, require_ownership
from services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["Order Management"])

async def check_order_status_permission(
    order_id: str,
    body: OrderStatusUpdate,
    request: Request,
    user: dict = Depends(get_current_user)
):
    """
    動態檢查訂單狀態更新權限
    - 已作廢: 需要 ORDER_VOID 權限 (僅限 Admin)
    - 已完成: 需要 ORDER_COMPLETE 權限，且 Sales 需符合資源所有權
    """
    if body.status == "已作廢":
        # 作廢權限檢查 (通常僅限 Admin)
        checker = require_permission("ORDER_VOID")
        await checker(user)
    elif body.status == "已完成":
        # 完成權限檢查 + 所有權檢查 (Admin 或 Sales 自己)
        perm_checker = require_permission("ORDER_COMPLETE")
        await perm_checker(user)
        own_checker = require_ownership("order", "order_id")
        await own_checker(request, user)
    else:
        # 其他狀態更新 (視同一般編輯)
        perm_checker = require_permission("ORDER_EDIT")
        await perm_checker(user)
        own_checker = require_ownership("order", "order_id")
        await own_checker(request, user)

@router.get("/", response_model=List[OrderSchema])
async def list_orders(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ORDER_VIEW"))
):
    """列出訂單資料。權限與過濾邏輯已移至 Service 層。"""
    return await OrderService.get_orders(user)

@router.post("/")
async def create_order(
    req: OrderCreate, 
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ORDER_CREATE"))
):
    """建立新訂單。業務邏輯已移至 Service 層。"""
    return await OrderService.create_order(req.model_dump(), user)

@router.patch("/{order_id}/status")
async def update_order_status(
    order_id: str,
    body: OrderStatusUpdate,
    user: dict = Depends(get_current_user),
    _: dict = Depends(check_order_status_permission)
):
    """
    更新訂單狀態
    
    Body:
    ```json
    { "status": "已完成" | "已作廢" }
    ```
    """
    return await OrderService.update_order_status(order_id, body.status, user)

@router.patch("/{order_id}")
async def update_order(
    order_id: str, 
    req: OrderUpdate, 
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ORDER_EDIT")),
    __: dict = Depends(require_ownership("order", "order_id"))
):
    """更新訂單資訊 (通用)"""
    update_data = req.model_dump(exclude_unset=True)
    return await OrderService.update_order(order_id, update_data, user)
