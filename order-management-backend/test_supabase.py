import os
from dotenv import load_dotenv
from supabase import create_client, Client
import json

load_dotenv()
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(url, key)

res = supabase.table("profiles").select("*").eq("employee_id", "EMP001").maybe_single().execute()
print(f"Result type: {type(res)}")
print(f"Result: {res}")
