// navigation.js — SPA 路由導覽

import { f, setDropdownValue } from '../utils.js?v=1.0.1';
import { getCurrentUser } from '../auth.js';
import { isAdmin, canCreateOrder, canCreateCustomer, canCreateProduct } from '../rbac.js';
import { getCustomerSearch, setCustomerSearch } from './state.js';

// ── 功能模組靜態引入 ──
import { updateOverviewStats, renderOrdersList } from './orders.js';
import { renderCustomersList } from './customers.js';
import { renderProductsList } from './products.js';
import { renderUsersList } from './users.js';
import { renderAuditLogsList } from './audit-logs.js';
import { renderAccountSettings } from './account-settings.js';
import { loadDashboardAiWidget } from './ai-widget.js';

/**
 * SPA 路由跳轉控制
 * @param {string} section - 區段 ID (如 orders, customers 等)
 * @param {object} filters - 傳遞給目標區段的篩選參數
 */
export async function navigateTo(section, filters = null) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  // SPA 內部導航防禦 (AI 報告生成中警告)
  if (window.isAnalyticsLoading && section !== 'analytics') {
    const confirmLeave = confirm("AI 報告生成中，此時離開將中斷生成並浪費 API 額度，確定要離開嗎？");
    if (!confirmLeave) {
      window.location.hash = 'analytics';
      return; // 中斷切換
    }
    window.isAnalyticsLoading = false; // 確定離開則重置狀態
  }

  // 切換 DOM 區段可見性
  document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + section)?.classList.add('active');
  document.querySelectorAll('.menu-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));

  // 更新頁面大標題
  const titles = { 
    dashboard: '儀表板', 
    orders: '訂單管理', 
    customers: '客戶管理', 
    users: '使用者管理', 
    auditlogs: '操作紀錄', 
    'change-password': '帳戶設定', 
    analytics: '銷售分析',
    products: '商品管理'
  };
  const titleEl = f('currentPageTitle');
  if (titleEl && titles[section]) titleEl.textContent = titles[section];

  const role = (currentUser.role || 'viewer').toLowerCase();

  // 權限控制：顯示/隱藏新增按鈕與特定欄位
  if (section === 'orders') {
    const btn = f('addOrderBtn');
    if (btn) btn.style.display = canCreateOrder(currentUser) ? 'block' : 'none';

    // Sales 隱藏負責人搜尋選項
    const ownerOption = document.querySelector('#orderFieldDropdown .dropdown-item[data-value="ownerName"]');
    if (ownerOption) {
      ownerOption.style.display = role === 'sales' ? 'none' : '';
    }
  } else if (section === 'customers') {
    const btn = f('addCustomerBtn');
    if (btn) btn.style.display = canCreateCustomer(currentUser) ? 'block' : 'none';

    // Sales 隱藏負責人搜尋選項
    const ownerOption = document.querySelector('#customerFieldDropdown .dropdown-item[data-value="ownerId"]');
    if (ownerOption) {
      ownerOption.style.display = role === 'sales' ? 'none' : '';
      
      const customerSearch = getCustomerSearch();
      // 安全檢查：如果是 Sales 且目前選中負責人，重設為客戶編號
      if (role === 'sales' && customerSearch.field === 'ownerId') {
        setCustomerSearch({ field: 'customerId' });
        setDropdownValue('customerFieldDropdown', 'customerId');
      }
    }
  } else if (section === 'users') {
    const btn = f('addUserBtn');
    if (btn) btn.style.display = isAdmin(currentUser) ? 'block' : 'none';
  } else if (section === 'products') {
    const btn = f('addProductBtn');
    if (btn) btn.style.display = canCreateProduct(currentUser) ? 'block' : 'none';
  }

  // 執行對應區段的渲染邏輯
  const map = {
    dashboard: () => { 
      updateOverviewStats(); 
      renderOrdersList(); 
      loadDashboardAiWidget(); 
    },
    orders: renderOrdersList,
    customers: renderCustomersList,
    products: renderProductsList,
    users: renderUsersList,
    auditlogs: renderAuditLogsList,
    'change-password': renderAccountSettings,
    analytics: async () => {
      if (!window.analyticsModuleLoaded) {
        await import('../analytics-module.js');
        window.analyticsModuleLoaded = true;
      }
      window.renderAnalyticsSection(filters || {});
    }
  };

  if (map[section]) {
    if (section === 'analytics') {
      await map[section]();
    } else {
      map[section]();
    }
  }
}
