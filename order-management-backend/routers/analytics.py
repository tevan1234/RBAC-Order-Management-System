from fastapi import APIRouter, Depends
from models.schemas import AnalyticsRequest, AggregatedStats
from services.auth_service import get_current_user, require_permission
from services.analytics_service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["Sales Analytics"])

@router.post("/aggregate", response_model=AggregatedStats)
async def aggregate_analytics(
    req: AnalyticsRequest,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    銷售分析資料聚合運算。
    - Admin 和 Viewer 擁有「全局檢視權限」，可取得所有訂單數據的聚合統計。
    - Sales 僅能擁有「個人檢視權限」，系統將強制進行資料隔離，僅統計該 Sales 自身負責的訂單數據。
    """
    return await AnalyticsService.aggregate_orders(req.model_dump(), user)
