from services.supabase_client import get_supabase_admin
from repositories import AuditRepository

def _get_repo():
    client = get_supabase_admin()
    return AuditRepository(client)

async def log_action(user_id: str, action: str, target: str = "", details: dict = None):
    """
    將操作紀錄寫入 audit_logs 資料表

    Args:
        user_id:  操作者 employee_id
        action:   操作類型 (CREATE_ORDER, TRANSFER_CUSTOMER, …)
        target:   純文字描述（舊式呼叫，向後相容）
        details:  結構化詳情 dict（優先於 target）
                  若提供，序列化為 JSON 字串存入 target 欄位
    """
    import json
    try:
        repo = _get_repo()
        log_target = (
            json.dumps(details, ensure_ascii=False, default=str)
            if details is not None
            else target
        )
        repo.log_action(user_id, action, log_target)
    except Exception as e:
        print(f"Error logging action: {e}")

async def get_audit_logs() -> list:
    """讀取操作紀錄"""
    repo = _get_repo()
    logs = repo.get_logs()
    
    # 處理 Join 資料，將 profiles 內的 employee_id 提取出來
    for log in logs:
        profiles = log.get("profiles")
        if isinstance(profiles, dict):
            log["operator_id"] = profiles.get("employee_id")
        elif isinstance(profiles, list) and len(profiles) > 0:
            # 有時 Supabase Join 會回傳 list
            log["operator_id"] = profiles[0].get("employee_id")
            
    return logs
