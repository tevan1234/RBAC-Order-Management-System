from typing import List, Dict, Any, Optional
from repositories.base_repository import BaseRepository

class ProductRepository(BaseRepository):
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "products")

    def get_all_products(self, sort_by: str = "product_id") -> List[Dict[str, Any]]:
        query = self.select("*")
        if sort_by:
            query = query.order(sort_by)
        res = query.execute()
        return res.data

    def get_product_by_id(self, product_id: str) -> Optional[Dict[str, Any]]:
        return self.find_one({"product_id": product_id})

    def create_product(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.insert(data)
        return res.data[0] if res.data else {}

    def update_product(self, product_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.update(data, {"product_id": product_id})
        return res.data[0] if res.data else {}

