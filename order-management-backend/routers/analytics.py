import logging
from fastapi import APIRouter, Depends, Response
from models.schemas import AnalyticsRequest, AggregatedStats, AIReportResponse
from services.auth_service import get_current_user, require_permission
from services.analytics_service import AnalyticsService
from services.export_service import ExportService

logger = logging.getLogger(__name__)

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

@router.post("/generate-report", response_model=AIReportResponse)
async def generate_ai_report(
    req: AnalyticsRequest,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    銷售分析 AI 報告生成。
    - 根據請求的過濾條件，對訂單數據進行硬性角色隔離聚合。
    - 調用 Gemini AI 分析引擎，生成包含趨勢洞察、熱銷商品分析、營收預測與具體行動建議的高階商業智慧報告。
    - 內部實作 2 次失敗重試機制。
    """
    return await AnalyticsService.generate_ai_report(req.model_dump(), user)

@router.post("/export-pdf")
async def export_pdf(
    req: AnalyticsRequest,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    匯出銷售分析 PDF 報告。
    - 所有具備 ANALYTICS_VIEW 權限的角色都可以下載，但內容會依角色進行數據隔離。
    """
    pdf_data = await ExportService.generate_pdf(req.model_dump(), user)
    return Response(
        content=pdf_data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "attachment; filename=sales_report.pdf",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@router.post("/export-excel")
async def export_excel(
    req: AnalyticsRequest,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    匯出銷售數據 Excel 報告。
    - 內部進行嚴格角色防禦，若是 Viewer 角色則攔截並拋出 403。
    """
    excel_data = await ExportService.generate_excel(req.model_dump(), user)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename=sales_report.xlsx",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )


