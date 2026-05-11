// dashboard.js — API 驅動版本 (重構 V2)
import { getCurrentUser, logout } from './auth.js';
import { isAdmin, canCreateOrder, canCreateCustomer, canEditOrder, canVoidOrder, canCompleteOrder, canEditCustomer, canVoidCustomer, canEditOtherUser, canDeactivateUser } from './rbac.js';
import { getOrders, saveOrder as saveOrderApi, updateOrder, updateOrderStatus, getCustomers, saveCustomer as saveCustomerApi, updateCustomer, getProducts, getUsers, saveUser, updateUser, getLogs } from './data.js';
import { formatDate, generateEmployeeId, initDropdown, setDropdownValue, getDropdownValue, showNotification, showConfirm } from './utils.js';

// ── 全域快取 ──
let cachedOrders = [], cachedCustomers = [], cachedProducts = [], cachedUsers = [], cachedLogs = [];
const PAGE_SIZE = 10;
let ordersPage = 1, customersPage = 1, usersPage = 1, logsPage = 1;
let orderSearch = { keyword: '', field: 'id', dateFrom: '', dateTo: '' };
let customerSearch = { keyword: '', field: 'name' };
let userSearch = { keyword: '', field: 'employeeId' };
let auditSearch = { keyword: '', field: 'action', dateFrom: '', dateTo: '' };
const currentUser = getCurrentUser();

function f(id) { return document.getElementById(id); }
function getF(o, ...keys) { for (const k of keys) { if (o[k] !== undefined && o[k] !== null) return o[k]; } return ''; }

// ── 初始化 ──
function initDashboard() {
  if (!currentUser) return (window.location.href = 'index.html');
  renderSidebarMenu();
  updateHeaderUI();
  bindEvents();
  loadDashboardData();
  try {
    const p = sessionStorage.getItem('pendingNotification');
    if (p) { const n = JSON.parse(p); showNotification(n.message, n.type); sessionStorage.removeItem('pendingNotification'); }
  } catch (e) { }
}

function updateHeaderUI() {
  const idEl = f('displayEmployeeId'), badgeEl = f('roleBadgeContainer'), welcomeEl = f('welcomeUserName');
  if (idEl) idEl.textContent = currentUser.employeeId || currentUser.employee_id || 'Unknown';
  if (welcomeEl) welcomeEl.textContent = currentUser.name || currentUser.employeeId || currentUser.employee_id || '使用者';

  if (badgeEl) {
    const role = (currentUser.role || 'viewer').toLowerCase();
    badgeEl.innerHTML = '<span class=\"badge badge-' + role + '\">' + role.toUpperCase() + '</span>';
  }
}

function renderSidebarMenu() {
  const menuEl = f('sidebarMenu');
  if (!menuEl) return;

  const items = [
    { id: 'dashboard', label: '儀表板', icon: '📊', roles: ['admin', 'sales', 'viewer'] },
    { id: 'orders', label: '訂單管理', icon: '🛍️', roles: ['admin', 'sales', 'viewer'] },
    { id: 'customers', label: '客戶管理', icon: '👥', roles: ['admin', 'sales', 'viewer'] },
    { id: 'users', label: '使用者管理', icon: '👤', roles: ['admin'] },
    { id: 'auditlogs', label: '操作紀錄', icon: '📜', roles: ['admin'] },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️', roles: ['admin', 'sales', 'viewer'] }
  ];

  const role = (currentUser.role || 'viewer').toLowerCase();
  menuEl.innerHTML = items
    .filter(item => item.roles.includes(role))
    .map(item => '      <li class=\"menu-item\" data-section=\"' + item.id + '\">        <span class=\"icon\">' + item.icon + '</span> ' + item.label + '      </li>    ').join('');

  menuEl.querySelectorAll('.menu-item').forEach(el => {
    el.addEventListener('click', () => {
      const s = el.dataset.section;
      window.location.hash = s;
      navigateTo(s);
      f('sidebar')?.classList.remove('mobile-active');
      f('sidebarOverlay')?.classList.remove('active');
    });
  });
}

