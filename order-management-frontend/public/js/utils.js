// ============================================================
// utils.js — 工具函式 / API 請求 / UI 元件
// ============================================================

const API_BASE = 'http://localhost:8000/api';

// ============================================================
// API 請求核心
// ============================================================

/**
 * 統一的 API 請求函數
 * 自動注入 Bearer Token，處理 401 自動登出
 */
export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    if (response.status === 401) {
      // 在登入頁面不做自動跳轉（避免靜默失敗），直接拋出錯誤
      const isLoginPage = window.location.pathname.includes('index.html') || window.location.pathname === '/';
      if (!isLoginPage) {
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
        return;
      }
      // 登入頁面：讓錯誤往上拋，由 auth.js 顯示訊息
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || '帳號或密碼錯誤');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || '請求失敗');
    }
    return data;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
}

// ============================================================
// 格式化工具
// ============================================================

/**
 * 格式化 ISO 時間字串為 zh-TW 本地格式
 */
export function formatDate(isoString) {
  if (!isoString || isoString === '-') return '-';
  try {
    return new Date(isoString).toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

/**
 * 將 ISO 時間字串轉換為本地日期的 YYYY-MM-DD
 */
export function formatDateISO(isoString) {
  if (!isoString || isoString === '-') return '';
  try {
    const d = new Date(isoString);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

/**
 * 格式化金額為 TWD
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0
  }).format(amount);
}

/**
 * 產生員工 ID（格式：EMP + 4位亂數）
 */
export function generateEmployeeId() {
  return 'EMP' + Math.floor(1000 + Math.random() * 9000);
}

// ============================================================
// 通知系統
// ============================================================

let _notifications = [];
const NOTIF_TOP_START = 24;
const NOTIF_HEIGHT = 60;
const NOTIF_GAP = 12;

/**
 * 顯示浮動通知
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration - 毫秒
 */
export function showNotification(message, type = 'info', duration = 4000) {
  const iconMap = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  const el = document.createElement('div');
  el.className = `notification notification-${type}`;
  el.style.cssText = `
    position: fixed; right: 24px; z-index: 9999;
    display: flex; align-items: center; gap: 10px;
    padding: 14px 18px; border-radius: 12px;
    background: var(--bg-card, #1e293b); color: var(--text-primary, #f1f5f9);
    box-shadow: 0 8px 32px rgba(0,0,0,.35);
    font-size: 14px; max-width: 360px;
    transition: opacity .3s, transform .3s;
    opacity: 0; transform: translateX(20px);
  `;

  const topOffset = NOTIF_TOP_START + _notifications.length * (NOTIF_HEIGHT + NOTIF_GAP);
  el.style.top = topOffset + 'px';

  el.innerHTML = `
    <span style="font-size:18px">${iconMap[type] || 'ℹ️'}</span>
    <span style="flex:1">${message}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;cursor:pointer;font-size:16px;padding:0 4px">×</button>
  `;

  document.body.appendChild(el);
  _notifications.push(el);

  // 淡入
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });

  // 自動移除
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => {
      el.remove();
      _notifications = _notifications.filter(n => n !== el);
    }, 300);
  }, duration);
}

// ============================================================
// 確認對話框
// ============================================================

/**
 * 顯示確認對話框，回傳 Promise<boolean>
 */
