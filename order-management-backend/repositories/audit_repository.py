from typing import List, Dict, Any, Optional
from repositories.base_repository import BaseRepository

class AuditRepository(BaseRepository):
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "audit_logs")

    def log_action(self, user_id: str, action: str, target: str) -> Dict[str, Any]:
        data = {
            "user_id": user_id,
            "action": action,
            "target": target
        }
        res = self.insert(data)
        return res.data[0] if res.data else {}

    def get_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        res = self.select("*, profiles(employee_id)").order("timestamp", desc=True).limit(limit).execute()
        return res.data
