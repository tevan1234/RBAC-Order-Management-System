from typing import List, Dict, Any, Optional
from repositories.base_repository import BaseRepository

class UserRepository(BaseRepository):
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "profiles")

    def get_users(self) -> List[Dict[str, Any]]:
        """獲取所有使用者設定檔"""
        res = self.select("*").execute()
        return res.data

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """根據 UUID 獲取單一使用者"""
        return self.find_one({"id": user_id})

    def get_user_by_employee_id(self, employee_id: str) -> Optional[Dict[str, Any]]:
        """根據員工代號獲取使用者"""
        return self.find_one({"employee_id": employee_id})

    def create_profile(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """建立 Profile (通常由 Trigger 自動建立，此處供特殊情況使用)"""
        res = self.insert(data)
        return res.data[0] if res.data else {}

    def update_user(self, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """更新使用者資料"""
        res = self.update(data, {"id": user_id})
        return res.data[0] if res.data else {}
