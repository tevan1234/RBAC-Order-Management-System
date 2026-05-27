import os
from slowapi import Limiter
from slowapi.util import get_remote_address

# 初始化 Limiter，使用 IP 地址作為限制鍵值，並啟用 X-RateLimit-* 回傳標頭
limiter = Limiter(
    key_func=get_remote_address,
    headers_enabled=True
)

# 從環境變數讀取限流配置值，若無則使用安全之預設值
# 預設值：
# - 登入：5 次 / 分鐘
# - 修改密碼：3 次 / 小時
LIMIT_LOGIN = os.getenv("LIMIT_LOGIN", "5/minute")
LIMIT_CHANGE_PASSWORD = os.getenv("LIMIT_CHANGE_PASSWORD", "3/hour")
