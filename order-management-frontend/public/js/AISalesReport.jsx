// AISalesReport.jsx - 高階商業 BI 互動式銷售大儀表板 React 元件
// 基於 React 18 + Recharts + Tailwind CSS 實作

const {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} = window.Recharts || {};

function AISalesReport({ reportData, userRole }) {
  // 訂閱設定狀態
  const [subscribed, setSubscribed] = React.useState(false);
  const [frequency, setFrequency] = React.useState('weekly');
  const [subLoading, setSubLoading] = React.useState(true);
  const [emailSending, setEmailSending] = React.useState(false);

  // 取得訂閱資料
  React.useEffect(() => {
    let active = true;
    const fetchSubscription = async () => {
      try {
        const data = await window.apiRequest('/analytics/subscription');
        if (data && active) {
          setSubscribed(data.is_subscribed);
          setFrequency(data.frequency || 'weekly');
        }
      } catch (e) {
        console.error("取得訂閱偏好失敗:", e);
      } finally {
        if (active) setSubLoading(false);
      }
    };
    fetchSubscription();
    return () => { active = false; };
  }, []);

  // 儲存訂閱設定
  const handleSaveSubscription = async () => {
    setSubLoading(true);
    try {
      await window.apiRequest('/analytics/subscription', {
        method: 'POST',
        body: JSON.stringify({
          is_subscribed: subscribed,
          frequency: frequency
        })
      });
      if (window.showNotification) {
        window.showNotification('訂閱偏好設定已儲存！', 'success');
      } else {
        alert('訂閱偏好設定已儲存！');
      }
    } catch (e) {
      if (window.showNotification) {
        window.showNotification('儲存訂閱設定失敗，請稍後再試。', 'error');
      } else {
        alert('儲存訂閱設定失敗，請稍後再試。');
      }
    } finally {
      setSubLoading(false);
    }
  };

  // 立即發送測試郵件
  const handleSendTestEmail = async () => {
    if (!reportData) return;
    setEmailSending(true);
    try {
      const currentUser = window.getCurrentUser ? window.getCurrentUser() : null;
      const email = currentUser?.email;
      if (!email) {
        throw new Error('未取得使用者 Email，請重新登入。');
      }

      const dateFrom = document.getElementById('analyticsDateFrom')?.value || '';
      const dateTo = document.getElementById('analyticsDateTo')?.value || '';
      const container = document.getElementById('analyticsReport');
      const customerId = container?.dataset.customerId || null;
      const productId = container?.dataset.productId || null;

      const filters = {
        date_from: dateFrom,
        date_to: dateTo,
        customer_id: customerId,
        product_id: productId
      };

      await window.apiRequest('/analytics/send-report-email', {
        method: 'POST',
        body: JSON.stringify({
          email: email,
          filters: filters,
          report_summary: reportData.summary || 'AI 銷售分析速報',
          report_content: reportData
        })
      });
      if (window.showNotification) {
        window.showNotification('測試分析報告郵件已成功寄出！', 'success');
      } else {
        alert('測試分析報告郵件已成功寄出！');
      }
    } catch (e) {
      const errMsg = e.message || '發送測試郵件失敗，請檢查信箱設定或 Webhook。';
      if (window.showNotification) {
        window.showNotification(errMsg, 'error');
      } else {
        alert(errMsg);
      }
    } finally {
      setEmailSending(false);
    }
  };

  if (!reportData) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-slate-100 rounded-3xl shadow-xl">
        <span className="text-4xl mb-4">📊</span>
        <h3 className="text-lg font-bold text-slate-800">暫無銷售報告數據</h3>
        <p className="text-sm text-slate-500 mt-1">請選擇合適的日期範圍並點擊生成報告。</p>
      </div>
    );
  }

  // 1. 取得視角提示內容
  const isCompanyWide = userRole === 'admin' || userRole === 'viewer';
  const roleHintText = isCompanyWide 
    ? '當前視角：全公司銷售總覽分析' 
    : '當前視角：個人銷售業績與客戶洞察';

  // 2. 趨勢與折線圖數據準備
  const chartData = reportData.trends?.chart_data || [];
  const trendInsights = reportData.trends?.insights || '尚無明確的趨勢分析。';
  const trendDirection = reportData.trends?.trend_direction || '平穩';

  // 3. 熱銷商品數據準備
  const topProducts = reportData.top_products || [];

  // 4. 預測與建議數據準備
  const forecastRevenue = reportData.forecast?.next_30_days_revenue || 0;
  const confidence = reportData.forecast?.confidence || 0.8;
  const forecastRec = reportData.forecast?.recommendation || '請持續關注銷售表現並進行適時的推廣。';
  const recommendations = reportData.recommendations || [];

  // 趨勢走向圖示與顏色
  const getTrendBadge = (direction) => {
    switch (direction) {
      case '上升':
      case '成長':
      case 'Up':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            📈 成長趨勢
          </span>
        );
      case '下降':
      case '衰退':
      case 'Down':
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            📉 下降趨勢
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            ➡️ 平穩波動
          </span>
        );
    }
  };

  return (
    <div className="font-sans antialiased text-slate-800 space-y-6 max-w-[1400px] mx-auto p-1">
      
      {/* 1. 頂部控制與動態極光橫幅 */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 shadow-xl border border-indigo-500/20 p-6 sm:p-8 text-white transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/10">
        {/* 裝飾性漸變背景球 */}
        <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-white/10 blur-[80px] -mr-32 -mt-32 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[200px] h-[200px] rounded-full bg-indigo-400/20 blur-[60px] -ml-20 -mb-20 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-xs font-bold tracking-wide border border-white/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              {roleHintText}
            </div>
            
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              🧠 AI 銷售決策大儀表板
            </h1>
            <p className="text-indigo-100 text-sm sm:text-base max-w-2xl leading-relaxed">
              {reportData.summary ? `✨ AI 報告摘要：${reportData.summary}` : '系統已整合完畢。後端大數據分析引擎將根據角色權限即時渲染數據。'}
            </p>
          </div>
          
          <div className="flex items-center bg-white/10 backdrop-blur-md px-6 py-4 rounded-2xl border border-white/15 self-start md:self-auto shrink-0 shadow-lg">
            <div className="text-right">
              <div className="text-xs text-indigo-200">生成時間</div>
              <div className="text-lg font-bold">{new Date().toLocaleDateString('zh-TW')}</div>
            </div>
            <div className="w-[1px] h-8 bg-white/20 mx-4"></div>
            <div className="text-right">
              <div className="text-xs text-indigo-200">當前角色</div>
              <div className="text-lg font-bold uppercase tracking-wider">{userRole}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 📧 AI 銷售分析自動化訂閱偏好設定面板 */}
      <div className="bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-300 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              📧 AI 銷售分析自動化定期訂閱偏好
            </h2>
            <p className="text-xs text-slate-500">
              設定訂閱後，系統將透過 AI 引擎自動定期產出銷售分析洞察，並主動發送至您的電子信箱
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {subLoading ? (
              <span className="text-xs text-slate-400">⏳ 讀取設定中...</span>
            ) : (
              <>
                {/* 啟用開關 */}
                <label className="inline-flex items-center cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={subscribed} 
                    onChange={(e) => setSubscribed(e.target.checked)} 
                    className="sr-only peer"
                  />
                  <div className="relative w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  <span className="ms-2.5 text-sm font-semibold text-slate-700">
                    {subscribed ? '🔔 已啟用' : '🔕 已停用'}
                  </span>
                </label>

                {/* 頻率選擇器 */}
                {subscribed && (
                  <div className="flex items-center gap-1 bg-slate-50 border border-slate-100 rounded-xl p-1">
                    <button 
                      onClick={() => setFrequency('weekly')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        frequency === 'weekly' 
                          ? 'bg-indigo-600 text-white shadow-sm' 
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      每週
                    </button>
                    <button 
                      onClick={() => setFrequency('monthly')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        frequency === 'monthly' 
                          ? 'bg-indigo-600 text-white shadow-sm' 
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      每月
                    </button>
                  </div>
                )}

                {/* 儲存設定按鈕 */}
                <button
                  onClick={handleSaveSubscription}
                  disabled={subLoading}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold rounded-xl shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-violet-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  💾 儲存偏好
                </button>

                <div className="w-[1px] h-6 bg-slate-200 mx-2 hidden sm:block"></div>

                {/* 立即發送測試郵件按鈕 */}
                <button
                  onClick={handleSendTestEmail}
                  disabled={emailSending}
                  className="px-4 py-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 text-xs font-bold rounded-xl active:scale-[0.98] transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {emailSending ? '✉️ 寄送中...' : '🚀 寄送測試信'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 2. 核心圖表與洞察區（雙欄 Grid 佈局） */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* 左欄：趨勢分析區 (佔 3 格, 60%) */}
        <div className="lg:col-span-3 flex flex-col bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-300 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                📈 銷售營收趨勢分析
              </h2>
              <p className="text-xs text-slate-500">選定日期區間的每日銷售額波動情況</p>
            </div>
            {getTrendBadge(trendDirection)}
          </div>

          {/* LineChart 視覺化折線圖 */}
          <div className="w-full h-[320px] mb-4">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    stroke="#94a3b8" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `$${val.toLocaleString()}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.96)', 
                      borderRadius: '16px', 
                      border: '1px solid #f1f5f9', 
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)'
                    }} 
                    formatter={(val) => [val !== undefined && val !== null ? `$${val.toLocaleString()}` : '$0', '銷售金額']}
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                  />
                  <Legend verticalAlign="top" height={36} align="right" iconType="circle" />
                  <Line 
                    name="每日營收" 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#8b5cf6" 
                    strokeWidth={3}
                    activeDot={{ r: 6, stroke: '#8b5cf6', strokeWidth: 2, fill: '#fff' }}
                    dot={{ r: 3, stroke: '#c084fc', fill: '#c084fc' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-2xl text-slate-400 text-sm">
                無趨勢圖表數據
              </div>
            )}
          </div>

          {/* AI 趨勢分析洞察點 */}
          <div className="mt-auto bg-violet-50/50 border border-violet-100/50 rounded-2xl p-4 sm:p-5">
            <h4 className="text-sm font-bold text-violet-900 mb-2 flex items-center gap-2">
              💡 AI 銷售趨勢洞察
            </h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              {trendInsights}
            </p>
          </div>
        </div>

        {/* 右欄：產品排名區 (佔 2 格, 40%) */}
        <div className="lg:col-span-2 flex flex-col bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-300 p-6">
          <div className="space-y-1 mb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              🔥 熱銷商品排名與佔比
            </h2>
            <p className="text-xs text-slate-500">按商品銷售額排名的最暢銷清單</p>
          </div>

          {/* BarChart 熱銷商品柱狀圖 */}
          <div className="w-full h-[220px] mb-4">
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.9}/>
                      <stop offset="95%" stopColor="#c084fc" stopOpacity={0.3}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#94a3b8" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `$${val.toLocaleString()}`}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.96)', 
                      borderRadius: '16px', 
                      border: '1px solid #f1f5f9', 
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)'
                    }}
                    formatter={(val) => [`$${val.toLocaleString()}`, '銷售金額']}
                  />
                  <Bar dataKey="revenue" name="銷售總額" fill="url(#colorRevenue)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-2xl text-slate-400 text-sm">
                無熱銷商品排名數據
              </div>
            )}
          </div>

          {/* 熱銷商品個別 AI 洞察清單 */}
          <div className="flex-1 overflow-y-auto max-h-[220px] space-y-3 pr-1">
            {topProducts.length > 0 ? (
              topProducts.map((product, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-100 rounded-2xl p-3 flex flex-col gap-2 transition-all duration-300 hover:bg-slate-100/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white ${
                        idx === 0 ? 'bg-amber-500' : idx === 1 ? 'bg-slate-400' : 'bg-amber-700/50'
                      }`}>
                        {idx + 1}
                      </span>
                      <strong className="text-sm text-slate-800 font-bold">{product.name}</strong>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-indigo-600 block">${product.revenue.toLocaleString()}</span>
                      <span className="text-[10px] text-slate-400 block">數量: {product.quantity}</span>
                    </div>
                  </div>
                  {product.insights && (
                    <div className="text-xs text-slate-600 bg-white border border-slate-100 rounded-xl px-3 py-2">
                      💡 {product.insights}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-slate-400 text-xs text-center py-4">尚無暢銷品排名。</p>
            )}
          </div>
        </div>
      </div>

      {/* 3. 底部深度預測與策略建議區 (左右並排雙卡片) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* 左側：「🔮 未來預測」卡片 */}
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-300 p-6 flex flex-col justify-between">
          <div className="space-y-1 mb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              🔮 未來 30 天營收預測
            </h2>
            <p className="text-xs text-slate-500">基於歷史銷售軌跡與 AI 預測模型推估</p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6 py-2 my-auto">
            {/* 預測營收顯示 */}
            <div className="flex-1 bg-gradient-to-br from-slate-50 to-indigo-50/20 border border-slate-100 p-5 rounded-2xl w-full text-center sm:text-left">
              <span className="text-xs text-slate-400 uppercase tracking-wider block font-medium">預期銷售額</span>
              <strong className="text-2xl sm:text-3xl font-black text-emerald-600 tracking-tight block mt-1">
                ${forecastRevenue.toLocaleString()}
              </strong>
            </div>

            {/* 信心指數 */}
            <div className="w-[140px] flex flex-col items-center shrink-0">
              <div className="relative flex items-center justify-center">
                {/* 簡單的圓形信心指針進度條 */}
                <svg className="w-20 h-20 transform -rotate-90">
                  <circle cx="40" cy="40" r="34" stroke="#f1f5f9" strokeWidth="6" fill="transparent" />
                  <circle 
                    cx="40" 
                    cy="40" 
                    r="34" 
                    stroke="#10b981" 
                    strokeWidth="6" 
                    fill="transparent" 
                    strokeDasharray={2 * Math.PI * 34} 
                    strokeDashoffset={2 * Math.PI * 34 * (1 - confidence)} 
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className="text-lg font-extrabold text-slate-800">{(confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
              <span className="text-[11px] text-slate-500 font-semibold mt-2">AI 預測信心度</span>
            </div>
          </div>

          {/* 預測建議說明 */}
          <div className="mt-4 bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-2.5">
            <span className="text-lg shrink-0 mt-0.5">💡</span>
            <div className="space-y-1">
              <span className="text-xs font-bold text-emerald-900 block">營運建議</span>
              <p className="text-xs text-slate-600 leading-relaxed">
                {forecastRec}
              </p>
            </div>
          </div>
        </div>

        {/* 右側：「📋 AI 策略建議」卡片 */}
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm hover:shadow-md transition-shadow duration-300 p-6 flex flex-col">
          <div className="space-y-1 mb-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              📋 AI 銷售行動建議
            </h2>
            <p className="text-xs text-slate-500">大數據決策引擎針對當前市場狀況之策略指南</p>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[220px] space-y-3 pr-1">
            {recommendations.length > 0 ? (
              recommendations.map((rec, idx) => (
                <div key={idx} className="flex gap-3 bg-slate-50 border border-slate-100 rounded-2xl p-3.5 items-start transition-all duration-300 hover:bg-slate-100/50">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-bold shrink-0">
                    🎯
                  </span>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mt-0.5">
                    {rec}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-400 text-xs">暫無具體的 AI 策略建議。</div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}

// 註冊至全域，供 analytics-module.js 動態調用
window.AISalesReport = AISalesReport;
