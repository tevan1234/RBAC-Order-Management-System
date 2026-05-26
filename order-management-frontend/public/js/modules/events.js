// events.js — 全域事件監聽與綁定中心

import { f, getF } from '../utils.js?v=1.0.1';
import { logout, getCurrentUser } from '../auth.js';
import { getOrderSearch, getCachedCustomers, getCachedProducts, getCachedOrders } from './state.js';
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

    // 1. 推算當前可見之篩選後的訂單列表 (包含 sales 角色與 keyword 搜尋過濾，排除日期過濾以求推算基準一致)
    const currentUser = getCurrentUser();
    let visibleOrders = getCachedOrders();
    if (currentUser && currentUser.role === 'sales') {
      const uid = currentUser.employeeId || currentUser.employee_id;
      visibleOrders = visibleOrders.filter(o => getF(o, 'owner_id', 'ownerId') === uid);
    }

    const toSnake = str => str.replace(/([A-Z])/g, "_$1").toLowerCase();
    let filteredOrders = visibleOrders;

    if (orderSearch.keyword) {
      const kw = orderSearch.keyword.toLowerCase().trim();
      filteredOrders = filteredOrders.filter(o => {
        let v = '';
        if (orderSearch.field === 'ownerName') {
          v = getF(o, 'owner_id', 'ownerId') || '';
        } else if (orderSearch.field === 'customer') {
          const custId = getF(o, 'customer_id', 'customerId', 'customer');
          const cust = cachedCustomers.find(c => getF(c, 'customer_id', 'customerId') === custId);
          v = cust ? `${cust.name || cust.customer_name} ${custId}` : custId;
        } else if (orderSearch.field === 'product') {
          const prodId = getF(o, 'product_id', 'productId');
          const prod = cachedProducts.find(p => getF(p, 'product_id', 'productId') === prodId);
          v = prod?.name || getF(o, 'product_name') || '未知商品';
        } else {
          v = String(getF(o, orderSearch.field, toSnake(orderSearch.field) || ''));
        }
        return v.toLowerCase().includes(kw);
      });
    }

    // 2. 判斷篩選後的訂單中是否包含「狀態為已完成且最後更新日是今天」的訂單
    const todayStr = new Date().toISOString().split('T')[0];
    const hasTodayCompletedOrder = filteredOrders.some(o => {
      const isDone = o.status === '已完成';
      const updatedAt = getF(o, 'updated_at', 'updatedAt') || '';
      const updatedDateStr = updatedAt.split('T')[0];
      return isDone && updatedDateStr === todayStr;
    });

    // 3. 根據上述條件動態決定 Fallback：若今天有完成訂單，則 Fallback 為今天；否則 Fallback 為昨天
    const fallbackDateTo = hasTodayCompletedOrder ? todayStr : (window.getTodayDate ? window.getTodayDate() : '');
    
    const dateFrom = orderSearch.dateFrom || (window.getDate30DaysAgo ? window.getDate30DaysAgo() : '');
    const dateTo = orderSearch.dateTo || fallbackDateTo;

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

    // 防禦性同步網址 Hash，確保切換與資料更新安全無虞
    window.location.hash = 'analytics';
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

