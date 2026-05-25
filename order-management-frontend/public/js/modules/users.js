// users.js — 使用者管理模組

import { 
  f, getF, toSnake, formatDate, 
  showNotification, initDropdown, 
  setDropdownValue, getDropdownValue, 
  validateEmployeeId, validateEmail, generateEmployeeId 
} from '../utils.js?v=1.0.1';
import { getCurrentUser } from '../auth.js';
import { canEditOtherUser, isAdmin } from '../rbac.js';
import { saveUser, updateUser } from '../data.js';
import { 
  getCachedUsers, PAGE_SIZE, getUsersPage, setUsersPage,
  getUserSearch, setUserSearch
} from './state.js';
import { createPaginator } from './paginator.js';

const currentUser = getCurrentUser();
let refreshCallback = null;

/**
 * 渲染使用者列表表格
 */
export function renderUsersList() {
  if (!isAdmin(currentUser)) return;
  const tbody = f('usersTableBody'); 
  if (!tbody) return;
  
  let users = getCachedUsers();
  const userSearch = getUserSearch();

  if (userSearch.keyword) {
    const kw = userSearch.keyword.toLowerCase();
    users = users.filter(u => String(getF(u, userSearch.field, toSnake(userSearch.field))).toLowerCase().includes(kw));
  }
  
  const usersPage = getUsersPage();
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

  createPaginator(users.length, PAGE_SIZE, usersPage, p => { 
    setUsersPage(p); 
    renderUsersList(); 
  }, 'usersPaginator');
}

/**
 * 開啟使用者 Modal (新增或編輯)
 */
export function openUserModal(id = null) {
  const modal = f('userModal'); if (!modal) return;
  const eidEl = f('userEmployeeId'), nameEl = f('userName'), emailEl = f('userEmail'), titleEl = f('userModalTitle');

  initDropdown('userRoleDropdown');
  initDropdown('userStatusDropdown');

  const statusGroup = f('userStatusGroup');
  const cachedUsers = getCachedUsers();

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

/**
 * 儲存使用者角色與基本資料
 */
async function saveUserRole() {
  const eid = f('userEmployeeId')?.value;
  const name = f('userName')?.value.trim();
  const email = f('userEmail')?.value.trim();
  const role = getDropdownValue('userRoleDropdown');
  const status = getDropdownValue('userStatusDropdown');
  
  if (!eid || !role) return;

  if (!validateEmployeeId(eid)) return showNotification('員工編號格式不合法', 'warning');
  if (email && !validateEmail(email)) return showNotification('請輸入合法的 Email 格式', 'warning');

  const cachedUsers = getCachedUsers();
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
      showNotification('使用者建立成功，預設密碼為 Test1234', 'success', 8000);
    }
    f('userModal')?.classList.remove('active');
    
    if (refreshCallback) {
      await refreshCallback();
    }
  } catch (e) { 
    showNotification('儲存失敗：' + e.message, 'error'); 
  }
}

/**
 * 綁定使用者模組事件
 */
export function bindUsersEvents(onRefresh) {
  refreshCallback = onRefresh;

  f('addUserBtn')?.addEventListener('click', () => openUserModal());
  f('saveUserRoleBtn')?.addEventListener('click', saveUserRole);
  f('cancelUserBtn')?.addEventListener('click', () => f('userModal')?.classList.remove('active'));

  // 搜尋事件
  initDropdown('userFieldDropdown', v => { 
    setUserSearch({ field: v }); 
    renderUsersList(); 
  });
  
  f('userSearchKeyword')?.addEventListener('input', e => { 
    setUserSearch({ keyword: e.target.value }); 
    setUsersPage(1); 
    renderUsersList(); 
  });
}
