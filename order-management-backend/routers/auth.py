from fastapi import APIRouter, HTTPException, Depends
from models.schemas import RegisterRequest, LoginRequest
from services.supabase_client import get_supabase
from services.auth_service import get_current_user
from services.audit_service import log_action

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register")
async def register(req: RegisterRequest):
    """註冊新使用者，並透過 Trigger 自動建立 Profile"""
    supabase = get_supabase()
    try:
        # 呼叫 supabase.auth.sign_up
        # 注意：要在 options 中傳遞 data，以便資料庫 Trigger 捕捉
        res = supabase.auth.sign_up({
            "email": req.email,
            "password": req.password,
            "options": {
                "data": {
                    "name": req.name,
                    "employee_id": req.employee_id,
                    "role": req.role
                }
            }
        })
        
        if not res.user:
            raise HTTPException(status_code=400, detail="註冊失敗")
            
        await log_action(req.employee_id, "REGISTER", f"User registered: {req.email}")
        
        return {"user": res.user, "session": res.session}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/login")
async def login(req: LoginRequest):
    """使用員工代號登入"""
    supabase = get_supabase()
    try:
        # 1. 根據 employee_id 查詢 email
        profile_res = supabase.table("profiles").select("email, name, role").eq("employee_id", req.employee_id).single().execute()
        
        if not profile_res.data:
            raise HTTPException(status_code=404, detail="員工代號不存在")
            
        email = profile_res.data.get("email")
        
        # 2. 使用 email 與密碼登入
        try:
            res = supabase.auth.sign_in_with_password({
                "email": email,
                "password": req.password
            })
        except Exception as auth_e:
            raise HTTPException(status_code=401, detail="密碼錯誤")
        
        if not res.session:
            raise HTTPException(status_code=401, detail="密碼錯誤")
            
        await log_action(req.employee_id, "LOGIN", "User logged in")
        
        return {
            "access_token": res.session.access_token,
            "token_type": "bearer",
            "user": {
                "name": profile_res.data.get("name"),
                "role": profile_res.data.get("role"),
                "employee_id": req.employee_id
            }
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """取得目前登入的使用者資訊"""
    return current_user
