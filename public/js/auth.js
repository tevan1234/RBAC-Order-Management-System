// 模擬使用者資料庫
const defaultUsers = [
    { employeeId: 'EMP001', password: 'admin123', role: 'admin', name: '管理者' },
    { employeeId: 'EMP002', password: 'user123', role: 'sales', name: '銷售專員' }
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
            // 確保 EMP001 存在，如果不存在則重置（方便測試）
            if (!users.some(u => u.employeeId === 'EMP001')) {
                localStorage.setItem('users', JSON.stringify(defaultUsers));
                console.log('Database reset to default users.');
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
