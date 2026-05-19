from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List
from datetime import datetime
from uuid import UUID
import re

class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="電子郵件信箱，必須符合標準格式")
    password: str = Field(..., description="密碼，最少 8 個字元，且必須包含大小寫字母與數字")
    name: str = Field(..., min_length=2, max_length=50, description="使用者姓名，2-50 個字元")
    employee_id: str = Field(..., description="員工編號，格式必須為 EMP 後接至少四位數字（例如：EMP0001）")
    role: Optional[str] = Field("viewer", description="使用者角色，選填，預設為 viewer")

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
