// ai-widget.js — AI 銷售速報 Widget

import { f, escapeHtml, apiRequest } from '../utils.js?v=1.0.1';

/**
 * 載入並渲染儀表板的 AI 銷售速報 Widget
 */
export async function loadDashboardAiWidget() {
  const widget = f('dashboardAiWidget');
  const title = f('dashboardAiWidgetTitle');
  const content = f('dashboardAiWidgetContent');
  const refreshBtn = f('refreshAiWidgetBtn');
  
  if (!widget || !title || !content) return;
  
  widget.style.display = 'block';
  
  // 顯示骨架屏
  content.innerHTML = `
    <div class="widget-skeleton">
      <div class="skeleton-line" style="height: 14px; background: rgba(124, 58, 237, 0.08); margin-bottom: 8px; border-radius: 4px; width: 100%;"></div>
      <div class="skeleton-line" style="height: 14px; background: rgba(124, 58, 237, 0.08); margin-bottom: 8px; border-radius: 4px; width: 90%;"></div>
      <div class="skeleton-line" style="height: 14px; background: rgba(124, 58, 237, 0.08); border-radius: 4px; width: 75%;"></div>
    </div>
  `;
  title.textContent = '📊 過去 7 日銷售速報 (AI 正在運算中...)';
  
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.style.cursor = 'not-allowed';
    refreshBtn.style.transform = 'rotate(360deg)';
  }
  
  try {
    const data = await apiRequest('/analytics/realtime-insights');
    const dateFromFormatted = data.date_from.replace(/-/g, '/');
    const dateToFormatted = data.date_to.replace(/-/g, '/');
    title.textContent = `📊 AI 銷售速報 (${dateFromFormatted} ～ ${dateToFormatted})`;
    content.innerHTML = `<p class="widget-insight-text">${escapeHtml(data.insights)}</p>`;
  } catch (e) {
    console.error('loadDashboardAiWidget error:', e);
    title.textContent = '📊 AI 銷售速報';
    content.innerHTML = `<p class="widget-insight-text" style="color: #ef4444; font-weight: 600;">AI 思考太用力了，請稍後再試。</p>`;
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.style.cursor = 'pointer';
      refreshBtn.style.transform = 'rotate(0deg)';
    }
  }
}
