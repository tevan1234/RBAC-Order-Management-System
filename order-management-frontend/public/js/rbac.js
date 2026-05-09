// ============================================================
// rbac.js — 純權限判斷模組（無副作用、無 DOM、無 localStorage）
// ============================================================

// 側邊欄選單設定（依 role 控制可見項目）
export const menuConfig = {
  admin: [
    { id: 'dashboard', label: '儀表板', icon: '📊' },
    { id: 'orders', label: '訂單管理', icon: '🛍️' },
    { id: 'customers', label: '客戶管理', icon: '👤' },
    { id: 'users', label: '使用者管理', icon: '👥' },
    { id: 'auditlogs', label: '操作紀錄', icon: '📝' },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️' }
  ],
  sales: [
    { id: 'dashboard', label: '儀表板', icon: '📊' },
    { id: 'orders', label: '訂單管理', icon: '🛍️' },
    { id: 'customers', label: '客戶管理', icon: '👤' },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️' }
  ],
  viewer: [
    { id: 'dashboard', label: '儀表板 (唯讀)', icon: '👁️' },
    { id: 'orders', label: '訂單管理', icon: '🛍️' },
    { id: 'customers', label: '客戶管理', icon: '👤' },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️' }
  ]
};

// ── 基礎角色判斷 ──

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function canAccessMenu(user, sectionId) {
  if (!user) return false;
  if (sectionId === 'change-password') return true;
  const items = menuConfig[user?.role] || [];
  return items.some(item => item.id === sectionId);
}

export function canChangePassword(user) {
  return !!user?.role;
}

export function getMenuItems(role) {
  return menuConfig[role] || [];
}

// ── 使用者管理 ──

export function canEditUser(currentUser) {
  return currentUser?.role === 'admin';
}

export function canEditOtherUser(currentUser, targetUser) {
  if (currentUser?.role !== 'admin') return false;
  // 自己不能編輯自己（透過此頁面），避免繞過 role 保護
  if (currentUser?.employeeId === targetUser?.employeeId) return false;
  return true;
}

export function canDeactivateUser(currentUser, targetUser) {
  if (currentUser?.role !== 'admin') return false;
  if (currentUser?.employeeId === targetUser?.employeeId) return false;
  return true;
}

export function validateLastAdmin(users) {
  // true = 還有其他 admin，可以繼續操作
  return users.filter(u => u.role === 'admin' && u.status !== 'inactive').length > 1;
}

/**
 * 檢查是否可以變更使用者角色
 * 1. admin 不可修改自己的角色（防止自我調降）
 * 2. 若目標使用者原本是 admin 且要改為非 admin，需確認系統還有其他 active admin
 * @param {Array}  users       - 完整使用者列表
 * @param {Object} currentUser - 操作者
 * @param {Object} targetUser  - 被修改的使用者
 * @param {string} newRole     - 新角色
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canChangeRole(users, currentUser, targetUser, newRole) {
  if (!currentUser || !targetUser) return { allowed: false, reason: '系統錯誤：缺少使用者資訊' };
  // 角色沒變，允許
  if (targetUser.role === newRole) return { allowed: true, reason: '' };
  // 不可修改自己的角色
  if (currentUser.employeeId === targetUser.employeeId) {
    return { allowed: false, reason: '無法修改自己的角色，請由其他管理員協助變更' };
  }
  // 目標是 admin 且要改成非 admin → 檢查是否還有其他 active admin
  if (targetUser.role === 'admin' && !validateLastAdmin(users)) {
    return { allowed: false, reason: '系統至少需保留一位管理員，無法變更此使用者的角色' };
  }
  return { allowed: true, reason: '' };
}

// ── 訂單 ──

export function canViewOrder(user, order) {
  if (user?.role === 'admin' || user?.role === 'viewer') return true;
  if (user?.role === 'sales') return order?.ownerId === user?.employeeId;
  return false;
}

export function canEditOrder(user, order) {
  if (user?.role === 'admin') return true;
  if (user?.role === 'sales') return order?.ownerId === user?.employeeId;
  return false;
}

export function canVoidOrder(user) {
  return user.role === 'admin';
}

export function canCompleteOrder(user, order) {
  if (user?.role === 'admin') return true;
  if (user?.role === 'sales') return order?.ownerId === user?.employeeId;
  return false;
}

export function canCreateOrder(user) {
  return user.role === 'admin' || user.role === 'sales';
}

// ── 客戶 ──

export function canViewCustomer(user, customer) {
  if (user?.role === 'admin') return true;
  if (user?.role === 'sales') return customer?.ownerId === user?.employeeId;
  if (user?.role === 'viewer') return true; // 唯讀可看全部
  return false;
}

export function canEditCustomer(user, customer) {
  if (user?.role === 'admin') return true;
  if (user?.role === 'sales') return customer?.ownerId === user?.employeeId;
  return false; // viewer 不可編輯
}

export function canVoidCustomer(user) {
  return user.role === 'admin';
}

export function canCreateCustomer(user) {
  return user.role === 'admin' || user.role === 'sales';
}
