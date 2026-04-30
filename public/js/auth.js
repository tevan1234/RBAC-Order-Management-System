// 模擬使用者資料庫
const defaultUsers = [
    { employeeId: 'EMP001', email: "admin@test.com", password: 'admin123', role: 'admin', name: '管理者' },
    { employeeId: 'EMP002', email: "sales@test.com", password: 'user123', role: 'sales', name: '銷售專員' },
    { employeeId: 'EMP003', email: "viewer@test.com", password: 'viewer123', role: 'viewer', name: '檢視者' }
];

// 初始化資料
function initDatabase() {
    const storedUsers = localStorage.getItem('users');
    if (!storedUsers) {
        localStorage.setItem('users', JSON.stringify(defaultUsers));
        console.log('Database initialized with default users.');
    } else {
        try {
            const users = JSON.parse(storedUsers);
            // 檢查是否包含新欄位 email，若無則強制重置為新結構
            if (!users.some(u => u.email)) {
                localStorage.setItem('users', JSON.stringify(defaultUsers));
                console.log('Database reset to updated default users.');
            }
        } catch (e) {
            localStorage.setItem('users', JSON.stringify(defaultUsers));
            console.log('Database recovered from error.');
        }
    }
}

// 登入處理
function handleLogin(event) {
    event.preventDefault();
    
    const employeeId = document.getElementById('employeeId').value.trim();
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('errorMessage');
    
    // 清除錯誤訊息
    errorMessage.textContent = '';
    
    const users = JSON.parse(localStorage.getItem('users'));
    const user = users.find(u => u.employeeId === employeeId && u.password === password);
    
    if (user) {
        // 登入成功
        const sessionInfo = {
            employeeId: user.employeeId,
            role: user.role,
            name: user.name,
            loginAt: new Date().toISOString()
        };
        
        localStorage.setItem('currentUser', JSON.stringify(sessionInfo));
        
        // 跳轉至儀表板
        window.location.href = 'dashboard.html';
    } else {
        // 登入失敗
        errorMessage.textContent = '帳號或密碼錯誤';
    }
}

// 頁面載入後執行
document.addEventListener('DOMContentLoaded', () => {
    initDatabase();
    
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});
