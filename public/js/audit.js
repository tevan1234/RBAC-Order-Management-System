// ============================================================
// audit.js — Audit Log 寫入模組
// ============================================================

import { getLogs } from './data.js';

/**
 * 寫入一筆操作紀錄至 localStorage
 * @param {string} action    - 操作類型 (CREATE_ORDER, UPDATE_USER, …)
 * @param {string} target    - 操作目標 (ORD-1, EMP004, C001, …)
 * @param {object} currentUser - 當前登入使用者物件
 */
export function addLog(action, target, currentUser) {
  const logs = getLogs();

  logs.push({
    id: 'LOG-' + Date.now(),
    action,
    userId: currentUser.employeeId,
    target,
    timestamp: new Date().toISOString()
  });

  localStorage.setItem('auditLogs', JSON.stringify(logs));
}