// ── 資料載入 ──
async function loadDashboardData() {
  try {
    document.body.classList.add('is-loading');
    const [orders, customers, products] = await Promise.all([getOrders(), getCustomers(), getProducts()]);
    cachedOrders = Array.isArray(orders) ? orders : [];
    cachedCustomers = Array.isArray(customers) ? customers : [];
    cachedProducts = Array.isArray(products) ? products : [];
    if (isAdmin(currentUser)) {
      const [users, logs] = await Promise.all([getUsers(), getLogs()]);
      cachedUsers = Array.isArray(users) ? users : [];
      cachedLogs = Array.isArray(logs) ? logs : [];
    }
    navigateTo(window.location.hash.replace('#', '') || 'dashboard');
  } catch (e) {
    console.error('loadDashboardData:', e);
    showNotification('資料載入失敗：' + e.message, 'error');
  } finally {
    document.body.classList.remove('is-loading');
  }
}

// ── 導覽 ──
function navigateTo(section) {
  document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + section)?.classList.add('active');
  document.querySelectorAll('.menu-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));

  const titles = { dashboard: '儀表板', orders: '訂單管理', customers: '客戶管理', users: '使用者管理', auditlogs: '操作紀錄', 'change-password': '帳戶設定' };
  const titleEl = f('currentPageTitle');
  if (titleEl && titles[section]) titleEl.textContent = titles[section];

  // 權限控制：顯示/隱藏新增按鈕
  if (section === 'orders') {
    const btn = f('addOrderBtn');
    if (btn) btn.style.display = canCreateOrder(currentUser) ? 'block' : 'none';
  } else if (section === 'customers') {
    const btn = f('addCustomerBtn');
    if (btn) btn.style.display = canCreateCustomer(currentUser) ? 'block' : 'none';
  } else if (section === 'users') {
    const btn = f('addUserBtn');
    if (btn) btn.style.display = isAdmin(currentUser) ? 'block' : 'none';
  }

  const map = {
    dashboard: () => { updateOverviewStats(); renderOrdersList(); },
    orders: renderOrdersList,
    customers: renderCustomersList,
    users: renderUsersList,
    auditlogs: renderAuditLogsList,
    'change-password': renderAccountSettings
  };
  if (map[section]) map[section]();
}

function updateOverviewStats() {
  const vis = getVisibleOrders(currentUser);
  const set = (id, v) => { const el = f(id); if (el) el.textContent = v; };
  set('dbTotalOrders', vis.length);
  set('dbPendingOrders', vis.filter(o => o.status === '處理中').length);
  const completed = vis.filter(o => o.status === '已完成');
  set('dbTotalAmount', '$' + completed.reduce((s, o) => s + Number(o.amount || 0), 0).toLocaleString());
}

