from fastapi import APIRouter, Depends
from typing import List
from models.schemas import AuditLogResponse
from services.auth_service import get_current_user, require_permission
from services import audit_service

router = APIRouter(prefix="/audit", tags=["Audit Logs"])

@router.get("/", response_model=List[AuditLogResponse])
async def list_audit_logs(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission('AUDITLOG_VIEW'))
):
    """讀取操作紀錄 (限管理員)"""
    return await audit_service.get_audit_logs()
