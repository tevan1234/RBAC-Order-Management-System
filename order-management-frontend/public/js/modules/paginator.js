// paginator.js — 通用分頁元件 (純函式)

import { f } from '../utils.js?v=1.0.1';

/**
 * 建立分頁器 HTML 結構並綁定事件
 * @param {number} total - 資料總筆數
 * @param {number} size - 每頁顯示筆數
 * @param {number} curr - 當前頁碼 (1-indexed)
 * @param {function} onChange - 頁碼變更時的回呼函式
 * @param {string} containerId - 分頁器容器 DOM ID
 */
export function createPaginator(total, size, curr, onChange, containerId) {
  const c = f(containerId);
  if (!c) return;
  const pc = Math.ceil(total / size);
  c.innerHTML = '';
  if (pc <= 1) return;

  // 上一頁按鈕
  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn-pager';
  prevBtn.textContent = '上一頁';
  if (curr === 1) {
    prevBtn.disabled = true;
  } else {
    prevBtn.addEventListener('click', () => onChange(curr - 1));
  }
  c.appendChild(prevBtn);

  // 頁碼與省略號
  for (let i = 1; i <= pc; i++) {
    if (i === 1 || i === pc || Math.abs(i - curr) <= 1) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `btn-pager ${i === curr ? 'active' : ''}`;
      pageBtn.textContent = i;
      if (i !== curr) {
        pageBtn.addEventListener('click', () => onChange(i));
      }
      c.appendChild(pageBtn);
    } else if (Math.abs(i - curr) === 2) {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'pager-ellipsis';
      ellipsis.textContent = '…';
      c.appendChild(ellipsis);
    }
  }

  // 下一頁按鈕
  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn-pager';
  nextBtn.textContent = '下一頁';
  if (curr === pc) {
    nextBtn.disabled = true;
  } else {
    nextBtn.addEventListener('click', () => onChange(curr + 1));
  }
  c.appendChild(nextBtn);
}
