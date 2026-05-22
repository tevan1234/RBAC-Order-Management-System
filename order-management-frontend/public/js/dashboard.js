// dashboard.js — API 驅動版本 (重構 V2)
import { getCurrentUser, logout, updateCurrentUser } from './auth.js';
import { isAdmin, canCreateOrder, canCreateCustomer, canEditOrder, canVoidOrder, canCompleteOrder, canEditCustomer, canVoidCustomer, canEditOtherUser, canDeactivateUser, getMenuItems, canCreateProduct, canEditProduct } from './rbac.js';
import { getOrders, saveOrder as saveOrderApi, updateOrder, updateOrderStatus, getCustomers, saveCustomer as saveCustomerApi, updateCustomer, getProducts, saveProduct as saveProductApi, updateProduct, getUsers, saveUser, updateUser, getLogs } from './data.js';
import { formatDate, formatDateISO, generateEmployeeId, initDropdown, setDropdownValue, getDropdownValue, showNotification, showConfirm, renderWithTooltip, escapeHtml, validateEmail, validateEmployeeId, validateAmount } from './utils.js';

// ── 全域快取 ──
let cachedOrders = [], cachedCustomers = [], cachedProducts = [], cachedUsers = [], cachedLogs = [];
const PAGE_SIZE = 10;
let ordersPage = 1, customersPage = 1, usersPage = 1, logsPage = 1;
let orderSearch = { keyword: '', field: 'id', dateFrom: '', dateTo: '', dateField: 'created_at' };
let customerSearch = { keyword: '', field: 'customerId' };
let productSearch = { keyword: '', field: 'name' };
let userSearch = { keyword: '', field: 'employeeId' };
let auditSearch = { keyword: '', field: 'action', dateFrom: '', dateTo: '' };
const currentUser = getCurrentUser();

function f(id) { return document.getElementById(id); }
function getF(o, ...keys) { for (const k of keys) { if (o[k] !== undefined && o[k] !== null) return o[k]; } return ''; }

// ── 閒置偵測 (30 分鐘) ──
let idleTimer = null;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 分鐘 (1800000 毫秒)

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showNotification('您已閒置超過 30 分鐘，系統將自動登出以保護帳戶安全。', 'warning');
    setTimeout(() => {
      logout();
    }, 2000);
  }, IDLE_TIMEOUT);
}

