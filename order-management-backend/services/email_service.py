import os
import logging
import smtplib
import asyncio
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class EmailService:
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
        - 採用 asyncio.to_thread 將阻塞性 SMTP 連線作業外派至內部執行緒池，保障 FastAPI 事件循環不中斷。
        - 若未配置 SMTP 憑證，將自動優雅降級為 Mock 模擬發信模式。
        """
        configs = cls._get_smtp_configs()
        
        # 1. 檢查是否啟用本地直接寄送
        if not configs["enable_direct"]:
            logger.info(f"[EmailService] 本地直寄功能已關閉 (ENABLE_SMTP_DIRECT=False)")
            return False

        # 2. 健全度防禦：若 SMTP 憑證未填寫，自動優雅降級為 Mock 發信，不中斷業務流程
        if not configs["user"] or not configs["password"]:
            logger.warning(
                f"[Mock Email Send] SMTP 帳號或密碼未填寫！將自動進行模擬發信。\n"
                f"收件者: {email}\n"
                f"標題: {subject}\n"
                f"夾帶附件列表: {[att.get('filename') for att in attachments]}\n"
                f"內文長度: {len(html_content) if html_content else 0} 字元"
            )
            # 模擬發信非同步等待，以貼近真實網路延遲體驗
            await asyncio.sleep(0.5)
            return True

        # 3. 呼叫 smtplib 阻塞性發信，外派至執行緒池執行
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
            logger.error(f"Email 本地發送失敗: {str(e)}", exc_info=True)
            if raise_on_error:
                raise e
            # 不在背景任務中拋出 HTTPException 導致伺服器出錯，僅回傳 False 讓上層做日誌防禦
            return False
