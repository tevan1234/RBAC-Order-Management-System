from services.supabase_client import get_supabase

async def log_action(user_id: str, action: str, target: str):
    """將操作紀錄寫入 audit_logs 資料表"""
    try:
        supabase = get_supabase()
        supabase.table("audit_logs").insert({
            "action": action,
            "user_id": user_id,
            "target": target
        }).execute()
    except Exception as e:
        print(f"Error logging action: {e}")
        # 在實際應用中可能需要更完整的錯誤處理
