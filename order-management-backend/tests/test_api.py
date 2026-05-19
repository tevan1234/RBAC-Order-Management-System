import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from unittest.mock import patch, AsyncMock, MagicMock
import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from unittest.mock import patch, AsyncMock, MagicMock

@pytest.fixture
async def ac():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

@pytest.fixture
def mock_user():
    return {
        "id": "uuid-admin",
        "email": "admin@test.com",
        "profile": {
            "id": "uuid-admin",
            "employee_id": "EMP5590",
            "name": "Admin User",
            "role": "admin",
            "status": "active"
        }
    }

@pytest.fixture(autouse=True)
def setup_dependencies(mock_user):
    from services.auth_service import get_current_user, require_admin
    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.dependency_overrides[require_admin] = lambda: mock_user
    yield
    app.dependency_overrides = {}

@pytest.mark.asyncio
async def test_health_check(ac: AsyncClient):
    response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "API is running"}

@pytest.mark.asyncio
async def test_login_success(ac: AsyncClient):
    login_data = {"employee_id": "EMP5590", "password": "admin123"}
    
    # We need to mock the supabase call in auth.py login
    with patch("routers.auth.get_supabase") as mock_get_supabase:
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase
        
        # Mock profile check
        mock_profile = MagicMock()
        mock_profile.data = {"email": "admin@test.com", "name": "Admin", "role": "admin", "status": "active"}
        mock_supabase.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = mock_profile
        
        # Mock auth sign in
        mock_session = MagicMock()
        mock_session.session.access_token = "fake-token"
        mock_supabase.auth.sign_in_with_password.return_value = mock_session
        
        response = await ac.post("/api/auth/login", json=login_data)
        assert response.status_code == 200
        assert "access_token" in response.json()

@pytest.mark.asyncio
async def test_get_me(ac: AsyncClient, mock_user):
    headers = {"Authorization": "Bearer fake-token"}
    response = await ac.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["profile"]["employee_id"] == "EMP5590"

# --- User Management ---
@pytest.mark.asyncio
async def test_list_users(ac: AsyncClient):
    headers = {"Authorization": "Bearer fake-token"}
    with patch("routers.users.UserService.get_user_list", new_callable=AsyncMock) as mock_list:
        mock_list.return_value = [{
            "id": "1e97de8c-c5ed-440f-9274-455fe8389c31",
            "employee_id": "U001",
            "name": "User 1",
            "email": "u1@t.com",
            "role": "sales",
            "status": "active"
        }]
        response = await ac.get("/api/users/", headers=headers)
        assert response.status_code == 200
        assert len(response.json()) == 1

@pytest.mark.asyncio
async def test_create_user(ac: AsyncClient):
    headers = {"Authorization": "Bearer fake-token"}
    user_data = {
        "email": "new@test.com",
        "password": "Password123",
        "name": "New User",
        "employee_id": "EMP9999",
        "role": "sales"
    }
    with patch("routers.users.UserService.create_user_as_admin", new_callable=AsyncMock) as mock_create:
        mock_create.return_value = {
            "id": "2f97de8c-c5ed-440f-9274-455fe8389c32",
            "employee_id": "EMP9999",
            "name": "New User",
            "email": "new@test.com",
            "role": "sales",
            "status": "active"
        }
        response = await ac.post("/api/users/", json=user_data, headers=headers)
        assert response.status_code == 200
        assert response.json()["employee_id"] == "EMP9999"

# --- Product Management ---
@pytest.mark.asyncio
async def test_product_crud(ac: AsyncClient):
    headers = {"Authorization": "Bearer fake-token"}
    
    with patch("routers.products.ProductService", spec=True) as mock_service:
        mock_service.create_product = AsyncMock(return_value={"product_id": "P1", "name": "Prod 1", "price": 10.0, "status": "active"})
        mock_service.get_all_products = AsyncMock(return_value=[{"product_id": "P1", "name": "Prod 1", "price": 10.0, "status": "active"}])
        
        # Create
        res = await ac.post("/api/products/", json={"product_id": "P1", "name": "Prod 1", "price": 10}, headers=headers)
        assert res.status_code == 200
        
        # List
        res = await ac.get("/api/products/", headers=headers)
        assert res.status_code == 200
        assert len(res.json()) == 1

