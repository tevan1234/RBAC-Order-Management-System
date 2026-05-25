// data-loader.js — 資料載入協調器
// ⚠️ 架構警告：此模組已被設計為循環依賴打破器。
//    navigation.js 靜態 import 各功能模組 (orders.js, customers.js...)，
//    各功能模組透過 callback 呼叫 loadDashboardData，而非直接 import 此模組。
//    請勿在任何功能模組中直接 import 此模組，否則將立即形成循環依賴。

import { getOrders, getCustomers, getProducts, getUsers, getLogs } from '../data.js';
import { getCurrentUser } from '../auth.js';
import { isAdmin } from '../rbac.js';
import { showNotification } from '../utils.js?v=1.0.1';
import { setCachedOrders, setCachedCustomers, setCachedProducts, setCachedUsers, setCachedLogs } from './state.js';

/**
 * 載入儀表板所需的全部基礎資料，並進行快取
 * ⚠️ 注意：此函式不會自動呼叫 navigateTo。
 *    初次載入應由 dashboard.js 的 initDashboard() 在呼叫本函式後自行呼叫 navigateTo。
 *    CRUD 刷新時則由各功能模組的 onRefresh callback 呼叫，頁面保持在當前區段不跳轉。
 */
export async function loadDashboardData() {
  const currentUser = getCurrentUser();
  try {
    document.body.classList.add('is-loading');
    const [orders, customers, products] = await Promise.all([getOrders(), getCustomers(), getProducts()]);
    
    setCachedOrders(orders);
    setCachedCustomers(customers);
    setCachedProducts(products);
    
    if (currentUser && isAdmin(currentUser)) {
      const [users, logs] = await Promise.all([getUsers(), getLogs()]);
      setCachedUsers(users);
      setCachedLogs(logs);
    }
  } catch (e) {
    console.error('loadDashboardData:', e);
    showNotification('資料載入失敗：' + e.message, 'error');
  } finally {
    document.body.classList.remove('is-loading');
  }
}
