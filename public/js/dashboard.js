// ============================================================
// dashboard.js — UI 渲染 + 事件綁定 + Flow 控制 (ES Module)
// ============================================================

import {
  canAccessMenu, getMenuItems, isAdmin,
  canEditOrder, canVoidOrder, canCreateOrder,
  canEditCustomer, canVoidCustomer, canCreateCustomer,
  canEditUser, canDeactivateUser, validateLastAdmin, canChangeRole
} from './rbac.js';

import {
  initData, getCurrentUser, clearCurrentUser,
  getOrders, getVisibleOrders, saveOrders,
  getCustomers, getVisibleCustomers, saveCustomers,
  getUsers, saveUsers,
  getLogs, defaultProducts
} from './data.js';

import { addLog } from './audit.js';
import { formatDate, generateEmployeeId } from './utils.js';

// ── 全域快取 ──
let currentUser = null;

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

  // 5. 預設載入 Dashboard
  navigateTo('dashboard');
});

// ============================================================
// UI 初始化
// ============================================================

function initUI() {
  // Topbar
  document.getElementById('displayEmployeeId').textContent = currentUser.name || currentUser.employeeId;
  document.getElementById('welcomeUserName').textContent = currentUser.name || currentUser.employeeId;

  // Role Badge
  const badgeContainer = document.getElementById('roleBadgeContainer');
  const displayRole = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  badgeContainer.innerHTML = `<span class="badge badge-${currentUser.role}">${displayRole}</span>`;

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
    if (target) target.classList.add('active');

    const items = getMenuItems(currentUser.role);
    const menuItem = items.find(i => i.id === sectionId);
    if (menuItem) document.getElementById('currentPageTitle').textContent = menuItem.label;

    loadSectionData(sectionId);
  } else {
    document.getElementById('section-unauthorized').classList.add('active');
    document.getElementById('currentPageTitle').textContent = '權限不足';
  }

  // Sidebar active
  document.querySelectorAll('.menu-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-target') === sectionId);
  });
}

function loadSectionData(sectionId) {
  switch (sectionId) {
    case 'orders':    renderOrdersTable();    break;
    case 'customers': renderCustomersTable(); break;
    case 'users':     if (isAdmin(currentUser)) renderUsersTable();     break;
    case 'auditlogs': if (isAdmin(currentUser)) renderAuditLogsTable(); break;
  }
}

// ============================================================
// Orders
// ============================================================

