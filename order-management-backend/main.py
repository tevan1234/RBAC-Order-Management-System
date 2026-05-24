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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
