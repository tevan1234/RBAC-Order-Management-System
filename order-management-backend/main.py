from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os

# 載入環境變數
load_dotenv()

from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from services.rate_limiter import limiter

# 匯入路由
from routers import auth, users, products, orders, customers, audit_logs, analytics

app = FastAPI(title="Order Management System API")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


# 設定 CORS
cors_origins_str = os.getenv("CORS_ORIGINS", "")
allow_origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
if not allow_origins:
    allow_origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Disposition"],
    max_age=600,
)

# 掛載路由
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(products.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(customers.router, prefix="/api")
app.include_router(audit_logs.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")

@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """
    自訂速率限制超額異常處理器。
    回傳 429 狀態碼與繁體中文提示訊息，並注入 X-RateLimit-* 標頭。
    """
    response = JSONResponse(
        status_code=429,
        content={"detail": "請求過於頻繁，請稍後再試"}
    )
    # 注入 X-RateLimit 標頭
    if hasattr(request.state, "view_rate_limit"):
        response = request.app.state.limiter._inject_headers(
            response,
            request.state.view_rate_limit
        )
    return response

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    from fastapi.responses import JSONResponse
    import logging
    
    # 記錄完整錯誤堆疊
    logging.exception("Global error catch")
    
    # 判斷環境變數決定錯誤訊息詳細程度
    env = os.getenv("ENV", "production")
    if env == "development":
        detail = str(exc)
    else:
        detail = "發生內部錯誤，請聯絡支援團隊"
        
    # 處理 CORS header，確保與動態 CORS 設定一致
    origin = request.headers.get("origin")
    cors_origins_str = os.getenv("CORS_ORIGINS", "")
    allow_origins = [o.strip() for o in cors_origins_str.split(",") if o.strip()]
    
    headers = {
        "Access-Control-Allow-Credentials": "true"
    }
    if origin in allow_origins:
        headers["Access-Control-Allow-Origin"] = origin
    elif allow_origins:
        headers["Access-Control-Allow-Origin"] = allow_origins[0]
    else:
        headers["Access-Control-Allow-Origin"] = "http://localhost:3000"
        
    return JSONResponse(
        status_code=500,
        content={"detail": detail},
        headers=headers
    )

@app.get("/health")
async def health_check():
    """健康檢查端點"""
    return {"status": "ok", "message": "API is running"}

@app.get("/api/debug/fonts")
async def debug_fonts():
    import os
    from services.export_service import FONT_NAME, FONT_BOLD_NAME, FONT_FOUND, font_paths, local_font_path
    
    font_status = []
    for name, path in font_paths:
        exists = os.path.exists(path)
        size = os.path.getsize(path) if exists else 0
        font_status.append({
            "name": name,
            "path": path,
            "exists": exists,
            "size_bytes": size
        })
        
    usr_share_fonts = []
    try:
        if os.path.exists("/usr/share/fonts"):
            for root, dirs, files in os.walk("/usr/share/fonts"):
                for f in files:
                    if f.endswith((".ttf", ".ttc", ".otf")):
                        usr_share_fonts.append(os.path.join(root, f))
                        if len(usr_share_fonts) > 15:
                            break
                if len(usr_share_fonts) > 15:
                    break
        else:
            usr_share_fonts.append("/usr/share/fonts path does not exist")
    except Exception as e:
        usr_share_fonts.append(f"Error scanning: {str(e)}")

    return {
        "FONT_NAME": FONT_NAME,
        "FONT_BOLD_NAME": FONT_BOLD_NAME,
        "FONT_FOUND": FONT_FOUND,
        "local_font_path": local_font_path,
        "local_font_exists": os.path.exists(local_font_path),
        "local_font_size": os.path.getsize(local_font_path) if os.path.exists(local_font_path) else 0,
        "font_paths_status": font_status,
        "usr_share_fonts_sample": usr_share_fonts
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

