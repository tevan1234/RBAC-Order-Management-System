from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List
from datetime import datetime
from uuid import UUID
import re

class LoginRequest(BaseModel):
    employee_id: str = Field(..., description="員工編號，格式必須為 EMP 後接至少四位數字")
    password: str = Field(..., description="密碼，不可為空")

    @field_validator("employee_id")
    @classmethod
    def validate_employee_id(cls, v: str) -> str:
        if not re.match(r"^EMP\d{4,}$", v):
            raise ValueError("員工編號格式不正確，必須以 'EMP' 開頭，後接至少 4 位數字（例如：EMP0001）")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("密碼不可為空")
        return v

class ProfileResponse(BaseModel):
    id: UUID = Field(..., description="使用者唯一的 UUID")
    employee_id: str = Field(..., description="員工編號")
    name: str = Field(..., description="使用者姓名")
    email: str = Field(..., description="電子郵件信箱")
    role: str = Field(..., description="使用者角色")
    status: str = Field(..., description="使用者狀態")
    created_at: Optional[datetime] = Field(None, description="建立時間，選填")
    updated_at: Optional[datetime] = Field(None, description="更新時間，選填")

class ProductSchema(BaseModel):
    product_id: str = Field(..., description="商品 ID")
    name: str = Field(..., description="商品名稱")
    price: float = Field(..., description="商品價格")
    status: str = Field(..., description="商品狀態")
    updated_at: Optional[datetime] = Field(None, description="更新時間，選填")

class ProductCreate(BaseModel):
    product_id: Optional[str] = Field(None, description="商品 ID，選填")
    name: str = Field(..., min_length=2, max_length=100, description="商品名稱，2-100 個字元")
    price: float = Field(..., description="商品價格，必須大於或等於 0，最多兩位小數")
    status: Optional[str] = Field("active", description="商品狀態，選填，預設為 active")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("商品名稱不可為空")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: float) -> float:
        if v < 0:
            raise ValueError("價格必須大於或等於 0")
        from decimal import Decimal
        d = Decimal(str(v))
        if d.as_tuple().exponent < -2:
            raise ValueError("價格最多只能有兩位小數")
        return v