function renderOrdersTable() {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  const orders = getVisibleOrders(currentUser);
  const usersList = getUsers();

  tbody.innerHTML = orders.map(order => {
    let badgeClass = 'badge-secondary';
    if (order.status === '處理中') badgeClass = 'badge-info';
    if (order.status === '已完成') badgeClass = 'badge-success';

    const product = defaultProducts.find(p => p.productId === order.productId);
    const productName = product ? product.name : '-';
    const ownerUser = usersList.find(u => u.employeeId === order.ownerId);
    const ownerName = ownerUser ? ownerUser.name : order.ownerId;

    let actionsHtml = '';
    if (order.status !== '已作廢') {
      if (canEditOrder(currentUser, order)) {
        actionsHtml += `<button class="btn-secondary btn-edit-order" data-id="${order.id}">編輯</button>`;
      }
      if (canVoidOrder(currentUser)) {
        actionsHtml += `<button class="btn-danger btn-void-order" data-id="${order.id}">作廢</button>`;
      }
    }

    return `
      <tr>
        <td><strong>${order.id}</strong></td>
        <td>${order.customer}</td>
        <td>${productName}</td>
        <td>$${Number(order.amount).toLocaleString()}</td>
        <td><span class="badge ${badgeClass}">${order.status}</span></td>
        <td><span class="badge badge-viewer">${ownerName}</span></td>
        <td class="actions-cell">${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  // 動態事件綁定
  tbody.querySelectorAll('.btn-edit-order').forEach(btn => {
    btn.addEventListener('click', () => openOrderModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-void-order').forEach(btn => {
    btn.addEventListener('click', () => voidOrder(btn.dataset.id));
  });
}

function openOrderModal(orderId = null) {
  if (!canCreateOrder(currentUser)) { alert('無權限操作'); return; }

  const modal          = document.getElementById('orderModal');
  const title          = document.getElementById('modalTitle');
  const idInput        = document.getElementById('orderId');
  const customerInput  = document.getElementById('orderCustomer');
  const productSelect  = document.getElementById('orderProduct');
  const amountInput    = document.getElementById('orderAmount');

  // 填充商品選單
  productSelect.innerHTML = '<option value="">請選擇商品</option>' +
    defaultProducts.map(p => `<option value="${p.productId}">${p.name} - $${p.price}</option>`).join('');

  if (orderId) {
    const orders = getOrders();
    const order  = orders.find(o => o.id === orderId);
    if (!order) return;
    if (!canEditOrder(currentUser, order)) { alert('無權限編輯此訂單'); return; }

    title.textContent        = '編輯訂單';
    idInput.value            = order.id;
    customerInput.value      = order.customer;
    productSelect.value      = order.productId;
    amountInput.value        = order.amount;
  } else {
    title.textContent   = '新增訂單';
    idInput.value       = '';
    customerInput.value = '';
    productSelect.value = '';
    amountInput.value   = '';
  }

  modal.classList.add('active');
}

function closeOrderModal() {
  document.getElementById('orderModal').classList.remove('active');
}

function handleProductChange() {
  const productId = document.getElementById('orderProduct').value;
  const product = defaultProducts.find(p => p.productId === productId);
  if (product) document.getElementById('orderAmount').value = product.price;
}

function saveOrder() {
  if (!canCreateOrder(currentUser)) { alert('無權限操作'); return; }

  const id        = document.getElementById('orderId').value;
  const customer  = document.getElementById('orderCustomer').value.trim();
  const productId = document.getElementById('orderProduct').value;
  const amount    = document.getElementById('orderAmount').value;

  if (!customer || !productId || !amount) { alert('請填寫完整資訊'); return; }

  const allOrders = getOrders();
  const now = new Date().toISOString();

  if (id) {
    // 編輯
    const order = allOrders.find(o => o.id === id);
    if (!order) return;
    if (!canEditOrder(currentUser, order)) { alert('無權限修改此訂單'); return; }

    order.customer  = customer;
    order.productId = productId;
    order.amount    = Number(amount);
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

function voidOrder(id) {
  if (!canVoidOrder(currentUser)) { alert('無權限操作：僅管理員可作廢訂單'); return; }
  if (!confirm('確定要作廢此訂單嗎？作廢後將無法修改。')) return;

  const allOrders = getOrders();
  const order = allOrders.find(o => o.id === id);
  if (!order) return;

  order.status    = '已作廢';
  order.updatedAt = new Date().toISOString();

  saveOrders(allOrders);
  addLog('VOID_ORDER', id, currentUser);
  renderOrdersTable();
}

// ============================================================
// Customers
// ============================================================

function renderCustomersTable() {
  const tbody = document.getElementById('customersTableBody');
  if (!tbody) return;

  const customers = getVisibleCustomers(currentUser);
  const usersList = getUsers();

  tbody.innerHTML = customers.map(customer => {
    const badgeClass = customer.status === 'active' ? 'badge-success' : 'badge-secondary';
    const ownerUser  = usersList.find(u => u.employeeId === customer.ownerId);
    const ownerName  = ownerUser ? ownerUser.name : customer.ownerId;

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
        <td>${customer.email}</td>
        <td><span class="badge badge-viewer">${ownerName}</span></td>
        <td><span class="badge ${badgeClass}">${customer.status}</span></td>
        <td><small style="color:#6B7280">${formatDate(customer.createdAt)}</small></td>
        <td><small style="color:#6B7280">${formatDate(customer.updatedAt)}</small></td>
        <td class="actions-cell">${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-edit-customer').forEach(btn => {
    btn.addEventListener('click', () => openCustomerModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-void-customer').forEach(btn => {
    btn.addEventListener('click', () => voidCustomer(btn.dataset.id));
  });
}

function openCustomerModal(customerId = null) {
  if (!canCreateCustomer(currentUser)) { alert('無權限操作'); return; }

  const modal      = document.getElementById('customerModal');
  const title      = document.getElementById('customerModalTitle');
  const idInput    = document.getElementById('customerId');
  const nameInput  = document.getElementById('customerName');
  const emailInput = document.getElementById('customerEmail');

  if (customerId) {
    const customers = getCustomers();
    const customer  = customers.find(c => c.customerId === customerId);
    if (!customer) return;
    if (!canEditCustomer(currentUser, customer)) { alert('您只能編輯自己的客戶'); return; }

    title.textContent  = '編輯客戶';
    idInput.value      = customer.customerId;
    nameInput.value    = customer.name;
    emailInput.value   = customer.email;
  } else {
    title.textContent = '新增客戶';
    idInput.value     = '';
    nameInput.value   = '';
    emailInput.value  = '';
  }

  modal.classList.add('active');
}

function closeCustomerModal() {
  document.getElementById('customerModal').classList.remove('active');
}

function saveCustomer() {
  if (!canCreateCustomer(currentUser)) { alert('無權限操作'); return; }

  const id    = document.getElementById('customerId').value;
  const name  = document.getElementById('customerName').value.trim();
  const email = document.getElementById('customerEmail').value.trim();

  if (!name || !email) { alert('請填寫完整資訊'); return; }

  const allCustomers = getCustomers();
  const now = new Date().toISOString();

  if (id) {
    const customer = allCustomers.find(c => c.customerId === id);
    if (!customer) return;
    if (!canEditCustomer(currentUser, customer)) { alert('無權限修改此客戶'); return; }

    customer.name      = name;
    customer.email     = email;
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

function voidCustomer(id) {
  if (!canVoidCustomer(currentUser)) { alert('無權限操作：僅管理員可作廢客戶'); return; }
  if (!confirm('確定要作廢此客戶嗎？作廢後狀態將轉為 inactive。')) return;

  const allCustomers = getCustomers();
  const customer = allCustomers.find(c => c.customerId === id);
  if (!customer) return;

  customer.status    = 'inactive';
  customer.updatedAt = new Date().toISOString();

  saveCustomers(allCustomers);
  addLog('DEACTIVATE_CUSTOMER', id, currentUser);
  renderCustomersTable();
}

// ============================================================
// Users Management (Admin Only)
// ============================================================

function renderUsersTable() {
  if (!isAdmin(currentUser)) return;

  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  const users = getUsers();

  tbody.innerHTML = users.map(u => {
    const displayRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    const status = u.status || 'active';
    const badgeClass = status === 'active' ? 'badge-success' : 'badge-secondary';

    let roleBadgeClass = 'badge-viewer';
    if (u.role === 'admin') roleBadgeClass = 'badge-admin';
    else if (u.role === 'sales') roleBadgeClass = 'badge-sales';

    let actionsHtml = '';
    if (status !== 'inactive') {
      if (canEditUser(currentUser)) {
        actionsHtml += `<button class="btn-secondary btn-edit-user" data-id="${u.employeeId}">編輯</button>`;
      }
      if (canDeactivateUser(currentUser, u)) {
        actionsHtml += `<button class="btn-danger btn-void-user" data-id="${u.employeeId}">停用</button>`;
      }
    }

    return `
      <tr>
        <td><strong>${u.employeeId}</strong></td>
        <td>${u.name || '-'}</td>
        <td>${u.email || '-'}</td>
        <td><span class="badge ${roleBadgeClass}">${displayRole}</span></td>
        <td><span class="badge ${badgeClass}">${status}</span></td>
        <td class="actions-cell">${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => openUserModal(btn.dataset.id));
  });
  tbody.querySelectorAll('.btn-void-user').forEach(btn => {
    btn.addEventListener('click', () => deactivateUser(btn.dataset.id));
  });
}

