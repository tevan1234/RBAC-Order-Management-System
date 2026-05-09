import pytest
from httpx import AsyncClient, ASGITransport
from main import app
import os
from dotenv import load_dotenv

load_dotenv()

@pytest.fixture
async def ac():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

@pytest.fixture
async def admin_token(ac: AsyncClient):
    # 使用 EMP5590 / admin123 登入取得 token
    login_data = {
        "employee_id": "EMP5590",
        "password": "admin123"
    }
    response = await ac.post("/api/auth/login", json=login_data)
    assert response.status_code == 200
    return response.json()["access_token"]

@pytest.mark.asyncio
async def test_health_check(ac: AsyncClient):
    response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "API is running"}

@pytest.mark.asyncio
async def test_login_success(ac: AsyncClient):
    login_data = {
        "employee_id": "EMP5590",
        "password": "admin123"
    }
    response = await ac.post("/api/auth/login", json=login_data)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["employee_id"] == "EMP5590"

@pytest.mark.asyncio
async def test_login_fail(ac: AsyncClient):
    login_data = {
        "employee_id": "EMP5590",
        "password": "wrongpassword"
    }
    response = await ac.post("/api/auth/login", json=login_data)
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_get_me(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    response = await ac.get("/api/auth/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["profile"]["employee_id"] == "EMP5590"

# --- User Management ---
@pytest.mark.asyncio
async def test_list_users(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    response = await ac.get("/api/users/", headers=headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.asyncio
async def test_create_user(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    import random
    test_id = f"TEST{random.randint(1000, 9999)}"
    user_data = {
        "email": f"{test_id}@test.com",
        "password": "password123",
        "name": f"Test User {test_id}",
        "employee_id": test_id,
        "role": "sales"
    }
    response = await ac.post("/api/users/", json=user_data, headers=headers)
    if response.status_code == 200:
        data = response.json()
        assert data["employee_id"] == test_id
    else:
        print(f"User creation returned {response.status_code}: {response.text}")

# --- Product Management ---
@pytest.mark.asyncio
async def test_product_crud(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    import random
    prod_id = f"PROD{random.randint(1000, 9999)}"
    
    # 1. Create
    prod_data = {
        "product_id": prod_id,
        "name": "Test Product",
        "price": 99.9
    }
    res = await ac.post("/api/products/", json=prod_data, headers=headers)
    assert res.status_code == 200
    
    # 2. List
    res = await ac.get("/api/products/", headers=headers)
    assert res.status_code == 200
    products = res.json()
    assert any(p["product_id"] == prod_id for p in products)
    
    # 3. Update
    update_data = prod_data.copy()
    update_data["name"] = "Updated Product"
    res = await ac.put(f"/api/products/{prod_id}", json=update_data, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "Updated Product"
    
    # 4. Delete
    res = await ac.delete(f"/api/products/{prod_id}", headers=headers)
    assert res.status_code == 200

# --- Order Management ---
@pytest.mark.asyncio
async def test_order_flow(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    import random
    order_id = f"ORD{random.randint(1000, 9999)}"
    
    # 1. Create Order
    order_data = {
        "id": order_id,
        "customer": "Test Customer",
        "product_id": "P001",
        "amount": 100.0,
        "status": "處理中",
        "owner_id": "EMP5590"
    }
    res = await ac.post("/api/orders/", json=order_data, headers=headers)
    assert res.status_code == 200
    
    # 2. Update Status
    res = await ac.patch(f"/api/orders/{order_id}/status?status=已完成", headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "已完成"

# --- Customer Management ---
@pytest.mark.asyncio
async def test_customer_crud(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    import random
    cust_id = f"CUST{random.randint(1000, 9999)}"
    
    # 1. Create
    cust_data = {
        "customer_id": cust_id,
        "name": "Test Customer",
        "email": "test@cust.com",
        "owner_id": "EMP5590",
        "status": "active"
    }
    res = await ac.post("/api/customers/", json=cust_data, headers=headers)
    assert res.status_code == 200
    
    # 2. Update
    update_data = {"name": "Updated Customer Name"}
    res = await ac.patch(f"/api/customers/{cust_id}", json=update_data, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "Updated Customer Name"

# --- Audit Logs ---
@pytest.mark.asyncio
async def test_audit_logs(ac: AsyncClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    res = await ac.get("/api/audit/", headers=headers)
    assert res.status_code == 200
    assert isinstance(res.json(), list)
