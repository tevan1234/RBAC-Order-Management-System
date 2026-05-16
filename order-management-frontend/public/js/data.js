// ============================================================
// data.js — API 資料存取層
// ============================================================

import { apiRequest } from './utils.js';

// === Products ===
export async function getProducts() {
  return await apiRequest('/products');
}

export async function saveProduct(product) {
  return await apiRequest('/products', {
    method: 'POST',
    body: JSON.stringify(product)
  });
}

export async function updateProduct(productId, data) {
  return await apiRequest(`/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}


// === Orders ===
export async function getOrders() {
  return await apiRequest('/orders/');
}

export async function saveOrder(order) {
  return await apiRequest('/orders/', {
    method: 'POST',
    body: JSON.stringify(order)
  });
}

export async function updateOrder(orderId, data) {
  return await apiRequest(`/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function updateOrderStatus(orderId, status) {
  return await apiRequest(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}

// === Customers ===
export async function getCustomers() {
  return await apiRequest('/customers/');
}

export async function saveCustomer(customer) {
  return await apiRequest('/customers/', {
    method: 'POST',
    body: JSON.stringify(customer)
  });
}

export async function updateCustomer(customerId, data) {
  return await apiRequest(`/customers/${customerId}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

// === Users ===
export async function getUsers() {
  return await apiRequest('/users/');
}

export async function saveUser(userData) {
  return await apiRequest('/users/', {
    method: 'POST',
    body: JSON.stringify(userData)
  });
}

export async function updateUser(userId, data) {
  return await apiRequest(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export async function deleteUser(userId) {
  return await apiRequest(`/users/${userId}`, {
    method: 'DELETE'
  });
}

// === Audit Logs ===
export async function getLogs() {
  return await apiRequest('/audit/');
}

// === Initialization ===
// 由於現在是 API 驅動，initData 不再需要初始化 localStorage
export function initData() {
  console.log('Data layer initialized (API mode)');
}
