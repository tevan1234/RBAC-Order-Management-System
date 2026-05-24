import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()

class GeminiService:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        model_name = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        if api_key:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(model_name)
        else:
            self.model = None

    async def generate_content(self, prompt: str):
        if not self.model:
            return "AI 分析服務尚未設定，請聯絡系統管理員。"
        
        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            # 引入 logging 安全地記錄詳細例外
            import logging
            logger = logging.getLogger(__name__)
            logger.exception("GeminiService generate_content failed with exception")
            return "AI 分析服務目前忙碌中，請稍後再試。"


_gemini_service = GeminiService()

def get_gemini_service() -> GeminiService:
    return _gemini_service