class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100, description="商品名稱，選填，2-100 個字元")
    price: Optional[float] = Field(None, description="商品價格，選填，必須大於或等於 0，最多兩位小數")
    status: Optional[str] = Field(None, description="商品狀態，選填")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and (not v or not v.strip()):
            raise ValueError("商品名稱不可為空")
        return v

    @field_validator("price")
    @classmethod
    def validate_price(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if v < 0:
            raise ValueError("價格必須大於或等於 0")
        from decimal import Decimal
        d = Decimal(str(v))
        if d.as_tuple().exponent < -2:
            raise ValueError("價格最多只能有兩位小數")
        return v

class OrderSchema(BaseModel):
    id: str = Field(..., description="訂單 ID")
    customer: str = Field(..., description="客戶名稱")
    product_id: str = Field(..., description="商品 ID")
    amount: float = Field(..., description="訂單金額")
    status: str = Field(..., description="訂單狀態")
    owner_id: str = Field(..., description="訂單擁有者 ID")
    created_at: Optional[datetime] = Field(None, description="建立時間，選填")
    updated_at: Optional[datetime] = Field(None, description="更新時間，選填")

class OrderCreate(BaseModel):
    id: Optional[str] = Field(None, description="訂單 ID，選填")
    customer: str = Field(..., max_length=200, description="客戶名稱，不可為空且最大長度 200 字元")
    product_id: str = Field(..., description="商品 ID")
    amount: Optional[float] = Field(None, description="訂單金額，選填，必須大於或等於 0，最多兩位小數")
    owner_id: Optional[str] = Field(None, description="訂單擁有者 ID，選填")

    @field_validator("customer")
    @classmethod
    def validate_customer(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("客戶名稱不可為空")
        return v

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if v < 0:
            raise ValueError("訂單金額必須大於或等於 0")
        from decimal import Decimal
        d = Decimal(str(v))
        if d.as_tuple().exponent < -2:
            raise ValueError("訂單金額最多只能有兩位小數")
        return v

class CustomerSchema(BaseModel):
    customer_id: str = Field(..., description="客戶 ID")
    name: str = Field(..., description="客戶姓名")
    email: Optional[str] = Field(None, description="電子郵件信箱，選填")
    owner_id: str = Field(..., description="客戶擁有者 ID")
    status: str = Field(..., description="客戶狀態")
    created_at: Optional[datetime] = Field(None, description="建立時間，選填")
    updated_at: Optional[datetime] = Field(None, description="更新時間，選填")

class CustomerCreate(BaseModel):
    customer_id: Optional[str] = Field(None, description="客戶 ID，選填")
    name: str = Field(..., min_length=2, max_length=100, description="客戶姓名，2-100 個字元")
    email: Optional[EmailStr] = Field(None, description="電子郵件信箱，選填，必須符合標準格式")
    owner_id: Optional[str] = Field(None, description="客戶擁有者 ID，選填")
    status: Optional[str] = Field("active", description="客戶狀態，選填，預設為 active")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("客戶姓名不可為空")
        return v

class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100, description="客戶姓名，選填，2-100 個字元")
    email: Optional[EmailStr] = Field(None, description="電子郵件信箱，選填，必須符合標準格式")
    status: Optional[str] = Field(None, description="客戶狀態，選填")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and (not v or not v.strip()):
            raise ValueError("客戶姓名不可為空")
        return v

class AuditLogResponse(BaseModel):
    id: UUID = Field(..., description="稽核日誌唯一的 UUID")
    action: str = Field(..., description="執行的操作/動作")
    user_id: str = Field(..., description="操作使用者的 ID")
    target: str = Field(..., description="操作目標")
    timestamp: datetime = Field(..., description="操作時間戳記")
    operator_id: Optional[str] = Field(None, description="操作員 ID，選填")

class UserAdminCreate(BaseModel):
    email: EmailStr = Field(..., description="電子郵件信箱，必須符合標準格式")
    password: str = Field(..., description="密碼，最少 8 個字元，且必須包含大小寫字母與數字")
    name: str = Field(..., min_length=2, max_length=50, description="使用者姓名，2-50 個字元")
    employee_id: str = Field(..., description="員工編號，格式必須為 EMP 後接至少四位數字（例如：EMP0001）")
    role: str = Field(..., description="使用者角色")

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密碼長度必須至少為 8 個字元")
        if not any(c.isupper() for c in v):
            raise ValueError("密碼必須包含至少一個大寫字母")
        if not any(c.islower() for c in v):
            raise ValueError("密碼必須包含至少一個小寫字母")
        if not any(c.isdigit() for c in v):
            raise ValueError("密碼必須包含至少一個數字")
        return v

    @field_validator("employee_id")
    @classmethod
    def validate_employee_id(cls, v: str) -> str:
        if not re.match(r"^EMP\d{4,}$", v):
            raise ValueError("員工編號格式不正確，必須以 'EMP' 開頭，後接至少 4 位數字（例如：EMP0001）")
        return v

class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=50, description="使用者姓名，選填，2-50 個字元")
    email: Optional[EmailStr] = Field(None, description="電子郵件信箱，選填，必須符合標準格式")
    role: Optional[str] = Field(None, description="使用者角色，選填")
    status: Optional[str] = Field(None, description="使用者狀態，選填")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and (not v or not v.strip()):
            raise ValueError("姓名不可為空")
        return v

class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., description="目前的密碼")
    new_password: str = Field(..., description="新設定的密碼，最少 8 個字元，且必須包含大小寫字母與數字")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密碼長度必須至少為 8 個字元")
        if not any(c.isupper() for c in v):
            raise ValueError("密碼必須包含至少一個大寫字母")
        if not any(c.islower() for c in v):
            raise ValueError("密碼必須包含至少一個小寫字母")
        if not any(c.isdigit() for c in v):
            raise ValueError("密碼必須包含至少一個數字")
        return v

class EmailUpdateRequest(BaseModel):
    email: EmailStr = Field(..., description="新設定的電子郵件信箱，必須符合標準格式")