function openUserModal(employeeId = null) {
  if (!canEditUser(currentUser)) { alert('無權限'); return; }

  const modal      = document.getElementById('userModal');
  const title      = document.getElementById('userModalTitle');
  const idInput    = document.getElementById('userEmployeeId');
  const nameInput  = document.getElementById('userName');
  const emailInput = document.getElementById('userEmail');
  const roleSelect = document.getElementById('userRole');

  const users = getUsers();

  if (employeeId) {
    // 編輯模式
    const u = users.find(x => x.employeeId === employeeId);
    if (!u) return;

    title.textContent     = '編輯使用者';
    idInput.value         = u.employeeId;
    idInput.dataset.mode  = 'edit';
    nameInput.value       = u.name;
    emailInput.value      = u.email;
    roleSelect.value      = u.role;
  } else {
    // 新增模式
    const newEmployeeId = generateEmployeeId(users);

    title.textContent     = '新增使用者';
    idInput.value         = newEmployeeId;
    idInput.dataset.mode  = 'create';
    nameInput.value       = '';
    emailInput.value      = `${newEmployeeId}@test.com`;
    roleSelect.value      = 'viewer';
  }

  modal.classList.add('active');
}

function closeUserModal() {
  document.getElementById('userModal').classList.remove('active');
}

