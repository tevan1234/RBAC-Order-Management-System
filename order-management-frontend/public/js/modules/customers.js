// customers.js — 客戶管理模組

import { 
  f, getF, toSnake, formatDate, 
  showNotification, showConfirm, initDropdown, 
  setDropdownValue, getDropdownValue, validateEmail 
} from '../utils.js?v=1.0.1';
import { getCurrentUser } from '../auth.js';
import { canEditCustomer, isAdmin } from '../rbac.js';
import { saveCustomer as saveCustomerApi, updateCustomer } from '../data.js';
import { 
  getCachedCustomers, PAGE_SIZE, getCustomersPage, setCustomersPage,
  getCustomerSearch, setCustomerSearch
} from './state.js';
import { createPaginator } from './paginator.js';

const currentUser = getCurrentUser();
let refreshCallback = null;

/**
 * 取得當前使用者權限下可見的客戶
 */
export function getVisibleCustomers(u) {
  if (!u) return [];
  const cachedCustomers = getCachedCustomers();
  // 由於後端 API /customers/ 已經依角色做了可見性過濾，前端直接回傳快取結果
  return cachedCustomers;
}

/**
 * 渲染客戶列表表格
 */
export function renderCustomersList() {
  const tbody = f('customersTableBody'); 
  if (!tbody) return;
  const headerEl = f('customerOwnerHeader');
  const role = (currentUser.role || 'viewer').toLowerCase();

  // 更新標題
  if (headerEl) {
    headerEl.textContent = role === 'sales' ? '客戶歸屬' : '負責人';
  }

  let custs = getVisibleCustomers(currentUser);
  const customerSearch = getCustomerSearch();

  if (customerSearch.keyword) {
    const kw = customerSearch.keyword.toLowerCase();
    custs = custs.filter(c => String(getF(c, customerSearch.field, toSnake(customerSearch.field))).toLowerCase().includes(kw));
  }
  
  const customersPage = getCustomersPage();
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
      // 停用功能已整合在「編輯客戶」Modal 的狀態下拉選單中（Admin 才可見）
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

  createPaginator(custs.length, PAGE_SIZE, customersPage, p => { 
    setCustomersPage(p); 
    renderCustomersList(); 
  }, 'customersPaginator');
}

/**
 * 開啟客戶 Modal (新增或編輯)
 */
export function openCustomerModal(id = null) {
  const modal = f('customerModal'); if (!modal) return;
  const idEl = f('customerId'), nameEl = f('customerName'), emailEl = f('customerEmail'), titleEl = f('customerModalTitle');
  initDropdown('customerStatusDropdown');
  const statusGroup = f('customerStatusGroup');
  const isAdm = isAdmin(currentUser);
  const cachedCustomers = getCachedCustomers();

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

/**
 * 儲存客戶
 */
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
    
    if (refreshCallback) {
      await refreshCallback();
    }
  } catch (e) { 
    showNotification('儲存失敗：' + e.message, 'error'); 
  }
}

/**
 * 停用客戶
 */
async function voidCustomer(id) {
  if (!await showConfirm('確定要停用此客戶嗎？')) return;
  try { 
    await updateCustomer(id, { status: 'inactive' }); 
    showNotification('客戶已停用', 'success'); 
    if (refreshCallback) {
      await refreshCallback();
    }
  } catch (e) { 
    showNotification('操作失敗：' + e.message, 'error'); 
  }
}

/**
 * 綁定客戶管理模組事件
 */
export function bindCustomersEvents(onRefresh) {
  refreshCallback = onRefresh;

  f('addCustomerBtn')?.addEventListener('click', () => openCustomerModal());
  f('saveCustomerBtn')?.addEventListener('click', saveCustomer);
  f('cancelCustomerBtn')?.addEventListener('click', () => f('customerModal')?.classList.remove('active'));

  // 搜尋事件
  initDropdown('customerFieldDropdown', v => { 
    setCustomerSearch({ field: v }); 
    renderCustomersList(); 
  });
  
  f('customerSearchKeyword')?.addEventListener('input', e => { 
    setCustomerSearch({ keyword: e.target.value }); 
    setCustomersPage(1); 
    renderCustomersList(); 
  });
}
