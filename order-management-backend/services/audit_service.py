from services.supabase_client import get_supabase_admin
from repositories import AuditRepository

def _get_repo():
    client = get_supabase_admin()
    return AuditRepository(client)

async def log_action(user_id: str, action: str, target: str):
    """將操作紀錄寫入 audit_logs 資料表"""
    try:
        repo = _get_repo()
        repo.log_action(user_id, action, target)
    except Exception as e:
        print(f"Error logging action: {e}")

async def get_audit_logs() -> list:
    """讀取操作紀錄"""
    repo = _get_repo()
    return repo.get_logs()
