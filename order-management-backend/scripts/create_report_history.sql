-- 建立 report_history 資料表
CREATE TABLE IF NOT EXISTS public.report_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    filter_parameters JSONB NOT NULL,
    report_content JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 建立索引以優化每日快取與歷史查詢效能
CREATE INDEX IF NOT EXISTS idx_report_history_query 
ON public.report_history (user_id, report_type, created_at DESC);

-- 啟用 Row Level Security (RLS) 安全機制
ALTER TABLE public.report_history ENABLE ROW LEVEL SECURITY;

-- 建立 RLS 政策 (僅允許使用者查詢及寫入自己的歷史紀錄)
CREATE POLICY "Users can insert their own reports" 
ON public.report_history FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own reports" 
ON public.report_history FOR SELECT 
USING (auth.uid() = user_id);
