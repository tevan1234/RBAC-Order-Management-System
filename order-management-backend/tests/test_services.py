import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException
from services.order_service import get_orders, update_order_status, STATUS_COMPLETED, STATUS_PROCESSING
from services.user_service import UserService
from models.schemas import UserAdminCreate

# 模擬使用者資料
MOCK_SALES_USER = {
    "role": "sales",
    "employee_id": "S001",
    "profile": {"id": "uuid-sales", "role": "sales"}
}

MOCK_ADMIN_USER = {
    "role": "admin",
    "employee_id": "A001",
    "profile": {"id": "uuid-admin", "role": "admin"}
}

@pytest.mark.asyncio
async def test_get_orders_sales_permission():
    """
    測試情境 A (Sales 權限)：
    驗證 role='sales' 的 User 呼叫 get_orders，結果是否只包含其 employee_id 的資料。
    """
    with patch("services.order_service.get_supabase") as mock_get_supabase:
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase
        
        # 模擬查詢鏈：supabase.table("orders").select("*").eq("owner_id", "S001").execute()
        mock_query = mock_supabase.table.return_value.select.return_value.eq.return_value
        mock_query.execute.return_value = MagicMock(data=[{"id": "order-1", "owner_id": "S001"}])
        
        result = await get_orders(MOCK_SALES_USER)
        
        # 驗證是否呼叫了正確的過濾條件
        mock_supabase.table.assert_called_with("orders")
        mock_supabase.table().select().eq.assert_called_with("owner_id", "S001")
        assert len(result) == 1
        assert result[0]["owner_id"] == "S001"

@pytest.mark.asyncio
async def test_update_order_status_completed_restriction():
    """
    測試情境 B (狀態限制)：
    模擬 sales 嘗試將狀態為「已完成」的訂單改為「已作廢」，預期應拋出 403 HTTPException。
    """
    with patch("services.order_service.get_supabase") as mock_get_supabase:
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase
        
        # 模擬獲取原訂單資訊：狀態為 STATUS_COMPLETED
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"id": "order-1", "status": STATUS_COMPLETED, "owner_id": "S001"}]
        )
        
        # 預期拋出 403 HTTPException
        with pytest.raises(HTTPException) as excinfo:
            await update_order_status("order-1", "已作廢", MOCK_SALES_USER)
        
        assert excinfo.value.status_code == 403
        assert "不可修改" in excinfo.value.detail

@pytest.mark.asyncio
async def test_create_user_as_admin_api_call():
    """
    測試情境 C (Admin 新增)：
    測試 user_service.create_user_as_admin 是否正確呼叫了 Supabase Admin Auth API。
    """
    with patch("services.user_service.get_supabase") as mock_get_supabase, \
         patch("services.audit_service.log_action", new_callable=AsyncMock) as mock_log:
        
        mock_supabase = MagicMock()
        mock_get_supabase.return_value = mock_supabase
        
        # 模擬預先檢查 employee_id 不存在
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        
        # 模擬 Auth Admin API 回傳
        mock_auth_user = MagicMock()
        mock_auth_user.id = "new-user-uuid"
        mock_supabase.auth.admin.create_user.return_value = MagicMock(user=mock_auth_user)
        
        # 模擬 Profile 同步回傳
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
            data={"id": "new-user-uuid", "email": "test@example.com"}
        )
        
        user_data = UserAdminCreate(
            email="test@example.com",
            password="password123",
            name="Test User",
            employee_id="E999",
            role="sales"
        )
        
        result = await UserService.create_user_as_admin(user_data, MOCK_ADMIN_USER)
        
        # 驗證 Admin Auth API 呼叫參數
        mock_supabase.auth.admin.create_user.assert_called_once()
        args, kwargs = mock_supabase.auth.admin.create_user.call_args
        called_data = args[0]
        assert called_data["email"] == "test@example.com"
        assert called_data["user_metadata"]["employee_id"] == "E999"
        assert called_data["user_metadata"]["role"] == "sales"
        
        # 驗證日誌記錄
        mock_log.assert_called_once()
        assert result["email"] == "test@example.com"