// ── 訂單 ──
function renderOrdersList() {
  const tbody = f('ordersTableBody');
  if (!tbody) return;
  let orders = getVisibleOrders(currentUser);

  const pendingCount = orders.filter(o => o.status === '處理中').length;
  const doneCount = orders.filter(o => o.status === '已完成').length;
  const voidCount = orders.filter(o => o.status === '已作廢').length;
  if (f('overviewTotal')) f('overviewTotal').textContent = orders.length;
  if (f('statPending')) f('statPending').textContent = pendingCount;
  if (f('statDone')) f('statDone').textContent = doneCount;
  if (f('statVoid')) f('statVoid').textContent = voidCount;
  const progress = orders.length > 0 ? Math.round((doneCount / (orders.length - voidCount || 1)) * 100) : 0;
  if (f('overviewProgressFill')) f('overviewProgressFill').style.width = progress + '%';
  if (f('overviewProgressLabel')) f('overviewProgressLabel').textContent = '完成率 ' + progress + '%';

  if (orderSearch.keyword) {
    const kw = orderSearch.keyword.toLowerCase();
    orders = orders.filter(o => {
      let v = orderSearch.field === 'ownerName'
        ? (cachedUsers.find(u => getF(u, 'employee_id', 'employeeId') === getF(o, 'owner_id', 'ownerId'))?.name || '')
        : String(getF(o, orderSearch.field, toSnake(orderSearch.field)));
      return v.toLowerCase().includes(kw);
    });
  }
  if (orderSearch.dateFrom || orderSearch.dateTo) {
    orders = orders.filter(o => {
      const d = getF(o, 'created_at', 'createdAt').split('T')[0];
      return !(orderSearch.dateFrom && d < orderSearch.dateFrom) && !(orderSearch.dateTo && d > orderSearch.dateTo);
    });
  }
  const paged = orders.slice((ordersPage - 1) * PAGE_SIZE, ordersPage * PAGE_SIZE);
  tbody.innerHTML = paged.map(o => {
    const sid = getF(o, 'id', 'order_id');
    const sc = o.status === '已完成' ? 'badge-success' : o.status === '處理中' ? 'badge-info' : 'badge-void';
    const prod = cachedProducts.find(p => getF(p, 'product_id', 'productId') === getF(o, 'product_id', 'productId'))?.name || getF(o, 'product_name') || '未知商品';
    const ownerId = getF(o, 'owner_id', 'ownerId');
    const own = cachedUsers.find(u => getF(u, 'employee_id', 'employeeId') === ownerId)?.name || ownerId;
    const fin = o.status === '已完成' || o.status === '已作廢';
    let btn = '';
    if (!fin) {
      if (canEditOrder(currentUser, { ownerId })) btn += '<button class=\"btn-sm btn-secondary btn-edit-order\" data-id=\"' + sid + '\">編輯</button>';
      if (canCompleteOrder(currentUser, { ownerId })) btn += '<button class=\"btn-sm btn-success btn-complete-order\" data-id=\"' + sid + '\">完成</button>';
      if (canVoidOrder(currentUser)) btn += '<button class=\"btn-sm btn-danger btn-void-order\" data-id=\"' + sid + '\">作廢</button>';
    }
    return '<tr><td><strong>' + sid + '</strong></td><td>' + getF(o, 'customer_name', 'customer') + '</td><td>' + prod + '</td><td style=\"text-align:right\">$' + Number(o.amount || 0).toLocaleString() + '</td><td><span class=\"badge ' + sc + '\">' + o.status + '</span></td><td>' + own + '</td><td class=\"actions-cell\">' + (btn || '—') + '</td></tr>';
  }).join('');

  tbody.querySelectorAll('.btn-edit-order').forEach(b => b.addEventListener('click', () => openOrderModal(b.dataset.id)));
  tbody.querySelectorAll('.btn-void-order').forEach(b => b.addEventListener('click', () => voidOrder(b.dataset.id)));
  tbody.querySelectorAll('.btn-complete-order').forEach(b => b.addEventListener('click', () => completeOrder(b.dataset.id)));
  createPaginator(orders.length, PAGE_SIZE, ordersPage, p => { ordersPage = p; renderOrdersList(); }, 'ordersPaginator');
}

function openOrderModal(id = null) {
  const modal = f('orderModal'); if (!modal) return;
  const amEl = f('orderAmount');
  const custMenu = f('orderCustomerMenu');
  const prodMenu = f('orderProductMenu');
  if (custMenu) custMenu.innerHTML = cachedCustomers.filter(c => c.status === 'active').map(c => '<li class=\"dropdown-item\" data-value=\"' + (c.name || c.customer_name) + '\">' + (c.name || c.customer_name) + '</li>').join('');
  if (prodMenu) prodMenu.innerHTML = cachedProducts.map(p => '<li class=\"dropdown-item\" data-value=\"' + getF(p, 'product_id', 'productId') + '\">' + p.name + ' - $' + p.price + '</li>').join('');

  initDropdown('orderCustomerDropdown');
  initDropdown('orderProductDropdown', v => { const p = cachedProducts.find(x => getF(x, 'product_id', 'productId') === v); if (p && amEl) amEl.value = p.price; });

  const titleEl = f('modalTitle'), idEl = f('orderId');
  if (id) {
    const o = cachedOrders.find(x => getF(x, 'id', 'order_id') === id); if (!o) return;
    if (titleEl) titleEl.textContent = '編輯訂單'; if (idEl) idEl.value = id;
    setDropdownValue('orderCustomerDropdown', getF(o, 'customer_name', 'customer'));
    setDropdownValue('orderProductDropdown', getF(o, 'product_id', 'productId'));
    if (amEl) amEl.value = o.amount;
  } else {
    if (titleEl) titleEl.textContent = '新增訂單'; if (idEl) idEl.value = '';
    setDropdownValue('orderCustomerDropdown', ''); setDropdownValue('orderProductDropdown', '');
    if (amEl) amEl.value = '';
  }
  modal.classList.add('active');
}

