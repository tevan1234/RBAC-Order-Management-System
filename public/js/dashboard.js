// RBAC Configuration
const menuConfig = {
    admin: [
        { id: 'dashboard', label: '儀表板', icon: '📊' },
        { id: 'customers', label: '客戶管理', icon: '👤' },
        { id: 'orders', label: '訂單管理', icon: '🛍️' },
        { id: 'users', label: '使用者管理', icon: '👥' },
        { id: 'permissions', label: '權限設定', icon: '⚙️' }
    ],
    sales: [
        { id: 'dashboard', label: '儀表板', icon: '📊' },
        { id: 'customers', label: '客戶管理', icon: '👤' },
        { id: 'orders', label: '訂單管理', icon: '🛍️' }
    ],
    viewer: [
        { id: 'dashboard', label: '儀表板 (唯讀)', icon: '👁️' },
        { id: 'customers', label: '客戶管理', icon: '👤' }
    ]
};

// 商品查表
const defaultProducts = [
  { productId: "P001", name: "iPhone 15", price: 1200 },
  { productId: "P002", name: "MacBook Air", price: 2400 },
  { productId: "P003", name: "iPad Pro", price: 3600 }
];

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
    // 1. RBAC Guard - 檢查登入狀態
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) {
        window.location.href = 'index.html';
        return;
    }

    let user;
    try {
        user = JSON.parse(userStr);
    } catch (e) {
        console.error('Failed to parse user session', e);
        window.location.href = 'index.html';
        return;
    }

    if (!user || !user.role) {
        window.location.href = 'index.html';
        return;
    }

    // 2. 初始化資料庫
    initData();

    // 3. 初始化 UI
    initUI(user);
    
    // 4. 綁定事件
    bindEvents();
    
    // 5. 預設載入 Dashboard
    navigateTo('dashboard', user);
});

function initData() {
    // Orders 資料
    const storedOrders = localStorage.getItem('orders');
    let shouldResetOrders = !storedOrders;

    if (storedOrders) {
        try {
            const parsedOrders = JSON.parse(storedOrders);
            // 檢查舊版結構，如果沒有 productId 就強制重置
            if (parsedOrders.length > 0 && !parsedOrders[0].productId) {
                shouldResetOrders = true;
            }
        } catch (e) {
            shouldResetOrders = true;
        }
    }

    if (shouldResetOrders) {
        const defaultOrders = [
            { id: 'ORD-1', customer: "王小明", productId: "P001", amount: 1200, status: "已完成", ownerId: "EMP001", createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-01T10:00:00Z" },
            { id: 'ORD-2', customer: "李小華", productId: "P002", amount: 2400, status: "處理中", ownerId: "EMP002", createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-01T10:00:00Z" },
            { id: 'ORD-3', customer: "陳大文", productId: "P003", amount: 3600, status: "處理中", ownerId: "EMP002", createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-01T10:00:00Z" }
        ];
        localStorage.setItem('orders', JSON.stringify(defaultOrders));
    }

    // Customers 資料
    if (!localStorage.getItem('customers')) {
        const defaultCustomers = [
            {
                customerId: "C001",
                name: "王小明",
                email: "customer1@test.com",
                ownerId: "EMP002",
                status: "active",
                createdAt: "2026-05-01T10:00:00Z",
                updatedAt: "2026-05-01T10:00:00Z"
            },
            {
                customerId: "C002",
                name: "李小華",
                email: "customer2@test.com",
                ownerId: "EMP001",
                status: "active",
                createdAt: "2026-05-01T09:00:00Z",
                updatedAt: "2026-05-01T09:30:00Z"
            }
        ];
        localStorage.setItem('customers', JSON.stringify(defaultCustomers));
    }
}

function initUI(user) {
    // Topbar 資訊
    document.getElementById('displayEmployeeId').textContent = user.name || user.employeeId;
    document.getElementById('welcomeUserName').textContent = user.name || user.employeeId;
    
    // Role Badge
    const badgeContainer = document.getElementById('roleBadgeContainer');
    const badgeClass = `badge badge-${user.role}`;
    const displayRole = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    badgeContainer.innerHTML = `<span class="${badgeClass}">${displayRole}</span>`;

    // 產生側邊欄選單
    renderSidebar(user.role);

    // 控制 Orders 區塊的「新增訂單」按鈕
    const addOrderBtn = document.getElementById('addOrderBtn');
    if (addOrderBtn) {
        addOrderBtn.style.display = (user.role === 'admin' || user.role === 'sales') ? 'block' : 'none';
    }

    // 控制 Customers 區塊的「新增客戶」按鈕
    const addCustomerBtn = document.getElementById('addCustomerBtn');
    if (addCustomerBtn) {
        addCustomerBtn.style.display = (user.role === 'admin' || user.role === 'sales') ? 'block' : 'none';
    }
}

function renderSidebar(role) {
    const menuContainer = document.getElementById('sidebarMenu');
    const allowedMenus = menuConfig[role] || [];
    
    menuContainer.innerHTML = allowedMenus.map(item => `
        <li class="menu-item" data-target="${item.id}">
            <span class="menu-icon">${item.icon}</span>
            <span class="menu-text">${item.label}</span>
        </li>
    `).join('');

    // 綁定選單點擊事件
    document.querySelectorAll('.menu-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const user = JSON.parse(localStorage.getItem('currentUser'));
            navigateTo(targetId, user);
        });
    });
}

