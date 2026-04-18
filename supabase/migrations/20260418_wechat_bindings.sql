-- 微信公众号绑定：openid -> supabase user_id
create table if not exists public.wechat_bindings (
  openid text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists wechat_bindings_user_id_idx
  on public.wechat_bindings (user_id);

-- 一次性绑定码（用户在 App 内生成，去公众号发送 /bind <code> 激活）
create table if not exists public.wechat_bind_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists wechat_bind_codes_user_id_idx
  on public.wechat_bind_codes (user_id);

alter table public.wechat_bindings enable row level security;
alter table public.wechat_bind_codes enable row level security;

-- 用户只能看到自己的绑定记录
drop policy if exists "own wechat bindings" on public.wechat_bindings;
create policy "own wechat bindings"
  on public.wechat_bindings
  for select
  using (auth.uid() = user_id);

-- 用户可完全管理自己的绑定码（插入/读取/删除）
drop policy if exists "own wechat bind codes" on public.wechat_bind_codes;
create policy "own wechat bind codes"
  on public.wechat_bind_codes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
