// ============================================================
// dashboard.js — UI 渲染 + 事件綁定 + Flow 控制 (ES Module)
// ============================================================

import {
  canAccessMenu, getMenuItems, isAdmin,
  canEditOrder, canVoidOrder, canCompleteOrder, canCreateOrder,
  canEditCustomer, canVoidCustomer, canCreateCustomer,
  canEditUser, canDeactivateUser, validateLastAdmin, canChangeRole,
  canEditOtherUser
} from './rbac.js';

import {
  initData, getCurrentUser, clearCurrentUser,
  getOrders, getVisibleOrders, saveOrders,
  getCustomers, getVisibleCustomers, saveCustomers,
  getUsers, saveUsers, setCurrentUser,
  getLogs, defaultProducts
} from './data.js';

import { addLog } from './audit.js';
import { formatDate, generateEmployeeId } from './utils.js';

// ============================================================
// 全域通知系統
// type: 'success' | 'error' | 'warning' | 'info'
// ============================================================

// ── 全域通知佇列 ──
let activeNotifications = [];
const NOTIFICATION_SPACING = 16;
const NOTIFICATION_TOP_START = 24;

function showNotification(message, type = 'info', duration = 4000) {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;

  const iconMap = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  notification.innerHTML = `
    <span class="notification-icon">${iconMap[type] || 'ℹ️'}</span>
    <span class="notification-message">${message}</span>
    <button class="notification-close" aria-label="關閉">×</button>
  `;

  document.body.appendChild(notification);
  activeNotifications.push(notification);

  // 初始化位置與透明度 (GSAP)
  gsap.set(notification, {
    x: 100,
    opacity: 0,
    display: 'flex',
    y: calculateNotificationTop(notification)
  });

  // 入場動畫
  gsap.to(notification, {
    x: 0,
    opacity: 1,
    duration: 0.5,
    ease: "back.out(1.7)"
  });

  // 更新所有現有通知的位置
  updateNotificationsPosition();

  // 關閉按鈕
  notification.querySelector('.notification-close').addEventListener('click', () => {
    dismissNotification(notification);
  });

  // 自動消失 (GSAP delayedCall 比 setTimeout 更精確且易於管理)
  const autoHide = gsap.delayedCall(duration / 1000, () => dismissNotification(notification));

  // 滑鼠停留時暫停計時
  notification.addEventListener('mouseenter', () => autoHide.pause());
  notification.addEventListener('mouseleave', () => autoHide.resume());
}

function calculateNotificationTop(el) {
  let top = NOTIFICATION_TOP_START;
  const index = activeNotifications.indexOf(el);
  for (let i = 0; i < index; i++) {
    top += activeNotifications[i].offsetHeight + NOTIFICATION_SPACING;
  }
  return top;
}

function updateNotificationsPosition() {
  let currentTop = NOTIFICATION_TOP_START;
  activeNotifications.forEach((el) => {
    gsap.to(el, {
      y: currentTop,
      duration: 0.4,
      ease: "power2.out"
    });
    currentTop += el.offsetHeight + NOTIFICATION_SPACING;
  });
}

function dismissNotification(el) {
  const index = activeNotifications.indexOf(el);
  if (index > -1) {
    activeNotifications.splice(index, 1);
  }

  // 退場動畫
  gsap.to(el, {
    x: 50,
    opacity: 0,
    duration: 0.3,
    ease: "power2.in",
    onComplete: () => {
      el.remove();
      updateNotificationsPosition(); // 舊通知移除後，下方的通知往上遞補
    }
  });
}

// ── 自定義確認對話框 ──
function showConfirm(message, title = '確認操作') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmMessage');
    const titleEl = document.getElementById('confirmTitle');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const closeBtn = document.getElementById('closeConfirmBtn');

    if (!modal || !msgEl || !titleEl || !okBtn || !cancelBtn || !closeBtn) {
      console.error('[showConfirm] 找不到確認對話框所需之元素');
      resolve(false);
      return;
    }

    msgEl.textContent = message;
    titleEl.textContent = title;
    modal.classList.add('active');

    const cleanup = (result) => {
      modal.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
  });
}

// ── 全域快取 ──
let currentUser = null;

// ── 分頁與搜尋狀態 ──
let ordersPage = 1;
let customersPage = 1;
let usersPage = 1;
let logsPage = 1;
const PAGE_SIZE = 10;

// 搜尋條件
let orderSearch = { field: 'id', keyword: '', dateFrom: '', dateTo: '' };
let customerSearch = { field: 'customerId', keyword: '' };
let auditSearch = { field: 'action', keyword: '', dateFrom: '', dateTo: '' };
let userSearch = { field: 'employeeId', keyword: '' };

// ── 目標三：Custom Dropdown 管理 ──
function initDropdown(dropdownId, onChange) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown || dropdown.dataset.initialized === 'true') return;

  const trigger = dropdown.querySelector('.dropdown-trigger');
  const menu = dropdown.querySelector('.dropdown-menu');
  const labelEl = dropdown.querySelector('.dropdown-label');

  // 開關選單
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) dropdown.classList.add('open');
  });

  // 選取選項
  menu.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      labelEl.textContent = item.textContent;
      dropdown.dataset.value = item.dataset.value;

      // 同時更新隱藏的 input (如有)
      const hiddenInput = dropdown.querySelector('input[type="hidden"]');
      if (hiddenInput) hiddenInput.value = item.dataset.value;

      dropdown.classList.remove('open');
      if (onChange) onChange(item.dataset.value, item.textContent);
    });
  });

  dropdown.dataset.initialized = 'true';
}

function getDropdownValue(dropdownId) {
  return document.getElementById(dropdownId)?.dataset.value || '';
}

function setDropdownValue(dropdownId, value) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const item = dropdown.querySelector(`.dropdown-item[data-value="${value}"]`);
  if (item) {
    // 模擬點擊以觸發 UI 更新與 callback
    item.click();
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
}

document.addEventListener('click', closeAllDropdowns);

