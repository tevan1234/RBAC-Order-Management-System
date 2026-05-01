// ============================================================
// utils.js — 純工具函式（無副作用）
// ============================================================

/**
 * 格式化 ISO 時間字串為 zh-TW 本地格式
 */
export function formatDate(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

/**
 * 自動產生下一個員工編號（EMP001 → EMP999）
 */
export function generateEmployeeId(users) {
  const max = users
    .map(u => parseInt(u.employeeId.replace('EMP', ''), 10))
    .filter(n => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return 'EMP' + String(max + 1).padStart(3, '0');
}
