// ============================================================
// rbac.js — 統一權限判斷模組
// ============================================================

// ── 角色常量 ──
export const ROLES = {
  ADMIN: 'admin',
  SALES: 'sales',
  VIEWER: 'viewer'
};

// ── 角色特性 ──
export const ROLE_CAPABILITIES = {
  admin: {
    isReadOnly: false,
    canManageUsers: true,
    canViewAuditLogs: true,
    canCreateResources: true
  },
  sales: {
    isReadOnly: false,
    canManageUsers: false,
    canViewAuditLogs: false,
    canCreateResources: true  // 受限於 owner_id
  },
  viewer: {
    isReadOnly: true,          // 關鍵：純唯讀
    canManageUsers: false,
    canViewAuditLogs: false,
    canCreateResources: false
  }
};

// ── 權限定義 (與後端完全同步) ──
export const PERMISSIONS = {
  // Order 相關
  ORDER_VIEW: ['admin', 'sales', 'viewer'],
  ORDER_CREATE: ['admin', 'sales'],
  ORDER_EDIT: ['admin', 'sales'],
  ORDER_VOID: ['admin'],
  ORDER_COMPLETE: ['admin', 'sales'],

  // Customer 相關
  CUSTOMER_VIEW: ['admin', 'sales', 'viewer'],
  CUSTOMER_CREATE: ['admin', 'sales'],
  CUSTOMER_EDIT: ['admin', 'sales'],
  CUSTOMER_VOID: ['admin'],

  // Product 相關 (保持前端 UI 功能運作並統一走 Permission 系統)
  PRODUCT_VIEW: ['admin', 'sales', 'viewer'],
  PRODUCT_CREATE: ['admin'],
  PRODUCT_EDIT: ['admin'],

  // User Management 相關
  USER_VIEW: ['admin'],
  USER_CREATE: ['admin'],
  USER_EDIT: ['admin'],
  USER_DELETE: ['admin'],
  USER_MANAGE_ROLE: ['admin'],

  // Audit Logs 相關
  AUDITLOG_VIEW: ['admin'],

  // Analytics 相關
  ANALYTICS_VIEW: ['admin', 'sales', 'viewer']
};

// ── 基礎角色判斷 ──
export function getRole(user) {
  return (user?.role || ROLES.VIEWER).toLowerCase();
}

export function isAdmin(user) {
  return getRole(user) === ROLES.ADMIN;
}

export function isViewer(user) {
  return getRole(user) === ROLES.VIEWER;
}

export function isSales(user) {
  return getRole(user) === ROLES.SALES;
}

export function isReadOnly(user) {
  const capabilities = ROLE_CAPABILITIES[getRole(user)];
  return capabilities?.isReadOnly ?? true;
}

// ── 統一權限檢查 ──
export function hasPermission(user, permission) {
  const role = getRole(user);
  const allowedRoles = PERMISSIONS[permission] || [];
  return allowedRoles.includes(role);
}

export function canPerformAction(user, permission) {
  if (!user) return false;

  // Viewer 角色不能進行任何 non-VIEW 操作
  if (isReadOnly(user) && !permission.endsWith('_VIEW')) {
    return false;
  }

  return hasPermission(user, permission);
}

// ── 菜單控制 ──
export const menuConfig = {
  [ROLES.ADMIN]: [
    { id: 'dashboard', label: '儀表板', icon: '📊' },
    { id: 'orders', label: '訂單管理', icon: '🛍️' },
    { id: 'analytics', label: '銷售分析', icon: '🤖' },
    { id: 'customers', label: '客戶管理', icon: '👥' },
    { id: 'products', label: '商品管理', icon: '📦' }, // 補回：確保管理員可看商品管理
    { id: 'users', label: '使用者管理', icon: '👤' },
    { id: 'auditlogs', label: '操作紀錄', icon: '📝' },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️' }
  ],
  [ROLES.SALES]: [
    { id: 'dashboard', label: '儀表板', icon: '📊' },
    { id: 'orders', label: '訂單管理', icon: '🛍️' },
    { id: 'analytics', label: '銷售分析', icon: '🤖' },
    { id: 'customers', label: '客戶管理', icon: '👤' },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️' }
  ],
  [ROLES.VIEWER]: [
    { id: 'dashboard', label: '儀表板 (唯讀)', icon: '👁️' },
    { id: 'orders', label: '訂單管理 (唯讀)', icon: '🛍️' },
    { id: 'analytics', label: '銷售分析', icon: '🤖' },
    { id: 'customers', label: '客戶管理 (唯讀)', icon: '👤' },
    { id: 'change-password', label: '帳戶設定', icon: '⚙️' }
  ]
};

export function getMenuItems(role) {
  return menuConfig[role.toLowerCase()] || [];
}

