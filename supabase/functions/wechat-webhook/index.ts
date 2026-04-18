// 微信公众号（测试号/订阅号）被动消息 Webhook
// 运行时：Supabase Edge Function（Deno）
// 部署：supabase functions deploy wechat-webhook --no-verify-jwt
// 必需 secrets：
//   WECHAT_TOKEN                 在公众号后台随机填入的 Token（用于 signature 校验）
//   SUPABASE_URL                 项目 URL（平台默认注入，无需手动设置）
//   SUPABASE_SERVICE_ROLE_KEY    用于绕过 RLS 写库（平台默认注入，无需手动设置）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN = Deno.env.get("WECHAT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ThoughtCategory = "general" | "work" | "life" | "inspire";
type ItemType = "todo" | "thought";

interface ParsedMessage {
  openid: string;
  toUser: string;
  content: string;
  msgId: string;
  createTime: string;
}

// ─── 工具函数 ─────────────────────────────────────────────

async function sha1(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(
  signature: string,
  timestamp: string,
  nonce: string,
): Promise<boolean> {
  if (!signature || !timestamp || !nonce || !TOKEN) return false;
  const expected = await sha1([TOKEN, timestamp, nonce].sort().join(""));
  return expected === signature;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
  );
  const m = xml.match(re);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function parseIncomingXml(xml: string): ParsedMessage {
  return {
    openid: extractTag(xml, "FromUserName"),
    toUser: extractTag(xml, "ToUserName"),
    content: extractTag(xml, "Content"),
    msgId: extractTag(xml, "MsgId"),
    createTime: extractTag(xml, "CreateTime"),
  };
}

function xmlReply(to: string, from: string, text: string): string {
  const now = Math.floor(Date.now() / 1000);
  const safe = text.replace(/]]>/g, "]] >");
  return `<xml>
<ToUserName><![CDATA[${to}]]></ToUserName>
<FromUserName><![CDATA[${from}]]></FromUserName>
<CreateTime>${now}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${safe}]]></Content>
</xml>`;
}

// ─── 消息内容解析 ─────────────────────────────────────────

interface Parsed {
  type: ItemType;
  text: string;
  category?: ThoughtCategory;
}

function parseCommand(raw: string): Parsed | null {
  const text = raw.trim();
  if (!text) return null;

  const prefixes: Array<[RegExp, Parsed["type"], ThoughtCategory?]> = [
    [/^\/?(todo|待办|任务)[\s:：]+/i, "todo", undefined],
    [/^\/?(idea|想法)[\s:：]+/i, "thought", "general"],
    [/^\/?(work|工作)[\s:：]+/i, "thought", "work"],
    [/^\/?(life|生活)[\s:：]+/i, "thought", "life"],
    [/^\/?(inspire|灵感)[\s:：]+/i, "thought", "inspire"],
    [/^\/?i[\s:：]+/i, "thought", "general"],
    [/^\/?t[\s:：]+/i, "todo", undefined],
  ];

  for (const [re, type, category] of prefixes) {
    if (re.test(text)) {
      return { type, text: text.replace(re, "").trim(), category };
    }
  }
  // 默认走 todo
  return { type: "todo", text };
}

// ─── 业务处理 ─────────────────────────────────────────────

const HELP_TEXT = [
  "可用命令：",
  "/bind <6位码>   绑定账号",
  "直接发文字       默认作为待办",
  "待办 xxx         创建待办",
  "想法 xxx         创建想法",
  "工作 xxx         想法-工作",
  "生活 xxx         想法-生活",
  "灵感 xxx         想法-灵感",
  "/help            帮助",
].join("\n");

async function handleBind(openid: string, code: string): Promise<string> {
  const trimmed = code.trim();
  if (!trimmed) return "绑定失败：请附上 6 位绑定码，例如 /bind 123456";

  const { data: codeRow, error: codeErr } = await supabase
    .from("wechat_bind_codes")
    .select("code, user_id, expires_at")
    .eq("code", trimmed)
    .maybeSingle();

  if (codeErr) return `绑定失败：${codeErr.message}`;
  if (!codeRow) return "绑定失败：绑定码无效或已被使用";
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    await supabase.from("wechat_bind_codes").delete().eq("code", trimmed);
    return "绑定失败：绑定码已过期，请在 App 中重新生成";
  }

  const { error: upsertErr } = await supabase
    .from("wechat_bindings")
    .upsert({ openid, user_id: codeRow.user_id }, { onConflict: "openid" });
  if (upsertErr) return `绑定失败：${upsertErr.message}`;

  await supabase.from("wechat_bind_codes").delete().eq("code", trimmed);
  return "✓ 绑定成功！现在直接发消息即可记录";
}

