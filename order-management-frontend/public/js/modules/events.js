// events.js — 全域事件監聽與綁定中心

import { f, getF } from '../utils.js?v=1.0.1';
import { logout } from '../auth.js';
import { getOrderSearch, getCachedCustomers, getCachedProducts } from './state.js';
import { navigateTo } from './navigation.js';
import { loadDashboardAiWidget } from './ai-widget.js';

/**
 * 綁定非功能模組專屬的全域性事件
 * @param {function} onRefresh - 資料載入回呼函式 (loadDashboardData)
 */
export function bindGlobalEvents(onRefresh) {
  // 1. 登出按鈕
  f('logoutBtn')?.addEventListener('click', () => logout());

  // 2. 行動裝置側邊選單與 Overlay
  f('mobileMenuBtn')?.addEventListener('click', () => {
    f('sidebar')?.classList.add('mobile-active');
    f('sidebarOverlay')?.classList.add('active');
  });
  f('sidebarOverlay')?.addEventListener('click', () => {
    f('sidebar')?.classList.remove('mobile-active');
    f('sidebarOverlay')?.classList.remove('active');
  });

  // 3. AI銷售速報手動刷新
  f('refreshAiWidgetBtn')?.addEventListener('click', () => {
    loadDashboardAiWidget();
  });

  // 4. 分析當前銷售情形 (入口 B - 跨模組跳轉)
  f('analyzeOrdersBtn')?.addEventListener('click', async () => {
    const orderSearch = getOrderSearch();
    const cachedCustomers = getCachedCustomers();
    const cachedProducts = getCachedProducts();

    const dateFrom = orderSearch.dateFrom || (window.getDate30DaysAgo ? window.getDate30DaysAgo() : '');
    const dateTo = orderSearch.dateTo || (window.getTodayDate ? window.getTodayDate() : '');

    let customerId = null;
    let productId = null;

    if (orderSearch.keyword) {
      const kw = orderSearch.keyword.toLowerCase().trim();
      if (orderSearch.field === 'customer') {
        const matchedCust = cachedCustomers.find(c =>
          String(getF(c, 'customer_id', 'customerId')).toLowerCase() === kw ||
          String(c.name || c.customer_name || '').toLowerCase().includes(kw)
        );
        customerId = matchedCust ? getF(matchedCust, 'customer_id', 'customerId') : orderSearch.keyword.trim();
      } else if (orderSearch.field === 'product') {
        const matchedProd = cachedProducts.find(p =>
          String(getF(p, 'product_id', 'productId')).toLowerCase() === kw ||
          String(p.name || '').toLowerCase().includes(kw)
        );
        productId = matchedProd ? getF(matchedProd, 'product_id', 'productId') : orderSearch.keyword.trim();
      }
    }

    await navigateTo('analytics', { dateFrom, dateTo, customerId, productId });
  });

  // 5. 統一使用事件委派監聽所有 Modal 關閉按鈕 (.btn-close) 的點擊事件
  document.body.addEventListener('click', (e) => {
    const btnClose = e.target.closest('.btn-close');
    if (btnClose) {
      const modal = btnClose.closest('.modal-overlay');
      if (modal) {
        modal.classList.remove('active');
      }
    }
  });
}

