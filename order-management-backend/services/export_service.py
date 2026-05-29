import os
import io
import logging
import pandas as pd
from fastapi import HTTPException
from typing import Dict, Any, List, Optional
from datetime import datetime

# Matplotlib 與 ReportLab 設置
import matplotlib
matplotlib.use('Agg')  # 強制使用無 GUI 後端，避免在伺服器環境出錯
import matplotlib.pyplot as plt
from matplotlib import font_manager

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from services.analytics_service import AnalyticsService
from services.supabase_client import get_supabase_admin
from repositories import OrderRepository, ProductRepository

logger = logging.getLogger(__name__)

# ==========================================
# 1. 繁體中文字體相容防禦 (跨平台 CJK 支援與動態下載)
# ==========================================
FONT_NAME = "Helvetica"
FONT_BOLD_NAME = "Helvetica-Bold"
FONT_FOUND = False
FONT_DOWNLOAD_ERROR = "尚未執行字體下載防禦"

# 取得專案根目錄與本地字體快取路徑
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
local_font_dir = os.path.join(base_dir, "static", "fonts")
local_font_path = os.path.join(local_font_dir, "NotoSansTC-Regular.ttf")

# 跨平台字體候選路徑 (Windows, Linux 系統字體, 以及本地端備用字體)
font_paths = [
    # 1. Windows 繁體中文微軟正黑體
    ("MSJH", "C:\\Windows\\Fonts\\msjh.ttc"),
    ("MSJH", "C:\\Windows\\Fonts\\msjh.ttf"),
    ("MSJH", "C:\\Windows\\Fonts\\Microsoft\\msjh.ttc"),
    
    # 2. Linux (Render) 內建 Noto CJK / 儷黑體等繁體中文字體
    ("NotoSansCJK", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    ("NotoSansCJK", "/usr/share/fonts/noto-cjk/NotoSansCJKtc-Regular.otf"),
    ("NotoSansCJK", "/usr/share/fonts/truetype/noto-cjk/NotoSansCJKtc-Regular.otf"),
    ("NotoSansCJK", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
    ("WenQuanYi", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
    
    # 3. 本地端 / 運行期動態下載備用字體 (堅不可摧的終極防禦)
    ("NotoSansTC", local_font_path),
]

def check_and_download_backup_font():
    """檢查是否有任何系統內建中文字體存在，若無，且本地亦無備用字體，則自動進行動態下載防禦"""
    global FONT_DOWNLOAD_ERROR
    system_font_found = False
    for _, path in font_paths[:-1]:  # 排除最後一個本地路徑
        if os.path.exists(path):
            system_font_found = True
            break
            
    if not system_font_found and not os.path.exists(local_font_path):
        # 準備多個下載來源 (確保在全球任何雲端伺服器網路皆能順利下載)
        urls = [
            "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf", # jsDelivr 全球加速 CDN (使用編碼括號)
            "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"  # GitHub Raw 原始路徑 (使用編碼括號)
        ]
        
        errors = []
        for url in urls:
            try:
                logger.info(f"正在嘗試自 {url} 下載 NotoSansTC 中文字體...")
                os.makedirs(local_font_dir, exist_ok=True)
                
                import urllib.request
                import ssl
                # 建立一個不驗證 SSL 憑證的 Context，徹底防禦 Linux/Docker 環境下憑證缺失導致的 SSL 連線錯誤
                context = ssl._create_unverified_context()
                
                req = urllib.request.Request(
                    url, 
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                )
                with urllib.request.urlopen(req, context=context, timeout=45) as response, open(local_font_path, 'wb') as out_file:
                    out_file.write(response.read())
                logger.info(f"備援中文字體下載成功！來源: {url}")
                FONT_DOWNLOAD_ERROR = f"成功 (來源: {url})"
                return True
            except Exception as e:
                logger.warning(f"自 {url} 下載失敗: {str(e)}")
                errors.append(f"[{url}] {str(e)}")
        
        FONT_DOWNLOAD_ERROR = "所有下載來源皆失敗: " + " | ".join(errors)
        return False
    else:
        if system_font_found:
            FONT_DOWNLOAD_ERROR = "已找到內建系統字體，跳過下載"
        elif os.path.exists(local_font_path):
            FONT_DOWNLOAD_ERROR = "本地備援字體已存在，跳過下載"
        return True

def ensure_font_registered():
    """確保中文字體已正確載入 (可被重複呼叫，具備執行期自動防禦機制)"""
    global FONT_NAME, FONT_BOLD_NAME, FONT_FOUND
    if FONT_FOUND:
        return
        
    # 執行字體下載防禦
    check_and_download_backup_font()
    
    # 開始註冊字體
    for name, path in font_paths:
        if os.path.exists(path):
            try:
                # 註冊 ReportLab 字體
                pdfmetrics.registerFont(TTFont(name, path))
                FONT_NAME = name
                FONT_BOLD_NAME = name
                FONT_FOUND = True
                logger.info(f"成功註冊 ReportLab 中文字體: {name} (路徑: {path})")
                
                # 註冊 Matplotlib 字體
                font_manager.fontManager.addfont(path)
                prop = font_manager.FontProperties(fname=path)
                plt.rcParams['font.sans-serif'] = [prop.get_name()]
                plt.rcParams['axes.unicode_minus'] = False  # 避免負號顯示為亂碼
                logger.info(f"成功註冊 Matplotlib 中文字體: {prop.get_name()}")
                break
            except Exception as e:
                logger.warning(f"註冊中文字體失敗 ({path}): {str(e)}")

# 啟動時進行第一次嘗試
ensure_font_registered()

# ==========================================
# 2. 導出服務類別
# ==========================================
class ExportService:
    @staticmethod
    def _get_order_repo() -> OrderRepository:
        return OrderRepository(get_supabase_admin())

    @staticmethod
    def _get_product_repo() -> ProductRepository:
        return ProductRepository(get_supabase_admin())

    @staticmethod
    async def generate_pdf(filters: dict, user: dict) -> bytes:
        filters = filters or {}
        # 確保中文字體已載入 (防禦性雙重檢查)
        ensure_font_registered()
        """
        生成結構化且精美的 PDF 銷售分析報告。
        - 內部調用 AnalyticsService 進行角色權限硬性隔離數據聚合。
        - 自動生成折線圖與條形圖，並以 BytesIO 嵌入。
        - 嘗試調用 Gemini 生成 AI 商業智慧洞察，若服務失敗則自動 fallback 僅顯示數據，提升系統健全度。
        """
        # A. 數據獲取 (包含角色隔離)
        aggregated_data = await AnalyticsService.aggregate_orders(filters, user)
        
        # 獲取使用者角色
        profile = user.get("profile", user)
        role = profile.get("role", "viewer")
        employee_id_val = profile.get("employee_id", "")
        
        # 堅不可摧的姓名獲取機制 (多級安全 fallback)
        display_name = profile.get("name") or profile.get("username")
        if not display_name:
            try:
                user_id = user.get("id")
                if user_id:
                    supabase_cli = get_supabase_admin()
                    res = supabase_cli.table("profiles").select("name").eq("id", user_id).maybe_single().execute()
                    if res and res.data:
                        display_name = res.data.get("name")
            except Exception as e:
                logger.warning(f"即時查詢使用者姓名失敗: {str(e)}")
                
        if not display_name:
            display_name = user.get("email") or "未知使用者"
        
        # 組合顯示名稱（姓名 + 員工代號）以提高辨識度
        username = f"{display_name} ({employee_id_val})" if employee_id_val else display_name
        
        # B. 嘗試調用 Gemini 獲取 AI 商業報告 (作為 PDF 亮點，若失敗則優雅降級)
        import asyncio
        ai_report = None
        try:
            # 限制最多等待 15 秒，避免 AI 服務無限阻塞影響使用者下載 PDF 體驗
            ai_report = await asyncio.wait_for(
                AnalyticsService.generate_ai_report(filters, user),
                timeout=15.0
            )
        except Exception as e:
            logger.warning(f"PDF 匯出中呼叫 AI 報告失敗或超時 (優雅降級為僅顯示數據): {str(e)}")

        # C. 繪製 Matplotlib 圖表
        chart_line_img = None
        chart_bar_img = None
        
        try:
            # 1. 銷售走勢圖 (折線圖)
            time_series = aggregated_data.get("time_series", {})
            if time_series:
                plt.figure(figsize=(6, 2.5))
                dates = list(time_series.keys())
                amounts = list(time_series.values())
                
                plt.plot(dates, amounts, marker='o', color='#3182CE', linewidth=2, label="銷售額")
                plt.title("每日銷售走勢圖", fontsize=12, color='#1A365D', weight='bold')
                plt.xlabel("日期", fontsize=9, color='#4A5568')
                plt.ylabel("金額 (元)", fontsize=9, color='#4A5568')
                plt.grid(True, linestyle='--', alpha=0.5)
                plt.xticks(rotation=30, ha='right', fontsize=8)
                plt.yticks(fontsize=8)
                plt.tight_layout()
                
                buf = io.BytesIO()
                plt.savefig(buf, format='png', dpi=200)
                buf.seek(0)
                chart_line_img = buf
                plt.close()
            
            # 2. 熱銷商品圖 (條形圖)
            product_stats = aggregated_data.get("product_stats", [])
            if product_stats:
                plt.figure(figsize=(6, 2.5))
                # 僅取前 5 個熱銷商品
                top_products = product_stats[:5]
                names = [p["name"] for p in top_products]
                revenues = [p["total_amount"] for p in top_products]
                
                # 條形圖由大到小，為了在 barh 中從上到下顯示，需要 reverse
                names.reverse()
                revenues.reverse()
                
                colors_list = ['#4FD1C5', '#319795', '#3182CE', '#2B6CB0', '#1A365D'][-len(names):]
                plt.barh(names, revenues, color=colors_list)
                plt.title("熱銷商品銷售金額排行 (Top 5)", fontsize=12, color='#1A365D', weight='bold')
                plt.xlabel("銷售總額 (元)", fontsize=9, color='#4A5568')
                plt.yticks(fontsize=8)
                plt.xticks(fontsize=8)
                plt.grid(True, axis='x', linestyle='--', alpha=0.5)
                plt.tight_layout()
                
                buf2 = io.BytesIO()
                plt.savefig(buf2, format='png', dpi=200)
                buf2.seek(0)
                chart_bar_img = buf2
                plt.close()
        except Exception as e:
            logger.exception(f"Matplotlib 圖表繪製失敗: {str(e)}")
            plt.close()

        # D. 使用 ReportLab 生成 PDF
        pdf_buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            pdf_buffer,
            pagesize=A4,
            leftMargin=36,
            rightMargin=36,
            topMargin=36,
            bottomMargin=36
        )
        
        # 建立風格樣式
        styles = getSampleStyleSheet()
        
        title_style = ParagraphStyle(
            'ReportTitle',
            parent=styles['Normal'],
            fontName=FONT_NAME,
            fontSize=20,
            leading=24,
            textColor=colors.HexColor("#1A365D"),
            alignment=1, # 居中
            spaceAfter=5
        )
        
        meta_style = ParagraphStyle(
            'ReportMeta',
            parent=styles['Normal'],
            fontName=FONT_NAME,
            fontSize=9,
            leading=13,
            textColor=colors.HexColor("#718096"),
            alignment=1, # 居中
            spaceAfter=15
        )
        
        heading_style = ParagraphStyle(
            'SectionHeading',
            parent=styles['Heading2'],
            fontName=FONT_BOLD_NAME,
            fontSize=13,
            leading=17,
            textColor=colors.HexColor("#2B6CB0"),
            spaceBefore=12,
            spaceAfter=8,
            keepWithNext=True
        )
        
        body_style = ParagraphStyle(
            'BodyTextCustom',
            parent=styles['Normal'],
            fontName=FONT_NAME,
            fontSize=9.5,
            leading=13.5,
            textColor=colors.HexColor("#2D3748")
        )

        table_header_style = ParagraphStyle(
            'TableHeader',
            parent=styles['Normal'],
            fontName=FONT_BOLD_NAME,
            fontSize=9.5,
            textColor=colors.white,
            alignment=1
        )
        
        table_cell_style = ParagraphStyle(
            'TableCell',
            parent=styles['Normal'],
            fontName=FONT_NAME,
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#2D3748"),
            alignment=1
        )

        ai_box_style = ParagraphStyle(
            'AIBoxText',
            parent=styles['Normal'],
            fontName=FONT_NAME,
            fontSize=9,
            leading=13.5,
            textColor=colors.HexColor("#2C5282")
        )

        story = []
        
        # 1. 報告標題與元數據
        story.append(Paragraph("銷售數據分析與商業智慧報告", title_style))
        date_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        filters_desc = []
        if filters.get("date_from"):
            filters_desc.append(f"起: {filters.get('date_from')}")
        if filters.get("date_to"):
            filters_desc.append(f"迄: {filters.get('date_to')}")
        filters_str = " | ".join(filters_desc) if filters_desc else "全部時間"
        story.append(Paragraph(f"生成時間: {date_str}  |  篩選範圍: {filters_str}  |  操作人: {username} ({role.upper()})", meta_style))
        
        # 分隔線
        divider = Table([[""]], colWidths=[520], rowHeights=[1])
        divider.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#CBD5E0")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0),
        ]))
        story.append(divider)
        story.append(Spacer(1, 10))
        
        # 2. 關鍵營運指標 KPI 表格
        story.append(Paragraph("一、 關鍵營運指標 (KPI)", heading_style))
        kpi_data = [
            [
                Paragraph("<b>指標項目</b>", table_header_style),
                Paragraph("<b>數值描述</b>", table_header_style),
                Paragraph("<b>指標項目</b>", table_header_style),
                Paragraph("<b>數值描述</b>", table_header_style)
            ],
            [
                Paragraph("總訂單數", table_cell_style),
                Paragraph(f"{aggregated_data.get('total_orders')} 筆", table_cell_style),
                Paragraph("已完成銷售金額", table_cell_style),
                Paragraph(f"${aggregated_data.get('total_amount'):,.2f} 元", table_cell_style)
            ],
            [
                Paragraph("平均單筆金額", table_cell_style),
                Paragraph(f"${aggregated_data.get('average_amount'):,.2f} 元", table_cell_style),
                Paragraph("負責角色權限範圍", table_cell_style),
                Paragraph("個人隔離數據" if role == "sales" else "全局完整數據", table_cell_style)
            ]
        ]
        kpi_table = Table(kpi_data, colWidths=[130, 130, 130, 130])
        kpi_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#2B6CB0")),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
            ('BACKGROUND', (0,1), (-1,1), colors.HexColor("#F7FAFC")),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F7FAFC")]),
            ('TOPPADDING', (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ]))
        story.append(kpi_table)
        story.append(Spacer(1, 12))
        
        # 3. 銷售走勢與熱銷商品圖表
        story.append(Paragraph("二、 圖表趨勢分析", heading_style))
        charts_data = []
        if chart_line_img:
            charts_data.append(Image(chart_line_img, width=250, height=105))
        else:
            charts_data.append(Paragraph("無走勢數據", body_style))
            
        if chart_bar_img:
            charts_data.append(Image(chart_bar_img, width=250, height=105))
        else:
            charts_data.append(Paragraph("無商品排行數據", body_style))
            
        # 將兩個圖表水平排列
        charts_table = Table([charts_data], colWidths=[260, 260])
        charts_table.setStyle(TableStyle([
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ]))
        story.append(charts_table)
        story.append(Spacer(1, 12))
        
        # 4. 商品銷售排行明細表格
        story.append(Paragraph("三、 熱銷商品排行明細", heading_style))
        product_rows = [
            [
                Paragraph("<b>名次</b>", table_header_style),
                Paragraph("<b>商品名稱</b>", table_header_style),
                Paragraph("<b>銷售數量</b>", table_header_style),
                Paragraph("<b>銷售總額</b>", table_header_style)
            ]
        ]
        
        p_stats_list = aggregated_data.get("product_stats", [])
        if p_stats_list:
            for idx, p in enumerate(p_stats_list[:10]):  # 最多顯示前 10 個
                product_rows.append([
                    Paragraph(str(idx + 1), table_cell_style),
                    Paragraph(p["name"], table_cell_style),
                    Paragraph(f"{p['quantity']} 件", table_cell_style),
                    Paragraph(f"${p['total_amount']:,.2f} 元", table_cell_style)
                ])
        else:
            product_rows.append([Paragraph("無商品銷售數據", table_cell_style), "", "", ""])
            
        product_table = Table(product_rows, colWidths=[60, 220, 110, 130])
        product_table_style = [
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#4A5568")),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor("#E2E8F0")),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F7FAFC")]),
            ('TOPPADDING', (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ]
        if not p_stats_list:
            product_table_style.append(('SPAN', (0,1), (3,1)))
        product_table.setStyle(TableStyle(product_table_style))
        story.append(product_table)
        story.append(Spacer(1, 12))
        
        # 5. AI 商業智慧洞察 (Wowing 亮點區塊)
        # 防禦性檢查：排除正在背景處理中(processing)或失敗(failed)的 placeholder 快取紀錄，且必須有實際的 summary
        if ai_report and isinstance(ai_report, dict) and ai_report.get("status") not in ["processing", "failed"] and ai_report.get("summary"):
            story.append(Paragraph("四、 Gemini AI 商業智慧洞察與策略建議", heading_style))
            
            ai_content = []
            # A. 摘要
            ai_content.append(Paragraph(f"<b>📊 AI 核心摘要</b>：{ai_report.get('summary')}", ai_box_style))
            ai_content.append(Spacer(1, 4))
            
            # B. 趨勢洞察
            trends = ai_report.get("trends", {})
            insights = trends.get("insights", "未提供趨勢洞察。")
            direction = trends.get("trend_direction", "平穩")
            ai_content.append(Paragraph(f"<b>📈 趨勢走向 ({direction})</b>：{insights}", ai_box_style))
            ai_content.append(Spacer(1, 4))
            
            # C. 營收預測與操作建議
            forecast = ai_report.get("forecast", {})
            fc_rev = forecast.get("next_30_days_revenue", 0.0)
            fc_conf = forecast.get("confidence", 0.0)
            fc_rec = forecast.get("recommendation", "無具體預測建議。")
            ai_content.append(Paragraph(f"<b>🔮 30天營收預測</b>：預計銷售額 <b>${fc_rev:,.2f} 元</b> (置信度: {fc_conf * 100:.1f}%)", ai_box_style))
            ai_content.append(Paragraph(f"<b>💡 預防性/擴張性運營策略</b>：{fc_rec}", ai_box_style))
            ai_content.append(Spacer(1, 4))
            
            # D. 具體行動建議
            recs = ai_report.get("recommendations", [])
            if recs:
                rec_str = "<br/>".join([f"{i+1}. {r}" for i, r in enumerate(recs)])
                ai_content.append(Paragraph(f"<b>🎯 具體執行行動指南</b>：<br/>{rec_str}", ai_box_style))
            
            # 使用 ReportLab 的單元格包裝，加上帶底色的框線與內邊距，創造精緻奢華的 UI 體驗
            ai_table = Table([[ai_content]], colWidths=[520])
            ai_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#EBF8FF")),  # 淡藍底色
                ('BOX', (0,0), (-1,-1), 1.5, colors.HexColor("#3182CE")),     # 藍色邊框
                ('TOPPADDING', (0,0), (-1,-1), 10),
                ('BOTTOMPADDING', (0,0), (-1,-1), 10),
                ('LEFTPADDING', (0,0), (-1,-1), 12),
                ('RIGHTPADDING', (0,0), (-1,-1), 12),
            ]))
            story.append(ai_table)
        else:
            story.append(Paragraph("四、 商業智慧洞察", heading_style))
            fallback_box = Table([[Paragraph("<i>⚠️ AI 智慧報告引擎暫時無法連線。以上報告為自動生成的結構化統計明細，請參閱上方 KPI 指標與商品明細。</i>", ai_box_style)]], colWidths=[520])
            fallback_box.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#FFF5F5")),  # 淡紅底色
                ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#FEB2B2")),       # 淡紅邊框
                ('TOPPADDING', (0,0), (-1,-1), 8),
                ('BOTTOMPADDING', (0,0), (-1,-1), 8),
                ('LEFTPADDING', (0,0), (-1,-1), 10),
                ('RIGHTPADDING', (0,0), (-1,-1), 10),
            ]))
            story.append(fallback_box)
            
        doc.build(story)
        pdf_buffer.seek(0)
        return pdf_buffer.getvalue()

    @staticmethod
    async def generate_excel(filters: dict, user: dict) -> bytes:
        filters = filters or {}
        """
        生成包含多工作表的 Excel 銷售報告。
        - 嚴格安全防禦：若 user.role 為 viewer，直接拋出 403 Forbidden。
        - Sales 僅能下載自身負責訂單的數據。
        - Admin 可以下載全局數據。
        """
        # 1. 嚴格安全防禦攔截 (RBAC 核心)
        profile = user.get("profile", user)
        role = profile.get("role", "viewer")
        employee_id = profile.get("employee_id")
        
        # 堅不可摧的姓名獲取機制 (多級安全 fallback)
        display_name = profile.get("name") or profile.get("username")
        if not display_name:
            try:
                user_id = user.get("id")
                if user_id:
                    supabase_cli = get_supabase_admin()
                    res = supabase_cli.table("profiles").select("name").eq("id", user_id).maybe_single().execute()
                    if res and res.data:
                        display_name = res.data.get("name")
            except Exception as e:
                logger.warning(f"即時查詢使用者姓名失敗: {str(e)}")
                
        if not display_name:
            display_name = user.get("email") or "未知使用者"
        
        # 組合顯示名稱（姓名 + 員工代號）以提高辨識度
        username = f"{display_name} ({employee_id})" if employee_id else display_name


        if role == "viewer":
            logger.warning(f"安全警報: 檢視者 {username} 嘗試非法下載 Excel 銷售報告，後端攔截。")
            raise HTTPException(
                status_code=403, 
                detail="您的角色權限 (檢視者/Viewer) 僅能線上預覽及下載 PDF 報告，禁止匯出與下載包含原始明細的 Excel 檔案！"
            )
        
        if role == "sales":
            owner_id = employee_id
            data_scope = "個人負責數據"
        elif role == "admin":
            owner_id = None
            data_scope = "全局完整數據"
        else:
            raise HTTPException(status_code=403, detail="未知的角色權限，禁止匯出資料")

        # 2. 獲取過濾後的原始訂單與商品、客戶對應關係
        order_repo = ExportService._get_order_repo()
        product_repo = ExportService._get_product_repo()

        date_from = filters.get("date_from")
        date_to = filters.get("date_to")
        customer_id = filters.get("customer_id")
        product_id = filters.get("product_id")

        orders = order_repo.get_orders_for_analytics(
            owner_id=owner_id,
            date_from=date_from,
            date_to=date_to,
            customer_id=customer_id,
            product_id=product_id
        )

        all_products = product_repo.get_all_products()
        product_map = {p["product_id"]: p.get("name", "未知商品") for p in all_products}

        # 獲取統計聚合數據 (共用邏輯)
        aggregated_data = await AnalyticsService.aggregate_orders(filters, user)

        # 3. 準備 Excel 的 Sheets
        excel_buffer = io.BytesIO()

        with pd.ExcelWriter(excel_buffer, engine='openpyxl') as writer:
            # Sheet 1: 統計摘要 (KPI Summary)
            summary_data = {
                "指標項目": [
                    "報告名稱", 
                    "生成時間", 
                    "篩選起日", 
                    "篩選迄日", 
                    "下載人員", 
                    "人員角色", 
                    "資料權限範圍",
                    "總訂單數", 
                    "已完成銷售總額", 
                    "已完成平均單筆金額"
                ],
                "數值描述": [
                    "銷售數據分析報告 (Excel)",
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    date_from or "無限制",
                    date_to or "無限制",
                    username,
                    role.upper(),
                    data_scope,
                    f"{aggregated_data.get('total_orders')} 筆",
                    f"${aggregated_data.get('total_amount'):,.2f} 元",
                    f"${aggregated_data.get('average_amount'):,.2f} 元"
                ]
            }
            df_summary = pd.DataFrame(summary_data)
            df_summary.to_excel(writer, sheet_name="統計摘要", index=False)

            # Sheet 2: 商品排行 (Product Ranking)
            product_stats = aggregated_data.get("product_stats", [])
            df_products = pd.DataFrame(product_stats)
            if df_products.empty:
                df_products = pd.DataFrame(columns=["商品ID", "商品名稱", "銷售數量", "銷售總額 (元)"])
            else:
                df_products.columns = ["商品ID", "商品名稱", "銷售數量", "銷售總額 (元)"]
            df_products.to_excel(writer, sheet_name="商品排行", index=False)

            # Sheet 3: 原始訂單明細 (Order Details)
            orders_rows = []
            for o in orders:
                orders_rows.append({
                    "訂單ID": o.get("id"),
                    "金額 (元)": float(o.get("amount") or 0.0),
                    "訂單狀態": o.get("status"),
                    "商品ID": o.get("product_id"),
                    "商品名稱": product_map.get(o.get("product_id"), "未知商品"),
                    "客戶": o.get("customer", "未知客戶"),
                    "負責人ID": o.get("owner_id"),
                    "建立時間": o.get("created_at")
                })
            df_orders = pd.DataFrame(orders_rows)
            if df_orders.empty:
                df_orders = pd.DataFrame(columns=["訂單ID", "金額 (元)", "訂單狀態", "商品ID", "商品名稱", "客戶", "負責人ID", "建立時間"])
            df_orders.to_excel(writer, sheet_name="原始訂單明細", index=False)

        excel_buffer.seek(0)
        return excel_buffer.getvalue()
