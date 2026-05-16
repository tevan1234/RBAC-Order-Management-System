from fastapi import HTTPException
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from services.supabase_client import get_supabase, get_supabase_admin
from services import audit_service
from repositories import ProductRepository

class ProductService:
    @staticmethod
    def _get_repo(admin: bool = False):
        client = get_supabase_admin() if admin else get_supabase()
        return ProductRepository(client)

    @staticmethod
    async def get_all_products() -> List[Dict[str, Any]]:
        """取得所有產品清單"""
        repo = ProductService._get_repo()
        return repo.get_all_products()

    @staticmethod
    async def get_product_by_id(product_id: str) -> Dict[str, Any]:
        """獲取特定產品詳細資訊"""
        repo = ProductService._get_repo()
        product = repo.get_product_by_id(product_id)
        if not product:
            raise HTTPException(status_code=404, detail=f"找不到產品編號: {product_id}")
        return product

    @staticmethod
    async def create_product(product_data: Dict[str, Any], operator_id: str) -> Dict[str, Any]:
        """新增產品"""
        repo = ProductService._get_repo(admin=True)
        
        # 如果沒有提供 ID，自動生成一個
        if not product_data.get("product_id"):
            import time
            product_data["product_id"] = f"PROD{int(time.time()*1000)}"
            
        try:
            new_product = repo.create_product(product_data)
            if not new_product:
                raise HTTPException(status_code=400, detail="新增產品失敗")
                
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
        """更新產品資訊"""
        repo = ProductService._get_repo(admin=True)
        
        # 注入更新時間
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        updated_product = repo.update_product(product_id, update_data)
        if not updated_product:
            raise HTTPException(status_code=404, detail=f"更新失敗，找不到產品編號: {product_id}")
            
        await audit_service.log_action(
            user_id=operator_id,
            action="UPDATE_PRODUCT",
            target=f"Product ID: {product_id}, Changes: {update_data}"
        )
        return updated_product