export function showConfirm(message, title = '確認操作') {
  return new Promise((resolve) => {
    // 移除舊的 confirm modal（防止重複）
    document.getElementById('_confirmModal')?.remove();

    const modal = document.createElement('div');
    modal.id = '_confirmModal';
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
    `;
    modal.innerHTML = `
      <div style="
        background: var(--bg-card, #1e293b); border-radius: 16px;
        padding: 32px; max-width: 420px; width: 90%;
        box-shadow: 0 24px 64px rgba(0,0,0,.5);
        color: var(--text-primary, #f1f5f9);
      ">
        <h3 style="margin:0 0 12px;font-size:18px">${title}</h3>
        <p style="margin:0 0 24px;color:var(--text-secondary,#94a3b8);line-height:1.6">${message}</p>
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button id="_confirmCancel" style="
            padding:10px 20px;border-radius:8px;border:1px solid var(--border-color,#334155);
            background:transparent;color:var(--text-secondary,#94a3b8);cursor:pointer;font-size:14px
          ">取消</button>
          <button id="_confirmOk" style="
            padding:10px 20px;border-radius:8px;border:none;
            background:var(--accent-error,#ef4444);color:#fff;cursor:pointer;font-size:14px;font-weight:600
          ">確認</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#_confirmOk').addEventListener('click', () => {
      modal.remove();
      resolve(true);
    });
    modal.querySelector('#_confirmCancel').addEventListener('click', () => {
      modal.remove();
      resolve(false);
    });
    // 點擊背景關閉
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { modal.remove(); resolve(false); }
    });
  });
}

// ============================================================
// 自訂下拉選單 (Dropdown)
// ============================================================

/**
 * 初始化自訂下拉選單元件
 * @param {string} dropdownId - 下拉選單容器的 ID
 * @param {function} [onChange] - 選項變更時的 callback，參數為選中的 value
 */
// 用 WeakSet 追蹤已初始化的 dropdown，防止重複綁定全域監聽器
const _initializedDropdowns = new WeakSet();

export function initDropdown(dropdownId, onChange, enableSearch = false) {
  const container = document.getElementById(dropdownId);
  if (!container) return;

  const trigger = container.querySelector('.dropdown-trigger');
  const menu = container.querySelector('.dropdown-menu');
  const selectedLabel = container.querySelector('.dropdown-selected');
  if (!trigger || !menu) return;

  // ── 問題 1 修正：清除 HTML 中硬編碼的 `active` class，改用 `selected` 統一管理 ──
  menu.querySelectorAll('.dropdown-item.active').forEach(i => {
    i.classList.remove('active');
  });
  // 依照 container 的 data-value 初始化選中狀態
  const initValue = container.dataset.value;
  if (initValue) {
    const initItem = menu.querySelector(`[data-value="${initValue}"]`);
    if (initItem) {
      initItem.classList.add('selected');
      if (selectedLabel) selectedLabel.textContent = initItem.textContent.trim();
    }
  }

  // ── 搜尋功能實作 ──
  if (enableSearch && !menu.querySelector('.dropdown-search-wrapper')) {
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'dropdown-search-wrapper';
    searchWrapper.innerHTML = `<input type="text" class="dropdown-search-input" placeholder="搜尋...">`;
    menu.prepend(searchWrapper);

    const searchInput = searchWrapper.querySelector('.dropdown-search-input');
    searchInput.addEventListener('input', (e) => {
      const kw = e.target.value.toLowerCase();
      menu.querySelectorAll('.dropdown-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        const val = (item.dataset.value || '').toLowerCase();
        const isMatch = text.includes(kw) || val.includes(kw);
        item.classList.toggle('hidden', !isMatch);
      });
    });

    searchInput.addEventListener('click', (e) => e.stopPropagation());
  }

  // ── 問題 2 修正：已初始化過的 dropdown 不重複綁定事件 ──
  if (_initializedDropdowns.has(container)) {
    // 僅更新 onChange callback，不重新綁定事件
    container._dropdownOnChange = onChange;
    return;
  }
  _initializedDropdowns.add(container);
  container._dropdownOnChange = onChange;

  // 切換選單開關
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = container.classList.contains('open');
    // 關閉所有其他 dropdown
    document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!isOpen) {
      container.classList.add('open');
      // 自動聚焦搜尋框
      const searchInput = menu.querySelector('.dropdown-search-input');
      if (searchInput) {
        searchInput.value = '';
        menu.querySelectorAll('.dropdown-item').forEach(item => item.classList.remove('hidden'));
        setTimeout(() => searchInput.focus(), 100);
      }
    }
  });

  // 選項點擊
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;

    const value = item.dataset.value;
    const label = item.textContent.trim();

    // 更新顯示文字
    if (selectedLabel) selectedLabel.textContent = label;

    // 儲存當前值
    container.dataset.value = value;

    // 視覺標記（統一用 selected）
    menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');

    container.classList.remove('open');

    if (typeof container._dropdownOnChange === 'function') container._dropdownOnChange(value);
  });

  // 點擊外部關閉（每個 dropdown 只綁定一次全域監聽）
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      container.classList.remove('open');
    }
  });
}


/**
 * 設定下拉選單的選中值（程式碼驅動）
 * @param {string} dropdownId
 * @param {string} value
 */
export function setDropdownValue(dropdownId, value) {
  const container = document.getElementById(dropdownId);
  if (!container) return;

  const selectedLabel = container.querySelector('.dropdown-selected');
  const menu = container.querySelector('.dropdown-menu');

  container.dataset.value = value || '';

  if (!value) {
    if (selectedLabel) selectedLabel.textContent = selectedLabel.dataset.placeholder || '請選擇';
    menu?.querySelectorAll('.dropdown-item').forEach(i => {
    i.classList.remove('selected');
    i.classList.remove('active'); // 同步清除 HTML 中硬編碼的 active class
  });
    return;
  }

  const item = menu?.querySelector(`[data-value="${value}"]`);
  if (item) {
    if (selectedLabel) selectedLabel.textContent = item.textContent.trim();
    menu?.querySelectorAll('.dropdown-item').forEach(i => {
      i.classList.remove('selected');
      i.classList.remove('active'); // 同步清除 HTML 中硬編碼的 active class
    });
    item.classList.add('selected');
  }
}

/**
 * 取得下拉選單當前選中的值
 * @param {string} dropdownId
 * @returns {string}
 */
export function getDropdownValue(dropdownId) {
  const container = document.getElementById(dropdownId);
  return container?.dataset.value || '';
}

/**
 * 渲染帶有 Tooltip 的 HTML
 * @param {string} text - 顯示的文字
 * @param {Array} data - [{label, value}]
 */
export function renderWithTooltip(text, data = []) {
  const rows = data.map(item => `
    <div class="tooltip-row">
      <span class="tooltip-label">${item.label}：</span>
      <span class="tooltip-value">${item.value}</span>
    </div>
  `).join('');

  return `
    <div class="tooltip-wrapper">
      <span class="tooltip-trigger">ⓘ</span>
      <div class="tooltip-content">
        ${rows}
      </div>
      <span class="tooltip-text">${text}</span>
    </div>
  `;
}
