import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from unittest.mock import patch, MagicMock, AsyncMock

@pytest.fixture
async def ac():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

# 模擬產品列表
MOCK_PRODUCTS = [
    {"product_id": "P1", "name": "極速鍵盤", "price": 1200.0, "status": "active"},
    {"product_id": "P2", "name": "高畫質螢幕", "price": 8500.0, "status": "active"},
]

# 模擬所有訂單資料 (混合多個 Sales 負責的訂單)
MOCK_ORDERS = [
    {"id": "ORD1", "customer": "C1", "product_id": "P1", "amount": 1200.0, "status": "已完成", "owner_id": "EMP_SALES_1", "created_at": "2026-01-05T12:00:00Z", "updated_at": "2026-01-05T12:00:00Z"},
    {"id": "ORD2", "customer": "C2", "product_id": "P2", "amount": 8500.0, "status": "處理中", "owner_id": "EMP_SALES_2", "created_at": "2026-01-06T15:30:00Z", "updated_at": "2026-01-06T15:30:00Z"},
    {"id": "ORD3", "customer": "C3", "product_id": "P1", "amount": 1200.0, "status": "已完成", "owner_id": "EMP_SALES_1", "created_at": "2026-01-06T09:00:00Z", "updated_at": "2026-01-06T09:00:00Z"},
]

class MockReportHistoryRepo:
    store = {}
    def __init__(self, *args, **kwargs):
        pass

    def save_report(self, user_id, report_type, filter_parameters, report_content, record_id=None):
        rec_id = record_id or "some-uuid"
        record = {
            "id": rec_id,
            "user_id": user_id,
            "report_type": report_type,
            "filter_parameters": filter_parameters,
            "report_content": report_content
        }
        MockReportHistoryRepo.store[rec_id] = record
        return record

    def find_one(self, query):
        rec_id = query.get("id")
        return MockReportHistoryRepo.store.get(rec_id)

    def update(self, data, query):
        rec_id = query.get("id")
        if rec_id in MockReportHistoryRepo.store:
            MockReportHistoryRepo.store[rec_id].update(data)
            return MockReportHistoryRepo.store[rec_id]
        return None

    def get_recent_cache(self, user_id, filters, hours=24):
        return None


