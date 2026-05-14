from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from uuid import UUID

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    employee_id: str
    role: Optional[str] = "viewer"

class LoginRequest(BaseModel):
    employee_id: str
    password: str

class ProfileResponse(BaseModel):
    id: UUID
    employee_id: str
    name: str
    email: str
    role: str
    status: str
    created_at: Optional[datetime] = None

class ProductSchema(BaseModel):
    product_id: str
    name: str
    price: float

class OrderSchema(BaseModel):
    id: str
    customer: str
    product_id: str
    amount: float
    status: str
    owner_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class OrderCreate(BaseModel):
    id: Optional[str] = None
    customer: str
    product_id: str
    amount: Optional[float] = None
    owner_id: Optional[str] = None

class CustomerSchema(BaseModel):
    customer_id: str
    name: str
    email: Optional[str] = None
    owner_id: str
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class CustomerCreate(BaseModel):
    customer_id: Optional[str] = None
    name: str
    email: Optional[str] = None
    owner_id: Optional[str] = None
    status: Optional[str] = "active"

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None

class AuditLogResponse(BaseModel):
    id: UUID
    action: str
    user_id: str
    target: str
    timestamp: datetime

class UserAdminCreate(BaseModel):
    email: str
    password: str
    name: str
    employee_id: str
    role: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

class EmailUpdateRequest(BaseModel):
    email: EmailStr

class OrderUpdate(BaseModel):
    customer: Optional[str] = None
    product_id: Optional[str] = None
    amount: Optional[float] = None
    status: Optional[str] = None
    owner_id: Optional[str] = None
