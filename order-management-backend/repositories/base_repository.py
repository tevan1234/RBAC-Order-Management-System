from typing import List, Dict, Any, Optional
from postgrest import APIResponse

class BaseRepository:
    def __init__(self, supabase_client, table_name: str):
        self.supabase = supabase_client
        self.table = table_name

    def select(self, columns: str = "*") -> Any:
        return self.supabase.table(self.table).select(columns)

    def insert(self, data: Dict[str, Any]) -> APIResponse:
        return self.supabase.table(self.table).insert(data).execute()

    def update(self, data: Dict[str, Any], filters: Dict[str, Any]) -> APIResponse:
        query = self.supabase.table(self.table).update(data)
        for key, value in filters.items():
            query = query.eq(key, value)
        return query.execute()

    def delete(self, filters: Dict[str, Any]) -> APIResponse:
        query = self.supabase.table(self.table).delete()
        for key, value in filters.items():
            query = query.eq(key, value)
        return query.execute()

    def find_one(self, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        query = self.supabase.table(self.table).select("*")
        for key, value in filters.items():
            query = query.eq(key, value)
        res = query.execute()
        return res.data[0] if res.data else None