function navigateTo(sectionId, user) {
    // 驗證權限
    const allowedMenus = menuConfig[user.role] || [];
    const isAllowed = allowedMenus.some(item => item.id === sectionId);

    // 隱藏所有 section
    document.querySelectorAll('.section-content').forEach(section => {
        section.classList.remove('active');
    });

    if (isAllowed) {
        // 顯示目標 section
        const targetSection = document.getElementById(`section-${sectionId}`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // 更新頁面標題
        const menuItem = allowedMenus.find(item => item.id === sectionId);
        if (menuItem) {
            document.getElementById('currentPageTitle').textContent = menuItem.label;
        }

        // 載入該 section 的資料
        loadSectionData(sectionId, user);
    } else {
        // 無權限存取
        document.getElementById('section-unauthorized').classList.add('active');
        document.getElementById('currentPageTitle').textContent = '權限不足';
    }

    // 更新 Sidebar Active 狀態
    document.querySelectorAll('.menu-item').forEach(el => {
        if (el.getAttribute('data-target') === sectionId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function loadSectionData(sectionId, user) {
    if (sectionId === 'orders') {
        renderOrdersTable();
    } else if (sectionId === 'customers') {
        renderCustomersTable();
    } else if (sectionId === 'users' && user.role === 'admin') {
        renderUsersTable();
    }
}

function formatDate(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/* =========================================
   Customers Management Logic
========================================= */

function getCustomers() {
    return JSON.parse(localStorage.getItem('customers') || '[]');
}

function saveCustomers(customers) {
    localStorage.setItem('customers', JSON.stringify(customers));
}

function renderCustomersTable() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;
    
    let customers = getCustomers();
    const usersList = JSON.parse(localStorage.getItem('users') || '[]');

    // Data-level 過濾：sales 只能看見自己的客戶
    if (user.role === 'sales') {
        customers = customers.filter(c => c.ownerId === user.employeeId);
    }

    tbody.innerHTML = customers.map(customer => {
        // 狀態 Badge 顏色
        const badgeClass = customer.status === 'active' ? 'badge-success' : 'badge-secondary';
        
        // 負責人查表
        const ownerUser = usersList.find(u => u.employeeId === customer.ownerId);
        const ownerName = ownerUser ? ownerUser.name : customer.ownerId;

        // 動作按鈕邏輯
        let actionsHtml = '';
        if (user.role !== 'viewer' && customer.status !== 'inactive') {
            // Edit: admin 可編輯所有，sales 可編輯自己的
            if (user.role === 'admin' || (user.role === 'sales' && customer.ownerId === user.employeeId)) {
                actionsHtml += `<button class="btn-secondary" onclick="openCustomerModal('${customer.customerId}')">編輯</button>`;
            }
            // Void: 只有 admin 可作廢
            if (user.role === 'admin') {
                actionsHtml += `<button class="btn-danger" onclick="voidCustomer('${customer.customerId}')">作廢</button>`;
            }
        }

        return `
            <tr>
                <td><strong>${customer.customerId}</strong></td>
                <td>${customer.name}</td>
                <td>${customer.email}</td>
                <td><span class="badge badge-viewer">${ownerName}</span></td>
                <td><span class="badge ${badgeClass}">${customer.status}</span></td>
                <td><small style="color:#6B7280">${formatDate(customer.createdAt)}</small></td>
                <td><small style="color:#6B7280">${formatDate(customer.updatedAt)}</small></td>
                <td class="actions-cell">${actionsHtml}</td>
            </tr>
        `;
    }).join('');
}

// 開啟 Customer Modal (新增/編輯)
window.openCustomerModal = function(customerId = null) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    const modal = document.getElementById('customerModal');
    const title = document.getElementById('customerModalTitle');
    const idInput = document.getElementById('customerId');
    const nameInput = document.getElementById('customerName');
    const emailInput = document.getElementById('customerEmail');

    // 權限檢查
    if (user.role === 'viewer') {
        alert("無權限操作");
        return;
    }

    if (customerId) {
        // 編輯模式
        const customers = getCustomers();
        const customer = customers.find(c => c.customerId === customerId);
        if (!customer) return;

        // Data-level 權限防護：sales 只能編輯自己的客戶
        if (user.role === 'sales' && customer.ownerId !== user.employeeId) {
            alert("您只能編輯自己的客戶");
            return;
        }

        title.textContent = '編輯客戶';
        idInput.value = customer.customerId;
        nameInput.value = customer.name;
        emailInput.value = customer.email;
    } else {
        // 新增模式
        title.textContent = '新增客戶';
        idInput.value = '';
        nameInput.value = '';
        emailInput.value = '';
    }

    modal.classList.add('active');
}

// 關閉 Customer Modal
window.closeCustomerModal = function() {
    document.getElementById('customerModal').classList.remove('active');
}

// 儲存客戶
window.saveCustomer = function() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    
    // 權限防護
    if (user.role === 'viewer') {
        alert("無權限操作");
        return;
    }

    const id = document.getElementById('customerId').value;
    const name = document.getElementById('customerName').value.trim();
    const email = document.getElementById('customerEmail').value.trim();

    if (!name || !email) {
        alert('請填寫完整資訊');
        return;
    }

    let customers = getCustomers();
    const now = new Date().toISOString();

    if (id) {
        // 編輯客戶
        const index = customers.findIndex(c => c.customerId === id);
        if (index === -1) return;

        // Data-level 二次防護
        if (user.role === 'sales' && customers[index].ownerId !== user.employeeId) {
            alert("無權限修改此客戶");
            return;
        }

        customers[index].name = name;
        customers[index].email = email;
        customers[index].updatedAt = now;
    } else {
        // 新增客戶
        const newId = 'C' + String(Date.now()).slice(-4);
        customers.push({
            customerId: newId,
            name: name,
            email: email,
            status: "active",
            ownerId: user.employeeId, // 自動帶入登入者
            createdAt: now,
            updatedAt: null
        });
    }

    saveCustomers(customers);
    closeCustomerModal();
    renderCustomersTable();
}

// 作廢客戶 (Soft Delete)
window.voidCustomer = function(id) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    
    // RBAC 防護：只有 admin 可以作廢
    if (user.role !== 'admin') {
        alert("無權限操作：僅管理員可作廢客戶");
        return;
    }

    if (confirm('確定要作廢此客戶嗎？作廢後狀態將轉為 inactive。')) {
        let customers = getCustomers();
        const customer = customers.find(c => c.customerId === id);
        if (customer) {
            customer.status = 'inactive';
            customer.updatedAt = new Date().toISOString();
            saveCustomers(customers);
            renderCustomersTable();
        }
    }
}

/* =========================================
   Orders Management Logic
========================================= */

function getOrders() {
    return JSON.parse(localStorage.getItem('orders') || '[]');
}

function saveOrders(orders) {
    localStorage.setItem('orders', JSON.stringify(orders));
}

function renderOrdersTable() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    
    let orders = getOrders();
    const usersList = JSON.parse(localStorage.getItem('users') || '[]');

    // Data-level 過濾：sales 只能看見自己的訂單
    if (user.role === 'sales') {
        orders = orders.filter(o => o.ownerId === user.employeeId);
    }

    tbody.innerHTML = orders.map(order => {
        // 狀態 Badge 顏色
        let badgeClass = 'badge-secondary'; // 預設: 已作廢
        if (order.status === '處理中') badgeClass = 'badge-info';
        if (order.status === '已完成') badgeClass = 'badge-success';
        
        // 查表邏輯
        const product = defaultProducts.find(p => p.productId === order.productId);
        const productName = product ? product.name : '-';
        
        const ownerUser = usersList.find(u => u.employeeId === order.ownerId);
        const ownerName = ownerUser ? ownerUser.name : order.ownerId;

        // 動作按鈕邏輯
        let actionsHtml = '';
        if (user.role !== 'viewer' && order.status !== '已作廢') {
            // Edit: admin 可編輯所有，sales 可編輯自己的
            if (user.role === 'admin' || (user.role === 'sales' && order.ownerId === user.employeeId)) {
                actionsHtml += `<button class="btn-secondary" onclick="openOrderModal('${order.id}')">編輯</button>`;
            }
            // Void: 只有 admin 可作廢
            if (user.role === 'admin') {
                actionsHtml += `<button class="btn-danger" onclick="voidOrder('${order.id}')">作廢</button>`;
            }
        }

        return `
            <tr>
                <td><strong>${order.id}</strong></td>
                <td>${order.customer}</td>
                <td>${productName}</td>
                <td>$${Number(order.amount).toLocaleString()}</td>
                <td><span class="badge ${badgeClass}">${order.status}</span></td>
                <td><span class="badge badge-viewer">${ownerName}</span></td>
                <td class="actions-cell">${actionsHtml}</td>
            </tr>
        `;
    }).join('');
}

// 處理商品選擇變更，自動帶入金額
window.handleProductChange = function() {
    const productId = document.getElementById('orderProduct').value;
    const product = defaultProducts.find(p => p.productId === productId);
    if (product) {
        document.getElementById('orderAmount').value = product.price;
    }
}

// 開啟 Order Modal (新增/編輯)
window.openOrderModal = function(orderId = null) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    const modal = document.getElementById('orderModal');
    const title = document.getElementById('modalTitle');
    const idInput = document.getElementById('orderId');
    const customerInput = document.getElementById('orderCustomer');
    const productSelect = document.getElementById('orderProduct');
    const amountInput = document.getElementById('orderAmount');

    // 權限檢查：只有 admin, sales 可開啟
    if (user.role === 'viewer') {
        alert("無權限操作");
        return;
    }
    
    // 填充商品選單
    productSelect.innerHTML = '<option value="">請選擇商品</option>' + defaultProducts.map(p => 
        `<option value="${p.productId}">${p.name} - $${p.price}</option>`
    ).join('');

    if (orderId) {
        // 編輯模式
        const orders = getOrders();
        const order = orders.find(o => o.id === orderId);
        if (!order) return;

        // Data-level 權限防護：sales 只能編輯自己的訂單
        if (user.role === 'sales' && order.ownerId !== user.employeeId) {
            alert("您只能編輯自己的訂單");
            return;
        }

        title.textContent = '編輯訂單';
        idInput.value = order.id;
        customerInput.value = order.customer;
        productSelect.value = order.productId;
        amountInput.value = order.amount;
    } else {
        // 新增模式
        title.textContent = '新增訂單';
        idInput.value = '';
        customerInput.value = '';
        productSelect.value = '';
        amountInput.value = '';
    }

    modal.classList.add('active');
}

