import os
import pytest
from httpx import AsyncClient, ASGITransport
from main import app
from unittest.mock import patch, MagicMock

# 註冊一個臨時的 endpoint 用於觸發內部錯誤
@app.get("/api/test-error")
async def trigger_error():
    raise ValueError("這是一個機密的資料庫連線錯誤！")

@pytest.fixture
async def ac():
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        yield client

@pytest.mark.asyncio
async def test_cors_headers_allowed_origin(ac: AsyncClient):
    # 測試允許的 Origin 請求時，CORS Middleware 的回應
    # CORS 預設是透過環境變數 CORS_ORIGINS 載入，我們在 .env 裡設定了 http://localhost:3000 和 http://127.0.0.1:3000
    headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
    }
    response = await ac.options("/health", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert response.headers.get("access-control-allow-credentials") == "true"
    assert "POST" in response.headers.get("access-control-allow-methods", "")

@pytest.mark.asyncio
async def test_cors_headers_disallowed_origin(ac: AsyncClient):
    # 測試非法的 Origin 請求時，CORS 是否被阻擋或不包含對應 CORS headers
    headers = {
        "Origin": "http://malicious.com",
        "Access-Control-Request-Method": "POST",
    }
    response = await ac.options("/health", headers=headers)
    # 根據 FastAPI CORS 阻隔，如果 Origin 不合法，它將不會在回應中包含 Access-Control-Allow-Origin
    assert response.headers.get("access-control-allow-origin") is None

@pytest.mark.asyncio
async def test_global_exception_handler_development(ac: AsyncClient):
    # 測試開發環境下，全局異常處理回傳詳細資訊
    with patch("os.getenv") as mock_getenv:
        def getenv_side_effect(key, default=None):
            if key == "ENV":
                return "development"
            if key == "CORS_ORIGINS":
                return "http://localhost:3000,http://127.0.0.1:3000"
            return os.environ.get(key, default)
            
        mock_getenv.side_effect = getenv_side_effect
        
        headers = {"Origin": "http://localhost:3000"}
        response = await ac.get("/api/test-error", headers=headers)
        assert response.status_code == 500
        json_data = response.json()
        assert "這是一個機密的資料庫連線錯誤！" in json_data["detail"]
        assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
        assert response.headers.get("access-control-allow-credentials") == "true"

@pytest.mark.asyncio
async def test_global_exception_handler_production(ac: AsyncClient):
    # 測試生產環境下，全局異常處理遮蔽敏感資訊
    with patch("os.getenv") as mock_getenv:
        def getenv_side_effect(key, default=None):
            if key == "ENV":
                return "production"
            if key == "CORS_ORIGINS":
                return "http://localhost:3000,http://127.0.0.1:3000"
            return os.environ.get(key, default)
            
        mock_getenv.side_effect = getenv_side_effect
        
        headers = {"Origin": "http://localhost:3000"}
        response = await ac.get("/api/test-error", headers=headers)
        assert response.status_code == 500
        json_data = response.json()
        assert json_data["detail"] == "發生內部錯誤，請聯絡支援團隊"
        assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
        assert response.headers.get("access-control-allow-credentials") == "true"

@pytest.mark.asyncio
async def test_rate_limiting_login(ac: AsyncClient):
    # 測試 /api/auth/login 的速率限制 (限制是 5/minute)
    # 我們需要 Mock Supabase 回傳，以防真正的登入請求
    login_data = {"employee_id": "EMP5590", "password": "password123"}
    
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
        
        # 呼叫直到被限流阻擋 (最多 6 次)
        limit_triggered = False
        for _ in range(6):
            response = await ac.post("/api/auth/login", json=login_data)
            if response.status_code == 429:
                limit_triggered = True
                json_data = response.json()
                assert json_data["detail"] == "請求過於頻繁，請稍後再試"
                assert "x-ratelimit-limit" in response.headers
                assert "x-ratelimit-remaining" in response.headers
                break
            else:
                assert response.status_code == 200
                assert "x-ratelimit-limit" in response.headers
                assert "x-ratelimit-remaining" in response.headers
                
        assert limit_triggered, "應該要觸發限流阻擋 (429)，但卻順利通過了所有請求"

