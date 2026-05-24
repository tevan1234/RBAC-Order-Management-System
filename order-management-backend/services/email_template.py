from typing import Dict, Any

def render_analytics_report_email(
    report_summary: str,
    report_content: Dict[str, Any],
    filters: Dict[str, Any],
    role: str
) -> str:
    """
    動態生成具備科技質感 (Slate 深藍灰 + 科技藍) 的 AI 銷售報告 HTML 郵件。
    - 附件導覽區：頂端最顯眼處以 dashed 框呈現，動態說明夾帶 PDF 狀態，並依據角色權限安全隔離說明 Excel 是否夾帶。
    - 銷售走勢標籤：配合 trend_direction 的狀態，呈現不同的 Badge 色彩。
    - 信心度進度條：動態以 inline width 的 DIV 呈現進度。
    """
    # A. 解析篩選條件字串
    date_from = filters.get("date_from") or "無限制"
    date_to = filters.get("date_to") or "無限制"
    filters_desc = f"起日: {date_from} | 迄日: {date_to}"
    if filters.get("customer_id"):
        filters_desc += f" | 客戶: {filters.get('customer_id')}"
    if filters.get("product_id"):
        filters_desc += f" | 商品: {filters.get('product_id')}"

    # B. 解析報告欄位
    summary = report_summary or report_content.get("summary") or "銷售分析簡短速報"
    trends = report_content.get("trends") or {}
    insights = trends.get("insights") or "無趨勢分析內容"
    trend_dir = trends.get("trend_direction") or "平穩震盪"

    # 決定走勢標籤 (Badge) 配色
    badge_bg = "#475569" # 灰色預設
    badge_text = "#ffffff"
    if "上升" in trend_dir or "成長" in trend_dir:
        badge_bg = "#065f46" # 綠色
        badge_text = "#34d399"
    elif "下滑" in trend_dir or "下降" in trend_dir or "衰退" in trend_dir:
        badge_bg = "#7f1d1d" # 紅色
        badge_text = "#f87171"

    # C. 熱銷商品
    products = report_content.get("top_products") or []
    products_html = ""
    for idx, p in enumerate(products[:3]):  # 最多顯示前 3 熱銷
        p_name = p.get("name", "未知商品")
        p_qty = p.get("quantity", 0)
        p_rev = p.get("revenue", 0.0)
        p_ins = p.get("insights", "")
        products_html += f"""
        <div style="background-color: #0f172a; padding: 15px; border-radius: 6px; border: 1px solid #334155; margin-bottom: 12px;">
            <div style="font-weight: bold; color: #3b82f6; font-size: 15px; margin-bottom: 5px;">
                #{idx + 1} {p_name}
            </div>
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">
                銷量: <strong style="color: #f8fafc;">{p_qty} 件</strong> | 
                總額: <strong style="color: #10b981;">${p_rev:,.2f} 元</strong>
            </div>
            <div style="font-size: 13px; color: #cbd5e1; line-height: 1.4; border-top: 1px dashed #334155; padding-top: 6px;">
                {p_ins}
            </div>
        </div>
        """
    if not products_html:
        products_html = "<p style='color: #94a3b8; font-style: italic; font-size: 13px;'>暫無商品排名數據</p>"

    # D. 未來預測
    forecast = report_content.get("forecast") or {}
    fc_rev = forecast.get("next_30_days_revenue") or 0.0
    fc_conf = forecast.get("confidence") or 0.0
    fc_rec = forecast.get("recommendation") or "暫無策略建議。"
    conf_percentage = int(fc_conf * 100)

    # E. 行動建議
    recs = report_content.get("recommendations") or []
    recs_html = ""
    for r in recs:
        recs_html += f"""
        <li style="margin-bottom: 10px; font-size: 13.5px; line-height: 1.5;">
            <span style="color: #3b82f6; font-weight: bold; margin-right: 5px;">✦</span> {r}
        </li>
        """
    if not recs_html:
        recs_html = "<li style='color: #94a3b8;'>暫無行動建議</li>"

    # F. 隨信附件導覽區實作 (RBAC 亮點)
    excel_status_html = ""
    if role == "viewer":
        excel_status_html = """
        <div style="display: table-cell; vertical-align: middle; width: 50%; padding: 10px; border-left: 1px dashed #334155;">
            <div style="font-weight: bold; color: #f87171; font-size: 13px; margin-bottom: 3px;">
                📄 Excel 原始明細
            </div>
            <div style="font-size: 11px; color: #f87171; line-height: 1.3;">
                ⚠️ 基於安全性原則，系統自動防禦並忽略檢視者 (Viewer) 附件，以防止原始明細外流。
            </div>
        </div>
        """
    else:
        excel_status_html = """
        <div style="display: table-cell; vertical-align: middle; width: 50%; padding: 10px; border-left: 1px dashed #334155;">
            <div style="font-weight: bold; color: #10b981; font-size: 13px; margin-bottom: 3px;">
                📊 Excel 原始明細
            </div>
            <div style="font-size: 11px; color: #34d399; line-height: 1.3;">
                ✅ 隨信夾帶 <br>包含原始訂單及商品排名分析明細 (已成功附加)。
            </div>
        </div>
        """

    # G. 拼裝完整的 HTML
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>AI 銷售分析報告</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); border: 1px solid #334155; margin-top: 30px; margin-bottom: 30px;">
        
        <!-- HEADER 漸層板塊 -->
        <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 30px; text-align: center; border-bottom: 2px solid #2563eb;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #93c5fd; margin-bottom: 5px; font-weight: bold;">
                Artificial Intelligence Sales Analytics
            </div>
            <h1 style="font-size: 24px; font-weight: bold; margin: 0; color: #ffffff; letter-spacing: 0.5px;">
                AI 銷售分析與商業智慧報告
            </h1>
        </div>

        <!-- 隨信附件導覽區 (Attachment Zone) -->
        <div style="margin: 20px; padding: 15px; border: 2px dashed #475569; border-radius: 8px; background-color: #0f172a; display: table; width: calc(100% - 40px); box-sizing: border-box;">
            <div style="display: table-row;">
                
                <!-- PDF 狀態 -->
                <div style="display: table-cell; vertical-align: middle; width: 50%; padding: 10px;">
                    <div style="font-weight: bold; color: #3b82f6; font-size: 13px; margin-bottom: 3px;">
                        📕 PDF 智慧報告
                    </div>
                    <div style="font-size: 11px; color: #93c5fd; line-height: 1.3;">
                        ✅ 隨信夾帶 <br>包含視覺化趨勢圖表與高階策略分析建議 (已成功附加)。
                    </div>
                </div>

                <!-- Excel 狀態 (RBAC) -->
                {excel_status_html}

            </div>
        </div>

        <!-- 主要內容區 -->
        <div style="padding: 20px; padding-top: 0;">
            
            <!-- 報告元數據與摘要 -->
            <div style="background-color: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 20px;">
                <div style="font-size: 12px; color: #64748b; margin-bottom: 5px;">
                    篩選範圍: <strong style="color: #94a3b8;">{filters_desc}</strong>
                </div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 12px;">
                    使用者角色權限: <strong style="color: #94a3b8;">{role.upper()} ({'隔離數據' if role == 'sales' else '全局數據'})</strong>
                </div>
                <div style="font-size: 15px; font-weight: bold; color: #f8fafc; line-height: 1.4; border-left: 3px solid #3b82f6; padding-left: 10px;">
                    🎯 AI 報告摘要: {summary}
                </div>
            </div>

            <!-- 趨勢與走勢分析 -->
            <div style="margin-bottom: 25px;">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <h2 style="font-size: 16px; font-weight: bold; color: #3b82f6; margin: 0; margin-right: 10px; display: inline-block;">
                        一、 銷售走勢與 AI 洞察
                    </h2>
                    <span style="background-color: {badge_bg}; color: {badge_text}; font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: bold; display: inline-block; vertical-align: middle;">
                        {trend_dir}
                    </span>
                </div>
                <div style="font-size: 13.5px; color: #cbd5e1; line-height: 1.6; background-color: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155;">
                    {insights}
                </div>
            </div>

            <!-- 熱銷商品排行 -->
            <div style="margin-bottom: 25px;">
                <h2 style="font-size: 16px; font-weight: bold; color: #3b82f6; margin: 0; margin-bottom: 12px;">
                    二、 熱銷商品排行與深度洞察
                </h2>
                {products_html}
            </div>

            <!-- 30天銷售預測 -->
            <div style="margin-bottom: 25px; background-color: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid #334155;">
                <h2 style="font-size: 16px; font-weight: bold; color: #3b82f6; margin: 0; margin-bottom: 15px;">
                    三、 未來 30 天銷售預測
                </h2>
                <div style="display: table; width: 100%; margin-bottom: 15px;">
                    <div style="display: table-row;">
                        <div style="display: table-cell; width: 50%; padding-right: 10px;">
                            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 3px;">預期營收</div>
                            <div style="font-size: 18px; font-weight: bold; color: #10b981;">
                                ${fc_rev:,.2f} 元
                            </div>
                        </div>
                        <div style="display: table-cell; width: 50%; border-left: 1px solid #334155; padding-left: 15px;">
                            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 3px;">
                                AI 信心指數 ({conf_percentage}%)
                            </div>
                            <div style="width: 100%; height: 6px; background-color: #334155; border-radius: 3px; overflow: hidden; margin-top: 5px;">
                                <div style="width: {conf_percentage}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #10b981); border-radius: 3px;"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="font-size: 13px; color: #cbd5e1; line-height: 1.5; border-top: 1px dashed #334155; padding-top: 10px; font-style: italic;">
                    <strong>運營操作建議:</strong> {fc_rec}
                </div>
            </div>

            <!-- 行動建議 -->
            <div style="margin-bottom: 10px;">
                <h2 style="font-size: 16px; font-weight: bold; color: #3b82f6; margin: 0; margin-bottom: 12px;">
                    四、 具體執行行動指南
                </h2>
                <ul style="margin: 0; padding-left: 10px; list-style-type: none; color: #cbd5e1;">
                    {recs_html}
                </ul>
            </div>

        </div>

        <!-- FOOTER -->
        <div style="background-color: #0f172a; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #334155;">
            <p style="margin: 0 0 5px 0;">此郵件為系統自動發送之 AI 銷售商業智慧週報/手動請求信件。</p>
            <p style="margin: 0;">&copy; 2026 RBAC Order Management System. All rights reserved.</p>
        </div>

    </div>
</body>
</html>
"""
    return html
