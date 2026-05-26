// state.js — 全域共享狀態管理中心

// ── 全域快取 ──
let cachedOrders = [];
let cachedCustomers = [];
let cachedProducts = [];
let cachedUsers = [];
let cachedLogs = [];

// ── 常數與分頁狀態 ──
export const PAGE_SIZE = 10;
let ordersPage = 1;
let customersPage = 1;
let usersPage = 1;
let logsPage = 1;
let productsPage = 1;

// ── 搜尋參數 ──
let orderSearch = { keyword: '', field: 'id', dateFrom: '', dateTo: '', dateField: 'updated_at' };
let customerSearch = { keyword: '', field: 'customerId' };
let productSearch = { keyword: '', field: 'name' };
let userSearch = { keyword: '', field: 'employeeId' };
let auditSearch = { keyword: '', field: 'action', dateFrom: '', dateTo: '' };

// ── Getter ──
export const getCachedOrders = () => cachedOrders;
export const getCachedCustomers = () => cachedCustomers;
export const getCachedProducts = () => cachedProducts;
export const getCachedUsers = () => cachedUsers;
export const getCachedLogs = () => cachedLogs;

export const getOrdersPage = () => ordersPage;
export const getCustomersPage = () => customersPage;
export const getUsersPage = () => usersPage;
export const getLogsPage = () => logsPage;
export const getProductsPage = () => productsPage;

export const getOrderSearch = () => orderSearch;
export const getCustomerSearch = () => customerSearch;
export const getProductSearch = () => productSearch;
export const getUserSearch = () => userSearch;
export const getAuditSearch = () => auditSearch;

// ── Setter ──
export const setCachedOrders = (data) => { cachedOrders = Array.isArray(data) ? data : []; };
export const setCachedCustomers = (data) => { cachedCustomers = Array.isArray(data) ? data : []; };
export const setCachedProducts = (data) => { cachedProducts = Array.isArray(data) ? data : []; };
export const setCachedUsers = (data) => { cachedUsers = Array.isArray(data) ? data : []; };
export const setCachedLogs = (data) => { cachedLogs = Array.isArray(data) ? data : []; };

export const setOrdersPage = (page) => { ordersPage = page; };
export const setCustomersPage = (page) => { customersPage = page; };
export const setUsersPage = (page) => { usersPage = page; };
export const setLogsPage = (page) => { logsPage = page; };
export const setProductsPage = (page) => { productsPage = page; };

export const setOrderSearch = (params) => { orderSearch = { ...orderSearch, ...params }; };
export const setCustomerSearch = (params) => { customerSearch = { ...customerSearch, ...params }; };
export const setProductSearch = (params) => { productSearch = { ...productSearch, ...params }; };
export const setUserSearch = (params) => { userSearch = { ...userSearch, ...params }; };
export const setAuditSearch = (params) => { auditSearch = { ...auditSearch, ...params }; };

// ── 全域狀態完整清理（登出時呼叫，防止跨使用者資料洩漏） ──
export function clearAllState() {
  cachedOrders = [];
  cachedCustomers = [];
  cachedProducts = [];
  cachedUsers = [];
  cachedLogs = [];
  ordersPage = 1;
  customersPage = 1;
  usersPage = 1;
  logsPage = 1;
  productsPage = 1;
  orderSearch = { keyword: '', field: 'id', dateFrom: '', dateTo: '', dateField: 'updated_at' };
  customerSearch = { keyword: '', field: 'customerId' };
  productSearch = { keyword: '', field: 'name' };
  userSearch = { keyword: '', field: 'employeeId' };
  auditSearch = { keyword: '', field: 'action', dateFrom: '', dateTo: '' };
}
