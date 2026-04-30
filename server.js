const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// 設定靜態檔案目錄
app.use(express.static(path.join(__dirname, 'public')));

// 啟動伺服器
app.listen(port, () => {
    console.log(`前端伺服器啟動於 http://localhost:${port}`);
});
