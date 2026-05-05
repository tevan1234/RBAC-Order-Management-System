// ============================================================
// auth.js — 登入 / 登出 / Session (ES Module)
// ============================================================

import { initData, getUsers, setCurrentUser } from './data.js';

// 初始化資料
initData();

// 登入處理
function handleLogin(event) {
  event.preventDefault();

  const employeeId = document.getElementById('employeeId').value.trim();
  const password   = document.getElementById('password').value;
  const errorMessage = document.getElementById('errorMessage');

  errorMessage.textContent = '';

  const users = getUsers();
  const user  = users.find(u => u.employeeId === employeeId && u.password === password);

  if (!user) {
    errorMessage.textContent = '帳號或密碼錯誤';
    return;
  }

  if (user.status === 'inactive') {
    errorMessage.textContent = '此帳號已被停用，請聯繫管理員';
    return;
  }

  // 建立 session
  const sessionInfo = {
    employeeId: user.employeeId,
    email: user.email, // 新增此屬性
    role: user.role,
    name: user.name,
    mustChangePassword: user.mustChangePassword,
    loginAt: new Date().toISOString()
  };

  setCurrentUser(sessionInfo);

  sessionStorage.setItem('pendingNotification', JSON.stringify({
    message: `歡迎回來，${user.name || user.employeeId}！`,
    type: 'success'
  }));

  // 首次登入強制變更密碼
  if (user.mustChangePassword) {
    window.location.href = 'dashboard.html?action=change-password';
  } else {
    window.location.href = 'dashboard.html';
  }
}

// 頁面載入後執行
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
});
