from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta
import logging
from repositories.base_repository import BaseRepository

logger = logging.getLogger(__name__)

class ReportHistoryRepository(BaseRepository):
    """
    處理 AI 銷售分析歷史紀錄與快取機制的 Repository
    """
    def __init__(self, supabase_client):
        super().__init__(supabase_client, "report_history")

    def get_by_user(self, user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        查詢特定使用者產生的歷史分析報告紀錄，按時間降序排序。
        """
        try:
            res = self.supabase.table(self.table)\
                      .select("*")\
                      .eq("user_id", user_id)\
                      .order("created_at", desc=True)\
                      .limit(limit)\
                      .execute()
            return res.data if res.data else []
        except Exception as e:
            logger.error(f"查詢使用者歷史紀錄失敗 (user_id: {user_id}): {str(e)}")
            return []

    def get_recent_cache(self, user_id: str, filters: dict, hours: int = 24) -> Optional[Dict[str, Any]]:
        """
        查詢特定使用者在過去指定小時內，是否已產生過完全相同過濾參數的報告。
        
        【防禦性比對策略】：
        為避免資料庫端對 JSONB 的 Equality (=) 比對因為欄位 Key 順序、空格、或資料型態轉譯的微小差異而失準，
        本方法會先拉取該使用者於過去 24 小時內產生的所有歷史紀錄（筆數通常極少，效能佳），
        然後在 Python 記憶體端進行標準的字典相等性比對（dict equality, 欄位順序無關且深層比對），
        以確保快取命中率之 100% 絕對精準與系統的強健性。
        """
        try:
            # 計算時間起點
            since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
            
            res = self.supabase.table(self.table)\
                      .select("*")\
                      .eq("user_id", user_id)\
                      .eq("report_type", "sales_analytics")\
                      .gte("created_at", since)\
                      .order("created_at", desc=True)\
                      .execute()
            
            records = res.data if res.data else []
            for record in records:
                rec_filters = record.get("filter_parameters") or {}
                # 在 Python 端比對 dict 值是否完全一致（深層比對，不受 key 順序影響）
                if rec_filters == filters:
                    return record
            return None
        except Exception as e:
            logger.error(f"查詢銷售報告快取失敗 (user_id: {user_id}): {str(e)}")
            return None

    def save_report(self, user_id: str, report_type: str, filter_parameters: dict, report_content: dict, record_id: Optional[str] = None) -> Dict[str, Any]:
        """
        將生成成功的報告內容及過濾器參數，寫入歷史紀錄資料表中。
        """
        try:
            data = {
                "user_id": user_id,
                "report_type": report_type,
                "filter_parameters": filter_parameters,
                "report_content": report_content
            }
            if record_id:
                data["id"] = record_id
            res = self.insert(data)
            return res.data[0] if res.data else {}
        except Exception as e:
            logger.error(f"寫入銷售報告歷史紀錄失敗 (user_id: {user_id}): {str(e)}")
            return {}
