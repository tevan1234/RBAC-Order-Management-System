// analytics-module.js - 獨立模組避免 dashboard.js 過大
import { apiRequest, escapeHtml, showNotification, API_BASE } from './utils.js?v=1.0.1';
import { getCurrentUser, getToken } from './auth.js';

let isEventsBound = false;

/**
 * 取得「昨天」的日期（分析結束日）
 * 例如今天 5/2 → 回傳 5/1
 */
export function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * 取得「昨天往前 30 天」的日期（分析起始日）
 * 例如昨天 5/1 → 回傳 4/1
 */
export function getDateStartOfRange() {
  const d = new Date();
  d.setDate(d.getDate() - 31); // 昨天 -30 天 = 今天 -31 天
  return d.toISOString().split('T')[0];
}

// 向後相容別名（保留舊函式名稱，避免其他可能的引用失效）
export const getDate30DaysAgo = getDateStartOfRange;
export const getTodayDate = getYesterdayDate;

export async function renderAnalyticsSection(filters = {}) {
  // 綁定事件監聽器 (僅在首次載入時綁定)
  bindAnalyticsEvents();
  
  // 角色防禦：若是檢視者 (Viewer)，隱藏 Excel 下載按鈕
  const currentUser = getCurrentUser();
  const userRole = currentUser?.role || 'viewer';
  const downloadExcelBtn = document.getElementById('downloadExcelBtn');
  if (downloadExcelBtn) {
    if (userRole === 'viewer') {
      downloadExcelBtn.style.display = 'none';
    } else {
      downloadExcelBtn.style.display = 'inline-block';
    }
  }
  
  // 預設為「昨天 ~ 31 天前」（即完整的前一個月），避免今天資料不完整影響分析
  const dateFrom = filters.dateFrom || getDateStartOfRange();
  const dateTo = filters.dateTo || getYesterdayDate();
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
  window.isAnalyticsLoading = true;
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
    container.innerHTML = `
      <div class="analytics-processing-loading" style="text-align: center; padding: 40px 20px; color: #7c3aed;">
        <div class="widget-skeleton" style="margin-bottom: 20px;">
          <div class="skeleton-line" style="height: 14px; background: rgba(124, 58, 237, 0.08); margin-bottom: 8px; border-radius: 4px; width: 100%;"></div>
          <div class="skeleton-line" style="height: 14px; background: rgba(124, 58, 237, 0.08); margin-bottom: 8px; border-radius: 4px; width: 90%;"></div>
          <div class="skeleton-line" style="height: 14px; background: rgba(124, 58, 237, 0.08); border-radius: 4px; width: 75%;"></div>
        </div>
        <p style="font-weight: 600; font-size: 15px; margin: 0; animation: skeletonPulse 1.5s infinite ease-in-out;">🤖 AI 正在深入分析您的銷售數據並撰寫報告，請稍候...</p>
      </div>
    `;
  }
  
  try {
    // 1. 發送非同步任務請求
    const taskInit = await apiRequest(
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
    
    let reportResult = null;
    
    if (taskInit.status === 'success') {
      // ⚡ 快取命中：直接採用既有分析報告結果進行渲染，無需任何輪詢等待與 Skeleton skeleton 動畫！
      reportResult = taskInit;
    } else {
      const taskId = taskInit.task_id;
      if (!taskId) {
        throw new Error('未取得任務 ID');
      }
      
      // 2. 輪詢機制 (每 3 秒檢查一次)
      let attempts = 0;
      const maxAttempts = 40; // 最多輪詢 2 分鐘 (40 * 3 秒)
      
      while (window.isAnalyticsLoading && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        attempts++;
        
        // 若在等待期間使用者切換了頁面，則中斷
        if (!window.isAnalyticsLoading) {
          break;
        }
        
        const taskStatus = await apiRequest(`/analytics/task-status/${taskId}`);
        
        if (taskStatus.status === 'success') {
          reportResult = taskStatus;
          break;
        } else if (taskStatus.status === 'failed') {
          throw new Error('AI 思考太用力了，請稍後再試。');
        }
        
        // 更新 loading 文字以示狀態進展
        const loadingTextEl = container?.querySelector('p');
        if (loadingTextEl) {
          if (taskStatus.status === 'processing') {
            loadingTextEl.textContent = '🤖 AI 正在努力分析並生成完美洞察，請耐心等候...';
          }
        }
      }
    }
    
    if (!reportResult && window.isAnalyticsLoading) {
      throw new Error('AI 思考太用力了，請稍後再試。');
    }
    
    if (!window.isAnalyticsLoading) {
      return; // 已經切換頁面，不進行後續渲染
    }
    
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
            reportData: reportResult,
            userRole: userRole
          })
        );
      } else {
        // 備援方案：若 CDN 或轉譯有延遲，使用純 HTML 備援渲染
        renderBackupHtml(container, reportResult);
      }
    }
  } catch (error) {
    if (container && window.isAnalyticsLoading) {
      let friendlyMessage = "AI 思考太用力了，請稍後再試。";
      const errMsg = error.message ? String(error.message) : "";
      
      // 識別明確的權限錯誤，其餘網路或底層 API 錯誤一律進行安全遮蔽
      if (errMsg.includes("權限不足") || errMsg.includes("Forbidden") || errMsg.includes("403")) {
        friendlyMessage = "權限不足，無法生成 AI 分析報告。";
      }
      
      container.innerHTML = `<div class="error" style="margin-top: 12px; color: #ef4444; font-weight: 600; text-align: center; padding: 20px;">❌ 載入失敗: ${escapeHtml(friendlyMessage)}</div>`;
    }
  } finally {
    window.isAnalyticsLoading = false;
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

async function handleDownload(endpoint, defaultFilename) {
  const dateFrom = document.getElementById('analyticsDateFrom').value;
  const dateTo = document.getElementById('analyticsDateTo').value;
  if (!dateFrom || !dateTo) {
    showNotification('請選擇日期範圍', 'warning');
    return;
  }
  const container = document.getElementById('analyticsReport');
  const customerId = container?.dataset.customerId || null;
  const productId = container?.dataset.productId || null;

  showNotification('正在準備下載檔案，請稍候...', 'info');

  try {
    const token = getToken();
    
    // 將 POST 端點映射為對應的 GET 直連端點
    const directEndpoint = endpoint === '/analytics/export-pdf' 
      ? '/analytics/export-pdf-direct' 
      : '/analytics/export-excel-direct';

    // 拼接 Query Parameters 篩選參數與認證 token
    const queryParams = new URLSearchParams();
    if (dateFrom) queryParams.append('date_from', dateFrom);
    if (dateTo) queryParams.append('date_to', dateTo);
    if (customerId) queryParams.append('customer_id', customerId);
    if (productId) queryParams.append('product_id', productId);
    if (token) queryParams.append('token', token);

    const downloadUrl = `${API_BASE}${directEndpoint}?${queryParams.toString()}`;
    
    console.log(`[下載偵錯] 觸發原生 GET 導航下載。連結: ${downloadUrl}`);
    
    // 使用原生的 window.location.href 觸發下載。
    // 這將被瀏覽器安全防禦機制視為使用者主動發起的原生下載，100% 避開「自動下載」攔截政策！
    window.location.href = downloadUrl;

    // window.location.href 是非阻塞的瀏覽器原生下載，無法偵測「真正完成」事件。
    // 延遲 1.5 秒後顯示「已啟動」通知，避免與「準備中」通知同時出現造成混淆。
    setTimeout(() => {
      showNotification('下載已啟動！請至瀏覽器下載列確認。', 'success');
    }, 1500);
  } catch (error) {
    console.error('Download error:', error);
    showNotification(`下載失敗: ${error.message}`, 'error');
  }
}


// ============================================================
// Phase 6 - 歷史報告 Drawer 功能實作
// ============================================================

let historyDrawerBound = false;

/**
 * 格式化 filter_parameters 為易讀的 Tag 資料陣列
 */
function formatHistoryTags(filters) {
  const tags = [];
  if (!filters) return tags;

  // 日期範圍
  const dateFrom = filters.date_from || filters.dateFrom;
  const dateTo = filters.date_to || filters.dateTo;
  if (dateFrom && dateTo) {
    tags.push({ icon: '📅', text: `${dateFrom} ~ ${dateTo}` });
  } else if (dateFrom) {
    tags.push({ icon: '📅', text: `起始：${dateFrom}` });
  } else if (dateTo) {
    tags.push({ icon: '📅', text: `截止：${dateTo}` });
  }

  // 客戶篩選
  const customerId = filters.customer_id || filters.customerId;
  if (customerId) {
    tags.push({ icon: '👤', text: `客戶：${customerId}` });
  }

  // 產品篩選
  const productId = filters.product_id || filters.productId;
  if (productId) {
    tags.push({ icon: '📦', text: `產品：${productId}` });
  }

  if (tags.length === 0) {
    tags.push({ icon: '🔍', text: '全範圍查詢' });
  }

  return tags;
}

/**
 * 格式化 UTC 時間為台灣本地時間的易讀字串
 */
function formatHistoryTime(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

/**
 * 載入並渲染歷史紀錄列表到 Drawer 中
 */
async function loadHistoryList() {
  const listEl = document.getElementById('historyList');
  if (!listEl) return;

  listEl.innerHTML = '<div class="history-loading">⏳ 載入中...</div>';

  try {
    const data = await apiRequest('/analytics/history', { method: 'GET' });
    const history = data.history || [];

    if (history.length === 0) {
      listEl.innerHTML = '<div class="history-empty">📭 尚無歷史報告紀錄<br><small>生成第一份報告後，它將出現在這裡。</small></div>';
      return;
    }

    listEl.innerHTML = '';

    history.forEach((item, index) => {
      const tags = formatHistoryTags(item.filter_parameters || {});
      const timeStr = formatHistoryTime(item.created_at);

      const card = document.createElement('div');
      card.className = 'history-item';
      card.dataset.index = index;

      const tagsHtml = tags.map(t =>
        `<span class="history-tag">${t.icon} ${escapeHtml(t.text)}</span>`
      ).join('');

      card.innerHTML = `
        <div class="history-item-meta">${escapeHtml(timeStr)}</div>
        <div class="history-tags">${tagsHtml}</div>
        <button class="btn-reapply" data-index="${index}" title="重新套用此篩選條件並生成報告">
          🔄 重新篩選
        </button>
      `;

      // 儲存 filter_parameters 到 dataset
      card.dataset.filters = JSON.stringify(item.filter_parameters || {});

      listEl.appendChild(card);
    });

    // 綁定「重新篩選」按鈕事件（事件委派）
    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-reapply');
      if (!btn) return;

      const card = btn.closest('.history-item');
      if (!card) return;

      const filters = JSON.parse(card.dataset.filters || '{}');

      // 關閉 Drawer
      closeHistoryDrawer();

      // 填入日期選擇器（支援 snake_case 與 camelCase 兩種格式）
      const dateFrom = filters.date_from || filters.dateFrom || '';
      const dateTo = filters.date_to || filters.dateTo || '';

      const fromEl = document.getElementById('analyticsDateFrom');
      const toEl = document.getElementById('analyticsDateTo');
      if (fromEl) fromEl.value = dateFrom;
      if (toEl) toEl.value = dateTo;

      // 取出 customer/product ID
      const customerId = filters.customer_id || filters.customerId || null;
      const productId = filters.product_id || filters.productId || null;

      // 更新 analyticsReport 的 dataset（供下載功能使用）
      const container = document.getElementById('analyticsReport');
      if (container) {
        container.dataset.customerId = customerId || '';
        container.dataset.productId = productId || '';
      }

      // 主動觸發報告生成
      await generateReport(dateFrom, dateTo, customerId, productId);
    });

  } catch (error) {
    listEl.innerHTML = `<div class="history-empty">❌ 載入失敗：${escapeHtml(error.message)}</div>`;
  }
}