async function saveOrder() {
  const id = f('orderId')?.value;
  const customer = getDropdownValue('orderCustomerDropdown');
  const productId = getDropdownValue('orderProductDropdown');
  const amount = Number(f('orderAmount')?.value);
  if (!customer || !productId || !amount) return showNotification('請完整填寫資訊', 'warning');
  try {
    if (id) await updateOrder(id, { customer_name: customer, product_id: productId, amount });
    else await saveOrderApi({ customer_name: customer, product_id: productId, amount });
    f('orderModal')?.classList.remove('active');
    showNotification(id ? '訂單更新成功' : '訂單建立成功', 'success');
    await loadDashboardData();
  } catch (e) { showNotification('儲存失敗：' + e.message, 'error'); }
}

async function voidOrder(id) {
  if (!canVoidOrder(currentUser)) return showNotification('無權限', 'error');
  if (!await showConfirm('確定要作廢此訂單嗎？')) return;
  try { await updateOrderStatus(id, '已作廢'); showNotification('訂單已作廢', 'success'); await loadDashboardData(); }
  catch (e) { showNotification('操作失敗：' + e.message, 'error'); }
}

async function completeOrder(id) {
  if (!await showConfirm('確定要完成此訂單嗎？')) return;
  try { await updateOrderStatus(id, '已完成'); showNotification('訂單已完成', 'success'); await loadDashboardData(); }
  catch (e) { showNotification('操作失敗：' + e.message, 'error'); }
}

// ── 客戶 ──
function renderCustomersList() {
  const tbody = f('customersTableBody'); if (!tbody) return;
  let custs = getVisibleCustomers(currentUser);
  if (customerSearch.keyword) {
    const kw = customerSearch.keyword.toLowerCase();
    custs = custs.filter(c => String(getF(c, customerSearch.field, toSnake(customerSearch.field))).toLowerCase().includes(kw));
  }
  const paged = custs.slice((customersPage - 1) * PAGE_SIZE, customersPage * PAGE_SIZE);
  tbody.innerHTML = paged.map(c => {
    const cid = getF(c, 'customer_id', 'customerId');
    const bc = c.status === 'active' ? 'badge-success' : 'badge-secondary';
    const oid = getF(c, 'owner_id', 'ownerId');
    const own = cachedUsers.find(u => getF(u, 'employee_id', 'employeeId') === oid)?.name || oid;
    let btn = '';
    if (canEditCustomer(currentUser, { ownerId: oid })) btn += '<button class=\"btn-sm btn-secondary btn-edit-customer\" data-id=\"' + cid + '\">編輯</button>';
    if (canVoidCustomer(currentUser) && c.status === 'active') btn += '<button class=\"btn-sm btn-danger btn-void-customer\" data-id=\"' + cid + '\">停用</button>';
    return '<tr><td><strong>' + cid + '</strong></td><td>' + (c.name || '') + '</td><td>' + (c.email || '') + '</td><td>' + own + '</td><td><span class=\"badge ' + bc + '\">' + c.status + '</span></td><td>' + formatDate(c.created_at) + '</td><td>' + formatDate(c.updated_at) + '</td><td class=\"actions-cell\">' + (btn || '—') + '</td></tr>';
  }).join('');
  tbody.querySelectorAll('.btn-edit-customer').forEach(b => b.addEventListener('click', () => openCustomerModal(b.dataset.id)));
  tbody.querySelectorAll('.btn-void-customer').forEach(b => b.addEventListener('click', () => voidCustomer(b.dataset.id)));
  createPaginator(custs.length, PAGE_SIZE, customersPage, p => { customersPage = p; renderCustomersList(); }, 'customersPaginator');
}

function openCustomerModal(id = null) {
  const modal = f('customerModal'); if (!modal) return;
  const idEl = f('customerId'), nameEl = f('customerName'), emailEl = f('customerEmail');
  const titleEl = f('customerModalTitle');
  if (id) {
    const c = cachedCustomers.find(x => getF(x, 'customer_id', 'customerId') === id); if (!c) return;
    if (titleEl) titleEl.textContent = '編輯客戶'; if (idEl) idEl.value = id;
    if (nameEl) nameEl.value = c.name || ''; if (emailEl) emailEl.value = c.email || '';
  } else {
    if (titleEl) titleEl.textContent = '新增客戶'; if (idEl) idEl.value = '';
    if (nameEl) nameEl.value = ''; if (emailEl) emailEl.value = '';
  }
  modal.classList.add('active');
}

