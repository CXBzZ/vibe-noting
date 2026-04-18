<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 极简悬浮笔记 · Vibe Noting

跨平台、始终置顶的待办与灵感记录工具。支持三种终端：

- **Electron 桌面端**：Windows/macOS 悬浮窗，聚焦模式
- **PWA 手机端**：浏览器「添加到主屏幕」即装即用
- **微信公众号 Bot 投递**：手机不开 App，对公众号发消息即入库

数据统一存放在 Supabase，三端通过 Realtime 自动同步。

---

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev                  # Web 前端 (http://localhost:3000)
npm run electron:dev         # Electron 桌面端
```

---

## 部署到 GitHub Pages

仓库已包含工作流 [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)，`push` 到 `main` 会自动构建并发布。

1. 在 GitHub 仓库页：**Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
2. **Settings → Secrets and variables → Actions → New repository secret** 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. 推送到 `main`，等待 Action 完成
4. 发布地址：`https://<username>.github.io/<repo>/`
5. 在 **Supabase Dashboard → Authentication → URL Configuration** 配置：
   - **Site URL**：`https://<username>.github.io/<repo>/`
   - **Redirect URLs** 追加：`https://<username>.github.io/<repo>/**`

手机打开 Pages 地址 → 浏览器「添加到主屏幕」即完成 PWA 安装。

---

## 微信公众号 Bot 投递

### 1. 申请公众号测试号

个人开发者用官方测试号即可：<https://mp.weixin.qq.com/debug/cgi-bin/sandbox>

登录后记下 **appID** 与 **appSecret**（本项目实际只需要 appID 参考，签名靠自定义 Token）。

### 2. 执行数据库迁移

在 Supabase SQL Editor 里执行 [supabase/migrations/20260418_wechat_bindings.sql](supabase/migrations/20260418_wechat_bindings.sql)，或用 CLI：

```bash
supabase db push
```

会新增两张表：

- `wechat_bindings` — `openid -> user_id` 映射
- `wechat_bind_codes` — 一次性 6 位绑定码（10 分钟过期）

### 3. 部署 Edge Function

```bash
supabase functions deploy wechat-webhook --no-verify-jwt
```

设置 Function secret（`WECHAT_TOKEN` 为任意随机字符串，等下要填到公众号后台）：

```bash
supabase secrets set WECHAT_TOKEN=some_random_long_string
```

> `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 是平台默认注入的，不用手动配置。

部署完成后 Function 的公网地址为：

```
https://<project-ref>.supabase.co/functions/v1/wechat-webhook
```

### 4. 在测试号后台填写接入信息

测试号页面「接口配置信息」填入：

- **URL**：上一步的 Edge Function 地址
- **Token**：与 `WECHAT_TOKEN` 完全一致
- 点击「提交」，看到「配置成功」即表示签名校验通过

### 5. 绑定账号并开始使用

1. 手机扫测试号二维码关注
2. 打开 PWA，登录后点击工具栏的「微信绑定」按钮生成 6 位码
3. 在公众号聊天发送 `/bind 123456` 完成绑定
4. 之后可直接发消息：

| 输入 | 效果 |
|---|---|
| `买牛奶` | 创建待办 |
| `待办 买牛奶` 或 `/t 买牛奶` | 创建待办（显式） |
| `想法 今天天气不错` 或 `/i ...` | 创建想法（默认分类） |
| `工作 重构 X 模块` | 想法 - 工作 |
| `生活 周末去爬山` | 想法 - 生活 |
| `灵感 AI + 便签的结合点` | 想法 - 灵感 |
| `/help` | 查看命令列表 |

---

## 架构

```
手机用户 ──> 微信公众号 ──(XML webhook)──> Supabase Edge Function ──> Postgres
                                                                       ↓ Realtime
Electron 桌面端  &  手机 PWA  ─────(anon key + RLS)─────────────> 同一张 entries 表
```

- 前端：React 19 + Vite + Tailwind v4 + Motion
- 桌面外壳：Electron 41
- 后端：Supabase（Auth + Postgres + Realtime + Edge Functions）
- 部署：GitHub Actions → GitHub Pages（PWA）+ Supabase（API）
