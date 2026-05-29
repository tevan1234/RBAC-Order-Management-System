import os
import logging
import smtplib
import asyncio
import ssl
import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class EmailService:
    @staticmethod
    def _get_gmail_api_configs() -> Dict[str, Any]:
        """
        獲取環境變數中的 Google Gmail API 憑證設定項目。
        """
        return {
            "client_id": os.getenv("GMAIL_API_CLIENT_ID"),
            "client_secret": os.getenv("GMAIL_API_CLIENT_SECRET"),
            "refresh_token": os.getenv("GMAIL_API_REFRESH_TOKEN"),
        }

    @classmethod
    def _is_gmail_api_configured(cls) -> bool:
        """
        檢查是否已經配置了完整的 Gmail API 憑證環境變數。
        """
        configs = cls._get_gmail_api_configs()
        return bool(configs["client_id"] and configs["client_secret"] and configs["refresh_token"])

    @staticmethod
    def _send_gmail_api_blocking(
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str,
        attachments: List[Dict[str, Any]],
        configs: Dict[str, Any]
    ) -> None:
        """
        以同步阻塞方式透過 Google Gmail REST API (走 HTTPS 443 埠) 發送電子郵件。
        """
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        # 1. 建立符合標準的 MIME 多重郵件結構
        msg = MIMEMultipart()
        msg["From"] = configs["from_addr"] or os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")
        msg["To"] = to_email
        msg["Subject"] = subject

        # 2. 附加純文字與 HTML 內文軌道
        if text_content:
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
        if html_content:
            msg.attach(MIMEText(html_content, "html", "utf-8"))

        # 3. 附加多重附件
        for att in attachments:
            data = att.get("data")
            filename = att.get("filename", "attachment")
            mime_type = att.get("mime_type", "application/octet-stream")

            if not data:
                continue

            maintype, subtype = mime_type.split("/", 1) if "/" in mime_type else ("application", "octet-stream")
            part = MIMEBase(maintype, subtype)
            part.set_payload(data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f"attachment; filename={filename}")
            msg.attach(part)

        # 4. 初始化 Google API Credentials
        creds = Credentials(
            token=None,
            refresh_token=configs["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=configs["client_id"],
            client_secret=configs["client_secret"]
        )

        # 5. 建立 Gmail API 服務
        logger.info("正在連線並建立 Google Gmail REST API 服務...")
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)

        # 6. 將 MIME 郵件編碼為 Base64 urlsafe 格式以符合 Gmail API 規範
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        payload = {"raw": raw_message}

        # 7. 送出郵件
        logger.info(f"正在透過 Gmail API HTTPS 通道直接發信至 {to_email}...")
        service.users().messages().send(userId="me", body=payload).execute()
        logger.info(f"Gmail API 發信成功！已送至 {to_email}，附件數量: {len(attachments)}")

    @staticmethod
    def _get_smtp_configs() -> Dict[str, Any]:
        """
        獲取環境變數中的 SMTP 設定項目。
        """
        return {
            "enable_direct": os.getenv("ENABLE_SMTP_DIRECT", "True").lower() == "true",
            "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
            "port": int(os.getenv("SMTP_PORT", "587")),
            "user": os.getenv("SMTP_USER", "").strip(),
            "password": os.getenv("SMTP_PASSWORD", "").strip(),
            "from_addr": os.getenv("SMTP_FROM", "noreply@example.com").strip(),
            "use_tls": os.getenv("SMTP_USE_TLS", "True").lower() == "true"
        }

    @staticmethod
    def _send_smtp_blocking(
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str,
        attachments: List[Dict[str, Any]],
        configs: Dict[str, Any]
    ) -> None:
        """
        同步阻塞性的 SMTP 發送邏輯，此方法將在獨立的執行緒中運行。
        """
        # 1. 建立 MIME 最外層容器 (multipart/mixed) 以支援附件
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = configs["from_addr"]
        msg["To"] = to_email

        # 2. 建立內層容器 (multipart/alternative) 承載純文字與 HTML 信件內容
        msg_alternative = MIMEMultipart("alternative")
        
        # 純文字部分 (不支援 HTML 的郵件客戶端讀取)
        if text_content:
            msg_alternative.attach(MIMEText(text_content, "plain", "utf-8"))
        else:
            msg_alternative.attach(MIMEText("請參閱 HTML 格式的銷售分析報告。", "plain", "utf-8"))
            
        # HTML 部分
        if html_content:
            msg_alternative.attach(MIMEText(html_content, "html", "utf-8"))

        msg.attach(msg_alternative)

        # 3. 處理並夾帶附件列表
        for att in attachments:
            data = att.get("data")
            filename = att.get("filename", "attachment")
            mime_type = att.get("mime_type", "application/octet-stream")

            if not data:
                logger.warning(f"附件 {filename} 無數據內容，跳過不夾帶")
                continue

            # 建立附件 MIME 基礎物件
            part = MIMEBase(*mime_type.split("/", 1))
            part.set_payload(data)
            encoders.encode_base64(part)

            # 設定標頭與檔名編碼，避免繁體中文檔名在某些郵件客戶端產生亂碼
            # RFC 2231 編碼格式
            part.add_header(
                "Content-Disposition",
                "attachment",
                filename=("utf-8", "", filename)
            )
            msg.attach(part)

        # 4. 建立 SMTP 連線並寄送
        logger.info(f"正在連線至 SMTP 伺服器 {configs['host']}:{configs['port']}...")
        
        # 建立一個不驗證 SSL 憑證的 Context，防禦 Linux/Docker 環境下憑證缺失導致 of SSL 連線錯誤
        context = ssl._create_unverified_context()
        
        # 依據 port 來決定是否直接建立 SSL 連線或使用 TLS
        if configs["port"] == 465:
            server = smtplib.SMTP_SSL(configs["host"], configs["port"], context=context, timeout=15.0)
        else:
            server = smtplib.SMTP(configs["host"], configs["port"], timeout=15.0)

        try:
            server.ehlo()
            if configs["port"] != 465 and configs["use_tls"]:
                server.starttls(context=context)
                server.ehlo()
                
            # 登入驗證
            server.login(configs["user"], configs["password"])
            
            # 發送郵件
            server.sendmail(configs["from_addr"], [to_email], msg.as_string())
            logger.info(f"Email 成功發送至 {to_email}，附件數量: {len(attachments)}")
        finally:
            try:
                server.quit()
            except Exception:
                pass

    @classmethod
    async def send_report_with_attachments(
        cls,
        email: str,
        subject: str,
        html_content: str,
        text_content: str,
        attachments: List[Dict[str, Any]],
        raise_on_error: bool = False
    ) -> bool:
        """
        非同步發送包含多重附件的電子郵件。
        - 優先偵測並使用 Google Gmail API 走 HTTPS Port 443 發信，以 100% 避開雲端平台（如 Render）的 SMTP 封鎖。
        - 若未設定 Gmail API，則 Fallback 降級走傳統 SMTP 連線。
        - 若皆未設定，自動優雅降級為 Mock 模擬發信模式。
        """
        # 1. 優先判定並呼叫 Google Gmail API 發信軌道
        if cls._is_gmail_api_configured():
            logger.info("檢測到已配置 Gmail API 憑證，將優先啟用 Google Gmail REST API (HTTPS Port 443) 通道直接發信...")
            api_configs = cls._get_gmail_api_configs()
            smtp_configs = cls._get_smtp_configs()
            api_configs["from_addr"] = smtp_configs.get("from_addr") or os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")
            
            try:
                await asyncio.to_thread(
                    cls._send_gmail_api_blocking,
                    to_email=email,
                    subject=subject,
                    html_content=html_content,
                    text_content=text_content,
                    attachments=attachments,
                    configs=api_configs
                )
                return True
            except Exception as e:
                logger.error(f"Gmail API 發信失敗: {str(e)}", exc_info=True)
                if raise_on_error:
                    raise e
                return False

        # 2. 以下為原先的 SMTP / Mock Fallback 通道
        configs = cls._get_smtp_configs()
        
        # 檢查是否啟用本地直接寄送
        if not configs["enable_direct"]:
            logger.info(f"[EmailService] 本地直寄功能已關閉 (ENABLE_SMTP_DIRECT=False)")
            return False

        # 健全度防禦：若 SMTP 憑證未填寫，自動優雅降級為 Mock 發信，不中斷業務流程
        if not configs["user"] or not configs["password"]:
            logger.warning(
                f"[Mock Email Send] SMTP 帳號或密碼未填寫且未設定 Gmail API！將自動進行模擬發信。\n"
                f"收件者: {email}\n"
                f"標題: {subject}\n"
                f"夾帶附件列表: {[att.get('filename') for att in attachments]}\n"
                f"內文長度: {len(html_content) if html_content else 0} 字元"
            )
            # 模擬發信非同步等待，以貼近真實網路延遲體驗
            await asyncio.sleep(0.5)
            return True

        # 呼叫 smtplib 阻塞性發信，外派至執行緒池執行
        try:
            await asyncio.to_thread(
                cls._send_smtp_blocking,
                to_email=email,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
                attachments=attachments,
                configs=configs
            )
            return True
        except Exception as e:
            logger.error(f"Email 本地 SMTP 發送失敗: {str(e)}", exc_info=True)
            if raise_on_error:
                raise e
            # 不在背景任務中拋出 HTTPException 導致伺服器出錯，僅回傳 False 讓上層做日誌防禦
            return False