// 關閉 Modal
window.closeOrderModal = function() {
    document.getElementById('orderModal').classList.remove('active');
}

// 儲存訂單
window.saveOrder = function() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    
    // 權限防護
    if (user.role === 'viewer') {
        alert("無權限操作");
        return;
    }

    const id = document.getElementById('orderId').value;
    const customer = document.getElementById('orderCustomer').value.trim();
    const productId = document.getElementById('orderProduct').value;
    const amount = document.getElementById('orderAmount').value;

    if (!customer || !productId || !amount) {
        alert('請填寫完整資訊');
        return;
    }

    let orders = getOrders();
    const now = new Date().toISOString();

    if (id) {
        // 編輯訂單
        const index = orders.findIndex(o => o.id === id);
        if (index === -1) return;

        // Data-level 二次防護
        if (user.role === 'sales' && orders[index].ownerId !== user.employeeId) {
            alert("無權限修改此訂單");
            return;
        }

        orders[index].customer = customer;
        orders[index].productId = productId;
        orders[index].amount = Number(amount);
        orders[index].updatedAt = now;
    } else {
        // 新增訂單
        const newId = 'ORD-' + Date.now().toString().slice(-4);
        orders.push({
            id: newId,
            customer: customer,
            productId: productId,
            amount: Number(amount),
            status: "處理中",
            ownerId: user.employeeId, // 自動帶入登入者
            createdAt: now,
            updatedAt: now
        });
    }

    saveOrders(orders);
    closeOrderModal();
    renderOrdersTable();
}

