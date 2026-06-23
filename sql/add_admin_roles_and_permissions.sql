-- 1. 建立後台管理帳號權限表
CREATE TABLE IF NOT EXISTS public.admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- 自動生成唯一的 ID
    email TEXT UNIQUE NOT NULL,                   -- 登入用的 Email（不可重複）
    display_name TEXT,                            -- 顯示名稱（例如：知客組義工）
    role TEXT NOT NULL CHECK (role IN ('admin', 'volunteer')), -- 只能填入 admin 或 volunteer
    last_sign_in_at TIMESTAMP WITH TIME ZONE,     -- 最後登入時間
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. 開啟資料列安全政策 (RLS)，這是 Supabase 的防護罩，預設不讓人亂讀寫
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

-- 3. 設定安全政策：只有權限是 'admin' (管理者) 的人，才可以看見和修改這張表的資料
CREATE POLICY "允許管理者讀取所有後台權限資料" 
ON public.admin_roles FOR SELECT 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.admin_roles 
        WHERE admin_roles.email = auth.email() AND admin_roles.role = 'admin'
    )
);

CREATE POLICY "允許管理者修改所有後台權限資料" 
ON public.admin_roles FOR ALL 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.admin_roles 
        WHERE admin_roles.email = auth.email() AND admin_roles.role = 'admin'
    )
);