// ── 通用分頁元件渲染 ──
function createPaginator(totalItems, pageSize, currentPage, onPageChange, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;

  let html = `
    <button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">上一頁</button>
  `;

  // 簡化版分頁：顯示所有頁碼（若頁數極多再考慮省略號）
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `
    <button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">下一頁</button>
  `;

  container.innerHTML = html;

  container.querySelectorAll('button:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      onPageChange(Number(btn.dataset.page));
    });
  });
}

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. RBAC Guard
  currentUser = getCurrentUser();
  if (!currentUser || !currentUser.role) {
    window.location.href = 'index.html';
    return;
  }

  // 2. 初始化資料
  initData();

  // 3. UI 初始化
  initUI();

  // 4. 事件綁定
  bindEvents();

  // 5. 處理待顯示的通知 (放在初始化之後，確保 DOM 已準備好)
  const pending = sessionStorage.getItem('pendingNotification');
  if (pending) {
    try {
      const { message, type } = JSON.parse(pending);
      // 稍微延遲以確保動畫流暢
      setTimeout(() => showNotification(message, type), 300);
    } catch (_) { }
    sessionStorage.removeItem('pendingNotification');
  }

  // 6. 強制修改密碼檢查
  const urlParams = new URLSearchParams(window.location.search);
  const isChangePwdAction = urlParams.get('action') === 'change-password';

  if (currentUser.mustChangePassword || isChangePwdAction) {
    // 如果是強制改密，且不在該頁面，則導航過去
    showNotification('為了帳號安全，請先修改您的初始密碼', 'warning');
    navigateTo('change-password');
    // 清理 URL 避免重整後重複處理參數 (但保留狀態由 currentUser 控管)
    if (isChangePwdAction) history.replaceState(null, '', 'dashboard.html');
  } else {
    navigateTo('dashboard');
  }
});

// ============================================================
// UI 初始化
// ============================================================

function updateHeaderUI() {
  const displayIdEl = document.getElementById('displayEmployeeId');
  const welcomeUserEl = document.getElementById('welcomeUserName');
  if (displayIdEl) displayIdEl.textContent = currentUser.name || currentUser.employeeId;
  if (welcomeUserEl) welcomeUserEl.textContent = currentUser.name || currentUser.employeeId;

  // Role Badge
  const badgeContainer = document.getElementById('roleBadgeContainer');
  if (badgeContainer) {
    const displayRole = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
    badgeContainer.innerHTML = `<span class="badge badge-${currentUser.role}">${displayRole}</span>`;
  }
}

function initUI() {
  // Topbar & User Info
  updateHeaderUI();

  // Sidebar
  renderSidebar();

  // 按鈕顯示
  const addOrderBtn = document.getElementById('addOrderBtn');
  if (addOrderBtn) addOrderBtn.style.display = canCreateOrder(currentUser) ? 'block' : 'none';

  const addCustomerBtn = document.getElementById('addCustomerBtn');
  if (addCustomerBtn) addCustomerBtn.style.display = canCreateCustomer(currentUser) ? 'block' : 'none';
}

function renderSidebar() {
  const menuContainer = document.getElementById('sidebarMenu');
  const items = getMenuItems(currentUser.role);

  menuContainer.innerHTML = items.map(item => `
    <li class="menu-item" data-target="${item.id}">
      <span class="menu-icon">${item.icon}</span>
      <span class="menu-text">${item.label}</span>
    </li>
  `).join('');

  // 綁定選單點擊
  menuContainer.querySelectorAll('.menu-item').forEach(el => {
    el.addEventListener('click', () => {
      navigateTo(el.getAttribute('data-target'));
    });
  });
}

// ============================================================
// 導覽
// ============================================================

function navigateTo(sectionId) {
  // 隱藏所有 section
  document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));

  if (canAccessMenu(currentUser, sectionId)) {
    const target = document.getElementById(`section-${sectionId}`);
    if (target) {
      target.classList.add('active');

      // GSAP Animation for Change Password
      if (sectionId === 'change-password') {
        gsap.fromTo(target.querySelector('.form-card'),
          { y: 40, opacity: 0, scale: 0.95 },
          { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.5)" }
        );
        gsap.fromTo(target.querySelectorAll('.form-group'),
          { x: -30, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.4, stagger: 0.1, delay: 0.2, ease: "power2.out" }
        );
        gsap.fromTo(target.querySelector('.form-actions'),
          { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.4, delay: 0.5, ease: "power2.out" }
        );
      }
    }

    const items = getMenuItems(currentUser.role);
    const menuItem = items.find(i => i.id === sectionId);
    const pageTitleEl = document.getElementById('currentPageTitle');
    if (menuItem && pageTitleEl) pageTitleEl.textContent = menuItem.label;

    loadSectionData(sectionId);
  } else {
    const unauthorizedEl = document.getElementById('section-unauthorized');
    const pageTitleEl = document.getElementById('currentPageTitle');
    if (unauthorizedEl) unauthorizedEl.classList.add('active');
    if (pageTitleEl) pageTitleEl.textContent = '權限不足';
  }

  // Sidebar active
  document.querySelectorAll('.menu-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-target') === sectionId);
  });
}

// 更新訂單總覽數據 (依設計圖)
function updateOrderOverview(orders) {
  const total = orders.length;
  const pending = orders.filter(o => o.status === '處理中').length;
  const done = orders.filter(o => o.status === '已完成').length;
  const voidCount = orders.filter(o => o.status === '已作廢').length;

  const rate = total > 0 ? Math.round((done / total) * 100) : 0;

  // 更新總筆數
  const totalEl = document.getElementById('overviewTotal');
  if (totalEl) totalEl.textContent = total;

  // 更新狀態計數
  const pendingEl = document.getElementById('statPending');
  const doneEl = document.getElementById('statDone');
  const voidEl = document.getElementById('statVoid');

  if (pendingEl) pendingEl.textContent = pending;
  if (doneEl) doneEl.textContent = done;
  if (voidEl) voidEl.textContent = voidCount;

  // 更新進度條與完成率
  const fillEl = document.getElementById('overviewProgressFill');
  const labelEl = document.getElementById('overviewProgressLabel');

  if (fillEl) fillEl.style.width = `${rate}%`;
  if (labelEl) labelEl.textContent = `完成率 ${rate}%`;
}

