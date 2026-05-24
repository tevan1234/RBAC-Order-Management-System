from typing import Dict, Any, Optional
import logging
from repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)

class SubscriptionRepository(BaseRepository):
    """
    處理使用者定期報告訂閱狀態的 Repository
    """
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "analytics_subscriptions")

    def get_by_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """
        獲取特定使用者的訂閱偏好設定。
        """
        try:
            return self.find_one({"user_id": user_id})
        except Exception as e:
            logger.error(f"查詢使用者訂閱失敗 (user_id: {user_id}): {str(e)}")
            return None

    def save_subscription(self, user_id: str, email: str, is_subscribed: bool, frequency: str) -> Dict[str, Any]:
        """
        儲存或更新使用者的訂閱偏好設定。
        """
        try:
            existing = self.get_by_user(user_id)
            data = {
                "user_id": user_id,
                "email": email,
                "is_subscribed": is_subscribed,
                "frequency": frequency,
                "updated_at": "now()" # Database default or let postgres handle it
            }
            # postgres handling timezone('utc'::text, now())
            # For local data pass or update, let's use the DB function
            import datetime
            data["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            
            if existing:
                res = self.update(data, {"user_id": user_id})
            else:
                res = self.insert(data)
                
            return res.data[0] if res.data else {}
        except Exception as e:
            logger.error(f"更新使用者訂閱失敗 (user_id: {user_id}): {str(e)}")
            return {}
