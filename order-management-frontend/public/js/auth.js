// ============================================================
// auth.js — 登入 / 登出 / 認證相關 API
// ============================================================

import { apiRequest } from './utils.js';

/**
 * 處理登入表單提交
 */
async function handleLogin(event) {
  event.preventDefault();

  const employeeId = document.getElementById('employeeId').value.trim();
  const password = document.getElementById('password').value;
  const errorMessage = document.getElementById('errorMessage');
  const loginButton = event.target.querySelector('button');

  errorMessage.textContent = '';
  loginButton.disabled = true;
  loginButton.textContent = '登入中...';

  try {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employee_id: employeeId, password })
    });

    if (data && data.access_token) {
      // 映射欄位名稱以相容原有前端邏輯
      const userData = {
        ...data.user,
        employeeId: data.user.employee_id
      };
      
      // 儲存認證資訊
      sessionStorage.setItem('token', data.access_token);
      sessionStorage.setItem('currentUser', JSON.stringify(userData));

      sessionStorage.setItem('pendingNotification', JSON.stringify({
        message: `歡迎回來，${data.user.name || data.user.employee_id}！`,
        type: 'success'
      }));

      // 檢查是否需要強制更改密碼
      if (data.user.must_change_password) {
        window.location.href = 'dashboard.html#change-password';
      } else {
        window.location.href = 'dashboard.html';
      }
    }
  } catch (error) {
    errorMessage.textContent = error.message || '登入失敗，請檢查帳號密碼';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = '登入';
  }
}

/**
 * 修改密碼
 */
export async function changePassword(currentPassword, newPassword) {
  return await apiRequest('/auth/change-password', {
    method: 'PATCH',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });
}

/**
 * 更新 Email
 */
export async function updateEmail(newEmail) {
  return await apiRequest('/auth/update-email', {
    method: 'PATCH',
    body: JSON.stringify({ email: newEmail })
  });
}

/**
 * 獲取目前登入使用者 (從 sessionStorage)
 */
export function getCurrentUser() {
  const userJson = sessionStorage.getItem('currentUser');
  return userJson ? JSON.parse(userJson) : null;
}

/**
 * 登出
 */
export function logout() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('currentUser');
  window.location.href = 'index.html';
}

// 頁面載入後綁定登入事件
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
});
