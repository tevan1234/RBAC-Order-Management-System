from typing import List, Dict, Any, Optional
from repositories.base_repository import BaseRepository

class OrderRepository(BaseRepository):
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "orders")

    def get_orders(self, owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = self.select("*")
        if owner_id:
            query = query.eq("owner_id", owner_id)
        res = query.execute()
        return res.data

    def get_order_by_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        return self.find_one({"id": order_id})

    def create_order(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.insert(data)
        return res.data[0] if res.data else {}

    def update_order(self, order_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.update(data, {"id": order_id})
        return res.data[0] if res.data else {}
