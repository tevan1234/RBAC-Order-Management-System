from fastapi import Header, HTTPException, Depends
from services.supabase_client import get_supabase
import time

# 簡單的記憶體緩存 (方案 B: 60秒 TTL)
# 格式: {user_id: {"data": profile_dict, "expiry": timestamp}}
_profile_cache = {}
CACHE_TTL = 60

async def get_current_user(authorization: str = Header(...)):
    """從 token 取得目前使用者及其 Profile 角色 (具備 60 秒緩存優化)"""
    try:
        token = authorization.replace("Bearer ", "")
        supabase = get_supabase()
        
        # 取得 Supabase Auth 使用者 (這步通常會解析 JWT，速度較快)
        response = supabase.auth.get_user(token)
        if not response.user:
            raise HTTPException(status_code=401, detail="請先登入")
        
        user_id = response.user.id
        current_time = time.time()
        
        # 檢查緩存是否有效
        cached = _profile_cache.get(user_id)
        if cached and current_time < cached["expiry"]:
            return {
                "id": user_id,
                "email": response.user.email,
                "profile": cached["data"]
            }
        
        # 若無緩存或已過期，則從 profiles 表取得完整資訊
        profile_res = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
        
        if not profile_res.data:
            raise HTTPException(status_code=404, detail="找不到使用者設定檔")
            
        # 更新緩存
        _profile_cache[user_id] = {
            "data": profile_res.data,
            "expiry": current_time + CACHE_TTL
        }
            
        return {
            "id": user_id,
            "email": response.user.email,
            "profile": profile_res.data
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Auth error: {e}")
        raise HTTPException(status_code=401, detail="驗證失敗或 Token 已過期")

async def require_admin(user: dict = Depends(get_current_user)):
    """驗證是否為 admin 權限"""
    if user["profile"].get("role") != "admin":
        raise HTTPException(status_code=403, detail="權限不足，僅限管理員存取")
    return user

async def require_sales_or_admin(user: dict = Depends(get_current_user)):
    """驗證是否為 admin 或 sales 權限"""
    role = user["profile"].get("role")
    if role not in ["admin", "sales"]:
        raise HTTPException(status_code=403, detail="權限不足，僅限業務或管理員存取")
    return user
