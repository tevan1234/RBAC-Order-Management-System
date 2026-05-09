from fastapi import HTTPException
from typing import List, Dict, Any, Optional
from services.supabase_client import get_supabase
from services import audit_service
from models.schemas import ProductSchema

class ProductService:
    @staticmethod
    async def get_all_products() -> List[Dict[str, Any]]:
        """
        取得所有產品清單
        - 依 product_id 排序
        """
        supabase = get_supabase()
        res = supabase.table("products").select("*").order("product_id").execute()
        return res.data

    @staticmethod
    async def get_product_by_id(product_id: str) -> Dict[str, Any]:
        """
        獲取特定產品詳細資訊
        - 若找不到則拋出 404
        """
        supabase = get_supabase()
        res = supabase.table("products").select("*").eq("product_id", product_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail=f"找不到產品編號: {product_id}")
            
        return res.data[0]

    @staticmethod
    async def create_product(product_data: Dict[str, Any], operator_id: str) -> Dict[str, Any]:
        """
        新增產品
        - 記錄審計日誌
        """
        supabase = get_supabase()
        
        try:
            res = supabase.table("products").insert(product_data).execute()
            
            if not res.data:
                raise HTTPException(status_code=400, detail="新增產品失敗")
                
            new_product = res.data[0]
            
            # 記錄審計日誌
            await audit_service.log_action(
                user_id=operator_id,
                action="CREATE_PRODUCT",
                target=f"Product ID: {new_product.get('product_id')}, Name: {new_product.get('name')}"
            )
            
            return new_product
            
        except Exception as e:
            detail = str(e)
            if "already exists" in detail.lower():
                raise HTTPException(status_code=400, detail=f"產品編號 {product_data.get('product_id')} 已存在")
            raise HTTPException(status_code=400, detail=detail)

    @staticmethod
    async def update_product(product_id: str, update_data: Dict[str, Any], operator_id: str) -> Dict[str, Any]:
        """
        更新產品資訊
        - 記錄審計日誌
        """
        supabase = get_supabase()
        
        # 執行更新
        res = supabase.table("products").update(update_data).eq("product_id", product_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail=f"更新失敗，找不到產品編號: {product_id}")
            
        updated_product = res.data[0]
        
        # 記錄審計日誌
        await audit_service.log_action(
            user_id=operator_id,
            action="UPDATE_PRODUCT",
            target=f"Product ID: {product_id}, Changes: {update_data}"
        )
        
        return updated_product

    @staticmethod
    async def delete_product(product_id: str, operator_id: str) -> bool:
        """
        刪除產品
        - 記錄審計日誌
        """
        supabase = get_supabase()
        
        # 先確認產品是否存在
        check_res = supabase.table("products").select("product_id").eq("product_id", product_id).execute()
        if not check_res.data:
            raise HTTPException(status_code=404, detail=f"刪除失敗，找不到產品編號: {product_id}")
            
        # 執行刪除
        res = supabase.table("products").delete().eq("product_id", product_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=400, detail="刪除產品時發生錯誤")
            
        # 記錄審計日誌
        await audit_service.log_action(
            user_id=operator_id,
            action="DELETE_PRODUCT",
            target=f"Product ID: {product_id}"
        )
        
        return True
