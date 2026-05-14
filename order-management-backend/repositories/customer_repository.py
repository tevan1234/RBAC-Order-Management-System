from typing import List, Dict, Any, Optional
from repositories.base_repository import BaseRepository

class CustomerRepository(BaseRepository):
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "customers")

    def get_customers(self, owner_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = self.select("*")
        if owner_id:
            query = query.eq("owner_id", owner_id)
        res = query.execute()
        return res.data

    def get_customers_by_owners(self, owner_ids: List[str]) -> List[Dict[str, Any]]:
        """獲取指定負責人列表中的所有客戶"""
        if not owner_ids:
            return []
        res = self.select("*").in_("owner_id", owner_ids).execute()
        return res.data

    def get_customer_by_id(self, customer_id: str) -> Optional[Dict[str, Any]]:
        return self.find_one({"customer_id": customer_id})

    def create_customer(self, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.insert(data)
        return res.data[0] if res.data else {}

    def update_customer(self, customer_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        res = self.update(data, {"customer_id": customer_id})
        return res.data[0] if res.data else {}

    def delete_customer(self, customer_id: str) -> bool:
        res = self.delete({"customer_id": customer_id})
        return len(res.data) > 0
