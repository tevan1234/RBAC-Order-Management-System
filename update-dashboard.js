const fs = require('fs');
let code = fs.readFileSync('public/js/dashboard.js', 'utf8');

// 1. Add notification code at the top
const notifCode = `// ============================================================
// 全域通知系統
// type: 'success' | 'error' | 'warning' | 'info'
// ============================================================

function showNotification(message, type = 'info', duration = 3500) {
  // 移除同類型的現有通知，避免堆疊
  document.querySelectorAll(\`.notification.notification-\${type}\`).forEach(el => el.remove());

  const notification = document.createElement('div');
  notification.className = \`notification notification-\${type}\`;

  const iconMap = {
    success: '✅',
    error:   '❌',
    warning: '⚠️',
    info:    'ℹ️'
  };

  notification.innerHTML = \`
    <span class="notification-icon">\${iconMap[type] || 'ℹ️'}</span>
    <span class="notification-message">\${message}</span>
    <button class="notification-close" aria-label="關閉">×</button>
  \`;

  document.body.appendChild(notification);

  // 關閉按鈕
  notification.querySelector('.notification-close').addEventListener('click', () => {
    dismissNotification(notification);
  });

  // 自動消失
  const timer = setTimeout(() => dismissNotification(notification), duration);

  // 滑鼠停留時暫停計時
  notification.addEventListener('mouseenter', () => clearTimeout(timer));
  notification.addEventListener('mouseleave', () => {
    setTimeout(() => dismissNotification(notification), 1500);
  });

  // 觸發入場動畫
  requestAnimationFrame(() => notification.classList.add('notification-show'));
}

function dismissNotification(el) {
  el.classList.remove('notification-show');
  el.classList.add('notification-hide');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

`;
code = code.replace('// ── 全域快取 ──', notifCode + '// ── 全域快取 ──');

// 2. Add routing logic in loadSectionData
code = code.replace(
  "case 'auditlogs': if (isAdmin(currentUser)) renderAuditLogsTable(); break;", 
  "case 'auditlogs': if (isAdmin(currentUser)) renderAuditLogsTable(); break;\n    case 'change-password': renderChangePasswordSection(); break;"
);

// 3. Replace alerts
code = code.replace(/alert\('無權限([^']*)'\)/g, "showNotification('無權限$1', 'error')");
code = code.replace(/alert\('請填寫([^']*)'\)/g, "showNotification('請填寫$1', 'warning')");
code = code.replace(/alert\('系統至少需保留一位管理員([^']*)'\)/g, "showNotification('系統至少需保留一位管理員$1', 'error')");
code = code.replace(/alert\(roleCheck\.reason\)/g, "showNotification(roleCheck.reason, 'error')");
code = code.replace(/alert\('您只能編輯自己的客戶'\)/g, "showNotification('您只能編輯自己的客戶', 'error')");
code = code.replace(/alert\('員工編號已存在'\)/g, "showNotification('員工編號已存在', 'error')");
code = code.replace(/alert\('無法停用此使用者'\)/g, "showNotification('無法停用此使用者', 'error')");

// 4. Add Change Password Render Function
const cpRenderCode = `
// ============================================================
// Change Password
// ============================================================

function renderChangePasswordSection() {
  const form = document.getElementById('changePasswordForm');
  if (!form) return;

  // 避免重複綁定
  form.onsubmit = null;
  form.onsubmit = (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword     = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
      showNotification('兩次輸入的密碼不一致', 'error');
      return;
    }

    if (newPassword.length < 6) {
      showNotification('密碼長度至少需要 6 個字元', 'error');
      return;
    }

    const users = getUsers();
    const index = users.findIndex(u => u.employeeId === currentUser.employeeId);

    if (index === -1) {
      showNotification('找不到使用者資料，請重新登入', 'error');
      return;
    }

    if (users[index].password !== currentPassword) {
      showNotification('目前密碼輸入錯誤', 'error');
      return;
    }

    users[index].password          = newPassword;
    users[index].mustChangePassword = false;
    saveUsers(users);

    addLog('CHANGE_PASSWORD', currentUser.employeeId, currentUser);
    form.reset();
    showNotification('密碼已成功更新', 'success');
  };
}
`;
code += cpRenderCode;

// 5. Add initialization code in DOMContentLoaded
const initLogic = `  // Toast Notification Initialization
  const pending = sessionStorage.getItem('pendingNotification');
  if (pending) {
    try {
      const { message, type } = JSON.parse(pending);
      setTimeout(() => showNotification(message, type), 300);
    } catch (_) {}
    sessionStorage.removeItem('pendingNotification');
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('action') === 'change-password') {
    showNotification('首次登入，請先修改密碼', 'warning');
    navigateTo('change-password');
    history.replaceState(null, '', 'dashboard.html');
  } else {
    navigateTo('dashboard');
  }`;
code = code.replace(
  "// 5. 預設載入 Dashboard\n  navigateTo('dashboard');", 
  initLogic
);

fs.writeFileSync('public/js/dashboard.js', code);
console.log('Updated public/js/dashboard.js');