function loadSectionData(sectionId) {
  switch (sectionId) {
    case 'dashboard':
      updateDashboardStats();
      break;
    case 'orders':
      ordersPage = 1; // 切換 Section 時重設分頁
      renderOrdersTable();
      break;
    case 'customers':
      customersPage = 1;
      renderCustomersTable();
      break;
    case 'users':
      if (isAdmin(currentUser)) {
        usersPage = 1;
        renderUsersTable();
      }
      break;
    case 'auditlogs':
      if (isAdmin(currentUser)) {
        logsPage = 1;
        renderAuditLogsTable();
      }
      break;
    case 'change-password': renderAccountSettings(); break;
  }
}

// 儀表板數據動態化
function updateDashboardStats() {
  const orders = getOrders();
  const totalOrders = orders.length;
  const totalAmount = orders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const pendingOrders = orders.filter(o => o.status === '處理中').length;

  const totalEl = document.getElementById('dbTotalOrders');
  const amountEl = document.getElementById('dbTotalAmount');
  const pendingEl = document.getElementById('dbPendingOrders');

  if (totalEl) totalEl.textContent = totalOrders.toLocaleString();
  if (amountEl) amountEl.textContent = `$${totalAmount.toLocaleString()}`;
  if (pendingEl) pendingEl.textContent = pendingOrders.toLocaleString();
}

// ============================================================
// Orders
// ============================================================

