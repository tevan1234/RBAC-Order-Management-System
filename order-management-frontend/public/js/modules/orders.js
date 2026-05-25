// orders.js — 訂單管理模組

import { 
  f, getF, toSnake, formatDate, formatDateISO, 
  showNotification, showConfirm, initDropdown, 
  setDropdownValue, getDropdownValue, validateAmount 
} from '../utils.js?v=1.0.1';
import { getCurrentUser } from '../auth.js';
import { 
  canCreateOrder, canEditOrder 
} from '../rbac.js';
import { 
  getOrders, saveOrder as saveOrderApi, updateOrder, updateOrderStatus 
} from '../data.js';
import { 
  getCachedOrders, getCachedCustomers, getCachedProducts, PAGE_SIZE,
  getOrdersPage, setOrdersPage, getOrderSearch, setOrderSearch,
  setCachedOrders, setCachedCustomers
} from './state.js';
import { createPaginator } from './paginator.js';

const currentUser = getCurrentUser();
let refreshCallback = null;

/**
 * 取得當前使用者權限下可見的訂單
 */
export function getVisibleOrders(u) {
  if (!u) return [];
  const cachedOrders = getCachedOrders();
  if (u.role === 'admin' || u.role === 'viewer') return cachedOrders;
  const uid = u.employeeId || u.employee_id;
  return cachedOrders.filter(o => getF(o, 'owner_id', 'ownerId') === uid);
}

/**
 * 更新儀表板首頁的訂單統計數據
 */
export function updateOverviewStats() {
  const vis = getVisibleOrders(currentUser);
  const set = (id, v) => { const el = f(id); if (el) el.textContent = v; };
  set('dbTotalOrders', vis.length);
  set('dbPendingOrders', vis.filter(o => o.status === '處理中').length);
  const completed = vis.filter(o => o.status === '已完成');
  set('dbTotalAmount', '$' + completed.reduce((s, o) => s + Number(o.amount || 0), 0).toLocaleString());
}

/**
 * 更新訂單列表上方的統計總覽卡片
 */
export function updateOrderOverview(orders) {
  const pendingCount = orders.filter(o => o.status === '處理中').length;
  const doneCount = orders.filter(o => o.status === '已完成');
  const voidCount = orders.filter(o => o.status === '已作廢').length;

  if (f('overviewTotal')) f('overviewTotal').textContent = orders.length;
  if (f('statPending')) f('statPending').textContent = pendingCount;
  if (f('statDone')) f('statDone').textContent = doneCount.length;
  if (f('statVoid')) f('statVoid').textContent = voidCount;

  const activeOrders = orders.length - voidCount;
  const progress = orders.length > 0 ? Math.round((doneCount.length / (activeOrders || 1)) * 100) : 0;

  if (f('overviewProgressFill')) f('overviewProgressFill').style.width = progress + '%';
  if (f('overviewProgressLabel')) f('overviewProgressLabel').textContent = '完成率 ' + progress + '%';
}

/**
 * 渲染訂單列表表格
 */
export function renderOrdersList() {
  const tbody = f('ordersTableBody');
  if (!tbody) return;
  const role = (currentUser.role || 'viewer').toLowerCase();
  const headerEl = f('orderOwnerHeader');
  if (headerEl) headerEl.style.display = role === 'sales' ? 'none' : '';

  let orders = getVisibleOrders(currentUser);
  const orderSearch = getOrderSearch();
  const cachedCustomers = getCachedCustomers();
  const cachedProducts = getCachedProducts();

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

  const ordersPage = getOrdersPage();
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

    // 1. Order ID Cell with Tooltip
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

    // 3. Product Cell
    const tdProd = document.createElement('td');
    tdProd.textContent = prod;
    tr.appendChild(tdProd);

    // 4. Amount Cell
    const tdAmount = document.createElement('td');
    tdAmount.style.textAlign = 'right';
    tdAmount.textContent = '$' + Number(o.amount || 0).toLocaleString();
    tr.appendChild(tdAmount);

    // 5. Status Cell
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `badge ${sc}`;
    statusSpan.textContent = o.status;
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 6. Owner Cell
    if (role !== 'sales') {
      const tdOwner = document.createElement('td');
      tdOwner.textContent = own || '';
      tr.appendChild(tdOwner);
    }

    // 7. Actions Cell
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    
    // 僅顯示「編輯」按鈕（作廢/完成功能已整合在 Modal 的狀態下拉選單中）
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

  createPaginator(orders.length, PAGE_SIZE, ordersPage, p => { 
    setOrdersPage(p); 
    renderOrdersList(); 
  }, 'ordersPaginator');
}

