from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

_supabase_client: Client = None
_supabase_admin_client: Client = None

def get_supabase() -> Client:
    """回傳一般用途的 Supabase 客戶端 (使用 anon key)"""
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set")
        _supabase_client = create_client(url, key)
    return _supabase_client

def get_supabase_admin() -> Client:
    """回傳具有 service_role 權限的 Admin 客戶端，用於管理員操作 (如建立/刪除使用者)"""
    global _supabase_admin_client
    if _supabase_admin_client is None:
        url = os.getenv("SUPABASE_URL")
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not service_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for admin operations")
        _supabase_admin_client = create_client(url, service_key)
    return _supabase_admin_client
