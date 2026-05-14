from fastapi import APIRouter, Depends
from typing import List
from models.schemas import AuditLogResponse
from services.supabase_client import get_supabase
from services.auth_service import require_admin
from services import audit_service

router = APIRouter(prefix="/audit", tags=["Audit Logs"])

@router.get("/", response_model=List[AuditLogResponse])
async def list_audit_logs(admin: dict = Depends(require_admin)):
    """讀取操作紀錄 (限管理員)"""
    return await audit_service.get_audit_logs()