function saveUser() {
  if (!canEditUser(currentUser)) { alert('無權限操作'); return; }

  const idInput    = document.getElementById('userEmployeeId');
  const employeeId = idInput.value.trim();
  const name       = document.getElementById('userName').value.trim();
  const email      = document.getElementById('userEmail').value.trim();
  const role       = document.getElementById('userRole').value;
  const isEdit     = idInput.dataset.mode === 'edit';

  if (!employeeId || !name || !email) { alert('請填寫必填資訊'); return; }

  const users = getUsers();

  if (isEdit) {
    const index = users.findIndex(u => u.employeeId === employeeId);
    if (index > -1) {
      // 角色變更保護：不可改自己角色 + 最後 admin 保護
      const roleCheck = canChangeRole(users, currentUser, users[index], role);
      if (!roleCheck.allowed) {
        alert(roleCheck.reason);
        return;
      }

      users[index].name = name;
      users[index].email = email;
      users[index].role = role;
      saveUsers(users);
      addLog('UPDATE_USER', employeeId, currentUser);
    }
  } else {
    if (users.some(u => u.employeeId === employeeId)) {
      alert('員工編號已存在');
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
  }

  closeUserModal();
  renderUsersTable();
}

function deactivateUser(targetEmployeeId) {
  const users  = getUsers();
  const target = users.find(u => u.employeeId === targetEmployeeId);
  if (!target) return;

  if (!canDeactivateUser(currentUser, target)) {
    alert('無法停用此使用者');
    return;
  }

  // 最後 admin 保護
  if (target.role === 'admin' && !validateLastAdmin(users)) {
    alert('系統至少需保留一位管理員');
    return;
  }

  if (!confirm('確定要停用此使用者嗎？')) return;

  target.status = 'inactive';
  saveUsers(users);
  addLog('DEACTIVATE_USER', targetEmployeeId, currentUser);
  renderUsersTable();
}

// ============================================================
// Audit Logs (Admin Only)
// ============================================================

function renderAuditLogsTable() {
  if (!isAdmin(currentUser)) return;

  const tbody = document.getElementById('auditLogsTableBody');
  if (!tbody) return;

  const logs      = getLogs();
  const usersList = getUsers();

  // 依時間降冪排序
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  tbody.innerHTML = logs.map(log => {
    const logUser     = usersList.find(u => u.employeeId === log.userId);
    const logUserName = logUser ? logUser.name : log.userId;

    return `
      <tr>
        <td><small style="color:#6B7280">${log.id}</small></td>
        <td><strong>${log.action}</strong></td>
        <td><span class="badge badge-viewer">${logUserName}</span></td>
        <td>${log.target}</td>
        <td><small style="color:#6B7280">${formatDate(log.timestamp)}</small></td>
      </tr>
    `;
  }).join('');
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

  // Order Modal 按鈕
  document.getElementById('addOrderBtn')?.addEventListener('click', () => openOrderModal());
  document.querySelector('#orderModal .btn-close')?.addEventListener('click', closeOrderModal);
  document.querySelector('#orderModal .btn-secondary')?.addEventListener('click', closeOrderModal);
  document.querySelector('#orderModal .btn-primary')?.addEventListener('click', saveOrder);
  document.getElementById('orderProduct')?.addEventListener('change', handleProductChange);

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
