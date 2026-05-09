from fastapi import APIRouter, HTTPException, Depends
from typing import List
from models.schemas import ProductSchema
from services.supabase_client import get_supabase
from services.auth_service import get_current_user, require_admin
from services.audit_service import log_action

router = APIRouter(prefix="/products", tags=["Product Management"])

@router.get("/", response_model=List[ProductSchema])
async def list_products(user: dict = Depends(get_current_user)):
    """列出所有商品"""
    supabase = get_supabase()
    res = supabase.table("products").select("*").execute()
    return res.data

@router.post("/")
async def create_product(req: ProductSchema, admin: dict = Depends(require_admin)):
    """新增商品 (限管理員)"""
    supabase = get_supabase()
    res = supabase.table("products").insert(req.model_dump()).execute()
    
    if not res.data:
        raise HTTPException(status_code=400, detail="新增商品失敗")
        
    await log_action(admin["profile"]["employee_id"], "CREATE_PRODUCT", f"Created product: {req.product_id}")
    return res.data[0]

@router.put("/{product_id}")
async def update_product(product_id: str, req: ProductSchema, admin: dict = Depends(require_admin)):
    """更新商品資訊 (限管理員)"""
    supabase = get_supabase()
    res = supabase.table("products").update(req.model_dump()).eq("product_id", product_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到該商品")
        
    await log_action(admin["profile"]["employee_id"], "UPDATE_PRODUCT", f"Updated product: {product_id}")
    return res.data[0]

@router.delete("/{product_id}")
async def delete_product(product_id: str, admin: dict = Depends(require_admin)):
    """刪除商品 (限管理員)"""
    supabase = get_supabase()
    res = supabase.table("products").delete().eq("product_id", product_id).execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到該商品")
        
    await log_action(admin["profile"]["employee_id"], "DELETE_PRODUCT", f"Deleted product: {product_id}")
    return {"message": "商品已刪除"}
