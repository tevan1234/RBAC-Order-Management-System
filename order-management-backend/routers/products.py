from fastapi import APIRouter, HTTPException, Depends
from typing import List
from models.schemas import ProductSchema
from services.auth_service import get_current_user, require_admin
from services.product_service import ProductService

router = APIRouter(prefix="/products", tags=["Product Management"])

@router.get("/", response_model=List[ProductSchema])
async def list_products(user: dict = Depends(get_current_user)):
    """列出所有商品"""
    return await ProductService.get_all_products()

@router.post("/")
async def create_product(req: ProductSchema, admin: dict = Depends(require_admin)):
    """新增商品 (限管理員)"""
    return await ProductService.create_product(req.model_dump(), admin["profile"]["employee_id"])

@router.put("/{product_id}")
async def update_product(product_id: str, req: ProductSchema, admin: dict = Depends(require_admin)):
    """更新商品資訊 (限管理員)"""
    return await ProductService.update_product(product_id, req.model_dump(), admin["profile"]["employee_id"])

@router.delete("/{product_id}")
async def delete_product(product_id: str, admin: dict = Depends(require_admin)):
    """刪除商品 (限管理員)"""
    await ProductService.delete_product(product_id, admin["profile"]["employee_id"])
    return {"message": "商品已刪除"}