# --- Order Management ---
@pytest.mark.asyncio
async def test_order_flow(ac: AsyncClient):
    headers = {"Authorization": "Bearer fake-token"}
    
    with patch("routers.orders.OrderService", spec=True) as mock_service:
        mock_service.create_order = AsyncMock(return_value={
            "id": "ORD1", "customer": "C1", "product_id": "P1", "amount": 100.0, "status": "處理中", "owner_id": "EMP001"
        })
        mock_service.update_order_status = AsyncMock(return_value={
            "id": "ORD1", "customer": "C1", "product_id": "P1", "amount": 100.0, "status": "已完成", "owner_id": "EMP001"
        })
        
        # Create Order
        res = await ac.post("/api/orders/", json={"customer": "C1", "product_id": "P1", "amount": 100}, headers=headers)
        assert res.status_code == 200
        
        # Update Status
        res = await ac.patch("/api/orders/ORD1/status", json={"status": "已完成"}, headers=headers)
        assert res.status_code == 200
        assert res.json()["status"] == "已完成"

# --- Customer Management ---
@pytest.mark.asyncio
async def test_customer_crud(ac: AsyncClient):
    headers = {"Authorization": "Bearer fake-token"}
    
    with patch("routers.customers.customer_service", spec=True) as mock_service:
        mock_service.create_customer = AsyncMock(return_value={
            "customer_id": "C1", "name": "Cust 1", "email": "c1@t.com", "owner_id": "EMP001", "status": "active"
        })
        res = await ac.post("/api/customers/", json={"customer_id": "C1", "name": "Cust 1", "email": "c1@t.com"}, headers=headers)
        assert res.status_code == 200

# --- Audit Logs ---
@pytest.mark.asyncio
async def test_audit_logs(ac: AsyncClient):
    headers = {"Authorization": "Bearer fake-token"}
    with patch("routers.audit_logs.audit_service", spec=True) as mock_service:
        mock_service.get_audit_logs = AsyncMock(return_value=[{
            "id": "1e97de8c-c5ed-440f-9274-455fe8389c31", 
            "action": "LOGIN", 
            "user_id": "EMP001", 
            "target": "SYSTEM", 
            "timestamp": "2026-05-13T00:00:00"
        }])
        response = await ac.get("/api/audit/", headers=headers)
        assert response.status_code == 200
        assert len(response.json()) == 1

@pytest.mark.asyncio
async def test_audit_logs_forbidden_for_non_admin(ac: AsyncClient):
    # 測試非 admin 角色（如 sales）發送請求會被拒絕
    sales_user = {
        "id": "uuid-sales",
        "email": "sales@test.com",
        "profile": {
            "id": "uuid-sales",
            "employee_id": "EMP002",
            "name": "Sales User",
            "role": "sales",
            "status": "active"
        }
    }
    
    # 覆蓋依賴注入，回傳 sales 使用者
    from services.auth_service import get_current_user
    app.dependency_overrides[get_current_user] = lambda: sales_user
    
    try:
        headers = {"Authorization": "Bearer fake-token"}
        response = await ac.get("/api/audit/", headers=headers)
        assert response.status_code == 403
        assert "無權進行此操作" in response.json()["detail"]
    finally:
        # 清除 override，恢復原本 setup_dependencies 中設置的 admin 使用者
        app.dependency_overrides[get_current_user] = lambda: {
            "id": "uuid-admin",
            "email": "admin@test.com",
            "profile": {
                "id": "uuid-admin",
                "employee_id": "EMP5590",
                "name": "Admin User",
                "role": "admin",
                "status": "active"
            }
        }

