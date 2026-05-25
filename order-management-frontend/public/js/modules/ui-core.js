// ui-core.js — UI 核心與閒置偵測

import { f } from '../utils.js?v=1.0.1';
import { getMenuItems } from '../rbac.js';
import { logout } from '../auth.js';
import { showNotification } from '../utils.js?v=1.0.1';
import { navigateTo } from './navigation.js';

// ── 閒置偵測 (30 分鐘) ──
let idleTimer = null;
const IDLE_TIMEOUT = 30 * 60 * 1000;

export function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showNotification('您已閒置超過 30 分鐘，系統將自動登出以保護帳戶安全。', 'warning');
    setTimeout(() => {
      logout();
    }, 2000);
  }, IDLE_TIMEOUT);
}

export function initIdleDetection() {
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  events.forEach(event => {
    document.addEventListener(event, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

/**
 * 更新頂部列 UI 顯示
 * @param {object} currentUser - 當前登入使用者
 */
export function updateHeaderUI(currentUser) {
  if (!currentUser) return;
  const idEl = f('displayEmployeeId');
  const badgeEl = f('roleBadgeContainer');
  const welcomeEl = f('welcomeUserName');
  
  if (idEl) idEl.textContent = currentUser.employeeId || currentUser.employee_id || 'Unknown';
  if (welcomeEl) welcomeEl.textContent = currentUser.name || currentUser.employeeId || currentUser.employee_id || '使用者';

  if (badgeEl) {
    const role = (currentUser.role || 'viewer').toLowerCase();
    badgeEl.innerHTML = '';
    const span = document.createElement('span');
    span.className = `badge badge-${role}`;
    span.textContent = role.toUpperCase();
    badgeEl.appendChild(span);
  }
}

/**
 * 渲染側邊選單
 * @param {object} currentUser - 當前登入使用者
 */
export function renderSidebarMenu(currentUser) {
  if (!currentUser) return;
  const menuEl = f('sidebarMenu');
  if (!menuEl) return;

  const role = (currentUser.role || 'viewer').toLowerCase();
  const items = getMenuItems(role);

  menuEl.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'menu-item';
    li.dataset.section = item.id;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.textContent = item.icon;
    li.appendChild(iconSpan);

    li.appendChild(document.createTextNode(' ' + item.label));

    li.addEventListener('click', () => {
      window.location.hash = item.id;
      navigateTo(item.id);
      f('sidebar')?.classList.remove('mobile-active');
      f('sidebarOverlay')?.classList.remove('active');
    });

    menuEl.appendChild(li);
  });
}
