// products.js — 商品管理模組

import { 
  f, getF, toSnake, formatDate, 
  showNotification, initDropdown, 
  setDropdownValue, getDropdownValue, validateAmount 
} from '../utils.js?v=1.0.1';
import { getCurrentUser } from '../auth.js';
import { canEditProduct, isAdmin } from '../rbac.js';
import { saveProduct as saveProductApi, updateProduct } from '../data.js';
import { 
  getCachedProducts, PAGE_SIZE, getProductsPage, setProductsPage,
  getProductSearch, setProductSearch
} from './state.js';
import { createPaginator } from './paginator.js';

const currentUser = getCurrentUser();
let refreshCallback = null;

/**
 * 渲染商品列表表格
 */
export function renderProductsList() {
  if (!isAdmin(currentUser)) return;
  const tbody = f('productsTableBody'); 
  if (!tbody) return;
  
  let prods = getCachedProducts();
  const productSearch = getProductSearch();

  if (productSearch.keyword) {
    const kw = productSearch.keyword.toLowerCase();
    prods = prods.filter(p => String(getF(p, productSearch.field, toSnake(productSearch.field))).toLowerCase().includes(kw));
  }
  
  const productsPage = getProductsPage();
  const paged = prods.slice((productsPage - 1) * PAGE_SIZE, productsPage * PAGE_SIZE);

  tbody.innerHTML = '';
  paged.forEach(p => {
    const pid = getF(p, 'product_id', 'productId');
    const bc = p.status === 'active' ? 'badge-success' : 'badge-secondary';

    const tr = document.createElement('tr');

    // 1. ID Cell
    const tdId = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = pid;
    tdId.appendChild(strong);
    tr.appendChild(tdId);

    // 2. Name Cell
    const tdName = document.createElement('td');
    tdName.textContent = p.name || '';
    tr.appendChild(tdName);

    // 3. Price Cell
    const tdPrice = document.createElement('td');
    tdPrice.style.textAlign = 'right';
    tdPrice.textContent = '$' + Number(p.price || 0).toLocaleString();
    tr.appendChild(tdPrice);

    // 4. Status Cell
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `badge ${bc}`;
    statusSpan.textContent = p.status || 'active';
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 5. Updated At Cell
    const tdUpdated = document.createElement('td');
    tdUpdated.textContent = formatDate(p.updated_at);
    tr.appendChild(tdUpdated);

    // 6. Actions Cell
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    if (canEditProduct(currentUser)) {
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn-sm btn-secondary btn-edit-product';
      btnEdit.dataset.id = pid;
      btnEdit.textContent = '編輯';
      btnEdit.addEventListener('click', () => openProductModal(pid));
      tdActions.appendChild(btnEdit);
    } else {
      tdActions.textContent = '—';
    }
    tr.appendChild(tdActions);

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

  createPaginator(prods.length, PAGE_SIZE, productsPage, p => { 
    setProductsPage(p); 
    renderProductsList(); 
  }, 'productsPaginator');
}

/**
 * 開啟商品 Modal (新增或編輯)
 */
export function openProductModal(id = null) {
  const modal = f('productModal'); if (!modal) return;
  const nameEl = f('productName'), priceEl = f('productPrice'), idEl = f('productIdDisplay'), hiddenIdEl = f('modal_product_id_hidden'), titleEl = f('productModalTitle');
  const statusGroup = f('productStatusGroup'), idGroup = f('product_id_group');
  initDropdown('productStatusDropdown');
  const cachedProducts = getCachedProducts();

  if (id) {
    const p = cachedProducts.find(x => getF(x, 'product_id', 'productId') === id); if (!p) return;
    if (titleEl) titleEl.textContent = '編輯商品';
    if (hiddenIdEl) hiddenIdEl.value = id;
    if (idEl) { idEl.value = id; idEl.readOnly = true; idEl.style.backgroundColor = '#F3F4F6'; }
    if (idGroup) idGroup.style.display = 'block';
    if (nameEl) nameEl.value = p.name;
    if (priceEl) priceEl.value = p.price;
    setDropdownValue('productStatusDropdown', p.status || 'active');
    if (statusGroup) statusGroup.style.display = 'block';
  } else {
    if (titleEl) titleEl.textContent = '新增商品';
    if (hiddenIdEl) hiddenIdEl.value = '';
    if (idEl) { idEl.value = ''; idEl.readOnly = false; idEl.style.backgroundColor = ''; }
    if (idGroup) idGroup.style.display = 'none';
    if (nameEl) nameEl.value = '';
    if (priceEl) priceEl.value = '';
    setDropdownValue('productStatusDropdown', 'active');
    if (statusGroup) statusGroup.style.display = 'none';
  }
  modal.classList.add('active');
}

/**
 * 儲存商品
 */
async function saveProduct() {
  const hiddenId = f('modal_product_id_hidden')?.value;
  const name = f('productName')?.value.trim();
  const priceInput = f('productPrice')?.value;

  if (!name || priceInput === '') return showNotification('請填寫完整資訊', 'warning');
  if (!validateAmount(priceInput)) return showNotification('請輸入合法的商品價格', 'warning');
  const price = Number(priceInput);

  try {
    const status = getDropdownValue('productStatusDropdown');
    if (hiddenId) {
      await updateProduct(hiddenId, { name, price, status });
      showNotification('商品更新成功', 'success');
    } else {
      const data = { name, price, status };
      await saveProductApi(data);
      showNotification('商品建立成功', 'success');
    }
    f('productModal')?.classList.remove('active');
    
    if (refreshCallback) {
      await refreshCallback();
    }
  } catch (e) { 
    showNotification('儲存失敗：' + e.message, 'error'); 
  }
}

/**
 * 綁定商品模組事件
 */
export function bindProductsEvents(onRefresh) {
  refreshCallback = onRefresh;

  f('addProductBtn')?.addEventListener('click', () => openProductModal());
  f('saveProductBtn')?.addEventListener('click', saveProduct);
  f('cancelProductBtn')?.addEventListener('click', () => f('productModal')?.classList.remove('active'));

  // 搜尋事件
  initDropdown('productFieldDropdown', v => { 
    setProductSearch({ field: v }); 
    renderProductsList(); 
  });
  
  f('productSearchKeyword')?.addEventListener('input', e => { 
    setProductSearch({ keyword: e.target.value }); 
    setProductsPage(1); 
    renderProductsList(); 
  });
}
