// dashboard.js — 儀表板應用程式主入口點 (Modular Version)

import { getCurrentUser } from './auth.js';
import { showNotification } from './utils.js?v=1.0.1';
import { loadDashboardData } from './modules/data-loader.js';
import { updateHeaderUI, renderSidebarMenu, initIdleDetection } from './modules/ui-core.js';
import { navigateTo } from './modules/navigation.js';

import { bindGlobalEvents } from './modules/events.js';
import { bindOrdersEvents, openOrderModal } from './modules/orders.js';
import { bindCustomersEvents, openCustomerModal } from './modules/customers.js';
import { bindProductsEvents, openProductModal } from './modules/products.js';
import { bindUsersEvents, openUserModal } from './modules/users.js';
import { bindAuditEvents } from './modules/audit-logs.js';
import { bindAccountSettingsEvents } from './modules/account-settings.js';

const currentUser = getCurrentUser();

/**
 * 儀表板應用程式初始化
 */
async function initDashboard() {
  // 1. 安全防禦：若未登入則重定向至登入頁
  if (!currentUser) {
    return (window.location.href = 'index.html');
  }

  // 2. 初始化核心 UI
  renderSidebarMenu(currentUser);
  updateHeaderUI(currentUser);

  // ── onRefresh callback ──
  // CRUD 操作成功後，只重新拉取資料並渲染當前區段，不觸發頁面路由跳轉
  const onRefresh = async () => {
    await loadDashboardData();
    const currentSection = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(currentSection);
  };

  // 3. 綁定各功能模組與全域事件 (傳入 onRefresh 以便在資料更新後刷新當前區段)
  bindGlobalEvents(onRefresh);
  bindOrdersEvents(onRefresh);
  bindCustomersEvents(onRefresh);
  bindProductsEvents(onRefresh);
  bindUsersEvents(onRefresh);
  bindAuditEvents(onRefresh);
  bindAccountSettingsEvents(onRefresh);

  // 4. 首次載入基礎資料，然後導航至 Hash 指定的區段（僅執行一次）
  await loadDashboardData();
  const initialSection = window.location.hash.replace('#', '') || 'dashboard';

  // 5. 初始化使用者閒置偵測 (30 分鐘)
  initIdleDetection();

  // 6. 處理密碼變更強制要求與待處理通知
  if (currentUser.must_change_password) {
    showNotification('為了您的帳戶安全，首次登入請先修改預設密碼。', 'warning', 8000);
    window.location.hash = 'change-password';
    navigateTo('change-password');
  } else {
    // 先導航至初始區段
    navigateTo(initialSection);
    // 再顯示登入後的待處理通知
    const pendingNotif = localStorage.getItem('pendingNotification');
    if (pendingNotif) {
      try {
        const notif = JSON.parse(pendingNotif);
        showNotification(notif.message, notif.type || 'info', notif.duration || 4000);
      } catch (e) {
        console.error('Parse pending notification error:', e);
      }
      localStorage.removeItem('pendingNotification');
    }
  }
}

// ── 全域暴露中心 (維持與舊架構/分析模組相容性) ──
window.navigateTo = navigateTo;
window.openOrderModal = openOrderModal;
window.openCustomerModal = openCustomerModal;
window.openProductModal = openProductModal;
window.openUserModal = openUserModal;

// 啟動應用程式
initDashboard();

export { loadDashboardData, navigateTo };
