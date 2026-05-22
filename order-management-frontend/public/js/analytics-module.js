// analytics-module.js - 獨立模組避免 dashboard.js 過大
import { apiRequest, escapeHtml } from './utils.js';
import { getCurrentUser } from './auth.js';

let isEventsBound = false;

export function getDate30DaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

export function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

export async function renderAnalyticsSection(filters = {}) {
  // 綁定事件監聽器 (僅在首次載入時綁定)
  bindAnalyticsEvents();
  
  // 預設 30 天
  const dateFrom = filters.dateFrom || getDate30DaysAgo();
  const dateTo = filters.dateTo || getTodayDate();
  const customerId = filters.customerId || null;
  const productId = filters.productId || null;
  
  // 填入日期選擇器
  const dateFromInput = document.getElementById('analyticsDateFrom');
  const dateToInput = document.getElementById('analyticsDateTo');
  
  if (dateFromInput) dateFromInput.value = dateFrom;
  if (dateToInput) dateToInput.value = dateTo;

  // 將篩選的客戶與商品 ID 保存到容器的 dataset，供手動點擊「生成報告」時使用
  const container = document.getElementById('analyticsReport');
  if (container) {
    container.dataset.customerId = customerId || '';
    container.dataset.productId = productId || '';
  }
  
  // 自動生成報告（入口 A 或 B 都適用）
  await generateReport(dateFrom, dateTo, customerId, productId);
}

async function generateReport(dateFrom, dateTo, customerId = null, productId = null) {
  const loading = document.getElementById('analyticsLoading');
  const container = document.getElementById('analyticsReport');
  
  if (loading) loading.style.display = 'block';
  if (container) {
    if (container._reactRoot) {
      try {
        container._reactRoot.unmount();
      } catch (e) {
        console.error("Error unmounting React root:", e);
      }
      delete container._reactRoot;
    }
    container.innerHTML = '';
  }
  
  try {
    const report = await apiRequest(
      '/analytics/generate-report',
      {
        method: 'POST',
        body: JSON.stringify({
          date_from: dateFrom,
          date_to: dateTo,
          customer_id: customerId || null,
          product_id: productId || null
        })
      }
    );
    
    if (container) {
      const currentUser = getCurrentUser();
      const userRole = currentUser?.role || 'viewer';

      // 檢查瀏覽器端 React, ReactDOM 與 JSX 元件是否皆已載入完畢
      if (window.React && window.ReactDOM && window.AISalesReport) {
        // 使用 DOM 節點內部屬性緩存 React 根實例，避免 SPA 頁面切換後舊根實例失效的問題
        if (!container._reactRoot) {
          container._reactRoot = ReactDOM.createRoot(container);
        }
        container._reactRoot.render(
          React.createElement(window.AISalesReport, {
            reportData: report,
            userRole: userRole
          })
        );
      } else {
        // 備援方案：若 CDN 或轉譯有延遲，使用純 HTML 備援渲染
        renderBackupHtml(container, report);
      }
    }
  } catch (error) {
    if (container) {
      let friendlyMessage = "AI 分析服務目前忙碌中，請稍後再試。";
      const errMsg = error.message ? String(error.message) : "";
      
      // 識別明確的權限錯誤，其餘網路或底層 API 錯誤一律進行安全遮蔽
      if (errMsg.includes("權限不足") || errMsg.includes("Forbidden") || errMsg.includes("403")) {
        friendlyMessage = "權限不足，無法生成 AI 分析報告。";
      }
      
      container.innerHTML = `<div class="error" style="margin-top: 12px;">❌ 載入失敗: ${escapeHtml(friendlyMessage)}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

/**
 * 備援 HTML 渲染函數：用於 React 未能及時加載時之備份展示
 */
function renderBackupHtml(container, report) {
  const topProductsHtml = (report.top_products || []).map(p => `
    <li style="margin-bottom: 12px; list-style-type: none; border-left: 3px solid #7c3aed; padding-left: 12px;">
      <strong style="color: #1e293b;">${escapeHtml(p.name)}</strong> 
      <span style="font-size: 13px; color: #64748b;">(數量: ${p.quantity}, 銷售額: $${p.revenue.toLocaleString()})</span><br>
      <span style="font-size: 13px; color: #475569; display: block; margin-top: 4px;">💡 洞察: ${escapeHtml(p.insights)}</span>
    </li>
  `).join('');

  const recsHtml = (report.recommendations || []).map(r => `
    <li style="margin-bottom: 8px; padding-left: 18px; position: relative;">
      <span style="position: absolute; left: 0; color: #7c3aed;">🎯</span> ${escapeHtml(r)}
    </li>
  `).join('');

  container.innerHTML = `
    <div class="report-summary" style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
      <h3>📈 報告摘要</h3>
      <p style="font-size: 16px; font-weight: 700; color: #7c3aed; margin-bottom: 10px; background: #f5f3ff; display: inline-block; padding: 4px 12px; border-radius: 6px;">🧠 ${escapeHtml(report.summary || '無摘要')}</p>
      <p style="color: #475569; line-height: 1.7; font-size: 14px;">${escapeHtml(report.trends?.insights || '無趨勢洞察')}</p>
    </div>
    
    <div class="report-trends" style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
      <h3>🔥 熱銷商品分析</h3>
      <div style="margin-top: 12px;">
        ${topProductsHtml || '<p style="color: #94a3b8;">無商品分析數據</p>'}
      </div>
    </div>

    <div class="report-trends" style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
      <h3>🔮 未來 30 天營收預測</h3>
      <p style="margin-bottom: 8px; font-size: 14px; color: #334155;">
        預期銷售額: <strong style="color: #059669; font-size: 18px; font-weight: 800;">$${(report.forecast?.next_30_days_revenue || 0).toLocaleString()}</strong> 
        <span style="font-size: 12px; color: #64748b; margin-left: 8px;">(信心指數: ${((report.forecast?.confidence || 0) * 100).toFixed(0)}%)</span>
      </p>
      <p style="font-size: 13px; color: #475569; background: #ecfdf5; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #10b981;">
        💡 建議: ${escapeHtml(report.forecast?.recommendation || '無建議')}
      </p>
    </div>

    <div class="report-trends">
      <h3>🚀 具體行動建議</h3>
      <ul style="list-style: none; padding-left: 0; color: #475569; font-size: 14px; line-height: 1.6; margin-top: 12px;">
        ${recsHtml || '<li>無具體行動建議</li>'}
      </ul>
    </div>
  `;
}

function bindAnalyticsEvents() {
  if (isEventsBound) return;
  
  // 返回訂單管理按鈕
  document.getElementById('backToOrdersBtn')?.addEventListener('click', () => {
    if (window.navigateTo) {
      window.navigateTo('orders');
    }
  });
  
  // 生成報告按鈕
  document.getElementById('generateReportBtn')?.addEventListener('click', async () => {
    const dateFrom = document.getElementById('analyticsDateFrom').value;
    const dateTo = document.getElementById('analyticsDateTo').value;
    if (!dateFrom || !dateTo) {
      alert('請選擇日期範圍');
      return;
    }
    const container = document.getElementById('analyticsReport');
    const customerId = container?.dataset.customerId || null;
    const productId = container?.dataset.productId || null;
    await generateReport(dateFrom, dateTo, customerId || null, productId || null);
  });
  
  isEventsBound = true;
}

// 掛載至全域，方便 dynamic import 載入後，隨處皆可透過 window 呼叫
window.renderAnalyticsSection = renderAnalyticsSection;
window.getDate30DaysAgo = getDate30DaysAgo;
window.getTodayDate = getTodayDate;