/**
 * 開啟訂單 Modal (新增或編輯)
 */
export function openOrderModal(id = null) {
  const modal = f('orderModal'); if (!modal) return;
  const amEl = f('orderAmount');
  const custMenu = f('orderCustomerMenu');
  const prodMenu = f('orderProductMenu');
  
  const cachedOrders = getCachedOrders();
  const cachedCustomers = getCachedCustomers();
  const cachedProducts = getCachedProducts();

  if (custMenu) {
    const currentOrderId = id;
    let customersToShow = cachedCustomers.filter(c => (c.status || 'active') === 'active');

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
  initDropdown('orderProductDropdown', v => { 
    const p = cachedProducts.find(x => getF(x, 'product_id', 'productId') === v); 
    if (p && amEl) amEl.value = p.price; 
  }, true);

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
    setDropdownValue('orderCustomerDropdown', ''); 
    setDropdownValue('orderProductDropdown', '');
    setDropdownValue('orderStatusDropdown', '處理中');
    if (amEl) amEl.value = '';
    if (statusGroup) statusGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

/**
 * 儲存訂單 (新增或更新)
 */
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
      await updateOrder(id, { customer: customerId, product_id: productId, amount, status });
      f('orderModal')?.classList.remove('active');
      showNotification('訂單更新成功', 'success');
    } else {
      await saveOrderApi({ customer: customerId, product_id: productId, amount });
      f('orderModal')?.classList.remove('active');
      showNotification('訂單建立成功', 'success');
    }
    
    if (refreshCallback) {
      await refreshCallback();
    }
  } catch (e) {
    const duration = e.message.includes('已被其他同事分派') ? 8000 : 4000;
    showNotification('儲存失敗：' + e.message, 'error', duration);
    if (refreshCallback) {
      await refreshCallback();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * 作廢訂單
 */
async function voidOrder(id) {
  if (!canVoidOrder(currentUser)) return showNotification('無權限', 'error');
  if (!await showConfirm('確定要作廢此訂單嗎？')) return;
  try { 
    await updateOrderStatus(id, '已作廢'); 
    showNotification('訂單已作廢', 'success'); 
    if (refreshCallback) await refreshCallback(); 
  } catch (e) { 
    showNotification('操作失敗：' + e.message, 'error'); 
  }
}

/**
 * 完成訂單
 */
async function completeOrder(id) {
  if (!await showConfirm('確定要完成此訂單嗎？')) return;
  try { 
    await updateOrderStatus(id, '已完成'); 
    showNotification('訂單已完成', 'success'); 
    if (refreshCallback) await refreshCallback(); 
  } catch (e) { 
    showNotification('操作失敗：' + e.message, 'error'); 
  }
}

/**
 * 綁定訂單管理模組內部的 DOM 事件
 */
export function bindOrdersEvents(onRefresh) {
  refreshCallback = onRefresh;

  f('addOrderBtn')?.addEventListener('click', () => openOrderModal());
  f('saveOrderBtn')?.addEventListener('click', saveOrder);
  f('cancelOrderBtn')?.addEventListener('click', () => f('orderModal')?.classList.remove('active'));

  // 搜尋與篩選事件
  initDropdown('orderFieldDropdown', v => { 
    setOrderSearch({ field: v }); 
    renderOrdersList(); 
  });
  
  f('orderSearchKeyword')?.addEventListener('input', e => { 
    setOrderSearch({ keyword: e.target.value }); 
    setOrdersPage(1); 
    renderOrdersList(); 
  });

  initDropdown('orderDateFieldDropdown', v => { 
    setOrderSearch({ dateField: v }); 
    renderOrdersList(); 
  });
  
  f('orderDateFrom')?.addEventListener('change', e => { 
    setOrderSearch({ dateFrom: e.target.value }); 
    setOrdersPage(1); 
    renderOrdersList(); 
  });
  
  f('orderDateTo')?.addEventListener('change', e => { 
    setOrderSearch({ dateTo: e.target.value }); 
    setOrdersPage(1); 
    renderOrdersList(); 
  });

  // 日期重設
  f('orderDateReset')?.addEventListener('click', () => {
    if (f('orderDateFrom')) f('orderDateFrom').value = ''; 
    if (f('orderDateTo')) f('orderDateTo').value = '';
    setOrderSearch({ dateFrom: '', dateTo: '', dateField: 'created_at' });
    setDropdownValue('orderDateFieldDropdown', 'created_at');
    renderOrdersList();
  });
}
