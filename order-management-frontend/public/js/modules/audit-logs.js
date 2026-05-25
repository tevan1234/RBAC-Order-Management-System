// audit-logs.js — 稽核日誌模組

import { 
  f, getF, toSnake, formatDate, formatDateISO, initDropdown 
} from '../utils.js?v=1.0.1';
import { getCurrentUser } from '../auth.js';
import { isAdmin } from '../rbac.js';
import { 
  getCachedLogs, PAGE_SIZE, getLogsPage, setLogsPage,
  getAuditSearch, setAuditSearch
} from './state.js';
import { createPaginator } from './paginator.js';

const currentUser = getCurrentUser();

/**
 * 渲染稽核日誌表格
 */
export function renderAuditLogsList() {
  if (!isAdmin(currentUser)) return;
  const tbody = f('auditLogsTableBody'); 
  if (!tbody) return;
  
  let logs = getCachedLogs();
  const auditSearch = getAuditSearch();

  if (auditSearch.keyword) {
    const kw = auditSearch.keyword.toLowerCase();
    logs = logs.filter(l => String(getF(l, auditSearch.field, toSnake(auditSearch.field))).toLowerCase().includes(kw));
  }
  
  if (auditSearch.dateFrom || auditSearch.dateTo) {
    logs = logs.filter(l => {
      const d = formatDateISO(getF(l, 'timestamp', 'created_at'));
      return !(auditSearch.dateFrom && d < auditSearch.dateFrom) && !(auditSearch.dateTo && d > auditSearch.dateTo);
    });
  }
  
  const logsPage = getLogsPage();
  const paged = logs.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE);

  tbody.innerHTML = '';
  paged.forEach(l => {
    const action = getF(l, 'action', 'action_type');
    const operator = getF(l, 'operator_id', 'operatorId', 'user_id', 'userId') || '-';

    // 解析目標資訊 (處理 JSON 或純文字)
    let targetDisplay = '-';
    const rawTarget = getF(l, 'target', 'target_id', 'targetId');
    if (rawTarget) {
      if (typeof rawTarget === 'string' && (rawTarget.startsWith('{') || rawTarget.startsWith('['))) {
        try {
          const details = JSON.parse(rawTarget);
          targetDisplay = details.order_id || details.customer_id || details.employee_id || details.product_id || details.id || rawTarget;
          if (typeof targetDisplay === 'object') targetDisplay = JSON.stringify(targetDisplay);
        } catch (e) {
          targetDisplay = rawTarget;
        }
      } else {
        targetDisplay = rawTarget;
      }
    }

    const tr = document.createElement('tr');

    // 1. Log ID Cell
    const tdId = document.createElement('td');
    tdId.textContent = getF(l, 'id', 'log_id') || '';
    tr.appendChild(tdId);

    // 2. Action Cell
    const tdAction = document.createElement('td');
    const actionSpan = document.createElement('span');
    actionSpan.className = 'badge';
    actionSpan.textContent = action || '';
    tdAction.appendChild(actionSpan);
    tr.appendChild(tdAction);

    // 3. Operator Cell
    const tdOperator = document.createElement('td');
    const opStrong = document.createElement('strong');
    opStrong.textContent = operator;
    tdOperator.appendChild(opStrong);
    tr.appendChild(tdOperator);

    // 4. Target Cell
    const tdTarget = document.createElement('td');
    tdTarget.textContent = targetDisplay;
    tr.appendChild(tdTarget);

    // 5. Timestamp Cell
    const tdTimestamp = document.createElement('td');
    const timeSmall = document.createElement('small');
    timeSmall.textContent = formatDate(l.timestamp);
    tdTimestamp.appendChild(timeSmall);
    tr.appendChild(tdTimestamp);

    tbody.appendChild(tr);
  });

  if (paged.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--text-secondary)';
    td.textContent = '目前沒有任何資料';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  
  createPaginator(logs.length, PAGE_SIZE, logsPage, p => { 
    setLogsPage(p); 
    renderAuditLogsList(); 
  }, 'auditLogsPaginator');
}

/**
 * 綁定稽核日誌模組事件
 */
export function bindAuditEvents(onRefresh) {
  // 搜尋與篩選事件
  initDropdown('auditFieldDropdown', v => { 
    setAuditSearch({ field: v }); 
    renderAuditLogsList(); 
  });
  
  f('auditSearchKeyword')?.addEventListener('input', e => { 
    setAuditSearch({ keyword: e.target.value }); 
    setLogsPage(1); 
    renderAuditLogsList(); 
  });

  f('auditDateFrom')?.addEventListener('change', e => { 
    setAuditSearch({ dateFrom: e.target.value }); 
    setLogsPage(1); 
    renderAuditLogsList(); 
  });
  
  f('auditDateTo')?.addEventListener('change', e => { 
    setAuditSearch({ dateTo: e.target.value }); 
    setLogsPage(1); 
    renderAuditLogsList(); 
  });

  // 日期重設
  f('auditDateReset')?.addEventListener('click', () => { 
    if (f('auditDateFrom')) f('auditDateFrom').value = ''; 
    if (f('auditDateTo')) f('auditDateTo').value = ''; 
    setAuditSearch({ dateFrom: '', dateTo: '' }); 
    renderAuditLogsList(); 
  });
}
