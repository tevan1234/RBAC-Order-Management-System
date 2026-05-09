// ============================================================
// data.js — localStorage CRUD + Data-Level Security + 初始化
// ============================================================

import { canViewOrder, canViewCustomer } from './rbac.js';

// === Products（固定商品表，不存 localStorage）===
export const defaultProducts = [
  { productId: 'P001', name: 'iPhone 15',   price: 1200 },
  { productId: 'P002', name: 'MacBook Air', price: 2400 },
  { productId: 'P003', name: 'iPad Pro',    price: 3600 }
];

// === 預設使用者 ===
const defaultUsers = [
  { employeeId: 'EMP001', email: 'admin@test.com',  password: 'admin123',  role: 'admin',  name: '管理者',   status: 'active' },
  { employeeId: 'EMP002', email: 'sales@test.com',  password: 'user123',   role: 'sales',  name: '銷售專員', status: 'active' },
  { employeeId: 'EMP003', email: 'viewer@test.com', password: 'viewer123', role: 'viewer', name: '檢視者',   status: 'active' }
];

// === 預設訂單 ===
const defaultOrders = [
  { id: 'ORD-1', customer: '王小明', productId: 'P001', amount: 1200, status: '已完成', ownerId: 'EMP001', createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' },
  { id: 'ORD-2', customer: '李小華', productId: 'P002', amount: 2400, status: '處理中', ownerId: 'EMP002', createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' },
  { id: 'ORD-3', customer: '陳大文', productId: 'P003', amount: 3600, status: '處理中', ownerId: 'EMP002', createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' }
];

// === 預設客戶 ===
const defaultCustomers = [
  { customerId: 'C001', name: '王小明', email: 'customer1@test.com', ownerId: 'EMP002', status: 'active', createdAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T10:00:00Z' },
  { customerId: 'C002', name: '李小華', email: 'customer2@test.com', ownerId: 'EMP001', status: 'active', createdAt: '2026-05-01T09:00:00Z', updatedAt: '2026-05-01T09:30:00Z' }
];

// === 預設 Audit Logs ===
const defaultAuditLogs = [
  { id: 'LOG-1', action: 'CREATE_ORDER', userId: 'EMP001', target: 'ORD-1', timestamp: '2026-05-01T10:00:00Z' }
];

// ── 初始化預設資料 ──

export function initData() {
  // Users
  const storedUsers = localStorage.getItem('users');
  if (!storedUsers) {
    localStorage.setItem('users', JSON.stringify(defaultUsers));
  } else {
    try {
      const users = JSON.parse(storedUsers);
      if (!users.some(u => u.email)) {
        localStorage.setItem('users', JSON.stringify(defaultUsers));
      }
    } catch (e) {
      localStorage.setItem('users', JSON.stringify(defaultUsers));
    }
  }

  // Orders
  const storedOrders = localStorage.getItem('orders');
  let shouldResetOrders = !storedOrders;
  if (storedOrders) {
    try {
      const parsed = JSON.parse(storedOrders);
      if (parsed.length > 0 && !parsed[0].productId) shouldResetOrders = true;
    } catch (e) { shouldResetOrders = true; }
  }
  if (shouldResetOrders) {
    localStorage.setItem('orders', JSON.stringify(defaultOrders));
  }

  // Customers
  if (!localStorage.getItem('customers')) {
    localStorage.setItem('customers', JSON.stringify(defaultCustomers));
  }

  // Audit Logs
  if (!localStorage.getItem('auditLogs')) {
    localStorage.setItem('auditLogs', JSON.stringify(defaultAuditLogs));
  }
}

// ── Session ──

export function getCurrentUser() {
  const str = localStorage.getItem('currentUser');
  if (!str) return null;
  try { return JSON.parse(str); }
  catch (e) { return null; }
}

export function setCurrentUser(sessionInfo) {
  try {
    localStorage.setItem('currentUser', JSON.stringify(sessionInfo));
  } catch (e) {
    console.error('[setCurrentUser] localStorage 寫入失敗', e);
  }
}

export function clearCurrentUser() {
  localStorage.removeItem('currentUser');
}

// ── Orders CRUD ──

export function getOrders() {
  try {
    return JSON.parse(localStorage.getItem('orders') || '[]');
  } catch (e) {
    console.error('[getOrders] 資料解析失敗', e);
    return [];
  }
}

export function getVisibleOrders(currentUser) {
  return getOrders().filter(o => canViewOrder(currentUser, o));
}

export function saveOrders(orders) {
  localStorage.setItem('orders', JSON.stringify(orders));
}

// ── Customers CRUD ──

export function getCustomers() {
  try {
    return JSON.parse(localStorage.getItem('customers') || '[]');
  } catch (e) {
    console.error('[getCustomers] 資料解析失敗', e);
    return [];
  }
}

export function getVisibleCustomers(currentUser) {
  return getCustomers().filter(c => canViewCustomer(currentUser, c));
}

export function saveCustomers(customers) {
  localStorage.setItem('customers', JSON.stringify(customers));
}

// ── Users CRUD ──

export function getUsers() {
  try {
    return JSON.parse(localStorage.getItem('users') || '[]');
  } catch (e) {
    console.error('[getUsers] 資料解析失敗', e);
    return [];
  }
}

export function saveUsers(users) {
  localStorage.setItem('users', JSON.stringify(users));
}

// ── Audit Logs Read ──

export function getLogs() {
  try {
    return JSON.parse(localStorage.getItem('auditLogs') || '[]');
  } catch (e) {
    console.error('[getLogs] 資料解析失敗', e);
    return [];
  }
}