@pytest.mark.asyncio
async def test_analytics_sales_isolation(ac: AsyncClient):
    """
    測試 Sales 角色：
    - 驗證後端有硬性限制其只能撈取自己（EMP_SALES_1）負責的訂單進行聚合統計。
    """
    sales_user = {
        "id": "uuid-sales-1",
        "email": "sales1@test.com",
        "profile": {
            "id": "uuid-sales-1",
            "employee_id": "EMP_SALES_1",
            "name": "Sales User 1",
            "role": "sales",
            "status": "active"
        }
    }

    # 覆蓋權限與登入狀態依賴
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: sales_user

    try:
        # Mock 我們的 Repositories
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class:
            
            mock_order_repo = MagicMock()
            # 模擬 OrderRepository.get_orders_for_analytics 行為：僅傳回該 Sales 負責的訂單
            mock_order_repo.get_orders_for_analytics.return_value = [
                MOCK_ORDERS[0], MOCK_ORDERS[2]
            ]
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-sales-token"}
            response = await ac.post("/api/analytics/aggregate", json=payload, headers=headers)

            assert response.status_code == 200
            data = response.json()

            # 驗證硬性隔離過濾參數：必須以該 Sales 自身的 employee_id 進行過濾
            mock_order_repo.get_orders_for_analytics.assert_called_once_with(
                owner_id="EMP_SALES_1",
                date_from="2026-01-01",
                date_to="2026-01-31",
                customer_id=None,
                product_id=None
            )

            # 驗證聚合計算結果是否正確
            assert data["total_orders"] == 2
            assert data["total_amount"] == 2400.0  # 1200 + 1200
            assert data["average_amount"] == 1200.0
            assert len(data["product_stats"]) == 1
            assert data["product_stats"][0]["product_id"] == "P1"
            assert data["product_stats"][0]["name"] == "極速鍵盤"
            assert data["product_stats"][0]["quantity"] == 2
            assert data["product_stats"][0]["total_amount"] == 2400.0
            
            # 驗證時間序列 (按日期排序)
            assert "2026-01-05" in data["time_series"]
            assert "2026-01-06" in data["time_series"]
            assert data["time_series"]["2026-01-05"] == 1200.0
            assert data["time_series"]["2026-01-06"] == 1200.0
            
            # 驗證訂單狀態分組
            assert data["status_stats"] == {"已完成": 2}

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_analytics_admin_global_view(ac: AsyncClient):
    """
    測試 Admin 角色：
    - 驗證 Admin 可擁有全局檢視權限，撈取所有 Sales 的訂單。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {
            "id": "uuid-admin",
            "employee_id": "EMP_ADMIN",
            "name": "Admin User",
            "role": "admin",
            "status": "active"
        }
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class:
            
            mock_order_repo = MagicMock()
            # 模擬 Admin 可獲取所有 3 筆訂單
            mock_order_repo.get_orders_for_analytics.return_value = MOCK_ORDERS
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/aggregate", json=payload, headers=headers)

            assert response.status_code == 200
            data = response.json()

            # 驗證全局查詢參數：owner_id 必須為 None
            mock_order_repo.get_orders_for_analytics.assert_called_once_with(
                owner_id=None,
                date_from="2026-01-01",
                date_to="2026-01-31",
                customer_id=None,
                product_id=None
            )

            # 驗證全局聚合計算結果
            assert data["total_orders"] == 3
            assert data["total_amount"] == 2400.0  # 僅計算「已完成」：1200 + 1200
            assert data["average_amount"] == 1200.0
            assert len(data["product_stats"]) == 1  # 僅 P1 有「已完成」訂單
            
            assert data["product_stats"][0]["product_id"] == "P1"
            assert data["product_stats"][0]["name"] == "極速鍵盤"
            assert data["product_stats"][0]["quantity"] == 2
            assert data["product_stats"][0]["total_amount"] == 2400.0

            # 驗證訂單狀態分組
            assert data["status_stats"] == {"已完成": 2, "處理中": 1}

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_analytics_viewer_global_view(ac: AsyncClient):
    """
    測試 Viewer 角色：
    - 驗證 Viewer 可擁有全局檢視權限，撈取所有 Sales 的訂單。
    """
    viewer_user = {
        "id": "uuid-viewer",
        "email": "viewer@test.com",
        "profile": {
            "id": "uuid-viewer",
            "employee_id": "EMP_VIEWER",
            "name": "Viewer User",
            "role": "viewer",
            "status": "active"
        }
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: viewer_user

    try:
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class:
            
            mock_order_repo = MagicMock()
            mock_order_repo.get_orders_for_analytics.return_value = MOCK_ORDERS
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-viewer-token"}
            response = await ac.post("/api/analytics/aggregate", json=payload, headers=headers)

            assert response.status_code == 200
            data = response.json()

            # 驗證全局查詢參數：owner_id 必須為 None
            mock_order_repo.get_orders_for_analytics.assert_called_once_with(
                owner_id=None,
                date_from="2026-01-01",
                date_to="2026-01-31",
                customer_id=None,
                product_id=None
            )
            assert data["total_orders"] == 3

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_analytics_invalid_date_format(ac: AsyncClient):
    """
    測試日期格式驗證：
    - 傳入不正確的 YYYY-MM-DD 格式應回傳 422 錯誤。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        payload = {
            "date_from": "2026/01/01",  # 格式不對
            "date_to": "2026-01-31",
            "customer_id": None,
            "product_id": None
        }

        headers = {"Authorization": "Bearer fake-admin-token"}
        response = await ac.post("/api/analytics/aggregate", json=payload, headers=headers)

        assert response.status_code == 422  # Pydantic 驗證失敗應回傳 422 Unprocessable Entity
        assert "date_from" in response.text

    finally:
        app.dependency_overrides.clear()


# ==================== AI 分析報告與重試機制測試 ====================

MOCK_AI_RESPONSE_JSON = """
{
  "summary": "業績穩健成長",
  "trends": {
    "insights": "本期銷售趨勢呈穩步增長狀態，主要受主力商品推動。",
    "trend_direction": "上升",
    "chart_data": [
      {"name": "2026-01-05", "value": 1200.0},
      {"name": "2026-01-06", "value": 1200.0}
    ]
  },
  "top_products": [
    {
      "name": "極速鍵盤",
      "quantity": 2,
      "revenue": 2400.0,
      "insights": "為本期最暢銷商品，客戶滿意度高。"
    }
  ],
  "forecast": {
    "next_30_days_revenue": 5000.0,
    "confidence": 0.9,
    "recommendation": "建議追加庫存以應對潛在需求。"
  },
  "recommendations": [
    "優化極速鍵盤的供應鏈",
    "針對老客戶進行促銷跟進"
  ]
}
"""