function renderOrdersTable() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const usersList = getUsers();
  let orders = getVisibleOrders(currentUser);

  // 搜尋過濾
  if (orderSearch.keyword) {
    const kw = orderSearch.keyword.toLowerCase();
    orders = orders.filter(order => {
      let val = '';
      if (orderSearch.field === 'ownerName') {
        const owner = usersList.find(u => u.employeeId === order.ownerId);
        val = owner ? owner.name : order.ownerId;
      } else {
        val = String(order[orderSearch.field] || '');
      }
      return val.toLowerCase().includes(kw);
    });
  }

  // 日期篩選
  if (orderSearch.dateFrom || orderSearch.dateTo) {
    orders = orders.filter(order => {
      const orderDate = order.createdAt.split('T')[0];
      if (orderSearch.dateFrom && orderDate < orderSearch.dateFrom) return false;
      if (orderSearch.dateTo && orderDate > orderSearch.dateTo) return false;
      return true;
    });
  }

  const total = orders.length;
  // 分頁切片
  const start = (ordersPage - 1) * PAGE_SIZE;
  const pagedOrders = orders.slice(start, start + PAGE_SIZE);

  const showActions = canEditOrder(currentUser, { ownerId: currentUser.employeeId }) || canVoidOrder(currentUser) || canCompleteOrder(currentUser, { ownerId: currentUser.employeeId });
  const thead = document.querySelector('#section-orders .data-table thead tr');
  const actionTh = thead ? thead.querySelector('th:last-child') : null;

  if (showActions) {
    if (actionTh) actionTh.style.display = '';
  } else {
    if (actionTh) actionTh.style.display = 'none';
  }

  tbody.innerHTML = pagedOrders.map(order => {
    const statusClass = order.status === '已完成' ? 'badge-success' : (order.status === '處理中' ? 'badge-info' : 'badge-void');
    const product = defaultProducts.find(p => p.productId === order.productId);
    const productName = product ? product.name : '-';
    const ownerUser = usersList.find(u => u.employeeId === order.ownerId);
    const ownerName = ownerUser ? ownerUser.name : order.ownerId;

    let actionsHtml = '';
    const isFinalized = order.status === '已完成' || order.status === '已作廢';

    if (!isFinalized) {
      if (canEditOrder(currentUser, order)) {
        actionsHtml += `<button class="btn-secondary btn-edit-order" data-id="${order.id}">編輯</button>`;
      }
      if (canCompleteOrder(currentUser, order)) {
        actionsHtml += `<button class="btn-success btn-complete-order" data-id="${order.id}">完成</button>`;
      }
      if (canVoidOrder(currentUser)) {
        actionsHtml += `<button class="btn-danger btn-void-order" data-id="${order.id}">作廢</button>`;
      }
    }

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="info-tooltip">
              <span class="info-icon">i</span>
              <div class="tooltip-box">
                <div class="tooltip-row">
                  <span class="tooltip-label">建立時間</span>
                  <span class="tooltip-value">${formatDate(order.createdAt)}</span>
                </div>
                <div class="tooltip-row">
                  <span class="tooltip-label">更新時間</span>
                  <span class="tooltip-value">${formatDate(order.updatedAt || '-')}</span>
                </div>
              </div>
            </span>
            <strong>${order.id}</strong>
          </div>
        </td>
        <td>${order.customer}</td>
        <td class="text-truncate">${productName}</td>
        <td>$${Number(order.amount).toLocaleString()}</td>
        <td><div class="status-wrapper"><span class="badge ${statusClass}">${order.status}</span></div></td>
        <td class="badge-cell"><span class="badge badge-viewer">${ownerName}</span></td>
        ${showActions ? `<td class="actions-cell"><div class="actions-wrapper">${actionsHtml || '<span>—</span>'}</div></td>` : ''}
      </tr>
    `;
  }).join('');

  // 動態綁定事件 (因為是 Module，onclick 會失效)
  tbody.querySelectorAll('.btn-edit-order').forEach(btn => {
    btn.addEventListener('click', () => openOrderModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-void-order').forEach(btn => {
    btn.addEventListener('click', async () => {
      await voidOrder(btn.dataset.id);
    });
  });
  tbody.querySelectorAll('.btn-complete-order').forEach(btn => {
    btn.addEventListener('click', async () => {
      await completeOrder(btn.dataset.id);
    });
  });

  updateOrderOverview(orders);

  createPaginator(total, PAGE_SIZE, ordersPage, (newPage) => {
    ordersPage = newPage;
    renderOrdersTable();
  }, 'ordersPaginator');
}

function openOrderModal(orderId = null) {
  if (!canCreateOrder(currentUser)) { showNotification('無權限操作', 'error'); return; }

  const modal = document.getElementById('orderModal');
  const title = document.getElementById('modalTitle');
  const idInput = document.getElementById('orderId');
  const amountInput = document.getElementById('orderAmount');

  // 目標三：填充商品選單 (Dropdown 版)
  const productMenu = document.getElementById('orderProductMenu');
  productMenu.innerHTML = defaultProducts.map(p => `
    <li class="dropdown-item" data-value="${p.productId}">${p.name} - $${p.price}</li>
  `).join('');
  initDropdown('orderProductDropdown', (val) => {
    const product = defaultProducts.find(p => p.productId === val);
    if (product) amountInput.value = product.price;
  });

  // 目標四：動態填充客戶選單
  const customers = getVisibleCustomers(currentUser).filter(c => c.status === 'active');
  const customerMenu = document.getElementById('orderCustomerMenu');
  const customerLabel = document.querySelector('#orderCustomerDropdown .dropdown-label');

  customerMenu.innerHTML = customers.map(c => `
    <li class="dropdown-item" data-value="${c.name}" data-id="${c.customerId}">
      ${c.name}（${c.customerId}）
    </li>
  `).join('');

  initDropdown('orderCustomerDropdown', (value) => {
    customerLabel.style.color = ''; // 選取後移除灰色
  });

  if (orderId) {
    const orders = getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (!canEditOrder(currentUser, order)) { showNotification('無權限編輯此訂單', 'error'); return; }

    title.textContent = '編輯訂單';
    idInput.value = order.id;
    amountInput.value = order.amount;

    // 設定 Dropdown 預設值
    setDropdownValue('orderProductDropdown', order.productId);
    setDropdownValue('orderCustomerDropdown', order.customer);
    customerLabel.style.color = '';
  } else {
    title.textContent = '新增訂單';
    idInput.value = '';
    amountInput.value = '';

    // 重置 Dropdown
    const productLabel = document.querySelector('#orderProductDropdown .dropdown-label');
    productLabel.textContent = '請選擇商品';
    document.getElementById('orderProductDropdown').dataset.value = '';

    customerLabel.textContent = '請選擇客戶';
    customerLabel.style.color = '#9CA3AF';
    document.getElementById('orderCustomerDropdown').dataset.value = '';
  }

  modal.classList.add('active');
}

function closeOrderModal() {
  document.getElementById('orderModal').classList.remove('active');
}

function saveOrder() {
  if (!canCreateOrder(currentUser)) { showNotification('無權限操作', 'error'); return; }

  const id = document.getElementById('orderId').value;
  const customer = getDropdownValue('orderCustomerDropdown');
  const productId = getDropdownValue('orderProductDropdown');
  const amount = document.getElementById('orderAmount').value;

  if (!customer) { showNotification('請選擇客戶', 'warning'); return; }
  if (!productId || !amount) { showNotification('請選擇商品', 'warning'); return; }

  const allOrders = getOrders();
  const now = new Date().toISOString();

  if (id) {
    // 編輯
    const order = allOrders.find(o => o.id === id);
    if (!order) return;
    if (!canEditOrder(currentUser, order)) { showNotification('無權限修改此訂單', 'error'); return; }

    order.customer = customer;
    order.productId = productId;
    order.amount = Number(amount);
    order.updatedAt = now;

    saveOrders(allOrders);
    addLog('UPDATE_ORDER', id, currentUser);
  } else {
    // 新增
    const newId = 'ORD-' + Date.now().toString().slice(-4);
    allOrders.push({
      id: newId, customer, productId,
      amount: Number(amount), status: '處理中',
      ownerId: currentUser.employeeId,
      createdAt: now, updatedAt: now
    });

    saveOrders(allOrders);
    addLog('CREATE_ORDER', newId, currentUser);
  }

  closeOrderModal();
  renderOrdersTable();
}

async function voidOrder(id) {
  if (!canVoidOrder(currentUser)) { showNotification('無權限操作：僅管理員可作廢訂單', 'error'); return; }

  const confirmed = await showConfirm('確定要作廢此訂單嗎？作廢後將無法修改。', '作廢訂單確認');
  if (!confirmed) return;

  const allOrders = getOrders();
  const order = allOrders.find(o => o.id === id);
  if (!order) return;

  order.status = '已作廢';
  order.updatedAt = new Date().toISOString();

  saveOrders(allOrders);
  addLog('VOID_ORDER', id, currentUser);
  renderOrdersTable();
  showNotification('訂單已成功作廢', 'success');
}

async function completeOrder(id) {
  const allOrders = getOrders();
  const order = allOrders.find(o => o.id === id);
  if (!order) return;

  if (!canCompleteOrder(currentUser, order)) {
    showNotification('無權限完成此訂單', 'error');
    return;
  }

  const confirmed = await showConfirm('確定要將此訂單標記為「已完成」嗎？結案後將無法再修改。', '完成訂單確認');
  if (!confirmed) return;

  order.status = '已完成';
  order.updatedAt = new Date().toISOString();

  saveOrders(allOrders);
  addLog('COMPLETE_ORDER', id, currentUser);
  renderOrdersTable();
  showNotification('訂單已成功結案', 'success');
}

// ============================================================
// Customers
// ============================================================

function renderCustomersTable() {
  const tbody = document.getElementById('customersTableBody');
  const thead = document.querySelector('#section-customers .data-table thead tr');
  if (!tbody || !thead) return;

  const usersList = getUsers();
  let customers = getVisibleCustomers(currentUser);

  // 搜尋過濾
  if (customerSearch.keyword) {
    const kw = customerSearch.keyword.toLowerCase();
    customers = customers.filter(c => {
      let val = '';
      if (customerSearch.field === 'ownerName') {
        const owner = usersList.find(u => u.employeeId === c.ownerId);
        val = owner ? owner.name : c.ownerId;
      } else {
        val = String(c[customerSearch.field] || '');
      }
      return val.toLowerCase().includes(kw);
    });
  }

  // 判斷是否顯示操作欄 (目標四)
  // 若是 Viewer 且沒有編輯/作廢權限，則隱藏
  const showActions = canEditCustomer(currentUser, { ownerId: currentUser.employeeId }) || canVoidCustomer(currentUser);

  // 處理 Header
  const actionTh = thead.querySelector('th:last-child');
  if (showActions) {
    if (actionTh) actionTh.style.display = '';
  } else {
    if (actionTh) actionTh.style.display = 'none';
  }

  const total = customers.length;
  const start = (customersPage - 1) * PAGE_SIZE;
  const pagedCustomers = customers.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pagedCustomers.map(customer => {
    const badgeClass = customer.status === 'active' ? 'badge-success' : 'badge-secondary';
    const ownerUser = usersList.find(u => u.employeeId === customer.ownerId);
    const ownerName = ownerUser ? ownerUser.name : customer.ownerId;

    let actionsHtml = '';
    if (customer.status !== 'inactive') {
      if (canEditCustomer(currentUser, customer)) {
        actionsHtml += `<button class="btn-secondary btn-edit-customer" data-id="${customer.customerId}">編輯</button>`;
      }
      if (canVoidCustomer(currentUser)) {
        actionsHtml += `<button class="btn-danger btn-void-customer" data-id="${customer.customerId}">作廢</button>`;
      }
    }

    return `
      <tr>
        <td><strong>${customer.customerId}</strong></td>
        <td>${customer.name}</td>
        <td class="text-truncate">${customer.email}</td>
        <td><span class="badge badge-viewer">${ownerName}</span></td>
        <td><div class="status-wrapper"><span class="badge ${badgeClass}">${customer.status}</span></div></td>
        <td><small style="color:#6B7280">${formatDate(customer.createdAt)}</small></td>
        <td><small style="color:#6B7280">${formatDate(customer.updatedAt)}</small></td>
        ${showActions ? `<td class="actions-cell"><div class="actions-wrapper">${actionsHtml || '<span>—</span>'}</div></td>` : ''}
      </tr>
    `;
  }).join('');

  // 渲染分頁元件
  createPaginator(total, PAGE_SIZE, customersPage, (newPage) => {
    customersPage = newPage;
    renderCustomersTable();
  }, 'customersPaginator');

  tbody.querySelectorAll('.btn-edit-customer').forEach(btn => {
    btn.addEventListener('click', () => openCustomerModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-void-customer').forEach(btn => {
    btn.addEventListener('click', async () => {
      await voidCustomer(btn.dataset.id);
    });
  });
}

function openCustomerModal(customerId = null) {
  if (!canCreateCustomer(currentUser)) { showNotification('無權限操作', 'error'); return; }

  const modal = document.getElementById('customerModal');
  const title = document.getElementById('customerModalTitle');
  const idInput = document.getElementById('customerId');
  const nameInput = document.getElementById('customerName');
  const emailInput = document.getElementById('customerEmail');

  if (customerId) {
    const customers = getCustomers();
    const customer = customers.find(c => c.customerId === customerId);
    if (!customer) return;
    if (!canEditCustomer(currentUser, customer)) { showNotification('您只能編輯自己的客戶', 'error'); return; }

    title.textContent = '編輯客戶';
    idInput.value = customer.customerId;
    nameInput.value = customer.name;
    emailInput.value = customer.email;
  } else {
    title.textContent = '新增客戶';
    idInput.value = '';
    nameInput.value = '';
    emailInput.value = '';
  }

  modal.classList.add('active');
}

function closeCustomerModal() {
  document.getElementById('customerModal').classList.remove('active');
}

function saveCustomer() {
  if (!canCreateCustomer(currentUser)) { showNotification('無權限操作', 'error'); return; }

  const id = document.getElementById('customerId').value;
  const name = document.getElementById('customerName').value.trim();
  const email = document.getElementById('customerEmail').value.trim();

  if (!name || !email) { showNotification('請填寫完整資訊', 'warning'); return; }

  const allCustomers = getCustomers();
  const now = new Date().toISOString();

  if (id) {
    const customer = allCustomers.find(c => c.customerId === id);
    if (!customer) return;
    if (!canEditCustomer(currentUser, customer)) { showNotification('無權限修改此客戶', 'error'); return; }

    customer.name = name;
    customer.email = email;
    customer.updatedAt = now;

    saveCustomers(allCustomers);
    addLog('UPDATE_CUSTOMER', id, currentUser);
  } else {
    const newId = 'C' + String(Date.now()).slice(-4);
    allCustomers.push({
      customerId: newId, name, email,
      status: 'active',
      ownerId: currentUser.employeeId,
      createdAt: now, updatedAt: null
    });

    saveCustomers(allCustomers);
    addLog('CREATE_CUSTOMER', newId, currentUser);
  }

  closeCustomerModal();
  renderCustomersTable();
}

async function voidCustomer(id) {
  if (!canVoidCustomer(currentUser)) { showNotification('無權限操作：僅管理員可作廢客戶', 'error'); return; }

  const confirmed = await showConfirm('確定要作廢此客戶嗎？作廢後狀態將轉為 inactive。', '作廢客戶確認');
  if (!confirmed) return;

  const allCustomers = getCustomers();
  const customer = allCustomers.find(c => c.customerId === id);
  if (!customer) return;

  customer.status = 'inactive';
  customer.updatedAt = new Date().toISOString();

  saveCustomers(allCustomers);
  addLog('DEACTIVATE_CUSTOMER', id, currentUser);
  renderCustomersTable();
  showNotification('客戶已成功停用/作廢', 'success');
}

// ============================================================
// Users Management (Admin Only)
// ============================================================

function renderUsersTable() {
  if (!isAdmin(currentUser)) return;

  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  let users = getUsers();

  // 搜尋過濾
  if (userSearch.keyword) {
    const kw = userSearch.keyword.toLowerCase();
    users = users.filter(u => {
      const val = String(u[userSearch.field] || '');
      return val.toLowerCase().includes(kw);
    });
  }

  const total = users.length;
  const start = (usersPage - 1) * PAGE_SIZE;
  const pagedUsers = users.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pagedUsers.map(u => {
    const displayRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    const status = u.status || 'active';
    const badgeClass = status === 'active' ? 'badge-success' : 'badge-secondary';

    let roleBadgeClass = 'badge-viewer';
    if (u.role === 'admin') roleBadgeClass = 'badge-admin';
    else if (u.role === 'sales') roleBadgeClass = 'badge-sales';

    let actionsHtml = '';
    const isSelf = u.employeeId === currentUser.employeeId;

    if (status !== 'inactive') {
      if (!isSelf && canEditOtherUser(currentUser, u)) {
        actionsHtml += `<button class="btn-secondary btn-edit-user" data-id="${u.employeeId}">編輯</button>`;
      }
      if (!isSelf && canDeactivateUser(currentUser, u) && u.status !== 'inactive') {
        actionsHtml += `<button class="btn-danger btn-void-user" data-id="${u.employeeId}">停用</button>`;
      }
    }

    if (isSelf) {
      actionsHtml = '<span>—</span>';
    }

    return `
      <tr>
        <td><strong>${u.employeeId}</strong></td>
        <td>${u.name || '-'}</td>
        <td class="text-truncate">${u.email || '-'}</td>
        <td><span class="badge ${roleBadgeClass}">${displayRole}</span></td>
        <td><div class="status-wrapper"><span class="badge ${badgeClass}">${status}</span></div></td>
        <td class="actions-cell"><div class="actions-wrapper">${actionsHtml || '<span>—</span>'}</div></td>
      </tr>
    `;
  }).join('');

  createPaginator(total, PAGE_SIZE, usersPage, (newPage) => {
    usersPage = newPage;
    renderUsersTable();
  }, 'usersPaginator');

  tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => openUserModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-void-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deactivateUser(btn.dataset.id);
    });
  });
}

function openUserModal(employeeId = null) {
  if (!canEditUser(currentUser)) { showNotification('無權限', 'error'); return; }

  const modal = document.getElementById('userModal');
  const title = document.getElementById('userModalTitle');
  const idInput = document.getElementById('userEmployeeId');
  const nameInput = document.getElementById('userName');
  const emailInput = document.getElementById('userEmail');
  const roleSelect = document.getElementById('userRole');

  const users = getUsers();

  initDropdown('userRoleDropdown');

  if (employeeId) {
    // 編輯模式
    const u = users.find(x => x.employeeId === employeeId);
    if (!u) return;

    title.textContent = '編輯使用者';
    idInput.value = u.employeeId;
    idInput.dataset.mode = 'edit';
    nameInput.value = u.name || '';
    emailInput.value = u.email || '';
    emailInput.readOnly = false;
    emailInput.style.backgroundColor = '';
    setDropdownValue('userRoleDropdown', u.role);
  } else {
    // 新增模式
    const newEmployeeId = generateEmployeeId(users);

    title.textContent = '新增使用者';
    idInput.value = newEmployeeId;
    idInput.dataset.mode = 'create';
    nameInput.value = '';
    emailInput.value = `${newEmployeeId}@test.com`;
    emailInput.readOnly = true;
    emailInput.style.backgroundColor = '#F3F4F6';
    setDropdownValue('userRoleDropdown', 'viewer');
  }

  // Self-Edit 限制：不可改自己角色
  const roleDropdown = document.getElementById('userRoleDropdown');
  if (employeeId === currentUser.employeeId) {
    roleDropdown.classList.add('disabled');
    roleDropdown.style.pointerEvents = 'none';
    roleDropdown.style.opacity = '0.6';
  } else {
    roleDropdown.classList.remove('disabled');
    roleDropdown.style.pointerEvents = '';
    roleDropdown.style.opacity = '';
  }

  modal.classList.add('active');
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('active');
}

function saveUser() {
  if (!canEditUser(currentUser)) { showNotification('無權限操作', 'error'); return; }

  const idInput = document.getElementById('userEmployeeId');
  const employeeId = idInput.value.trim();
  const name = document.getElementById('userName').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const role = getDropdownValue('userRoleDropdown');
  const isEdit = idInput.dataset.mode === 'edit';

  if (!employeeId || !name || !email) { showNotification('請填寫必填資訊', 'warning'); return; }

  const users = getUsers();

  if (isEdit) {
    const index = users.findIndex(u => u.employeeId === employeeId);
    if (index > -1) {
      // Action-Level 保護：不允許透過 API 繞過 UI 限制
      const target = users[index];
      if (!canEditOtherUser(currentUser, target)) {
        showNotification('無法編輯自己的資料', 'error');
        return;
      }

      // 角色變更保護：不可改自己角色 + 最後 admin 保護
      const roleCheck = canChangeRole(users, currentUser, target, role);
      if (!roleCheck.allowed) {
        showNotification(roleCheck.reason, 'error');
        return;
      }

      target.name = name;
      target.email = email;
      target.role = role;
      saveUsers(users);
      addLog('UPDATE_USER', employeeId, currentUser);
    }
  } else {
    if (users.some(u => u.employeeId === employeeId)) {
      showNotification('員工編號已存在', 'error');
      return;
    }
    users.push({
      employeeId, name, email,
      password: 'test123',
      role, status: 'active',
      mustChangePassword: true
    });
    saveUsers(users);
    addLog('CREATE_USER', employeeId, currentUser);
    showNotification(`使用者 ${name} 已成功建立！預設密碼為：test123`, 'success', 8000);
  }

  closeUserModal();
  renderUsersTable();
}

async function deactivateUser(targetEmployeeId) {
  const users = getUsers();
  const target = users.find(u => u.employeeId === targetEmployeeId);
  if (!target) return;

  if (!canDeactivateUser(currentUser, target)) {
    showNotification('無法停用此使用者', 'error');
    return;
  }

  // 最後 admin 保護
  if (target.role === 'admin' && !validateLastAdmin(users)) {
    showNotification('系統至少需保留一位管理員', 'error');
    return;
  }

  const confirmed = await showConfirm('確定要停用此使用者嗎？', '停用使用者確認');
  if (!confirmed) return;

  target.status = 'inactive';
  saveUsers(users);
  addLog('DEACTIVATE_USER', targetEmployeeId, currentUser);
  renderUsersTable();
  showNotification('使用者已成功停用', 'success');
}

// ============================================================
// Audit Logs (Admin Only)
// ============================================================

function renderAuditLogsTable() {
  if (!isAdmin(currentUser)) return;

  const tbody = document.getElementById('auditLogsTableBody');
  if (!tbody) return;

  let logs = getLogs();

  // 搜尋過濾
  if (auditSearch.keyword) {
    const kw = auditSearch.keyword.toLowerCase();
    logs = logs.filter(log => {
      const val = String(log[auditSearch.field] || '');
      return val.toLowerCase().includes(kw);
    });
  }

  // 日期篩選
  if (auditSearch.dateFrom || auditSearch.dateTo) {
    logs = logs.filter(log => {
      const logDate = log.timestamp.split('T')[0];
      if (auditSearch.dateFrom && logDate < auditSearch.dateFrom) return false;
      if (auditSearch.dateTo && logDate > auditSearch.dateTo) return false;
      return true;
    });
  }

  // 依時間降冪排序
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const total = logs.length;
  const start = (logsPage - 1) * PAGE_SIZE;
  const pagedLogs = logs.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pagedLogs.map(log => {
    // 目標一：直接顯示 userId
    const logUserName = log.userId;

    return `
      <tr>
        <td><small style="color:#6B7280">${log.id}</small></td>
        <td><strong>${log.action}</strong></td>
        <td><span class="badge badge-viewer">${logUserName}</span></td>
        <td class="text-truncate">${log.target}</td>
        <td><small style="color:#6B7280">${formatDate(log.timestamp)}</small></td>
      </tr>
    `;
  }).join('');

  createPaginator(total, PAGE_SIZE, logsPage, (newPage) => {
    logsPage = newPage;
    renderAuditLogsTable();
  }, 'auditLogsPaginator');
}

// ============================================================
// 事件綁定（全域）
// ============================================================

function bindEvents() {
  // 登出
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    clearCurrentUser();
    window.location.href = 'index.html';
  });

  // 手機版選單
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  const toggleSidebar = (show) => {
    if (show) {
      sidebar?.classList.add('mobile-active');
      overlay?.classList.add('active');
    } else {
      sidebar?.classList.remove('mobile-active');
      overlay?.classList.remove('active');
    }
  };

  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    const isActive = sidebar?.classList.contains('mobile-active');
    toggleSidebar(!isActive);
  });

  // 點擊遮罩關閉側邊欄
  overlay?.addEventListener('click', () => {
    toggleSidebar(false);
  });

  // 點擊選單項目後自動收起手機版側邊欄
  document.querySelectorAll('.menu-item').forEach(el => {
    el.addEventListener('click', () => {
      toggleSidebar(false);
    });
  });

  initDropdown('orderFieldDropdown', (val) => {
    orderSearch.field = val;
    ordersPage = 1;
    renderOrdersTable();
  });

  // 針對 Sales/Viewer 隱藏 ownerName 搜尋選項
  if (currentUser.role !== 'admin') {
    const orderOwnerItem = document.querySelector('#orderFieldDropdown .dropdown-item[data-value="ownerName"]');
    const customerOwnerItem = document.querySelector('#customerFieldDropdown .dropdown-item[data-value="ownerName"]');
    if (orderOwnerItem) orderOwnerItem.remove();
    if (customerOwnerItem) customerOwnerItem.remove();
  }

  initDropdown('customerFieldDropdown', (val) => {
    customerSearch.field = val;
    customersPage = 1;
    renderCustomersTable();
  });
  initDropdown('auditFieldDropdown', (val) => {
    auditSearch.field = val;
    logsPage = 1;
    renderAuditLogsTable();
  });

  // 搜尋事件：訂單管理
  document.getElementById('orderSearchKeyword')?.addEventListener('input', (e) => {
    orderSearch.keyword = e.target.value;
    ordersPage = 1;
    renderOrdersTable();
  });
  document.getElementById('orderDateFrom')?.addEventListener('change', (e) => {
    orderSearch.dateFrom = e.target.value;
    ordersPage = 1;
    renderOrdersTable();
  });
  document.getElementById('orderDateTo')?.addEventListener('change', (e) => {
    orderSearch.dateTo = e.target.value;
    ordersPage = 1;
    renderOrdersTable();
  });
  document.getElementById('orderDateReset')?.addEventListener('click', () => {
    orderSearch.dateFrom = '';
    orderSearch.dateTo = '';
    const from = document.getElementById('orderDateFrom');
    const to = document.getElementById('orderDateTo');
    if (from) from.value = '';
    if (to) to.value = '';
    ordersPage = 1;
    renderOrdersTable();
  });

  // 搜尋事件：客戶管理
  document.getElementById('customerSearchKeyword')?.addEventListener('input', (e) => {
    customerSearch.keyword = e.target.value;
    customersPage = 1;
    renderCustomersTable();
  });

  // 搜尋事件：操作紀錄
  document.getElementById('auditSearchKeyword')?.addEventListener('input', (e) => {
    auditSearch.keyword = e.target.value;
    logsPage = 1;
    renderAuditLogsTable();
  });
  document.getElementById('auditDateFrom')?.addEventListener('change', (e) => {
    auditSearch.dateFrom = e.target.value;
    logsPage = 1;
    renderAuditLogsTable();
  });
  document.getElementById('auditDateTo')?.addEventListener('change', (e) => {
    auditSearch.dateTo = e.target.value;
    logsPage = 1;
    renderAuditLogsTable();
  });
  document.getElementById('auditDateReset')?.addEventListener('click', () => {
    auditSearch.dateFrom = '';
    auditSearch.dateTo = '';
    const from = document.getElementById('auditDateFrom');
    const to = document.getElementById('auditDateTo');
    if (from) from.value = '';
    if (to) to.value = '';
    logsPage = 1;
    renderAuditLogsTable();
  });

  // 搜尋事件：使用者管理
  initDropdown('userFieldDropdown', (val) => {
    userSearch.field = val;
    usersPage = 1;
    renderUsersTable();
  });
  document.getElementById('userSearchKeyword')?.addEventListener('input', (e) => {
    userSearch.keyword = e.target.value;
    usersPage = 1;
    renderUsersTable();
  });

  // Order Modal 按鈕
  document.getElementById('addOrderBtn')?.addEventListener('click', () => openOrderModal());
  document.querySelector('#orderModal .btn-close')?.addEventListener('click', closeOrderModal);
  document.querySelector('#orderModal .btn-secondary')?.addEventListener('click', closeOrderModal);
  document.querySelector('#orderModal .btn-primary')?.addEventListener('click', saveOrder);

  // Customer Modal 按鈕
  document.getElementById('addCustomerBtn')?.addEventListener('click', () => openCustomerModal());
  document.querySelector('#customerModal .btn-close')?.addEventListener('click', closeCustomerModal);
  document.querySelector('#customerModal .btn-secondary')?.addEventListener('click', closeCustomerModal);
  document.querySelector('#customerModal .btn-primary')?.addEventListener('click', saveCustomer);

  // User Modal 按鈕
  document.getElementById('addUserBtn')?.addEventListener('click', () => openUserModal());
  document.querySelector('#userModal .btn-close')?.addEventListener('click', closeUserModal);
  document.querySelector('#userModal .btn-secondary')?.addEventListener('click', closeUserModal);
  document.querySelector('#userModal .btn-primary')?.addEventListener('click', saveUser);
}

// ============================================================
// Account Settings
// ============================================================

function renderAccountSettings() {
  const form = document.getElementById('accountSettingsForm');
  if (!form) return;

  const emailInput = document.getElementById('accEmail');
  const nameInput = document.getElementById('accName');
  const idInput = document.getElementById('accEmployeeId');

  // 資料初始化 (Data Infilling)
  idInput.value = currentUser.employeeId;
  nameInput.value = currentUser.name || '';
  emailInput.value = currentUser.email || '';

  // 權限欄位控制 (Role-Based Field Control)
  const emailWrapper = document.getElementById('accEmailWrapper');
  const emailLock = document.getElementById('accEmailLock');

  if (isAdmin(currentUser)) {
    // Admin: 三個欄位皆唯讀
    emailInput.readOnly = true;
    emailWrapper.classList.add('readonly-input-wrapper'); // 確保有灰色背景
    emailLock.style.display = 'block';
  } else {
    // Sales / Viewer: 僅 ID, Name 唯讀，Email 可編輯
    emailInput.readOnly = false;
    emailWrapper.classList.remove('readonly-input-wrapper'); // 移除灰色背景
    emailLock.style.display = 'none';
  }

  form.onsubmit = async (e) => {
    e.preventDefault();

    const newEmail = emailInput.value.trim();
    const currentPwd = document.getElementById('accCurrentPassword').value;
    const newPwd = document.getElementById('accNewPassword').value;
    const confirmPwd = document.getElementById('accConfirmPassword').value;

    if (!newEmail) {
      showNotification('Email 不可為空', 'warning');
      return;
    }

    const users = getUsers();
    const userIndex = users.findIndex(u => u.employeeId === currentUser.employeeId);
    if (userIndex === -1) return;

    let isProfileUpdated = false;
    let isPasswordUpdated = false;

    // 1. 檢查基本資料是否有變動
    if (newEmail !== currentUser.email) {
      users[userIndex].email = newEmail;
      currentUser.email = newEmail;
      isProfileUpdated = true;
    }

    // 2. 檢查密碼更新邏輯 (若有填寫新密碼)
    if (newPwd || confirmPwd || currentPwd) {
      if (!currentPwd) {
        showNotification('請輸入目前密碼以進行驗證', 'warning');
        return;
      }
      if (users[userIndex].password !== currentPwd) {
        showNotification('目前密碼錯誤', 'error');
        return;
      }
      if (newPwd !== confirmPwd) {
        showNotification('兩次輸入的新密碼不一致', 'error');
        return;
      }
      if (newPwd.length < 6) {
        showNotification('新密碼長度至少需 6 個字元', 'error');
        return;
      }

      users[userIndex].password = newPwd;
      users[userIndex].mustChangePassword = false;
      isPasswordUpdated = true;
    }

    if (!isProfileUpdated && !isPasswordUpdated) {
      showNotification('資料無變動', 'info');
      return;
    }

    // 儲存變更
    saveUsers(users);
    setCurrentUser(currentUser);

    // 紀錄日誌
    if (isProfileUpdated) addLog('UPDATE_PROFILE', currentUser.employeeId, currentUser);
    if (isPasswordUpdated) addLog('CHANGE_PASSWORD', currentUser.employeeId, currentUser);

    // 同步 UI
    updateHeaderUI();
    form.reset();
    
    // 重新填入基本資料 (因為 reset 會清空)
    idInput.value = currentUser.employeeId;
    nameInput.value = currentUser.name || '';
    emailInput.value = currentUser.email || '';

    showNotification('帳戶設定已成功更新', 'success');
  };
}
