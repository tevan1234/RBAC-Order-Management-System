from fastapi import APIRouter, Depends
from typing import List
from models.schemas import AuditLogResponse
from services.supabase_client import get_supabase
from services.auth_service import require_admin

router = APIRouter(prefix="/audit", tags=["Audit Logs"])

@router.get("/", response_model=List[AuditLogResponse])
async def list_audit_logs(admin: dict = Depends(require_admin)):
    """讀取操作紀錄 (限管理員)"""
    supabase = get_supabase()
    res = supabase.table("audit_logs").select("*").order("timestamp", desc=True).limit(100).execute()
    return res.data