@pytest.mark.asyncio
async def test_generate_report_admin_success(ac: AsyncClient):
    """
    測試 Admin 角色成功生成 AI 報告。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    MockReportHistoryRepo.store.clear()
    try:
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class, \
             patch("services.analytics_service.ReportHistoryRepository", MockReportHistoryRepo), \
             patch("google.generativeai.GenerativeModel") as mock_generative_model_class:

            # Mock 銷售聚合數據獲取
            mock_order_repo = MagicMock()
            mock_order_repo.get_orders_for_analytics.return_value = MOCK_ORDERS
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            # Mock Gemini 呼叫
            mock_model = MagicMock()
            mock_response = MagicMock()
            mock_response.text = MOCK_AI_RESPONSE_JSON
            mock_model.generate_content_async = AsyncMock(return_value=mock_response)
            mock_generative_model_class.return_value = mock_model

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/generate-report", json=payload, headers=headers)

            assert response.status_code == 200
            init_data = response.json()
            assert "task_id" in init_data
            assert init_data["status"] == "processing"

            task_id = init_data["task_id"]

            status_response = await ac.get(f"/api/analytics/task-status/{task_id}", headers=headers)
            assert status_response.status_code == 200
            data = status_response.json()

            # 驗證回傳的結構是否符合 Pydantic 定義
            assert data["status"] == "success"
            assert data["summary"] == "業績穩健成長"
            assert data["trends"]["insights"] == "本期銷售趨勢呈穩步增長狀態，主要受主力商品推動。"
            assert data["trends"]["trend_direction"] == "上升"
            assert data["trends"]["chart_data"][0]["name"] == "2026-01-05"
            assert data["trends"]["chart_data"][0]["value"] == 1200.0
            assert len(data["top_products"]) == 1
            assert data["top_products"][0]["name"] == "極速鍵盤"
            assert data["forecast"]["next_30_days_revenue"] == 5000.0
            assert data["forecast"]["confidence"] == 0.9
            assert len(data["recommendations"]) == 2

            # 驗證是否只呼叫了一次 Gemini (無重試)
            mock_model.generate_content_async.assert_called_once()

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_generate_report_retry_success(ac: AsyncClient):
    """
    測試重試機制：
    - 第一次呼叫 Gemini：回傳非法 JSON
    - 第二次呼叫 Gemini：回傳正常 JSON，應成功完成並返回 200 狀態碼
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    MockReportHistoryRepo.store.clear()
    try:
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class, \
             patch("services.analytics_service.ReportHistoryRepository", MockReportHistoryRepo), \
             patch("google.generativeai.GenerativeModel") as mock_generative_model_class:

            # Mock 銷售聚合數據
            mock_order_repo = MagicMock()
            mock_order_repo.get_orders_for_analytics.return_value = MOCK_ORDERS
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            # 設定 Mock Gemini 多次呼叫的回傳值
            mock_model = MagicMock()
            
            # 第一個 Response 回傳非法的 JSON (或少欄位)，第二個正常
            mock_response_fail = MagicMock()
            mock_response_fail.text = "INVALID_JSON_OR_MISSING_FIELDS"
            
            mock_response_ok = MagicMock()
            mock_response_ok.text = MOCK_AI_RESPONSE_JSON
            
            # 使用 side_effect 依序傳回失敗與成功
            mock_model.generate_content_async = AsyncMock()
            mock_model.generate_content_async.side_effect = [mock_response_fail, mock_response_ok]
            mock_generative_model_class.return_value = mock_model

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31"
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/generate-report", json=payload, headers=headers)

            assert response.status_code == 200
            init_data = response.json()
            assert "task_id" in init_data
            assert init_data["status"] == "processing"

            task_id = init_data["task_id"]

            status_response = await ac.get(f"/api/analytics/task-status/{task_id}", headers=headers)
            assert status_response.status_code == 200
            data = status_response.json()
            assert data["status"] == "success"
            assert data["summary"] == "業績穩健成長"
            
            # 應呼叫過 2 次 (1 次失敗，1 次成功)
            assert mock_model.generate_content_async.call_count == 2

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_generate_report_max_retries_fail(ac: AsyncClient):
    """
    測試重試上限失敗：
    - 連續 3 次呼叫都回傳非法 JSON，應最終回傳 failed 狀態任務。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    MockReportHistoryRepo.store.clear()
    try:
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class, \
             patch("services.analytics_service.ReportHistoryRepository", MockReportHistoryRepo), \
             patch("google.generativeai.GenerativeModel") as mock_generative_model_class:

            mock_order_repo = MagicMock()
            mock_order_repo.get_orders_for_analytics.return_value = MOCK_ORDERS
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            mock_model = MagicMock()
            mock_response_fail = MagicMock()
            mock_response_fail.text = "{}"  # 空 JSON，缺乏必要欄位，Pydantic 驗證必會失敗
            
            # 連續回傳 3 次失敗
            mock_model.generate_content_async = AsyncMock()
            mock_model.generate_content_async.side_effect = [mock_response_fail, mock_response_fail, mock_response_fail]
            mock_generative_model_class.return_value = mock_model

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31"
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/generate-report", json=payload, headers=headers)

            assert response.status_code == 200
            init_data = response.json()
            assert "task_id" in init_data
            assert init_data["status"] == "processing"

            task_id = init_data["task_id"]

            status_response = await ac.get(f"/api/analytics/task-status/{task_id}", headers=headers)
            assert status_response.status_code == 200
            data = status_response.json()

            assert data["status"] == "failed"
            assert "AI 分析服務目前忙碌中，請稍後再試。" in data["error"]
            
            # 應嘗試呼叫過 3 次 (嘗試 + 2次重試)
            assert mock_model.generate_content_async.call_count == 3

    finally:
        app.dependency_overrides.clear()


# ==================== PDF 與 Excel 匯出與 RBAC 安全攔截測試 ====================

@pytest.mark.asyncio
async def test_export_pdf_success(ac: AsyncClient):
    """
    測試匯出 PDF 報告成功 (所有角色皆可下載 PDF，但資料會有隔離)
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        with patch("services.export_service.ExportService.generate_pdf") as mock_gen_pdf:
            mock_gen_pdf.return_value = b"%PDF-1.4 mock pdf data"

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/export-pdf", json=payload, headers=headers)

            assert response.status_code == 200
            assert response.headers["content-type"] == "application/pdf"
            assert response.content == b"%PDF-1.4 mock pdf data"
            mock_gen_pdf.assert_called_once_with(payload, admin_user)

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_export_excel_success_admin(ac: AsyncClient):
    """
    測試 Admin 匯出 Excel 報告成功 (Admin 有全局下載權限)
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        with patch("services.export_service.ExportService.generate_excel") as mock_gen_excel:
            mock_gen_excel.return_value = b"mock excel data"

            payload = {
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/export-excel", json=payload, headers=headers)

            assert response.status_code == 200
            assert "spreadsheetml.sheet" in response.headers["content-type"]
            assert response.content == b"mock excel data"
            mock_gen_excel.assert_called_once_with(payload, admin_user)

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_export_excel_forbidden_viewer(ac: AsyncClient):
    """
    測試 Viewer 匯出 Excel 報告：後端安全攔截，應回傳 403 Forbidden
    """
    viewer_user = {
        "id": "uuid-viewer",
        "email": "viewer@test.com",
        "profile": {"id": "uuid-viewer", "employee_id": "EMP_VIEWER", "role": "viewer", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: viewer_user

    try:
        # 在這裡，真實執行 ExportService.generate_excel，讓它觸發 403 異常，以驗證真實的 RBAC 攔截邏輯
        payload = {
            "date_from": "2026-01-01",
            "date_to": "2026-01-31",
            "customer_id": None,
            "product_id": None
        }

        headers = {"Authorization": "Bearer fake-viewer-token"}
        response = await ac.post("/api/analytics/export-excel", json=payload, headers=headers)

        assert response.status_code == 403
        assert "Viewer" in response.json()["detail"] or "檢視者" in response.json()["detail"]

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_analytics_date_dependency_updated_at(ac: AsyncClient):
    """
    測試銷售分析 X 軸日期依賴修正：
    - 驗證營收時間分組 (time_series) 是依賴於 updated_at (已完成時間) 而非 created_at (建立時間)。
    - ORD_DEP_1: 建立於 4/15，完成於 5/10。營收 3000 元應統計在 5/10。
    - ORD_DEP_2: 建立於 5/18，完成於 6/01。營收 5000 元應統計在 6/01。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {
            "id": "uuid-admin",
            "employee_id": "EMP_ADMIN",
            "name": "Admin User",
            "role": "admin",
            "status": "active"
        }
    }

    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    MOCK_DEP_ORDERS = [
        {"id": "ORD_DEP_1", "customer": "C1", "product_id": "P1", "amount": 3000.0, "status": "已完成", "owner_id": "EMP_ADMIN", "created_at": "2026-04-15T12:00:00Z", "updated_at": "2026-05-10T15:00:00Z"},
        {"id": "ORD_DEP_2", "customer": "C2", "product_id": "P2", "amount": 5000.0, "status": "已完成", "owner_id": "EMP_ADMIN", "created_at": "2026-05-18T10:00:00Z", "updated_at": "2026-06-01T09:30:00Z"},
    ]

    try:
        with patch("services.analytics_service.OrderRepository") as mock_order_repo_class, \
             patch("services.analytics_service.ProductRepository") as mock_prod_repo_class:
            
            mock_order_repo = MagicMock()
            mock_order_repo.get_orders_for_analytics.return_value = MOCK_DEP_ORDERS
            mock_order_repo_class.return_value = mock_order_repo

            mock_prod_repo = MagicMock()
            mock_prod_repo.get_all_products.return_value = MOCK_PRODUCTS
            mock_prod_repo_class.return_value = mock_prod_repo

            payload = {
                "date_from": "2026-05-01",
                "date_to": "2026-05-31",
                "customer_id": None,
                "product_id": None
            }

            headers = {"Authorization": "Bearer fake-admin-token"}
            response = await ac.post("/api/analytics/aggregate", json=payload, headers=headers)

            assert response.status_code == 200
            data = response.json()

            # 驗證資料庫查詢參數是否正確以 updated_at 作為篩選標準
            mock_order_repo.get_orders_for_analytics.assert_called_once_with(
                owner_id=None,
                date_from="2026-05-01",
                date_to="2026-05-31",
                customer_id=None,
                product_id=None
            )

            # 驗證營收是否被正確分組在 updated_at 的台灣時間日期 (注意 Z 是 UTC 時間，+8小時轉換)
            # ORD_DEP_1: 5-10T15:00:00Z -> 台灣時間 5-10T23:00:00，日期為 2026-05-10
            # ORD_DEP_2: 6-01T09:30:00Z -> 台灣時間 6-01T17:30:00，日期為 2026-06-01
            assert "2026-05-10" in data["time_series"]
            assert "2026-06-01" in data["time_series"]
            
            assert data["time_series"]["2026-05-10"] == 3000.0
            assert data["time_series"]["2026-06-01"] == 5000.0

            # 驗證總營收是兩筆訂單的累加
            assert data["total_amount"] == 8000.0

    finally:
        app.dependency_overrides.clear()


