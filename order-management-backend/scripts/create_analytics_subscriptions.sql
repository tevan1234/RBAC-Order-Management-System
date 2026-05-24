-- 建立 analytics_subscriptions 資料表，用以紀錄使用者的定期報告訂閱偏好
CREATE TABLE IF NOT EXISTS public.analytics_subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    is_subscribed BOOLEAN DEFAULT FALSE NOT NULL,
    frequency VARCHAR(20) DEFAULT 'weekly' NOT NULL, -- 'daily', 'weekly', 'monthly'
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 啟用 RLS (Row Level Security) 安全機制
ALTER TABLE public.analytics_subscriptions ENABLE ROW LEVEL SECURITY;

-- 建立 RLS 政策 (僅允許使用者查詢及修改自己的訂閱狀態)
CREATE POLICY "Users can manage their own subscriptions" 
ON public.analytics_subscriptions FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