class OrderUpdate(BaseModel):
    customer: Optional[str] = Field(None, max_length=200, description="客戶名稱，選填，最大長度 200 字元")
    product_id: Optional[str] = Field(None, description="商品 ID，選填")
    amount: Optional[float] = Field(None, description="訂單金額，選填，必須大於或等於 0，最多兩位小數")
    status: Optional[str] = Field(None, description="訂單狀態，選填")
    owner_id: Optional[str] = Field(None, description="訂單擁有者 ID，選填")

    @field_validator("customer")
    @classmethod
    def validate_customer(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and (not v or not v.strip()):
            raise ValueError("客戶名稱不可為空")
        return v

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if v < 0:
            raise ValueError("訂單金額必須大於或等於 0")
        from decimal import Decimal
        d = Decimal(str(v))
        if d.as_tuple().exponent < -2:
            raise ValueError("訂單金額最多只能有兩位小數")
        return v

class OrderStatusUpdate(BaseModel):
    """訂單狀態更新請求 Body"""
    status: str = Field(..., description="更新的訂單狀態")

class AnalyticsRequest(BaseModel):
    date_from: Optional[str] = Field(None, description="開始日期 (YYYY-MM-DD)", json_schema_extra={"example": "2026-01-01"})
    date_to: Optional[str] = Field(None, description="結束日期 (YYYY-MM-DD)", json_schema_extra={"example": "2026-01-31"})
    customer_id: Optional[str] = Field(None, description="客戶 ID，選填")
    product_id: Optional[str] = Field(None, description="商品 ID，選填")

    @field_validator("date_from", "date_to")
    @classmethod
    def validate_date_format(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("日期格式不正確，必須為 YYYY-MM-DD")
        return v

class ProductSalesStats(BaseModel):
    product_id: str = Field(..., description="商品 ID")
    name: Optional[str] = Field(None, description="商品名稱")
    quantity: int = Field(..., description="銷售數量/訂購次數")
    total_amount: float = Field(..., description="銷售總金額")

class AggregatedStats(BaseModel):
    total_orders: int = Field(..., description="總訂單數")
    total_amount: float = Field(..., description="總金額")
    average_amount: float = Field(..., description="平均訂單金額")
    product_stats: List[ProductSalesStats] = Field(..., description="按產品分組統計")
    time_series: dict = Field(..., description="按時間序列分組統計 (例如每日銷售趨勢)")
    status_stats: dict = Field(..., description="按訂單狀態分組統計")


class TrendDetail(BaseModel):
    insights: str = Field(..., description="趨勢分析洞察")
    trend_direction: str = Field(..., description="趨勢走向描述 (例如：上升、平穩、下降)")
    chart_data: List[dict] = Field(..., description="圖表數據點陣列")


class TopProductDetail(BaseModel):
    name: str = Field(..., description="商品名稱")
    quantity: int = Field(..., description="銷售數量")
    revenue: float = Field(..., description="銷售總額")
    insights: str = Field(..., description="針對該商品的銷售分析與洞察")


class ForecastDetail(BaseModel):
    next_30_days_revenue: float = Field(..., description="未來 30 天的預期銷售額")
    confidence: float = Field(..., description="預測信心指數，範圍為 0.0 至 1.0")
    recommendation: str = Field(..., description="基於預測的營運建議")


class AIReportResponse(BaseModel):
    status: str = Field("success", description="生成狀態，例如 'success' 或 'processing'")
    task_id: Optional[str] = Field(None, description="背景任務 ID")
    summary: Optional[str] = Field(None, max_length=20, description="AI 報告簡短摘要 (20字以內)")
    trends: Optional[TrendDetail] = Field(None, description="趨勢分析")
    top_products: Optional[List[TopProductDetail]] = Field(None, description="熱銷商品分析")
    forecast: Optional[ForecastDetail] = Field(None, description="未來 30 天預測")
    recommendations: Optional[List[str]] = Field(None, description="具體行動建議的陣列")


class HistoryItemResponse(BaseModel):
    id: UUID = Field(..., description="歷史紀錄唯一識別碼")
    user_id: UUID = Field(..., description="使用者 ID")
    report_type: str = Field(..., description="報告類型")
    filter_parameters: dict = Field(..., description="篩選過濾參數")
    report_content: dict = Field(..., description="快取的報告內容")
    created_at: datetime = Field(..., description="建立時間")


class HistoryListResponse(BaseModel):
    history: List[HistoryItemResponse] = Field(..., description="歷史報告清單")


class SubscriptionSchema(BaseModel):
    user_id: UUID = Field(..., description="使用者 ID")
    email: str = Field(..., description="電子郵件信箱")
    is_subscribed: bool = Field(..., description="是否訂閱")
    frequency: str = Field(..., description="訂閱頻率 (daily, weekly, monthly)")
    updated_at: datetime = Field(..., description="最後更新時間")


class SubscriptionUpdate(BaseModel):
    is_subscribed: bool = Field(..., description="是否訂閱")
    frequency: str = Field(..., description="訂閱頻率 (daily, weekly, monthly)")


class RealtimeInsightsResponse(BaseModel):
    insights: str = Field(..., description="AI 銷售分析速報簡短心得")
    date_from: str = Field(..., description="銷售數據計算開始日期 (YYYY-MM-DD)")
    date_to: str = Field(..., description="銷售數據計算結束日期 (YYYY-MM-DD)")


class SendEmailRequest(BaseModel):
    email: EmailStr = Field(..., description="接收報告的電子郵件信箱")
    filters: dict = Field(..., description="篩選參數")
    report_summary: str = Field(..., description="報告簡短摘要")
    report_content: dict = Field(..., description="報告完整內容")