async function saveCustomer() {
  const id = f('customerId')?.value;
  const name = f('customerName')?.value.trim();
  const email = f('customerEmail')?.value.trim();
  if (!name || !email) return showNotification('請填寫完整資訊', 'warning');
  try {
    if (id) await updateCustomer(id, { name, email });
    else await saveCustomerApi({ name, email });
    f('customerModal')?.classList.remove('active');
    showNotification(id ? '客戶更新成功' : '客戶建立成功', 'success');
    await loadDashboardData();
  } catch (e) { showNotification('儲存失敗：' + e.message, 'error'); }
}

async function voidCustomer(id) {
  if (!await showConfirm('確定要停用此客戶嗎？')) return;
  try { await updateCustomer(id, { status: 'inactive' }); showNotification('客戶已停用', 'success'); await loadDashboardData(); }
  catch (e) { showNotification('操作失敗：' + e.message, 'error'); }
}

// ── 使用者 ──
function renderUsersList() {
  if (!isAdmin(currentUser)) return;
  const tbody = f('usersTableBody'); if (!tbody) return;
  let users = cachedUsers;
  if (userSearch.keyword) {
    const kw = userSearch.keyword.toLowerCase();
    users = users.filter(u => String(getF(u, userSearch.field, toSnake(userSearch.field))).toLowerCase().includes(kw));
  }
  const paged = users.slice((usersPage - 1) * PAGE_SIZE, usersPage * PAGE_SIZE);
  tbody.innerHTML = paged.map(u => {
    const uid = getF(u, 'employee_id', 'employeeId');
    const isSelf = uid === (currentUser.employeeId || currentUser.employee_id);
    let btn = '';
    if (!isSelf && canEditOtherUser(currentUser, { employeeId: uid })) btn += '<button class=\"btn-sm btn-secondary btn-edit-user\" data-id=\"' + uid + '\">編輯</button>';
    return '<tr><td><strong>' + uid + '</strong>' + (isSelf ? ' <span class=\"badge badge-info\" style=\"font-size:10px\">您</span>' : '') + '</td><td>' + (u.name || '') + '</td><td>' + (u.email || '') + '</td><td><span class=\"badge badge-' + u.role + '\">' + (u.role || '').toUpperCase() + '</span></td><td><span class=\"badge ' + (u.status === 'active' ? 'badge-success' : 'badge-secondary') + '\">' + u.status + '</span></td><td class=\"actions-cell\">' + (btn || '—') + '</td></tr>';
  }).join('');
  tbody.querySelectorAll('.btn-edit-user').forEach(b => b.addEventListener('click', () => openUserModal(b.dataset.id)));
  createPaginator(users.length, PAGE_SIZE, usersPage, p => { usersPage = p; renderUsersList(); }, 'usersPaginator');
}

