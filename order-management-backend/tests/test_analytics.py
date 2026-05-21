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
    {"id": "ORD1", "customer": "C1", "product_id": "P1", "amount": 1200.0, "status": "已完成", "owner_id": "EMP_SALES_1", "created_at": "2026-01-05T12:00:00Z"},
    {"id": "ORD2", "customer": "C2", "product_id": "P2", "amount": 8500.0, "status": "處理中", "owner_id": "EMP_SALES_2", "created_at": "2026-01-06T15:30:00Z"},
    {"id": "ORD3", "customer": "C3", "product_id": "P1", "amount": 1200.0, "status": "已完成", "owner_id": "EMP_SALES_1", "created_at": "2026-01-06T09:00:00Z"},
]

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
            assert data["total_amount"] == 10900.0  # 1200 + 8500 + 1200
            assert round(data["average_amount"], 2) == round(10900.0 / 3, 2)
            assert len(data["product_stats"]) == 2  # P1, P2
            
            # P2 金額最大，應該排在第一個
            assert data["product_stats"][0]["product_id"] == "P2"
            assert data["product_stats"][0]["name"] == "高畫質螢幕"
            assert data["product_stats"][0]["quantity"] == 1
            assert data["product_stats"][0]["total_amount"] == 8500.0

            assert data["product_stats"][1]["product_id"] == "P1"
            assert data["product_stats"][1]["name"] == "極速鍵盤"
            assert data["product_stats"][1]["quantity"] == 2
            assert data["product_stats"][1]["total_amount"] == 2400.0

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