# ==================== 手動同步發信 API 測試 ====================

@pytest.mark.asyncio
async def test_send_report_email_success(ac: AsyncClient):
    """
    測試手動發信 API 成功情況 (模擬 EmailService 成功)。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        # Mock 導出 PDF & Excel 與發信服務
        with patch("services.export_service.ExportService.generate_pdf") as mock_pdf, \
             patch("services.export_service.ExportService.generate_excel") as mock_excel, \
             patch("services.email_service.EmailService.send_report_with_attachments") as mock_send_email:
            
            mock_pdf.return_value = b"%PDF mock"
            mock_excel.return_value = b"excel mock"
            mock_send_email.return_value = True

            payload = {
                "email": "target@test.com",
                "filters": {},
                "report_summary": "AI 銷售摘要",
                "report_content": {"summary": "測試"}
            }

            headers = {"Authorization": "Bearer fake-token"}
            response = await ac.post("/api/analytics/send-report-email", json=payload, headers=headers)

            assert response.status_code == 200
            assert response.json()["message"] == "測試分析報告郵件已成功寄出！"
            mock_send_email.assert_called_once()

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_send_report_email_failure_500(ac: AsyncClient):
    """
    測試手動發信 API 失敗情況：
    當 EmailService 發信失敗或拋出異常時，API 能回傳 500 錯誤與詳細原因，以便前端呈現。
    """
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        with patch("services.export_service.ExportService.generate_pdf") as mock_pdf, \
             patch("services.export_service.ExportService.generate_excel") as mock_excel, \
             patch("services.email_service.EmailService.send_report_with_attachments") as mock_send_email:
            
            mock_pdf.return_value = b"%PDF mock"
            mock_excel.return_value = b"excel mock"
            # 模擬 smtplib 連接逾時或驗證失敗拋出錯誤
            mock_send_email.side_effect = Exception("SMTP Connection timed out or Authentication failed")

            payload = {
                "email": "target@test.com",
                "filters": {},
                "report_summary": "AI 銷售摘要",
                "report_content": {"summary": "測試"}
            }

            headers = {"Authorization": "Bearer fake-token"}
            response = await ac.post("/api/analytics/send-report-email", json=payload, headers=headers)

            # 驗證是否拋出 500 錯誤且回傳詳細原因
            assert response.status_code == 500
            data = response.json()
            assert "發送報告郵件失敗" in data["detail"]
            assert "SMTP Connection timed out" in data["detail"]

    finally:
        app.dependency_overrides.clear()


# ==================== Google Gmail API 管道測試 ====================

@pytest.mark.asyncio
async def test_send_report_email_via_gmail_api_success(ac: AsyncClient):
    """
    測試啟用 Google Gmail API 時，手動發信 API 成功調用 Gmail API 通道的情況。
    """
    import os
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    # 模擬環境變數配置了 Gmail API 憑證
    env_mock = {
        "GMAIL_API_CLIENT_ID": "mock-client-id",
        "GMAIL_API_CLIENT_SECRET": "mock-client-secret",
        "GMAIL_API_REFRESH_TOKEN": "mock-refresh-token",
        "ENABLE_SMTP_DIRECT": "True"
    }

    try:
        with patch.dict(os.environ, env_mock), \
             patch("services.export_service.ExportService.generate_pdf") as mock_pdf, \
             patch("services.export_service.ExportService.generate_excel") as mock_excel, \
             patch("services.email_service.EmailService._send_gmail_api_blocking") as mock_gmail_send:
            
            mock_pdf.return_value = b"%PDF mock"
            mock_excel.return_value = b"excel mock"
            mock_gmail_send.return_value = None

            payload = {
                "email": "target@test.com",
                "filters": {},
                "report_summary": "AI 銷售摘要",
                "report_content": {"summary": "測試"}
            }

            headers = {"Authorization": "Bearer fake-token"}
            response = await ac.post("/api/analytics/send-report-email", json=payload, headers=headers)

            assert response.status_code == 200
            assert response.json()["message"] == "測試分析報告郵件已成功寄出！"
            # 確保確實調用了 Gmail API，而不是走傳統的 SMTP
            mock_gmail_send.assert_called_once()

    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_send_report_email_via_gmail_api_failure(ac: AsyncClient):
    """
    測試當 Google Gmail API 發信失敗時，API 是否能捕獲錯誤並回傳 500 給前端。
    """
    import os
    admin_user = {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {"id": "uuid-admin", "employee_id": "EMP_ADMIN", "role": "admin", "status": "active"}
    }
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: admin_user

    env_mock = {
        "GMAIL_API_CLIENT_ID": "mock-client-id",
        "GMAIL_API_CLIENT_SECRET": "mock-client-secret",
        "GMAIL_API_REFRESH_TOKEN": "mock-refresh-token",
        "ENABLE_SMTP_DIRECT": "True"
    }

    try:
        with patch.dict(os.environ, env_mock), \
             patch("services.export_service.ExportService.generate_pdf") as mock_pdf, \
             patch("services.export_service.ExportService.generate_excel") as mock_excel, \
             patch("services.email_service.EmailService._send_gmail_api_blocking") as mock_gmail_send:
            
            mock_pdf.return_value = b"%PDF mock"
            mock_excel.return_value = b"excel mock"
            mock_gmail_send.side_effect = Exception("Gmail API Error: Invalid Refresh Token")

            payload = {
                "email": "target@test.com",
                "filters": {},
                "report_summary": "AI 銷售摘要",
                "report_content": {"summary": "測試"}
            }

            headers = {"Authorization": "Bearer fake-token"}
            response = await ac.post("/api/analytics/send-report-email", json=payload, headers=headers)

            assert response.status_code == 500
            data = response.json()
            assert "發送報告郵件失敗" in data["detail"]
            assert "Gmail API Error: Invalid Refresh Token" in data["detail"]

    finally:
        app.dependency_overrides.clear()



