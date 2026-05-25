// account-settings.js — 帳戶設定模組

import { f, showNotification, validateEmail } from '../utils.js?v=1.0.1';
import { getCurrentUser, updateCurrentUser } from '../auth.js';
import { updateHeaderUI } from './ui-core.js';

const currentUser = getCurrentUser();

/**
 * 渲染帳戶設定表單
 */
export function renderAccountSettings() {
  const accEmail = f('accEmail');
  const accEmailLock = f('accEmailLock');

  if (f('accEmployeeId')) f('accEmployeeId').value = currentUser.employeeId || currentUser.employee_id || '';
  if (f('accName')) f('accName').value = currentUser.name || '-';
  if (accEmail) accEmail.value = currentUser.email || '-';

  // 權限控制：sales, viewer 可編輯 Email，admin 不可
  const role = (currentUser.role || 'viewer').toLowerCase();
  if (role === 'admin') {
    if (accEmail) accEmail.readOnly = true;
    accEmail?.parentElement.classList.add('readonly-input-wrapper');
    if (accEmailLock) accEmailLock.style.display = 'block';
  } else {
    if (accEmail) accEmail.readOnly = false;
    accEmail?.parentElement.classList.remove('readonly-input-wrapper');
    if (accEmailLock) accEmailLock.style.display = 'none';
  }
}

/**
 * 儲存個人帳戶變更 (Email 與密碼)
 */
export async function saveAccountSettings(event) {
  if (event) event.preventDefault();
  
  const currentEmail = currentUser.email;
  const newEmail = f('accEmail')?.value.trim();
  const currentPassword = f('accCurrentPassword')?.value;
  const newPassword = f('accNewPassword')?.value;
  const confirmPassword = f('accConfirmPassword')?.value;

  try {
    let emailUpdated = false;
    let passwordUpdated = false;

    // 1. 處理 Email 更新
    if (newEmail !== currentEmail) {
      if (!validateEmail(newEmail)) return showNotification('請輸入合法的 Email 格式', 'warning');
      const { updateEmail } = await import('../auth.js');
      await updateEmail(newEmail);
      currentUser.email = newEmail;
      emailUpdated = true;
    }

    // 2. 處理密碼更新
    if (newPassword) {
      if (newPassword !== confirmPassword) {
        return showNotification('新密碼與確認密碼不符', 'warning');
      }
      if (!currentPassword) {
        return showNotification('請輸入目前密碼以驗證身分', 'warning');
      }
      const { changePassword } = await import('../auth.js');
      await changePassword(currentPassword, newPassword);
      currentUser.must_change_password = false;
      passwordUpdated = true;
    }

    if (!emailUpdated && !passwordUpdated) {
      return showNotification('未偵測到任何變更', 'info');
    }

    // 更新本地與快取的使用者資訊
    updateCurrentUser(currentUser);
    updateHeaderUI(currentUser);

    // 清空密碼欄位
    if (f('accCurrentPassword')) f('accCurrentPassword').value = '';
    if (f('accNewPassword')) f('accNewPassword').value = '';
    if (f('accConfirmPassword')) f('accConfirmPassword').value = '';

    showNotification('帳戶設定已成功更新', 'success');
  } catch (e) {
    showNotification('更新失敗：' + e.message, 'error');
  }
}

/**
 * 綁定帳戶設定模組事件
 */
export function bindAccountSettingsEvents(onRefresh) {
  f('accountSettingsForm')?.addEventListener('submit', saveAccountSettings);
}