// 作廢訂單 (Soft Delete)
window.voidOrder = function(id) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    
    // RBAC 防護：只有 admin 可以作廢
    if (user.role !== 'admin') {
        alert("無權限操作：僅管理員可作廢訂單");
        return;
    }

    if (confirm('確定要作廢此訂單嗎？作廢後將無法修改。')) {
        let orders = getOrders();
        const order = orders.find(o => o.id === id);
        if (order) {
            order.status = '已作廢';
            order.updatedAt = new Date().toISOString();
            saveOrders(orders);
            renderOrdersTable();
        }
    }
}

/* =========================================
   Users Management Logic
========================================= */

function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    let users = [];
    try {
        const storedUsers = JSON.parse(localStorage.getItem('users'));
        if (Array.isArray(storedUsers)) {
            users = storedUsers;
        }
    } catch (e) {
        console.error('Failed to parse users list', e);
    }

    if (users.length === 0) {
        users = [
            { employeeId: 'admin1', name: '系統管理員', role: 'admin' },
            { employeeId: 'sales1', name: '業務專員', role: 'sales' },
            { employeeId: 'viewer1', name: '檢視人員', role: 'viewer' }
        ];
    }

    // 修改: 同時顯示 employeeId 與 email
    tbody.innerHTML = users.map(u => {
        const displayRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
        return `
            <tr>
                <td><strong>${u.employeeId}</strong><br><small style="color:#6B7280">${u.email || ''}</small></td>
                <td>${u.name || '-'}</td>
                <td><span class="badge badge-${u.role}">${displayRole}</span></td>
                <td>-</td>
            </tr>
        `;
    }).join('');
}

function bindEvents() {
    // 登出按鈕
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('currentUser');
            window.location.href = 'index.html';
        });
    }
}
