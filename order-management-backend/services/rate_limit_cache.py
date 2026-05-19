import time
import threading
from typing import Dict, Any, Tuple

class RateLimitCache:
    """
    簡單的記憶體快取服務 (In-Memory Cache)，用於管理密碼修改的失敗嘗試與臨時鎖定機制。
    支援線程安全 (Thread-Safe)，並可於未來平滑移轉至 Redis 方案。
    
    # ── 多實例部署 (Redis) 替代方案說明 ──
    # 若未來部署於多實例 (Multi-instance) 環境，可使用 redis-py 替換此類別的實作：
    # 1. is_locked:
    #    remaining = redis_client.ttl(f"lockout:{user_id}")
    #    return remaining > 0, max(0.0, float(remaining))
    # 2. record_failure:
    #    count = redis_client.incr(f"fail_count:{user_id}")
    #    if count == 1:
    #        redis_client.expire(f"fail_count:{user_id}", 1800) # 30分鐘自動重設
    #    ... (計算延遲)
    #    if count >= 5:
    #        redis_client.setex(f"lockout:{user_id}", 900, "locked")
    # 3. reset_failures:
    #    redis_client.delete(f"fail_count:{user_id}", f"lockout:{user_id}")
    """
    
    def __init__(self):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        
    def is_locked(self, user_id: str) -> Tuple[bool, float]:
        """
        檢查使用者是否處於鎖定狀態。
        
        回傳:
            (is_locked, remaining_seconds): 是否鎖定，以及剩餘的鎖定秒數。
        """
        with self._lock:
            user_data = self._cache.get(user_id)
            if not user_data:
                return False, 0.0
            
            now = time.time()
            lockout_until = user_data.get("lockout_until", 0.0)
            
            if lockout_until > now:
                return True, lockout_until - now
            
            # 若鎖定時間已過，自動重設失敗計數與鎖定狀態
            if lockout_until > 0.0:
                user_data["fail_count"] = 0
                user_data["lockout_until"] = 0.0
                
            return False, 0.0

    def record_failure(self, user_id: str) -> Tuple[int, float]:
        """
        記錄一次密碼驗證失敗。
        會根據失敗次數進行指數退避 (Exponential Backoff)，並在達到 5 次失敗時鎖定 15 分鐘。
        
        回傳:
            (fail_count, delay_seconds): 累計失敗次數，以及本次嘗試需延遲的秒數。
        """
        # 順便執行清理過期快取以防止 Memory Leak
        self._clean_expired_keys_internal()
        
        with self._lock:
            now = time.time()
            user_data = self._cache.get(user_id)
            
            if not user_data:
                user_data = {
                    "fail_count": 0,
                    "lockout_until": 0.0,
                    "last_failed_at": 0.0
                }
                self._cache[user_id] = user_data
            
            # 貼心防護：若上次失敗已超過 30 分鐘且未被鎖定，自動重設失敗計數，避免跨天累積
            if user_data["lockout_until"] == 0.0 and now - user_data["last_failed_at"] > 1800:
                user_data["fail_count"] = 0

            user_data["fail_count"] += 1
            user_data["last_failed_at"] = now
            
            fail_count = user_data["fail_count"]
            delay = 0.0
            
            # 指數退避邏輯 (Exponential Backoff)
            if fail_count in [1, 2]:
                delay = 0.0
            elif fail_count in [3, 4]:
                delay = 2.0
            elif fail_count >= 5:
                delay = 5.0
                # 達 5 次失敗，臨時鎖定 15 分鐘 (900 秒)
                user_data["lockout_until"] = now + 900.0
                
            return fail_count, delay

    def reset_failures(self, user_id: str):
        """
        密碼驗證成功時，清除該使用者的失敗紀錄。
        """
        with self._lock:
            if user_id in self._cache:
                del self._cache[user_id]

    def _clean_expired_keys_internal(self):
        """
        內部清理方法，移除超過 30 分鐘未活動的快取項目。
        """
        # 注意：此方法在 record_failure 內被呼叫，故內部有獨立鎖或應注意鎖重入。
        # 由於 Python 的 threading.Lock 是不可重入的 (Non-reentrant)，
        # 我們必須使用 threading.RLock (可重入鎖) 或者避免在此處重複獲取 self._lock。
        # 為了安全與簡潔，我們在此方法中手動獲取鎖，而在 record_failure 中呼叫時，
        # 我們是在獲取 self._lock 之前呼叫此方法。
        with self._lock:
            now = time.time()
            to_delete = []
            for user_id, data in self._cache.items():
                # 若 30 分鐘內無任何失敗嘗試，且未處於鎖定狀態，則可安全刪除
                if data["lockout_until"] == 0.0 and now - data["last_failed_at"] > 1800:
                    to_delete.append(user_id)
                # 若鎖定已過期超過 30 分鐘，亦可刪除
                elif data["lockout_until"] > 0.0 and now - data["lockout_until"] > 1800:
                    to_delete.append(user_id)
            
            for user_id in to_delete:
                del self._cache[user_id]

# 全域單例
rate_limit_cache = RateLimitCache()
