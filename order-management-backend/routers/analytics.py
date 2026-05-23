import logging
import uuid
import hashlib
import json
from fastapi import APIRouter, Depends, Response, BackgroundTasks, HTTPException
from models.schemas import (
    AnalyticsRequest,
    AggregatedStats,
    AIReportResponse,
    HistoryListResponse,
    RealtimeInsightsResponse,
    SendEmailRequest,
    SubscriptionSchema,
    SubscriptionUpdate
)
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
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    銷售分析 AI 報告生成（背景任務非同步處理版）。
    1. 根據請求的過濾條件，先行計算數據聚合以取得動態指紋與命中快取。
    2. 若快取命中，則立即返回已生成的報告內容。
    3. 若快取未命中，在 report_history 中插入狀態為 'processing' 的 placeholder 紀錄，
       並將 AI 分析任務投入背景線程池 (BackgroundTasks) 執行，立刻回傳處理中的任務 ID。
    """
    filters = req.model_dump()
    profile = user.get("profile", user)
    user_id = user.get("id") or profile.get("id")

    # 1. 撈取聚合數據以計算最新數據指紋
    aggregated_data = await AnalyticsService.aggregate_orders(filters, user)
    
    fingerprint_source = f"{aggregated_data.get('total_orders')}_{aggregated_data.get('total_amount')}_{json.dumps(aggregated_data.get('status_stats'), sort_keys=True)}"
    fingerprint = hashlib.md5(fingerprint_source.encode('utf-8')).hexdigest()
    cache_filters = {**filters, "_fingerprint": fingerprint}

    # 2. 每日快取檢查 (24 小時內相同指紋)
    if user_id:
        try:
            history_repo = AnalyticsService._get_report_history_repo()
            cached_record = history_repo.get_recent_cache(str(user_id), cache_filters, hours=24)
            if cached_record:
                report_content = cached_record.get("report_content") or {}
                report_content["status"] = "success"
                report_content["task_id"] = str(cached_record.get("id"))
                logger.info(f"AI 銷售分析快取命中 (Cache HIT)! 使用者 ID: {user_id}")
                return report_content
        except Exception as ce:
            logger.error(f"快取檢查失敗，改由背景生成: {str(ce)}")

    # 3. 快取未命中：建立 processing 狀態並派發背景任務
    task_id = str(uuid.uuid4())
    
    if user_id:
        try:
            history_repo = AnalyticsService._get_report_history_repo()
            history_repo.save_report(
                user_id=str(user_id),
                report_type="sales_analytics",
                filter_parameters=cache_filters,
                report_content={"status": "processing", "task_id": task_id},
                record_id=task_id
            )
        except Exception as he:
            logger.error(f"寫入背景任務 placeholder 紀錄失敗: {str(he)}")
            raise HTTPException(status_code=500, detail="系統建立背景分析任務失敗")
            
    background_tasks.add_task(
        AnalyticsService.background_generate_ai_report,
        task_id=task_id,
        cache_filters=cache_filters,
        user=user
    )
    
    return {
        "status": "processing",
        "task_id": task_id
    }


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

@router.get("/history", response_model=HistoryListResponse)
async def get_analytics_history(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    獲取當前使用者的 AI 銷售分析歷史報告紀錄清單。
    """
    history = await AnalyticsService.get_report_history(user)
    return {"history": history}


@router.get("/realtime-insights", response_model=RealtimeInsightsResponse)
async def get_realtime_insights(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    獲取首頁 AI 銷售速報。
    撈取包含昨天在內的最近 7 天數據，計算 date_from 與 date_to，並呼叫 Gemini 同步生成極簡銷售速報。
    使用 1 小時快取以防止重覆呼叫。
    """
    return await AnalyticsService.get_realtime_insights(user)


@router.get("/task-status/{task_id}")
async def get_task_status(
    task_id: str,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    獲取背景 AI 報告生成的進度與內容。
    """
    history_repo = AnalyticsService._get_report_history_repo()
    record = history_repo.find_one({"id": task_id})
    if not record:
        raise HTTPException(status_code=404, detail="找不到指定的背景任務")
    
    # 確保使用者只能查詢自己的任務 (安全隔離)
    profile = user.get("profile", user)
    user_id = user.get("id") or profile.get("id")
    if str(record.get("user_id")) != str(user_id):
        raise HTTPException(status_code=403, detail="您無權存取此背景任務資訊")
        
    return record.get("report_content")


@router.post("/send-report-email")
async def send_report_email(
    req: SendEmailRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    手動發送 AI 銷售報告至使用者信箱。
    封裝「Email、篩選參數、報告摘要、報告內容」為 JSON，以 BackgroundTasks 發送至外部 n8n Webhook。
    """
    background_tasks.add_task(
        AnalyticsService.send_email_webhook_task,
        email=req.email,
        filters=req.filters,
        report_summary=req.report_summary,
        report_content=req.report_content
    )
    return {"message": "報告發送任務已成功排入背景佇列"}


@router.get("/subscription", response_model=SubscriptionSchema)
async def get_subscription(
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    獲取當前使用者的 AI 銷售報告定期訂閱偏好設定。
    """
    return await AnalyticsService.get_subscription(user)


@router.post("/subscription", response_model=SubscriptionSchema)
async def update_subscription(
    req: SubscriptionUpdate,
    user: dict = Depends(get_current_user),
    _: dict = Depends(require_permission("ANALYTICS_VIEW"))
):
    """
    更新當前使用者的 AI 銷售報告定期訂閱偏好設定。
    """
    return await AnalyticsService.update_subscription(req.model_dump(), user)



