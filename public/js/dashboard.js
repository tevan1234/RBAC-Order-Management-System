// RBAC Configuration
const menuConfig = {
    admin: [
        { id: 'dashboard', label: '儀表板', icon: '📊' },
        { id: 'orders', label: '訂單管理', icon: '🛍️' },
        { id: 'users', label: '使用者管理', icon: '👥' },
        { id: 'permissions', label: '權限設定', icon: '⚙️' }
    ],
    sales: [
        { id: 'dashboard', label: '儀表板', icon: '📊' },
        { id: 'orders', label: '訂單管理', icon: '🛍️' }
    ],
    viewer: [
        { id: 'dashboard', label: '儀表板 (唯讀)', icon: '👁️' }
    ]
};

// Fake Data for Dashboard
const fakeOrders = [
    { id: 'ORD-2023-001', customer: 'Tech Solutions Inc.', amount: '$1,250.00', status: 'Completed', date: '2023-10-25' },
    { id: 'ORD-2023-002', customer: 'Global Logistics', amount: '$3,400.00', status: 'Processing', date: '2023-10-26' },
    { id: 'ORD-2023-003', customer: 'Startup Hub', amount: '$850.00', status: 'Pending', date: '2023-10-27' },
    { id: 'ORD-2023-004', customer: 'EduCorp', amount: '$2,100.00', status: 'Completed', date: '2023-10-28' }
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

    // 2. 初始化 UI
    initUI(user);
    
    // 3. 綁定事件
    bindEvents();
    
    // 4. 預設載入 Dashboard
    navigateTo('dashboard', user);
});

function initUI(user) {
    // Topbar 資訊
    document.getElementById('displayEmployeeId').textContent = user.name || user.employeeId;
    document.getElementById('welcomeUserName').textContent = user.name || user.employeeId;
    
    // Role Badge
    const badgeContainer = document.getElementById('roleBadgeContainer');
    const badgeClass = `badge badge-${user.role}`;
    // 轉換首字母大寫顯示
    const displayRole = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    badgeContainer.innerHTML = `<span class="${badgeClass}">${displayRole}</span>`;

    // 產生側邊欄選單
    renderSidebar(user.role);
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
    } else if (sectionId === 'users' && user.role === 'admin') {
        renderUsersTable();
    }
}

function renderOrdersTable() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = fakeOrders.map(order => {
        let badgeClass = 'badge-viewer'; // default Gray for Completed
        if (order.status === 'Processing') badgeClass = 'badge-sales'; // Blue
        if (order.status === 'Pending') badgeClass = 'badge-admin'; // Red
        
        return `
            <tr>
                <td><strong>${order.id}</strong></td>
                <td>${order.customer}</td>
                <td>${order.amount}</td>
                <td><span class="badge ${badgeClass}">${order.status}</span></td>
                <td>${order.date}</td>
            </tr>
        `;
    }).join('');
}

function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    // 嘗試從 localStorage 獲取真實資料，否則使用預設資料
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

    tbody.innerHTML = users.map(u => {
        const displayRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
        return `
            <tr>
                <td><strong>${u.employeeId}</strong></td>
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
