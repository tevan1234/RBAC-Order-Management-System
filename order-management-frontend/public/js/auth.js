// ============================================================
// auth.js — 登入 / 登出 / 認證相關 API
// ============================================================

import { apiRequest } from './utils.js';

// 記憶體私有儲存變數 (Memory Storage)
let _token = null;
let _currentUser = null;
let _expiryTimer = null;

// sessionStorage 備援 Key
const BACKUP_KEY = '_secure_session_state';

// ── 安全混淆輔助函數 ──
function obfuscate(data) {
  try {
    const jsonStr = JSON.stringify(data);
    const step1 = btoa(unescape(encodeURIComponent(jsonStr)));
    const step2 = step1.split('').reverse().join('');
    return btoa(step2);
  } catch (e) {
    return null;
  }
}

function deobfuscate(str) {
  try {
    const step2 = atob(str);
    const step1 = step2.split('').reverse().join('');
    const jsonStr = decodeURIComponent(escape(atob(step1)));
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

// ── JWT 格式與過期驗證 ──
function isValidJwt(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const base64UrlPattern = /^[A-Za-z0-9-_]+$/;
  return parts.every(part => base64UrlPattern.test(part));
}

function getJwtExpiry(token) {
  try {
    const payloadPart = token.split('.')[1];
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    const payload = JSON.parse(jsonPayload);
    return payload.exp ? payload.exp * 1000 : null; // 轉為毫秒
  } catch (e) {
    return null;
  }
}

export function isTokenExpired(token) {
  const expiry = getJwtExpiry(token);
  if (!expiry) return true;
  return Date.now() >= expiry;
}

// ── Token 自動過期登出計時器 ──
function setupTokenExpiryTimer(durationMs) {
  if (_expiryTimer) clearTimeout(_expiryTimer);
  if (durationMs > 2147483647) durationMs = 2147483647; // 防止 setTimeout 溢位
  _expiryTimer = setTimeout(() => {
    sessionStorage.setItem('pendingNotification', JSON.stringify({
      message: '您的登入憑證已過期，系統已自動登出。',
      type: 'warning'
    }));
    logout();
  }, durationMs);
}

// ── 階段備份與還原機制 ──
export function saveSessionBackup() {
  if (_token && _currentUser) {
    const backupData = {
      token: _token,
      user: _currentUser
    };
    const obfuscated = obfuscate(backupData);
    if (obfuscated) {
      sessionStorage.setItem(BACKUP_KEY, obfuscated);
    }
  }
}

export function restoreSession() {
  const backup = sessionStorage.getItem(BACKUP_KEY);
  if (backup) {
    sessionStorage.removeItem(BACKUP_KEY); // 立即清除以降低被竊取的風險
    const data = deobfuscate(backup);
    if (data && data.token && data.user) {
      if (isValidJwt(data.token)) {
        const expiry = getJwtExpiry(data.token);
        const now = Date.now();
        if (expiry && expiry > now) {
          _token = data.token;
          _currentUser = data.user;
          setupTokenExpiryTimer(expiry - now);
          return;
        }
      }
    }
  }
  _token = null;
  _currentUser = null;
}

// ── API 導出介面 ──
export function getToken() {
  if (_token) {
    if (isTokenExpired(_token)) {
      sessionStorage.setItem('pendingNotification', JSON.stringify({
        message: '您的登入憑證已過期，系統已自動登出。',
        type: 'warning'
      }));
      logout();
      return null;
    }
    return _token;
  }
  return null;
}

export function getCurrentUser() {
  return _currentUser;
}

export function updateCurrentUser(userData) {
  if (_currentUser) {
    _currentUser = {
      ..._currentUser,
      ...userData
    };
    saveSessionBackup();
  }
}

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
      
      // 儲存認證資訊至記憶體變數
      _token = data.access_token;
      _currentUser = userData;
      
      // 備份至 sessionStorage 以供頁面跳轉時使用
      saveSessionBackup();

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
 * 登出
 */
export function logout() {
  _token = null;
  _currentUser = null;
  if (_expiryTimer) clearTimeout(_expiryTimer);
  sessionStorage.removeItem(BACKUP_KEY);
  window.location.href = 'index.html';
}

// ── 初始化階段執行 ──
restoreSession();

// 監聽 unload 前寫入備份，確保 F5 重整不遺失登入狀態
window.addEventListener('beforeunload', () => {
  saveSessionBackup();
});

// 頁面載入後綁定登入事件
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
});
