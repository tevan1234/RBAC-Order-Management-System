from fastapi import APIRouter, HTTPException, Depends, Request, Response
from models.schemas import RegisterRequest, LoginRequest, PasswordChangeRequest, EmailUpdateRequest
from services.supabase_client import get_supabase
from services.auth_service import get_current_user, AuthService
from services.audit_service import log_action
from services.rate_limiter import limiter, LIMIT_LOGIN, LIMIT_REGISTER, LIMIT_CHANGE_PASSWORD

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register")
@limiter.limit(LIMIT_REGISTER)
async def register(request: Request, response: Response, req: RegisterRequest):
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
@limiter.limit(LIMIT_LOGIN)
async def login(request: Request, response: Response, req: LoginRequest):
    """使用員工代號登入"""
    supabase = get_supabase()
    try:
        # 1. 根據 employee_id 查詢 email (使用 maybe_single 避免 PGRST116)
        profile_res = supabase.table("profiles").select("employee_id, email, name, role, status, must_change_password").eq("employee_id", req.employee_id).maybe_single().execute()
        
        if not profile_res or not hasattr(profile_res, 'data') or not profile_res.data:
            raise HTTPException(status_code=404, detail="員工代號不存在")
        
        if profile_res.data.get("status") == "inactive":
            raise HTTPException(status_code=403, detail="此帳號已停用，請聯絡管理員")
            
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
        
        profile = profile_res.data
        return {
            "access_token": res.session.access_token,
            "token_type": "bearer",
            "user": {
                "name": profile.get("name"),
                "role": profile.get("role"),
                "employee_id": req.employee_id,
                "email": profile.get("email"),
                "status": profile.get("status", "active"),
                "must_change_password": profile.get("must_change_password", False)
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

@router.patch("/change-password")
@limiter.limit(LIMIT_CHANGE_PASSWORD)
async def change_password(request: Request, response: Response, req: PasswordChangeRequest, user: dict = Depends(get_current_user)):
    """修改密碼"""
    try:
        # AuthService.change_password 實作在 services/auth_service.py
        await AuthService.change_password(user["profile"]["id"], user["email"], req.current_password, req.new_password)
        await log_action(user["profile"]["employee_id"], "UPDATE_PASSWORD", "User updated their password")
        return {"message": "密碼已成功修改"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/update-email")
async def update_email(req: EmailUpdateRequest, user: dict = Depends(get_current_user)):
    """更新 Email"""
    try:
        await AuthService.update_email(user["profile"]["id"], req.email)
        await log_action(user["profile"]["employee_id"], "UPDATE_EMAIL", f"User updated their email to {req.email}")
        return {"message": "Email 已成功更新"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