async function findUserId(openid: string): Promise<string | null> {
  const { data } = await supabase
    .from("wechat_bindings")
    .select("user_id")
    .eq("openid", openid)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function insertEntry(userId: string, parsed: Parsed): Promise<string> {
  const payload = {
    text: parsed.text,
    type: parsed.type,
    completed: parsed.type === "todo" ? false : null,
    thought_category: parsed.type === "thought"
      ? (parsed.category ?? "general")
      : null,
    user_id: userId,
  };
  const { error } = await supabase.from("entries").insert(payload);
  if (error) return `记录失败：${error.message}`;

  if (parsed.type === "todo") return `✓ 已记录待办：${parsed.text}`;
  const label: Record<ThoughtCategory, string> = {
    general: "想法",
    work: "工作",
    life: "生活",
    inspire: "灵感",
  };
  return `✓ 已记录${label[parsed.category ?? "general"]}：${parsed.text}`;
}

async function routeMessage(msg: ParsedMessage): Promise<string> {
  const content = (msg.content ?? "").trim();

  // /help
  if (/^\/?(help|帮助|\?)\s*$/i.test(content)) return HELP_TEXT;

  // /bind <code>
  const bindMatch = content.match(/^\/?bind[\s:：]+(\S+)/i) ??
    content.match(/^\/?绑定[\s:：]+(\S+)/);
  if (bindMatch) return await handleBind(msg.openid, bindMatch[1]);

  // 其它指令必须先绑定
  const userId = await findUserId(msg.openid);
  if (!userId) {
    return [
      "未绑定账号。请：",
      "1. 打开 App，在登录后点击「微信绑定」生成 6 位绑定码",
      "2. 在此发送：/bind <6位码>",
    ].join("\n");
  }

  const parsed = parseCommand(content);
  if (!parsed || !parsed.text) return HELP_TEXT;

  return await insertEntry(userId, parsed);
}

// ─── HTTP 入口 ────────────────────────────────────────────

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const signature = url.searchParams.get("signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const echostr = url.searchParams.get("echostr") ?? "";

  // GET：微信首次接入校验
  if (req.method === "GET") {
    const ok = await verifySignature(signature, timestamp, nonce);
    if (!ok) return new Response("invalid signature", { status: 403 });
    return new Response(echostr, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // POST 同样校验签名，防止伪造
  if (!(await verifySignature(signature, timestamp, nonce))) {
    return new Response("invalid signature", { status: 403 });
  }

  const xml = await req.text();
  const msg = parseIncomingXml(xml);

  // 非文本消息（事件、图片、语音等）先简单处理：关注事件回欢迎语，其它忽略
  const msgType = extractTag(xml, "MsgType");
  if (msgType === "event") {
    const event = extractTag(xml, "Event").toLowerCase();
    if (event === "subscribe") {
      return new Response(
        xmlReply(
          msg.openid,
          msg.toUser,
          "欢迎！请在 App 内生成 6 位绑定码，然后在此发送：/bind <码> 以完成绑定。",
        ),
        { headers: { "content-type": "application/xml; charset=utf-8" } },
      );
    }
    return new Response("success"); // 其它事件：微信约定的空响应
  }

  if (msgType !== "text") {
    return new Response(
      xmlReply(msg.openid, msg.toUser, "暂只支持文本消息"),
      { headers: { "content-type": "application/xml; charset=utf-8" } },
    );
  }

  // 5 秒超时保护：微信对超时重试 3 次，这里兜底超时就回 success（不回复）
  const reply = await Promise.race<string>([
    routeMessage(msg),
    new Promise<string>((resolve) => setTimeout(() => resolve(""), 4500)),
  ]);

  if (!reply) return new Response("success");
  return new Response(xmlReply(msg.openid, msg.toUser, reply), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
});