export function canAccessMenu(user, sectionId) {
  if (!user) return false;
  if (sectionId === 'change-password') return true;
  const role = getRole(user);
  const items = menuConfig[role] || [];
  return items.some(item => item.id === sectionId);
}

// ── 資源操作檢查 (向下相容既有呼叫) ──
export function canViewOrder(user, order) {
  return hasPermission(user, 'ORDER_VIEW');
}

export function canEditOrder(user, order) {
  if (!canPerformAction(user, 'ORDER_EDIT')) return false;

  // Sales 需要檢查所有權
  if (isSales(user)) {
    const uid = user.employeeId || user.employee_id;
    const oid = order.ownerId || order.owner_id;
    return oid === uid;
  }

  return true; // Admin 可以編輯任何訂單
}

export function canCreateOrder(user) {
  return canPerformAction(user, 'ORDER_CREATE');
}

export function canCompleteOrder(user, order) {
  if (!canPerformAction(user, 'ORDER_COMPLETE')) return false;

  if (isSales(user)) {
    const uid = user.employeeId || user.employee_id;
    const oid = order.ownerId || order.owner_id;
    return oid === uid;
  }

  return true;
}

export function canVoidOrder(user) {
  return canPerformAction(user, 'ORDER_VOID');
}

export function canViewCustomer(user, customer) {
  return hasPermission(user, 'CUSTOMER_VIEW');
}

export function canEditCustomer(user, customer) {
  if (!canPerformAction(user, 'CUSTOMER_EDIT')) return false;

  if (isSales(user)) {
    const uid = user.employeeId || user.employee_id;
    const oid = customer.ownerId || customer.owner_id;
    return oid === uid;
  }

  return true;
}

export function canCreateCustomer(user) {
  return canPerformAction(user, 'CUSTOMER_CREATE');
}

export function canVoidCustomer(user) {
  return canPerformAction(user, 'CUSTOMER_VOID');
}

// ── 商品相關 (補回：相容既有 UI 並落實權限判定) ──
export function canEditProduct(user) {
  return canPerformAction(user, 'PRODUCT_EDIT');
}

export function canCreateProduct(user) {
  return canPerformAction(user, 'PRODUCT_CREATE');
}

// ── 使用者管理 ──
export function canEditUser(currentUser) {
  return canPerformAction(currentUser, 'USER_EDIT');
}

export function canEditOtherUser(currentUser, targetUser) {
  if (!canPerformAction(currentUser, 'USER_EDIT')) return false;

  const curId = currentUser?.employeeId || currentUser?.employee_id;
  const tarId = targetUser?.employeeId || targetUser?.employee_id;
  return curId !== tarId;
}

export function canDeactivateUser(currentUser, targetUser) {
  if (!canPerformAction(currentUser, 'USER_DELETE')) return false; // 採用 USER_DELETE 同步後端 deactive 操作

  const curId = currentUser?.employeeId || currentUser?.employee_id;
  const tarId = targetUser?.employeeId || targetUser?.employee_id;
  return curId !== tarId;
}

export function canAccessUserManagement(user) {
  return hasPermission(user, 'USER_VIEW');
}

export function canAccessAuditLogs(user) {
  return hasPermission(user, 'AUDITLOG_VIEW');
}

export function validateLastAdmin(users) {
  return users.filter(u => getRole(u) === ROLES.ADMIN && u.status !== 'inactive').length > 1;
}

export function canChangeRole(users, currentUser, targetUser, newRole) {
  if (!canPerformAction(currentUser, 'USER_MANAGE_ROLE')) {
    return { allowed: false, reason: 'Viewer 角色無法進行此操作' };
  }

  if (!currentUser || !targetUser) {
    return { allowed: false, reason: '系統錯誤：缺少使用者資訊' };
  }

  const curRole = getRole(currentUser);
  const tarRole = getRole(targetUser);
  const nRole = newRole.toLowerCase();

  if (tarRole === nRole) {
    return { allowed: true, reason: '' };
  }

  const curId = currentUser.employeeId || currentUser.employee_id;
  const tarId = targetUser.employeeId || targetUser.employee_id;
  if (curId === tarId) {
    return { allowed: false, reason: '無法修改自己的角色，請由其他管理員協助變更' };
  }

  if (tarRole === ROLES.ADMIN && !validateLastAdmin(users)) {
    return { allowed: false, reason: '系統至少需保留一位管理員，無法變更此使用者的角色' };
  }

  return { allowed: true, reason: '' };
}

// ── 錯誤訊息 ──
export const PERMISSION_MESSAGES = {
  READONLY_ROLE: 'Viewer 角色為唯讀，無法進行此操作',
  NOT_OWNER: '您無權修改他人的資源',
  NOT_ADMIN: '此操作僅限管理員',
  INSUFFICIENT_ROLE: '您的角色權限不足'
};