function openUserModal(id = null) {
  const modal = f('userModal'); if (!modal) return;
  const eidEl = f('userEmployeeId'), nameEl = f('userName'), emailEl = f('userEmail'), titleEl = f('userModalTitle');

  initDropdown('userRoleDropdown');
  initDropdown('userStatusDropdown');

  const statusGroup = f('userStatusGroup');

  if (id) {
    const u = cachedUsers.find(x => getF(x, 'employee_id', 'employeeId') === id); if (!u) return;
    if (titleEl) titleEl.textContent = '編輯使用者 (' + u.name + ')';
    if (eidEl) eidEl.value = id;
    if (nameEl) { nameEl.value = u.name; nameEl.readOnly = false; nameEl.style.backgroundColor = ''; }
    if (emailEl) { emailEl.value = u.email; emailEl.readOnly = false; emailEl.style.backgroundColor = ''; }
    setDropdownValue('userRoleDropdown', u.role);
    setDropdownValue('userStatusDropdown', u.status || 'active');
    if (statusGroup) statusGroup.style.display = 'block';
  } else {
    if (titleEl) titleEl.textContent = '新增使用者';
    const newId = generateEmployeeId();
    if (eidEl) eidEl.value = newId;
    if (nameEl) { nameEl.value = ''; nameEl.readOnly = false; nameEl.style.backgroundColor = ''; }
    if (emailEl) { emailEl.value = newId.toLowerCase() + '@example.com'; emailEl.readOnly = true; emailEl.style.backgroundColor = '#F3F4F6'; }
    setDropdownValue('userRoleDropdown', 'viewer');
    setDropdownValue('userStatusDropdown', 'active');
    if (statusGroup) statusGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

async function saveUserRole() {
  const eid = f('userEmployeeId')?.value;
  const name = f('userName')?.value.trim();
  const email = f('userEmail')?.value.trim();
  const role = getDropdownValue('userRoleDropdown');
  const status = getDropdownValue('userStatusDropdown');
  if (!eid || !role) return;

  const existingUser = cachedUsers.find(u => getF(u, 'employee_id', 'employeeId') === eid);
  const isEdit = !!existingUser;

  try {
    if (isEdit) {
      const userId = getF(existingUser, 'id');
      await updateUser(userId, { name, email, role, status });
      showNotification('資料更新成功', 'success');
    } else {
      if (!name) return showNotification('請輸入姓名', 'warning');
      await saveUser({ employee_id: eid, name, email, role, status: 'active', password: 'test1234' });
      showNotification('使用者建立成功，預設密碼為 test1234', 'success', 8000); // 延長顯示時間讓使用者看清楚
    }
    f('userModal')?.classList.remove('active');
    await loadDashboardData();
  } catch (e) { showNotification('儲存失敗：' + e.message, 'error'); }
}

// ── 稽核日誌 ──
function renderAuditLogsList() {
  if (!isAdmin(currentUser)) return;
  const tbody = f('auditLogsTableBody'); if (!tbody) return;
  let logs = cachedLogs;
  if (auditSearch.keyword) {
    const kw = auditSearch.keyword.toLowerCase();
    logs = logs.filter(l => String(getF(l, auditSearch.field, toSnake(auditSearch.field))).toLowerCase().includes(kw));
  }
  if (auditSearch.dateFrom || auditSearch.dateTo) {
    logs = logs.filter(l => {
      const d = getF(l, 'timestamp', 'created_at').split('T')[0];
      return !(auditSearch.dateFrom && d < auditSearch.dateFrom) && !(auditSearch.dateTo && d > auditSearch.dateTo);
    });
  }
  const paged = logs.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE);
  tbody.innerHTML = paged.map(l => {
    const action = getF(l, 'action', 'action_type');
    return '<tr><td>' + getF(l, 'id', 'log_id') + '</td><td><span class=\"badge\">' + action + '</span></td><td><strong>' + (getF(l, 'operator_name', 'operatorName', 'operator_id', 'operatorId') || '-') + '</strong></td><td>' + (getF(l, 'target_id', 'targetId') || '-') + '</td><td><small>' + formatDate(l.timestamp) + '</small></td></tr>';
  }).join('');
  createPaginator(logs.length, PAGE_SIZE, logsPage, p => { logsPage = p; renderAuditLogsList(); }, 'auditLogsPaginator');
}

// ── 帳戶設定 ──
function renderAccountSettings() {
  f('accEmployeeId').value = currentUser.employeeId || currentUser.employee_id || '';
  f('accName').value = currentUser.name || '-';
  f('accEmail').value = currentUser.email || '-';
}

// ── 分頁元件 ──
function createPaginator(total, size, curr, onChange, containerId) {
  const c = f(containerId); if (!c) return;
  const pc = Math.ceil(total / size);
  if (pc <= 1) { c.innerHTML = ''; return; }
  let h = '<button class=\"btn-pager\" ' + (curr === 1 ? 'disabled' : '') + ' data-page=\"' + (curr - 1) + '\">上一頁</button>';
  for (let i = 1; i <= pc; i++) {
    if (i === 1 || i === pc || Math.abs(i - curr) <= 1) h += '<button class=\"btn-pager ' + (i === curr ? 'active' : '') + '\" data-page=\"' + i + '\">' + i + '</button>';
    else if (Math.abs(i - curr) === 2) h += '<span class=\"pager-ellipsis\">…</span>';
  }
  h += '<button class=\"btn-pager\" ' + (curr === pc ? 'disabled' : '') + ' data-page=\"' + (curr + 1) + '\">下一頁</button>';
  c.innerHTML = h;
  c.querySelectorAll('.btn-pager:not([disabled])').forEach(b => b.addEventListener('click', () => onChange(Number(b.dataset.page))));
}

// ── 事件綁定 ──
function bindEvents() {
  f('logoutBtn')?.addEventListener('click', () => logout());
  f('mobileMenuBtn')?.addEventListener('click', () => {
    f('sidebar')?.classList.add('mobile-active');
    f('sidebarOverlay')?.classList.add('active');
  });
  f('sidebarOverlay')?.addEventListener('click', () => {
    f('sidebar')?.classList.remove('mobile-active');
    f('sidebarOverlay')?.classList.remove('active');
  });

  f('addOrderBtn')?.addEventListener('click', () => openOrderModal());
  f('saveOrderBtn')?.addEventListener('click', saveOrder);
  f('addCustomerBtn')?.addEventListener('click', () => openCustomerModal());
  f('addUserBtn')?.addEventListener('click', () => openUserModal());
  f('saveCustomerBtn')?.addEventListener('click', saveCustomer);
  f('saveUserRoleBtn')?.addEventListener('click', saveUserRole);
  f('cancelUserBtn')?.addEventListener('click', () => f('userModal')?.classList.remove('active'));
  f('cancelOrderBtn')?.addEventListener('click', () => f('orderModal')?.classList.remove('active'));
  f('cancelCustomerBtn')?.addEventListener('click', () => f('customerModal')?.classList.remove('active'));

  // 搜尋與下拉連動
  initDropdown('orderFieldDropdown', v => { orderSearch.field = v; renderOrdersList(); });
  f('orderSearchKeyword')?.addEventListener('input', e => { orderSearch.keyword = e.target.value; ordersPage = 1; renderOrdersList(); });
  initDropdown('customerFieldDropdown', v => { customerSearch.field = v; renderCustomersList(); });
  f('customerSearchKeyword')?.addEventListener('input', e => { customerSearch.keyword = e.target.value; customersPage = 1; renderCustomersList(); });
  initDropdown('userFieldDropdown', v => { userSearch.field = v; renderUsersList(); });
  f('userSearchKeyword')?.addEventListener('input', e => { userSearch.keyword = e.target.value; usersPage = 1; renderUsersList(); });
  initDropdown('auditFieldDropdown', v => { auditSearch.field = v; renderAuditLogsList(); });
  f('auditSearchKeyword')?.addEventListener('input', e => { auditSearch.keyword = e.target.value; logsPage = 1; renderAuditLogsList(); });

  // 日期重設
  f('orderDateReset')?.addEventListener('click', () => { f('orderDateFrom').value = ''; f('orderDateTo').value = ''; orderSearch.dateFrom = ''; orderSearch.dateTo = ''; renderOrdersList(); });
  f('auditDateReset')?.addEventListener('click', () => { f('auditDateFrom').value = ''; f('auditDateTo').value = ''; auditSearch.dateFrom = ''; auditSearch.dateTo = ''; renderAuditLogsList(); });

  // 模態框關閉按鈕
  document.querySelectorAll('.btn-close, .btn-secondary').forEach(b => {
    b.addEventListener('click', () => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')));
  });
}

// ── 可見性過濾 ──
function getVisibleOrders(u) {
  if (!u) return [];
  if (u.role === 'admin' || u.role === 'viewer') return cachedOrders;
  const uid = u.employeeId || u.employee_id;
  return cachedOrders.filter(o => getF(o, 'owner_id', 'ownerId') === uid);
}
function getVisibleCustomers(u) {
  if (!u) return [];
  if (u.role === 'admin' || u.role === 'viewer') return cachedCustomers;
  const uid = u.employeeId || u.employee_id;
  return cachedCustomers.filter(c => getF(c, 'owner_id', 'ownerId') === uid);
}
function toSnake(s) { return s.replace(/([A-Z])/g, m => '_' + m.toLowerCase()); }

// ── 全域暴露 ──
window.navigateTo = navigateTo;
window.openOrderModal = openOrderModal;
window.openCustomerModal = openCustomerModal;
window.openUserModal = openUserModal;

initDashboard();
export { loadDashboardData, navigateTo };