/**
 * 開啟 Drawer 並載入歷史列表
 */
function openHistoryDrawer() {
  const drawer = document.getElementById('historyDrawer');
  const overlay = document.getElementById('historyDrawerOverlay');
  if (drawer) drawer.classList.add('open');
  if (overlay) overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // 每次開啟都重新載入最新的歷史列表
  loadHistoryList();
}

/**
 * 關閉 Drawer
 */
function closeHistoryDrawer() {
  const drawer = document.getElementById('historyDrawer');
  const overlay = document.getElementById('historyDrawerOverlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * 綁定 Drawer 相關事件（只綁定一次）
 */
function bindHistoryDrawerEvents() {
  if (historyDrawerBound) return;

  document.getElementById('historyDrawerBtn')?.addEventListener('click', openHistoryDrawer);
  document.getElementById('historyDrawerClose')?.addEventListener('click', closeHistoryDrawer);
  document.getElementById('historyDrawerOverlay')?.addEventListener('click', closeHistoryDrawer);

  // ESC 鍵關閉 Drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('historyDrawer');
      if (drawer?.classList.contains('open')) closeHistoryDrawer();
    }
  });

  historyDrawerBound = true;
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

  // 使用事件委派 (Event Delegation) 監聽下載按鈕，徹底解決動態 React 渲染的 Race Condition 問題
  document.addEventListener('click', async (e) => {
    const pdfBtn = e.target.closest('#downloadPdfBtn');
    if (pdfBtn) {
      e.preventDefault();
      await handleDownload('/analytics/export-pdf', 'sales_report.pdf');
      return;
    }

    const excelBtn = e.target.closest('#downloadExcelBtn');
    if (excelBtn) {
      e.preventDefault();
      await handleDownload('/analytics/export-excel', 'sales_report.xlsx');
      return;
    }
  });
  
  bindHistoryDrawerEvents();
  isEventsBound = true;
}

// 掛載至全域，方便 dynamic import 載入後，隨處皆可透過 window 呼叫
window.renderAnalyticsSection = renderAnalyticsSection;
window.getDate30DaysAgo = getDateStartOfRange;    // 向後相容別名
window.getTodayDate = getYesterdayDate;            // 向後相容別名
window.getDateStartOfRange = getDateStartOfRange;
window.getYesterdayDate = getYesterdayDate;