function initIdleDetection() {
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  events.forEach(event => {
    document.addEventListener(event, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

// ── 初始化 ──
function initDashboard() {
  if (!currentUser) return (window.location.href = 'index.html');
  renderSidebarMenu();
  updateHeaderUI();
  bindEvents();
  loadDashboardData();
  initIdleDetection(); // 啟動閒置偵測
  try {
    const p = sessionStorage.getItem('pendingNotification');
    if (p) { const n = JSON.parse(p); showNotification(n.message, n.type); sessionStorage.removeItem('pendingNotification'); }

    // 初次登入提醒
    if (currentUser.must_change_password) {
      setTimeout(() => {
        showNotification('您是初次登入，請務必至「帳戶設定」修改預設密碼及信箱，以確保帳號安全。', 'warning', 10000);
      }, 1000);
    }
  } catch (e) { }
}

function updateHeaderUI() {
  const idEl = f('displayEmployeeId'), badgeEl = f('roleBadgeContainer'), welcomeEl = f('welcomeUserName');
  if (idEl) idEl.textContent = currentUser.employeeId || currentUser.employee_id || 'Unknown';
  if (welcomeEl) welcomeEl.textContent = currentUser.name || currentUser.employeeId || currentUser.employee_id || '使用者';

  if (badgeEl) {
    const role = (currentUser.role || 'viewer').toLowerCase();
    badgeEl.innerHTML = '';
    const span = document.createElement('span');
    span.className = `badge badge-${role}`;
    span.textContent = role.toUpperCase();
    badgeEl.appendChild(span);
  }
}

function renderSidebarMenu() {
  const menuEl = f('sidebarMenu');
  if (!menuEl) return;

  const role = (currentUser.role || 'viewer').toLowerCase();
  const items = getMenuItems(role);

  menuEl.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'menu-item';
    li.dataset.section = item.id;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.textContent = item.icon;
    li.appendChild(iconSpan);

    li.appendChild(document.createTextNode(' ' + item.label));

    li.addEventListener('click', () => {
      window.location.hash = item.id;
      navigateTo(item.id);
      f('sidebar')?.classList.remove('mobile-active');
      f('sidebarOverlay')?.classList.remove('active');
    });

    menuEl.appendChild(li);
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
async function navigateTo(section, filters = null) {
  document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + section)?.classList.add('active');
  document.querySelectorAll('.menu-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));

  const titles = { dashboard: '儀表板', orders: '訂單管理', customers: '客戶管理', users: '使用者管理', auditlogs: '操作紀錄', 'change-password': '帳戶設定', analytics: '銷售分析' };
  const titleEl = f('currentPageTitle');
  if (titleEl && titles[section]) titleEl.textContent = titles[section];

  // 權限控制：顯示/隱藏新增按鈕
  if (section === 'orders') {
    const btn = f('addOrderBtn');
    if (btn) btn.style.display = canCreateOrder(currentUser) ? 'block' : 'none';

    // 權限控制：Sales 隱藏負責人搜尋選項
    const role = (currentUser.role || 'viewer').toLowerCase();
    const ownerOption = document.querySelector('#orderFieldDropdown .dropdown-item[data-value="ownerName"]');
    if (ownerOption) {
      ownerOption.style.display = role === 'sales' ? 'none' : '';
    }
  } else if (section === 'customers') {
    const btn = f('addCustomerBtn');
    if (btn) btn.style.display = canCreateCustomer(currentUser) ? 'block' : 'none';

    // 權限控制：Sales 隱藏負責人搜尋選項
    const role = (currentUser.role || 'viewer').toLowerCase();
    const ownerOption = document.querySelector('#customerFieldDropdown .dropdown-item[data-value="ownerId"]');
    if (ownerOption) {
      ownerOption.style.display = role === 'sales' ? 'none' : '';
      // 安全檢查：如果是 Sales 且目前選中負責人，重設為客戶編號
      if (role === 'sales' && customerSearch.field === 'ownerId') {
        customerSearch.field = 'customerId';
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

  const map = {
    dashboard: () => { updateOverviewStats(); renderOrdersList(); },
    orders: renderOrdersList,
    customers: renderCustomersList,
    products: renderProductsList,
    users: renderUsersList,
    auditlogs: renderAuditLogsList,
    'change-password': renderAccountSettings,
    analytics: async () => {
      if (!window.analyticsModuleLoaded) {
        await import('./analytics-module.js');
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

function updateOverviewStats() {
  const vis = getVisibleOrders(currentUser);
  const set = (id, v) => { const el = f(id); if (el) el.textContent = v; };
  set('dbTotalOrders', vis.length);
  set('dbPendingOrders', vis.filter(o => o.status === '處理中').length);
  const completed = vis.filter(o => o.status === '已完成');
  set('dbTotalAmount', '$' + completed.reduce((s, o) => s + Number(o.amount || 0), 0).toLocaleString());
}

// ── 訂單 ──
function updateOrderOverview(orders) {
  const pendingCount = orders.filter(o => o.status === '處理中').length;
  const doneCount = orders.filter(o => o.status === '已完成').length;
  const voidCount = orders.filter(o => o.status === '已作廢').length;

  if (f('overviewTotal')) f('overviewTotal').textContent = orders.length;
  if (f('statPending')) f('statPending').textContent = pendingCount;
  if (f('statDone')) f('statDone').textContent = doneCount;
  if (f('statVoid')) f('statVoid').textContent = voidCount;

  const activeOrders = orders.length - voidCount;
  const progress = orders.length > 0 ? Math.round((doneCount / (activeOrders || 1)) * 100) : 0;

  if (f('overviewProgressFill')) f('overviewProgressFill').style.width = progress + '%';
  if (f('overviewProgressLabel')) f('overviewProgressLabel').textContent = '完成率 ' + progress + '%';
}

function renderOrdersList() {
  const tbody = f('ordersTableBody');
  if (!tbody) return;
  const role = (currentUser.role || 'viewer').toLowerCase();
  const headerEl = f('orderOwnerHeader');
  if (headerEl) headerEl.style.display = role === 'sales' ? 'none' : '';

  let orders = getVisibleOrders(currentUser);

  if (orderSearch.keyword) {
    const kw = orderSearch.keyword.toLowerCase();
    orders = orders.filter(o => {
      let v = '';
      if (orderSearch.field === 'ownerName') {
        const ownerId = getF(o, 'owner_id', 'ownerId');
        v = ownerId || '';
      } else if (orderSearch.field === 'customer') {
        const custId = getF(o, 'customer_id', 'customerId', 'customer');
        const cust = cachedCustomers.find(c => getF(c, 'customer_id', 'customerId') === custId);
        v = cust ? `${cust.name || cust.customer_name} ${custId}` : custId;
      } else if (orderSearch.field === 'product') {
        const prodId = getF(o, 'product_id', 'productId');
        const prod = cachedProducts.find(p => getF(p, 'product_id', 'productId') === prodId);
        v = prod?.name || getF(o, 'product_name') || '未知商品';
      } else {
        v = String(getF(o, orderSearch.field, toSnake(orderSearch.field)));
      }
      return v.toLowerCase().includes(kw);
    });
  }
  if (orderSearch.dateFrom || orderSearch.dateTo) {
    orders = orders.filter(o => {
      const d = formatDateISO(getF(o, orderSearch.dateField, toSnake(orderSearch.dateField)));
      return !(orderSearch.dateFrom && d < orderSearch.dateFrom) && !(orderSearch.dateTo && d > orderSearch.dateTo);
    });
  }

  updateOrderOverview(orders);

  const paged = orders.slice((ordersPage - 1) * PAGE_SIZE, ordersPage * PAGE_SIZE);

  tbody.innerHTML = '';
  paged.forEach(o => {
    const sid = getF(o, 'id', 'order_id');
    const sc = o.status === '已完成' ? 'badge-success' : o.status === '處理中' ? 'badge-info' : 'badge-void';
    const prod = cachedProducts.find(p => getF(p, 'product_id', 'productId') === getF(o, 'product_id', 'productId'))?.name || getF(o, 'product_name') || '未知商品';
    const ownerId = getF(o, 'owner_id', 'ownerId');
    const own = ownerId;
    const fin = o.status === '已完成' || o.status === '已作廢';

    const tr = document.createElement('tr');

    // 1. Order ID Cell with Tooltip (以 DOM API 建立以防止 XSS)
    const tdId = document.createElement('td');
    const strong = document.createElement('strong');

    const tooltipWrapper = document.createElement('div');
    tooltipWrapper.className = 'tooltip-wrapper';

    const tooltipTrigger = document.createElement('span');
    tooltipTrigger.className = 'tooltip-trigger';
    tooltipTrigger.textContent = 'ⓘ';

    const tooltipContent = document.createElement('div');
    tooltipContent.className = 'tooltip-content';

    const rows = [
      { label: '建立時間', value: formatDate(o.created_at) },
      { label: '最後更新', value: formatDate(o.updated_at) }
    ];
    rows.forEach(item => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'tooltip-row';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'tooltip-label';
      labelSpan.textContent = item.label + '：';

      const valSpan = document.createElement('span');
      valSpan.className = 'tooltip-value';
      valSpan.textContent = item.value;

      rowDiv.appendChild(labelSpan);
      rowDiv.appendChild(valSpan);
      tooltipContent.appendChild(rowDiv);
    });

    const tooltipText = document.createElement('span');
    tooltipText.className = 'tooltip-text';
    tooltipText.textContent = sid;

    tooltipWrapper.appendChild(tooltipTrigger);
    tooltipWrapper.appendChild(tooltipContent);
    tooltipWrapper.appendChild(tooltipText);

    strong.appendChild(tooltipWrapper);
    tdId.appendChild(strong);
    tr.appendChild(tdId);

    // 2. Customer Cell
    const tdCust = document.createElement('td');
    const custId = getF(o, 'customer_id', 'customerId', 'customer');
    const customerObj = cachedCustomers.find(c => getF(c, 'customer_id', 'customerId') === custId);
    const customerName = customerObj ? (customerObj.name || customerObj.customer_name) : custId;

    tdCust.textContent = customerName;
    if (custId) {
      const idSpan = document.createElement('span');
      idSpan.className = 'customer-id-text';
      idSpan.textContent = `（${custId}）`;
      tdCust.appendChild(idSpan);
    }
    tr.appendChild(tdCust);

    // 3. Product Cell (商品名稱)
    const tdProd = document.createElement('td');
    tdProd.textContent = prod;
    tr.appendChild(tdProd);

    // 4. Amount Cell (金額)
    const tdAmount = document.createElement('td');
    tdAmount.style.textAlign = 'right';
    tdAmount.textContent = '$' + Number(o.amount || 0).toLocaleString();
    tr.appendChild(tdAmount);

    // 5. Status Cell (狀態)
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `badge ${sc}`;
    statusSpan.textContent = o.status;
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 6. Owner Cell (負責人)
    if (role !== 'sales') {
      const tdOwner = document.createElement('td');
      tdOwner.textContent = own || '';
      tr.appendChild(tdOwner);
    }

    // 7. Actions Cell (操作)
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    if (!fin && canEditOrder(currentUser, { ownerId })) {
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn-sm btn-secondary btn-edit-order';
      btnEdit.dataset.id = sid;
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => openOrderModal(sid));
      tdActions.appendChild(btnEdit);
    } else {
      tdActions.textContent = '—';
    }
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  if (paged.length === 0) {
    const colCount = role === 'sales' ? 6 : 7;
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colCount;
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--text-secondary)';
    td.textContent = '目前沒有任何資料';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  createPaginator(orders.length, PAGE_SIZE, ordersPage, p => { ordersPage = p; renderOrdersList(); }, 'ordersPaginator');
}

function openOrderModal(id = null) {
  const modal = f('orderModal'); if (!modal) return;
  const amEl = f('orderAmount');
  const custMenu = f('orderCustomerMenu');
  const prodMenu = f('orderProductMenu');

  if (custMenu) {
    const currentOrderId = id;
    let customersToShow = cachedCustomers.filter(c => (c.status || 'active') === 'active');

    // 如果是編輯模式，確保目前訂單的客戶（即使已停用）也能顯示在清單中
    if (currentOrderId) {
      const o = cachedOrders.find(x => getF(x, 'id', 'order_id') === currentOrderId);
      if (o) {
        const currCid = getF(o, 'customer_id', 'customerId', 'customer');
        if (currCid && !customersToShow.some(c => getF(c, 'customer_id', 'customerId') === currCid)) {
          const currC = cachedCustomers.find(c => getF(c, 'customer_id', 'customerId') === currCid);
          if (currC) customersToShow.push(currC);
        }
      }
    }

    custMenu.innerHTML = '';
    customersToShow.forEach(c => {
      const cid = getF(c, 'customer_id', 'customerId');
      const isInactive = (c.status || 'active') !== 'active';
      const name = (c.name || c.customer_name) + (isInactive ? ' (已停用)' : '');

      const li = document.createElement('li');
      li.className = 'dropdown-item';
      li.dataset.value = cid;
      li.textContent = name;

      const span = document.createElement('span');
      span.className = 'customer-id-text';
      span.textContent = `（${cid}）`;

      li.appendChild(span);
      custMenu.appendChild(li);
    });
  }

  if (prodMenu) {
    const currentOrderId = id;
    let productsToShow = cachedProducts.filter(p => (p.status || 'active') === 'active');

    // 如果是編輯模式，確保目前訂單的商品（即使已停用）也能顯示在清單中
    if (currentOrderId) {
      const o = cachedOrders.find(x => getF(x, 'id', 'order_id') === currentOrderId);
      if (o) {
        const currPid = getF(o, 'product_id', 'productId');
        if (currPid && !productsToShow.some(p => getF(p, 'product_id', 'productId') === currPid)) {
          const currP = cachedProducts.find(p => getF(p, 'product_id', 'productId') === currPid);
          if (currP) productsToShow.push(currP);
        }
      }
    }

    prodMenu.innerHTML = '';
    productsToShow.forEach(p => {
      const isInactive = (p.status || 'active') !== 'active';
      const label = p.name + (isInactive ? ' (已停用)' : '') + ' - $' + p.price;

      const li = document.createElement('li');
      li.className = 'dropdown-item';
      li.dataset.value = getF(p, 'product_id', 'productId');
      li.textContent = label;
      prodMenu.appendChild(li);
    });
  }

  initDropdown('orderCustomerDropdown', null, true);
  initDropdown('orderProductDropdown', v => { const p = cachedProducts.find(x => getF(x, 'product_id', 'productId') === v); if (p && amEl) amEl.value = p.price; }, true);

  initDropdown('orderStatusDropdown');

  const titleEl = f('modalTitle'), idEl = f('orderId'), statusGroup = f('orderStatusGroup');
  if (id) {
    const o = cachedOrders.find(x => getF(x, 'id', 'order_id') === id); if (!o) return;
    if (titleEl) titleEl.textContent = '編輯訂單'; if (idEl) idEl.value = id;
    setDropdownValue('orderCustomerDropdown', getF(o, 'customer_name', 'customer_id', 'customer'));
    setDropdownValue('orderProductDropdown', getF(o, 'product_id', 'productId'));
    setDropdownValue('orderStatusDropdown', o.status || '處理中');
    if (amEl) amEl.value = o.amount;
    if (statusGroup) statusGroup.style.display = 'block';
  } else {
    if (titleEl) titleEl.textContent = '新增訂單'; if (idEl) idEl.value = '';
    setDropdownValue('orderCustomerDropdown', ''); setDropdownValue('orderProductDropdown', '');
    setDropdownValue('orderStatusDropdown', '處理中');
    if (amEl) amEl.value = '';
    if (statusGroup) statusGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

async function saveOrder() {
  const btn = f('saveOrderBtn');
  if (btn.disabled) return;

  const id = f('orderId')?.value;
  const customerId = getDropdownValue('orderCustomerDropdown');
  const productId = getDropdownValue('orderProductDropdown');
  const status = getDropdownValue('orderStatusDropdown');
  const amountInput = f('orderAmount')?.value;

  if (!customerId || !productId || amountInput === '') return showNotification('請完整填寫資訊', 'warning');
  if (!validateAmount(amountInput)) return showNotification('請輸入合法的金額數值', 'warning');
  const amount = Number(amountInput);

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '儲存中...';

  try {
    if (id) {
      // 編輯訂單：僅刷新訂單列表
      await updateOrder(id, { customer: customerId, product_id: productId, amount, status });
      f('orderModal')?.classList.remove('active');
      showNotification('訂單更新成功', 'success');
      const updatedOrders = await getOrders();
      cachedOrders = Array.isArray(updatedOrders) ? updatedOrders : [];
      renderOrdersList();
    } else {
      // 新建訂單：並行刷新訂單與客戶（客戶可能因轉移而改變歸屬）
      await saveOrderApi({ customer: customerId, product_id: productId, amount });
      f('orderModal')?.classList.remove('active');
      showNotification('訂單建立成功', 'success');
      const [orders, customers] = await Promise.all([getOrders(), getCustomers()]);
      cachedOrders = Array.isArray(orders) ? orders : [];
      cachedCustomers = Array.isArray(customers) ? customers : [];
      renderOrdersList();
      renderCustomersList();
    }
  } catch (e) {
    // 如果是競爭失敗的訊息，延長顯示時間
    const duration = e.message.includes('已被其他同事分派') ? 8000 : 4000;
    showNotification('儲存失敗：' + e.message, 'error', duration);
    // 即使失敗也重新整理資料，以確保客戶歸屬狀態正確
    await loadDashboardData();
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
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
  const headerEl = f('customerOwnerHeader');
  const role = (currentUser.role || 'viewer').toLowerCase();

  // 更新標題
  if (headerEl) {
    headerEl.textContent = role === 'sales' ? '客戶歸屬' : '負責人';
  }

  let custs = getVisibleCustomers(currentUser);
  if (customerSearch.keyword) {
    const kw = customerSearch.keyword.toLowerCase();
    custs = custs.filter(c => String(getF(c, customerSearch.field, toSnake(customerSearch.field))).toLowerCase().includes(kw));
  }
  const paged = custs.slice((customersPage - 1) * PAGE_SIZE, customersPage * PAGE_SIZE);

  tbody.innerHTML = '';
  paged.forEach(c => {
    const cid = getF(c, 'customer_id', 'customerId');
    const bc = c.status === 'active' ? 'badge-success' : 'badge-secondary';
    const oid = getF(c, 'owner_id', 'ownerId');

    const tr = document.createElement('tr');

    // 1. Customer ID Cell
    const tdId = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = cid;
    tdId.appendChild(strong);
    tr.appendChild(tdId);

    // 2. Customer Name Cell
    const tdName = document.createElement('td');
    tdName.textContent = c.name || '';
    tr.appendChild(tdName);

    // 3. Email Cell
    const tdEmail = document.createElement('td');
    tdEmail.textContent = c.email || '';
    tr.appendChild(tdEmail);

    // 4. Owner Cell
    const tdOwner = document.createElement('td');
    tdOwner.style.textAlign = 'center';
    if (role === 'sales') {
      const myId = currentUser.employeeId || currentUser.employee_id;
      const span = document.createElement('span');
      if (oid === myId) {
        span.className = 'badge badge-my-customer';
        span.textContent = '我的客戶';
      } else {
        span.className = 'badge badge-public-customer';
        span.textContent = '公共客戶';
      }
      tdOwner.appendChild(span);
    } else {
      tdOwner.textContent = oid || '';
    }
    tr.appendChild(tdOwner);

    // 5. Status Cell
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `badge ${bc}`;
    statusSpan.textContent = c.status;
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 6. Created At Cell
    const tdCreated = document.createElement('td');
    tdCreated.textContent = formatDate(c.created_at);
    tr.appendChild(tdCreated);

    // 7. Updated At Cell
    const tdUpdated = document.createElement('td');
    tdUpdated.textContent = formatDate(c.updated_at);
    tr.appendChild(tdUpdated);

    // 8. Actions Cell
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    if (canEditCustomer(currentUser, { ownerId: oid })) {
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn-sm btn-secondary btn-edit-customer';
      btnEdit.dataset.id = cid;
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => openCustomerModal(cid));
      tdActions.appendChild(btnEdit);
    } else {
      tdActions.textContent = '—';
    }
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  if (paged.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--text-secondary)';
    td.textContent = '目前沒有任何資料';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  createPaginator(custs.length, PAGE_SIZE, customersPage, p => { customersPage = p; renderCustomersList(); }, 'customersPaginator');
}

function openCustomerModal(id = null) {
  const modal = f('customerModal'); if (!modal) return;
  const idEl = f('customerId'), nameEl = f('customerName'), emailEl = f('customerEmail'), titleEl = f('customerModalTitle');
  initDropdown('customerStatusDropdown');
  const statusGroup = f('customerStatusGroup');
  const isAdm = isAdmin(currentUser);

  if (id) {
    const c = cachedCustomers.find(x => getF(x, 'customer_id', 'customerId') === id); if (!c) return;
    if (titleEl) titleEl.textContent = '編輯客戶'; if (idEl) idEl.value = id;
    if (nameEl) nameEl.value = c.name || ''; if (emailEl) emailEl.value = c.email || '';
    setDropdownValue('customerStatusDropdown', c.status || 'active');
    if (statusGroup) statusGroup.style.display = isAdm ? 'block' : 'none';
  } else {
    if (titleEl) titleEl.textContent = '新增客戶'; if (idEl) idEl.value = '';
    if (nameEl) nameEl.value = ''; if (emailEl) emailEl.value = '';
    setDropdownValue('customerStatusDropdown', 'active');
    if (statusGroup) statusGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

async function saveCustomer() {
  const id = f('customerId')?.value;
  const name = f('customerName')?.value.trim();
  const email = f('customerEmail')?.value.trim();
  const status = getDropdownValue('customerStatusDropdown');
  if (!name || !email) return showNotification('請填寫完整資訊', 'warning');
  if (!validateEmail(email)) return showNotification('請輸入合法的 Email 格式', 'warning');
  try {
    if (id) {
      const updateData = { name, email };
      if (isAdmin(currentUser)) updateData.status = status;
      await updateCustomer(id, updateData);
    } else {
      await saveCustomerApi({ name, email });
    }
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

  tbody.innerHTML = '';
  paged.forEach(u => {
    const uid = getF(u, 'employee_id', 'employeeId');
    const isSelf = uid === (currentUser.employeeId || currentUser.employee_id);

    const tr = document.createElement('tr');

    // 1. Employee ID Cell
    const tdId = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = uid;
    tdId.appendChild(strong);
    if (isSelf) {
      const selfSpan = document.createElement('span');
      selfSpan.className = 'badge badge-info';
      selfSpan.style.fontSize = '10px';
      selfSpan.textContent = '您';
      tdId.appendChild(document.createTextNode(' '));
      tdId.appendChild(selfSpan);
    }
    tr.appendChild(tdId);

    // 2. Name Cell
    const tdName = document.createElement('td');
    tdName.textContent = u.name || '';
    tr.appendChild(tdName);

    // 3. Email Cell
    const tdEmail = document.createElement('td');
    tdEmail.textContent = u.email || '';
    tr.appendChild(tdEmail);

    // 4. Role Cell
    const tdRole = document.createElement('td');
    const roleSpan = document.createElement('span');
    roleSpan.className = `badge badge-${u.role}`;
    roleSpan.textContent = (u.role || '').toUpperCase();
    tdRole.appendChild(roleSpan);
    tr.appendChild(tdRole);

    // 5. Status Cell
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `badge ${u.status === 'active' ? 'badge-success' : 'badge-secondary'}`;
    statusSpan.textContent = u.status;
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 6. Updated At Cell
    const tdUpdated = document.createElement('td');
    tdUpdated.textContent = formatDate(u.updated_at);
    tr.appendChild(tdUpdated);

    // 7. Actions Cell
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    if (!isSelf && canEditOtherUser(currentUser, { employeeId: uid })) {
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn-sm btn-secondary btn-edit-user';
      btnEdit.dataset.id = uid;
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => openUserModal(uid));
      tdActions.appendChild(btnEdit);
    } else {
      tdActions.textContent = '—';
    }
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  if (paged.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--text-secondary)';
    td.textContent = '目前沒有任何資料';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

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

  if (!validateEmployeeId(eid)) return showNotification('員工編號格式不合法', 'warning');
  if (email && !validateEmail(email)) return showNotification('請輸入合法的 Email 格式', 'warning');

  const existingUser = cachedUsers.find(u => getF(u, 'employee_id', 'employeeId') === eid);
  const isEdit = !!existingUser;

  try {
    if (isEdit) {
      const userId = getF(existingUser, 'id');
      await updateUser(userId, { name, email, role, status });
      showNotification('資料更新成功', 'success');
    } else {
      if (!name) return showNotification('請輸入姓名', 'warning');
      await saveUser({ employee_id: eid, name, email, role, status: 'active', password: 'Test1234' });
      showNotification('使用者建立成功，預設密碼為 Test1234', 'success', 8000); // 延長顯示時間讓使用者看清楚
    }
    f('userModal')?.classList.remove('active');
    await loadDashboardData();
  } catch (e) { showNotification('儲存失敗：' + e.message, 'error'); }
}

// ── 商品 ──
let productsPage = 1;
function renderProductsList() {
  if (!isAdmin(currentUser)) return;
  const tbody = f('productsTableBody'); if (!tbody) return;
  let prods = cachedProducts;
  if (productSearch.keyword) {
    const kw = productSearch.keyword.toLowerCase();
    prods = prods.filter(p => String(getF(p, productSearch.field, toSnake(productSearch.field))).toLowerCase().includes(kw));
  }
  const paged = prods.slice((productsPage - 1) * PAGE_SIZE, productsPage * PAGE_SIZE);

  tbody.innerHTML = '';
  paged.forEach(p => {
    const pid = getF(p, 'product_id', 'productId');
    const bc = p.status === 'active' ? 'badge-success' : 'badge-secondary';

    const tr = document.createElement('tr');

    // 1. ID Cell
    const tdId = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = pid;
    tdId.appendChild(strong);
    tr.appendChild(tdId);

    // 2. Name Cell
    const tdName = document.createElement('td');
    tdName.textContent = p.name || '';
    tr.appendChild(tdName);

    // 3. Price Cell
    const tdPrice = document.createElement('td');
    tdPrice.style.textAlign = 'right';
    tdPrice.textContent = '$' + Number(p.price || 0).toLocaleString();
    tr.appendChild(tdPrice);

    // 4. Status Cell
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `badge ${bc}`;
    statusSpan.textContent = p.status || 'active';
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 5. Updated At Cell
    const tdUpdated = document.createElement('td');
    tdUpdated.textContent = formatDate(p.updated_at);
    tr.appendChild(tdUpdated);

    // 6. Actions Cell
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    if (canEditProduct(currentUser)) {
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn-sm btn-secondary btn-edit-product';
      btnEdit.dataset.id = pid;
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => openProductModal(pid));
      tdActions.appendChild(btnEdit);
    } else {
      tdActions.textContent = '—';
    }
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  if (paged.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--text-secondary)';
    td.textContent = '目前沒有任何資料';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  createPaginator(prods.length, PAGE_SIZE, productsPage, p => { productsPage = p; renderProductsList(); }, 'productsPaginator');
}

function openProductModal(id = null) {
  const modal = f('productModal'); if (!modal) return;
  const nameEl = f('productName'), priceEl = f('productPrice'), idEl = f('productIdDisplay'), hiddenIdEl = f('modal_product_id_hidden'), titleEl = f('productModalTitle');
  const statusGroup = f('productStatusGroup'), idGroup = f('product_id_group');
  initDropdown('productStatusDropdown');

  if (id) {
    const p = cachedProducts.find(x => getF(x, 'product_id', 'productId') === id); if (!p) return;
    if (titleEl) titleEl.textContent = '編輯商品';
    if (hiddenIdEl) hiddenIdEl.value = id;
    if (idEl) { idEl.value = id; idEl.readOnly = true; idEl.style.backgroundColor = '#F3F4F6'; }
    if (idGroup) idGroup.style.display = 'block';
    if (nameEl) nameEl.value = p.name;
    if (priceEl) priceEl.value = p.price;
    setDropdownValue('productStatusDropdown', p.status || 'active');
    if (statusGroup) statusGroup.style.display = 'block';
  } else {
    if (titleEl) titleEl.textContent = '新增商品';
    if (hiddenIdEl) hiddenIdEl.value = '';
    if (idEl) { idEl.value = ''; idEl.readOnly = false; idEl.style.backgroundColor = ''; }
    if (idGroup) idGroup.style.display = 'none';
    if (nameEl) nameEl.value = '';
    if (priceEl) priceEl.value = '';
    setDropdownValue('productStatusDropdown', 'active');
    if (statusGroup) statusGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

async function saveProduct() {
  const hiddenId = f('modal_product_id_hidden')?.value;
  const name = f('productName')?.value.trim();
  const priceInput = f('productPrice')?.value;

  if (!name || priceInput === '') return showNotification('請填寫完整資訊', 'warning');
  if (!validateAmount(priceInput)) return showNotification('請輸入合法的商品價格', 'warning');
  const price = Number(priceInput);

  try {
    if (hiddenId) {
      const status = getDropdownValue('productStatusDropdown');
      await updateProduct(hiddenId, { name, price, status });
      showNotification('商品更新成功', 'success');
    } else {
      const status = getDropdownValue('productStatusDropdown');
      const data = { name, price, status };
      await saveProductApi(data);
      showNotification('商品建立成功', 'success');
    }
    f('productModal')?.classList.remove('active');
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
      const d = formatDateISO(getF(l, 'timestamp', 'created_at'));
      return !(auditSearch.dateFrom && d < auditSearch.dateFrom) && !(auditSearch.dateTo && d > auditSearch.dateTo);
    });
  }
  const paged = logs.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE);

  tbody.innerHTML = '';
  paged.forEach(l => {
    const action = getF(l, 'action', 'action_type');
    const operator = getF(l, 'operator_id', 'operatorId', 'user_id', 'userId') || '-';

    // 解析目標資訊 (處理 JSON 或純文字)
    let targetDisplay = '-';
    const rawTarget = getF(l, 'target', 'target_id', 'targetId');
    if (rawTarget) {
      if (typeof rawTarget === 'string' && (rawTarget.startsWith('{') || rawTarget.startsWith('['))) {
        try {
          const details = JSON.parse(rawTarget);
          targetDisplay = details.order_id || details.customer_id || details.employee_id || details.product_id || details.id || rawTarget;
          if (typeof targetDisplay === 'object') targetDisplay = JSON.stringify(targetDisplay);
        } catch (e) {
          targetDisplay = rawTarget;
        }
      } else {
        targetDisplay = rawTarget;
      }
    }

    const tr = document.createElement('tr');

    // 1. Log ID Cell
    const tdId = document.createElement('td');
    tdId.textContent = getF(l, 'id', 'log_id') || '';
    tr.appendChild(tdId);

    // 2. Action Cell
    const tdAction = document.createElement('td');
    const actionSpan = document.createElement('span');
    actionSpan.className = 'badge';
    actionSpan.textContent = action || '';
    tdAction.appendChild(actionSpan);
    tr.appendChild(tdAction);

    // 3. Operator Cell
    const tdOperator = document.createElement('td');
    const opStrong = document.createElement('strong');
    opStrong.textContent = operator;
    tdOperator.appendChild(opStrong);
    tr.appendChild(tdOperator);

    // 4. Target Cell
    const tdTarget = document.createElement('td');
    tdTarget.textContent = targetDisplay;
    tr.appendChild(tdTarget);

    // 5. Timestamp Cell
    const tdTimestamp = document.createElement('td');
    const timeSmall = document.createElement('small');
    timeSmall.textContent = formatDate(l.timestamp);
    tdTimestamp.appendChild(timeSmall);
    tr.appendChild(tdTimestamp);

    tbody.appendChild(tr);
  });

  if (paged.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--text-secondary)';
    td.textContent = '目前沒有任何資料';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  createPaginator(logs.length, PAGE_SIZE, logsPage, p => { logsPage = p; renderAuditLogsList(); }, 'auditLogsPaginator');
}

// ── 帳戶設定 ──
function renderAccountSettings() {
  const accEmail = f('accEmail');
  const accEmailLock = f('accEmailLock');

  f('accEmployeeId').value = currentUser.employeeId || currentUser.employee_id || '';
  f('accName').value = currentUser.name || '-';
  accEmail.value = currentUser.email || '-';

  // 權限控制：sales, viewer 可編輯 Email，admin 不可
  const role = (currentUser.role || 'viewer').toLowerCase();
  if (role === 'admin') {
    accEmail.readOnly = true;
    accEmail.parentElement.classList.add('readonly-input-wrapper');
    if (accEmailLock) accEmailLock.style.display = 'block';
  } else {
    accEmail.readOnly = false;
    accEmail.parentElement.classList.remove('readonly-input-wrapper');
    if (accEmailLock) accEmailLock.style.display = 'none';
  }
}

async function saveAccountSettings(event) {
  event.preventDefault();
  const currentEmail = currentUser.email;
  const newEmail = f('accEmail').value.trim();
  const currentPassword = f('accCurrentPassword').value;
  const newPassword = f('accNewPassword').value;
  const confirmPassword = f('accConfirmPassword').value;

  try {
    let emailUpdated = false;
    let passwordUpdated = false;

    // 1. 處理 Email 更新
    if (newEmail !== currentEmail) {
      if (!validateEmail(newEmail)) return showNotification('請輸入合法的 Email 格式', 'warning');
      const { updateEmail } = await import('./auth.js');
      await updateEmail(newEmail);
      currentUser.email = newEmail;
      emailUpdated = true;
    }

    // 2. 處理密碼更新
    if (newPassword) {
      if (newPassword !== confirmPassword) {
        return showNotification('新密碼與確認密碼不符', 'warning');
      }
      if (!currentPassword) {
        return showNotification('請輸入目前密碼以驗證身分', 'warning');
      }
      const { changePassword } = await import('./auth.js');
      await changePassword(currentPassword, newPassword);
      currentUser.must_change_password = false;
      passwordUpdated = true;
    }

    if (!emailUpdated && !passwordUpdated) {
      return showNotification('未偵測到任何變更', 'info');
    }

    // 更新本地存儲
    const currentUser = getCurrentUser();
    currentUser.email = newEmail;
    updateCurrentUser(currentUser);
    updateHeaderUI();

    // 清空密碼欄位
    f('accCurrentPassword').value = '';
    f('accNewPassword').value = '';
    f('accConfirmPassword').value = '';

    showNotification('帳戶設定已成功更新', 'success');
  } catch (e) {
    showNotification('更新失敗：' + e.message, 'error');
  }
}

// ── 分頁元件 ──
function createPaginator(total, size, curr, onChange, containerId) {
  const c = f(containerId); if (!c) return;
  const pc = Math.ceil(total / size);
  c.innerHTML = '';
  if (pc <= 1) return;

  // 上一頁按鈕
  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn-pager';
  prevBtn.textContent = '上一頁';
  if (curr === 1) {
    prevBtn.disabled = true;
  } else {
    prevBtn.addEventListener('click', () => onChange(curr - 1));
  }
  c.appendChild(prevBtn);

  // 頁碼與省略號
  for (let i = 1; i <= pc; i++) {
    if (i === 1 || i === pc || Math.abs(i - curr) <= 1) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `btn-pager ${i === curr ? 'active' : ''}`;
      pageBtn.textContent = i;
      if (i !== curr) {
        pageBtn.addEventListener('click', () => onChange(i));
      }
      c.appendChild(pageBtn);
    } else if (Math.abs(i - curr) === 2) {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'pager-ellipsis';
      ellipsis.textContent = '…';
      c.appendChild(ellipsis);
    }
  }

  // 下一頁按鈕
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn-pager';
  nextBtn.textContent = '下一頁';
  if (curr === pc) {
    nextBtn.disabled = true;
  } else {
    nextBtn.addEventListener('click', () => onChange(curr + 1));
  }
  c.appendChild(nextBtn);
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
  f('addProductBtn')?.addEventListener('click', () => openProductModal());
  f('saveProductBtn')?.addEventListener('click', saveProduct);
  f('cancelProductBtn')?.addEventListener('click', () => f('productModal')?.classList.remove('active'));
  f('saveUserRoleBtn')?.addEventListener('click', saveUserRole);
  f('cancelUserBtn')?.addEventListener('click', () => f('userModal')?.classList.remove('active'));
  f('cancelOrderBtn')?.addEventListener('click', () => f('orderModal')?.classList.remove('active'));
  f('cancelCustomerBtn')?.addEventListener('click', () => f('customerModal')?.classList.remove('active'));

  // 帳戶設定表單
  f('accountSettingsForm')?.addEventListener('submit', saveAccountSettings);

  // 搜尋與下拉連動
  initDropdown('orderFieldDropdown', v => { orderSearch.field = v; renderOrdersList(); });
  f('orderSearchKeyword')?.addEventListener('input', e => { orderSearch.keyword = e.target.value; ordersPage = 1; renderOrdersList(); });

  // 新增日期篩選事件監聽器
  initDropdown('orderDateFieldDropdown', v => { orderSearch.dateField = v; renderOrdersList(); });
  f('orderDateFrom')?.addEventListener('change', e => { orderSearch.dateFrom = e.target.value; ordersPage = 1; renderOrdersList(); });
  f('orderDateTo')?.addEventListener('change', e => { orderSearch.dateTo = e.target.value; ordersPage = 1; renderOrdersList(); });
  initDropdown('customerFieldDropdown', v => { customerSearch.field = v; renderCustomersList(); });
  f('customerSearchKeyword')?.addEventListener('input', e => { customerSearch.keyword = e.target.value; customersPage = 1; renderCustomersList(); });
  initDropdown('productFieldDropdown', v => { productSearch.field = v; renderProductsList(); });
  f('productSearchKeyword')?.addEventListener('input', e => { productSearch.keyword = e.target.value; productsPage = 1; renderProductsList(); });
  initDropdown('userFieldDropdown', v => { userSearch.field = v; renderUsersList(); });
  f('userSearchKeyword')?.addEventListener('input', e => { userSearch.keyword = e.target.value; usersPage = 1; renderUsersList(); });
  initDropdown('auditFieldDropdown', v => { auditSearch.field = v; renderAuditLogsList(); });
  f('auditSearchKeyword')?.addEventListener('input', e => { auditSearch.keyword = e.target.value; logsPage = 1; renderAuditLogsList(); });

  // 日期重設
  f('orderDateReset')?.addEventListener('click', () => {
    f('orderDateFrom').value = ''; f('orderDateTo').value = '';
    orderSearch.dateFrom = ''; orderSearch.dateTo = '';
    setDropdownValue('orderDateFieldDropdown', 'created_at');
    orderSearch.dateField = 'created_at';
    renderOrdersList();
  });
  f('auditDateReset')?.addEventListener('click', () => { f('auditDateFrom').value = ''; f('auditDateTo').value = ''; auditSearch.dateFrom = ''; auditSearch.dateTo = ''; renderAuditLogsList(); });

  // 補上稽核日誌日期監聽器
  f('auditDateFrom')?.addEventListener('change', e => { auditSearch.dateFrom = e.target.value; logsPage = 1; renderAuditLogsList(); });
  f('auditDateTo')?.addEventListener('change', e => { auditSearch.dateTo = e.target.value; logsPage = 1; renderAuditLogsList(); });

  // 模態框關閉按鈕
  document.querySelectorAll('.btn-close, .btn-secondary').forEach(b => {
    b.addEventListener('click', () => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')));
  });

  // 分析當前銷售情形按鈕 (入口 B)
  f('analyzeOrdersBtn')?.addEventListener('click', async () => {
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
        if (matchedCust) {
          customerId = getF(matchedCust, 'customer_id', 'customerId');
        } else {
          customerId = orderSearch.keyword.trim();
        }
      } else if (orderSearch.field === 'product') {
        const matchedProd = cachedProducts.find(p => 
          String(getF(p, 'product_id', 'productId')).toLowerCase() === kw ||
          String(p.name || '').toLowerCase().includes(kw)
        );
        if (matchedProd) {
          productId = getF(matchedProd, 'product_id', 'productId');
        } else {
          productId = orderSearch.keyword.trim();
        }
      }
    }
    
    await navigateTo('analytics', { dateFrom, dateTo, customerId, productId });
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
  // 前端過濾：保留自己負責的與 Admin 負責的 (Admin 通常由後端判斷，前端此處為保險/同步顯示)
  // 由於後端 API /customers/ 已經做了角色過濾，cachedCustomers 應該已經是過濾後的結果
  return cachedCustomers;
}
function toSnake(s) { return s.replace(/([A-Z])/g, m => '_' + m.toLowerCase()); }

// ── 全域暴露 ──
window.navigateTo = navigateTo;
window.openOrderModal = openOrderModal;
window.openCustomerModal = openCustomerModal;
window.openUserModal = openUserModal;

initDashboard();
export { loadDashboardData, navigateTo };
