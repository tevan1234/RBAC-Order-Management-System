const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// 取得 API Base URL，預設為 http://localhost:8000/api
const apiBase = process.env.API_BASE || 'http://localhost:8000/api';

// 解析 Origin，供 HTML 中的 CSP connect-src 使用
let apiOrigin = 'http://localhost:8000';
try {
    const parsedUrl = new URL(apiBase);
    apiOrigin = parsedUrl.origin;
} catch (e) {
    console.error('解析 API_BASE Origin 失敗，將使用預設 http://localhost:8000:', e.message);
}

// 1. 提供動態環境變數配置
app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    res.send(`window.ENV = { API_BASE: "${apiBase}" };`);
});

// 2. 攔截 HTML 檔案，動態替換其中的 CSP 網址
app.get(['/', '/*.html'], (req, res, next) => {
    let filename = req.path === '/' ? 'index.html' : req.path.substring(1);
    if (!filename.endsWith('.html')) {
        filename += '.html';
    }
    const filePath = path.join(__dirname, 'public', filename);

    if (fs.existsSync(filePath)) {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error(`讀取 HTML 檔案失敗 (${filename}):`, err);
                return next();
            }
            // 動態替換 CSP connect-src 中硬編碼的 http://localhost:8000
            const modifiedData = data.replace(/http:\/\/localhost:8000/g, apiOrigin);
            res.send(modifiedData);
        });
    } else {
        next();
    }
});

// 設定靜態檔案目錄 (用於服務 JS、CSS、圖片等其他資源)
app.use(express.static(path.join(__dirname, 'public')));

// 啟動伺服器
app.listen(port, () => {
    console.log(`前端伺服器啟動於 http://localhost:${port}`);
    console.log(`後端 API 設定為: ${apiBase}`);
    console.log(`CSP 後端 Origin 設定為: ${apiOrigin}`);
});
