import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, X, MessageSquare, Check, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface WechatBindProps {
  userId: string;
  onClose: () => void;
}

interface BindCode {
  code: string;
  expires_at: string;
}

interface Binding {
  openid: string;
  created_at: string;
}

const CODE_TTL_MINUTES = 10;

function randomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function WechatBind({ userId, onClose }: WechatBindProps) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeCode, setActiveCode] = useState<BindCode | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = async () => {
    setLoading(true);
    setError(null);
    const nowIso = new Date().toISOString();

    const [codeRes, bindRes] = await Promise.all([
      supabase
        .from('wechat_bind_codes')
        .select('code, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', nowIso)
        .order('expires_at', { ascending: false })
        .limit(1),
      supabase
        .from('wechat_bindings')
        .select('openid, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (codeRes.error) setError(codeRes.error.message);
    else setActiveCode(codeRes.data?.[0] ?? null);

    if (!bindRes.error) setBindings(bindRes.data ?? []);

    setLoading(false);
  };

  useEffect(() => {
    loadState();
    const cleanupExpired = async () => {
      await supabase
        .from('wechat_bind_codes')
        .delete()
        .eq('user_id', userId)
        .lt('expires_at', new Date().toISOString());
    };
    cleanupExpired();
  }, [userId]);

  useEffect(() => {
    if (!activeCode) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const ms = new Date(activeCode.expires_at).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
      if (ms <= 0) setActiveCode(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeCode]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    await supabase.from('wechat_bind_codes').delete().eq('user_id', userId);

    let attempt = 0;
    let lastErr: string | null = null;
    while (attempt < 5) {
      const code = randomCode();
      const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
      const { error } = await supabase
        .from('wechat_bind_codes')
        .insert({ code, user_id: userId, expires_at });
      if (!error) {
        setActiveCode({ code, expires_at });
        setGenerating(false);
        return;
      }
      if (error.code !== '23505') {
        lastErr = error.message;
        break;
      }
      attempt += 1;
    }
    setError(lastErr ?? '生成失败，请重试');
    setGenerating(false);
  };

  const handleUnbind = async (openid: string) => {
    if (!confirm('确认解除该微信绑定？')) return;
    const prev = bindings;
    setBindings((b) => b.filter((x) => x.openid !== openid));
    const { error } = await supabase.from('wechat_bindings').delete().eq('openid', openid);
    if (error) {
      setBindings(prev);
      alert(`解绑失败：${error.message}`);
    }
  };

  const handleCopy = async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-zinc-950 text-zinc-50 overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-yellow-500" />
          <h2 className="text-sm font-semibold text-zinc-100">微信绑定</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-5">
        <section>
          <h3 className="text-xs font-medium text-zinc-400 mb-2">1. 获取绑定码</h3>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-zinc-600" />
              </div>
            ) : activeCode && remaining > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div
                    className="text-3xl font-mono font-semibold tracking-[0.3em] text-yellow-500 select-all"
                  >
                    {activeCode.code}
                  </div>
                  <button
                    onClick={handleCopy}
                    className="p-2 rounded-lg text-zinc-500 hover:text-yellow-500 hover:bg-zinc-800/60 transition-colors"
                    title="复制"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">
                    剩余 {Math.floor(remaining / 60)}:
                    {(remaining % 60).toString().padStart(2, '0')}
                  </span>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                  >
                    <RefreshCw size={11} className={generating ? 'animate-spin' : ''} />
                    重新生成
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-2.5 rounded-lg bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-zinc-950 text-sm font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {generating && <Loader2 size={14} className="animate-spin" />}
                生成 6 位绑定码
              </button>
            )}
            {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-medium text-zinc-400 mb-2">2. 在微信公众号发送</h3>
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4 space-y-2 text-[12px] leading-relaxed">
            <p className="text-zinc-400">
              关注公众号后，在聊天中发送：
            </p>
            <code className="block px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-md text-yellow-500 font-mono text-[13px]">
              /bind {activeCode?.code ?? '<6位码>'}
            </code>
            <p className="text-zinc-500 pt-1">
              绑定成功后，直接发消息即可记录：
            </p>
            <ul className="text-zinc-500 space-y-0.5 pl-4 list-disc">
              <li>默认作为「待办」</li>
              <li>以「想法 」「工作 」「生活 」「灵感 」开头 → 作为对应分类的想法</li>
            </ul>
          </div>
        </section>

        {bindings.length > 0 && (
          <section>
            <h3 className="text-xs font-medium text-zinc-400 mb-2">已绑定的微信</h3>
            <div className="space-y-1.5">
              {bindings.map((b) => (
                <div
                  key={b.openid}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40"
                >
                  <div className="min-w-0 flex-1 mr-2">
                    <p className="text-[11px] text-zinc-500 font-mono truncate">
                      {b.openid}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {new Date(b.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUnbind(b.openid)}
                    className="text-[11px] text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    解绑
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
