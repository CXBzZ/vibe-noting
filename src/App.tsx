import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Trash2, Check, ExternalLink, X, ListTodo, Lightbulb,
  MessageSquareQuote, LogOut, LogIn, Loader2, Crosshair, Maximize2,
  ChevronLeft, ChevronRight, Sparkles, GripVertical, MessageSquare,
} from 'lucide-react';
import { Reorder } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';
import { WechatBind } from './components/WechatBind';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ItemType = 'todo' | 'thought';
type ThoughtCategory = 'general' | 'work' | 'life' | 'inspire';

type Entry = {
  id: string;
  text: string;
  completed?: boolean;
  type: ItemType;
  thought_category?: ThoughtCategory;
  created_at: string;
  user_id: string;
};

// ─── Helpers ─────────────────────────────────────────────

const ipcRenderer = (() => {
  try { return (window as any).require?.('electron')?.ipcRenderer; }
  catch { return null; }
})();

const isElectronEnv = navigator.userAgent.toLowerCase().includes(' electron/');
const supportsDocPip = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

const thoughtCategories: { id: ThoughtCategory; label: string }[] = [
  { id: 'general', label: '全部' },
  { id: 'work', label: '工作' },
  { id: 'life', label: '生活' },
  { id: 'inspire', label: '灵感' },
];

// ─── App ─────────────────────────────────────────────────

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeTab, setActiveTab] = useState<ItemType>('todo');
  const [activeThoughtCategory, setActiveThoughtCategory] = useState<ThoughtCategory>('general');
  const [inputValue, setInputValue] = useState('');
  const [isPip, setIsPip] = useState(false);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showWechatBind, setShowWechatBind] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [todoOrder, setTodoOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem('todoOrder'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });
  const pipWindowRef = useRef<Window | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── PWA ───
  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  // ─── Auth ───
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // ─── Data ───
  useEffect(() => {
    if (!session?.user.id) { setEntries([]); return; }

    const fetchEntries = async () => {
      const { data, error } = await supabase
        .from('entries').select('*').order('created_at', { ascending: false });
      if (error) console.error('Error fetching:', error);
      else setEntries(data || []);
    };
    fetchEntries();

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'entries', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setEntries(prev => prev.some(e => e.id === payload.new.id) ? prev : [payload.new as Entry, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setEntries(prev => prev.map(e => e.id === payload.new.id ? payload.new as Entry : e));
          } else if (payload.eventType === 'DELETE') {
            setEntries(prev => prev.filter(e => e.id !== payload.old.id));
          }
        }
      ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session]);

  // ─── Actions ───
  const addEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !session?.user.id) return;
    const newEntry = {
      text: inputValue.trim(),
      type: activeTab,
      completed: activeTab === 'todo' ? false : null,
      thought_category: activeTab === 'thought' ? activeThoughtCategory : null,
      user_id: session.user.id,
    };
    const { data, error } = await supabase.from('entries').insert([newEntry]).select();
    if (error) {
      console.error('Error adding:', error);
      alert(`添加失败: ${error.message}`);
    } else {
      if (data?.[0]) setEntries(prev => [data[0] as Entry, ...prev]);
      setInputValue('');
    }
  };

  const toggleTodo = async (entry: Entry) => {
    const { data, error } = await supabase
      .from('entries').update({ completed: !entry.completed }).eq('id', entry.id).select();
    if (error) alert(`更新失败: ${error.message}`);
    else if (data?.[0]) setEntries(prev => prev.map(e => e.id === entry.id ? data[0] as Entry : e));
  };

  const deleteEntry = (id: string) => setDeleteConfirmId(id);

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    const prev = [...entries];
    setEntries(p => p.filter(e => e.id !== id));
    const { error, data } = await supabase.from('entries').delete().eq('id', id).select();
    if (error || !data?.length) {
      setEntries(prev);
      alert(error ? `删除失败: ${error.message}` : '删除失败：权限不足');
    }
  };

  const confirmDeleteAllTodos = async () => {
    setShowDeleteAllConfirm(false);
    const todoIds = entries.filter(e => e.type === 'todo').map(e => e.id);
    if (todoIds.length === 0) return;
    const prev = [...entries];
    setEntries(p => p.filter(e => e.type !== 'todo'));
    const { error } = await supabase.from('entries').delete().in('id', todoIds);
    if (error) {
      setEntries(prev);
      alert(`批量删除失败: ${error.message}`);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setAuthLoading(true);
    try {
      if (authMode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert('注册成功！请检查邮箱确认。');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      alert(err.message || '认证失败');
    } finally { setAuthLoading(false); }
  };

  const handleLogout = () => supabase.auth.signOut();

  // ─── PiP ───
  const togglePip = async () => {
    if (isPip) { pipWindowRef.current?.close(); return; }
    if (!('documentPictureInPicture' in window)) { alert('浏览器不支持画中画'); return; }
    try {
      // @ts-ignore
      const pw = await window.documentPictureInPicture.requestWindow({ width: 340, height: 550 });
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(s => pw.document.head.appendChild(s.cloneNode(true)));
      const c = pw.document.createElement('div');
      c.id = 'pip-root'; c.className = 'h-full bg-zinc-950 text-zinc-50';
      pw.document.body.appendChild(c);
      pw.document.body.className = 'bg-zinc-950 m-0 p-0 h-screen overflow-hidden';
      setPipContainer(c); setIsPip(true); pipWindowRef.current = pw;
      pw.addEventListener('pagehide', () => { setIsPip(false); setPipContainer(null); pipWindowRef.current = null; });
    } catch (err) { console.error('PiP failed:', err); }
  };

  // ─── Todo Order Sync ───
  useEffect(() => {
    const todoIds = new Set(entries.filter(e => e.type === 'todo').map(e => e.id));
    setTodoOrder(prev => {
      const kept = prev.filter(id => todoIds.has(id));
      const keptSet = new Set(kept);
      const entryMap = new Map<string, Entry>(entries.map(e => [e.id, e]));
      const newIds = Array.from(todoIds)
        .filter(id => !keptSet.has(id))
        .sort((a: string, b: string) => new Date(entryMap.get(a)!.created_at).getTime() - new Date(entryMap.get(b)!.created_at).getTime());
      if (newIds.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newIds];
    });
  }, [entries]);

  useEffect(() => {
    localStorage.setItem('todoOrder', JSON.stringify(todoOrder));
  }, [todoOrder]);

  // ─── Ordered Todos ───
  const orderedTodos = useMemo(() => {
    const entryMap = new Map<string, Entry>(entries.map(e => [e.id, e]));
    return todoOrder.map(id => entryMap.get(id)).filter((e): e is Entry => !!e && e.type === 'todo');
  }, [entries, todoOrder]);

  // ─── Focus Mode ───
  const pendingTodos = orderedTodos.filter(e => !e.completed);
  const enterFocusMode = () => { setFocusMode(true); setFocusIndex(0); ipcRenderer?.send('enter-focus-mode'); };
  const exitFocusMode  = () => { setFocusMode(false); ipcRenderer?.send('exit-focus-mode'); };
  const focusNext = () => setFocusIndex(prev => pendingTodos.length <= 1 ? 0 : (prev + 1) % pendingTodos.length);
  const focusPrev = () => setFocusIndex(prev => pendingTodos.length <= 1 ? 0 : (prev - 1 + pendingTodos.length) % pendingTodos.length);

  useEffect(() => {
    if (!focusMode || pendingTodos.length === 0) return;
    if (focusIndex >= pendingTodos.length) setFocusIndex(0);
  }, [pendingTodos.length, focusMode, focusIndex]);

  // ─── Derived ───
  const filteredEntries = activeTab === 'todo'
    ? orderedTodos
    : entries.filter(e => e.type === 'thought' && e.thought_category === activeThoughtCategory);

  const todoCount = entries.filter(e => e.type === 'todo' && !e.completed).length;
  const thoughtCount = entries.filter(e => e.type === 'thought').length;

  // ─── Focus Mode UI ───
  if (focusMode) {
    const safeFocusIdx = pendingTodos.length === 0 ? -1 : focusIndex >= pendingTodos.length ? 0 : focusIndex;
    const current = safeFocusIdx >= 0 ? pendingTodos[safeFocusIdx] : null;
    return (
      <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-50 font-sans overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-yellow-500/80 via-amber-400/60 to-transparent" />
        <div
          className="flex-1 flex items-center px-3 gap-2 min-h-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {current ? (
            <>
              <button
                onClick={() => toggleTodo(current)}
                className="flex-shrink-0 w-4 h-4 rounded-full border border-zinc-500 hover:border-yellow-500 hover:bg-yellow-500/10 flex items-center justify-center transition-all text-transparent hover:text-yellow-500"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Check size={9} strokeWidth={3} />
              </button>
              <p className="flex-1 text-[12px] text-zinc-300 leading-none truncate">{current.text}</p>
              <span className="flex-shrink-0 text-[10px] text-yellow-500/60 font-medium tabular-nums">
                {safeFocusIdx + 1}/{pendingTodos.length}
              </span>
              {pendingTodos.length > 1 && (
                <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                  <button onClick={focusPrev} className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors">
                    <ChevronLeft size={12} />
                  </button>
                  <button onClick={focusNext} className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors">
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}
              <button
                onClick={exitFocusMode}
                className="flex-shrink-0 p-0.5 rounded text-zinc-600 hover:text-zinc-200 transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Maximize2 size={11} />
              </button>
            </>
          ) : (
            <>
              <p className="flex-1 text-[12px] text-zinc-500 text-center">全部完成 ✨</p>
              <button
                onClick={exitFocusMode}
                className="flex-shrink-0 p-0.5 rounded text-zinc-600 hover:text-zinc-200 transition-colors"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Maximize2 size={11} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Main UI ───
  const MainUI = (
    <div className="relative flex flex-col h-full w-full bg-zinc-950 text-zinc-50 font-sans overflow-hidden">
      {/* ── Header ── */}
      <div
        className="flex flex-col shrink-0 bg-zinc-950 sticky top-0 z-10"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Toolbar row */}
        <div className={cn("flex items-center justify-between px-3 pt-2 pb-1", isElectronEnv && "pl-20")}>
          <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={() => setActiveTab('todo')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTab === 'todo'
                  ? "bg-yellow-500/10 text-yellow-500"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
              )}
            >
              <ListTodo size={13} />
              待办
              {todoCount > 0 && (
                <span className={cn(
                  "ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center",
                  activeTab === 'todo' ? "bg-yellow-500/20 text-yellow-500" : "bg-zinc-800 text-zinc-500"
                )}>
                  {todoCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('thought')}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeTab === 'thought'
                  ? "bg-yellow-500/10 text-yellow-500"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
              )}
            >
              <Lightbulb size={13} />
              想法
              {thoughtCount > 0 && (
                <span className={cn(
                  "ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center",
                  activeTab === 'thought' ? "bg-yellow-500/20 text-yellow-500" : "bg-zinc-800 text-zinc-500"
                )}>
                  {thoughtCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {deferredPrompt && (
              <button onClick={handleInstall} className="p-1.5 rounded-lg text-yellow-500 hover:bg-yellow-500/10 transition-colors" title="安装应用">
                <Plus size={14} />
              </button>
            )}
            {!isElectronEnv && supportsDocPip && (
              <button onClick={togglePip} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors" title={isPip ? "关闭悬浮窗" : "开启悬浮窗"}>
                {isPip ? <X size={14} /> : <ExternalLink size={14} />}
              </button>
            )}
            {session && !isElectronEnv && (
              <button onClick={() => setShowWechatBind(true)} className="p-1.5 rounded-lg text-zinc-500 hover:text-green-400 hover:bg-zinc-800/50 transition-colors" title="微信绑定">
                <MessageSquare size={14} />
              </button>
            )}
            {session && activeTab === 'todo' && orderedTodos.length > 0 && (
              <button onClick={() => setShowDeleteAllConfirm(true)} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800/50 transition-colors" title="清空所有待办">
                <Trash2 size={14} />
              </button>
            )}
            {session && isElectronEnv && pendingTodos.length > 0 && (
              <button onClick={enterFocusMode} className="p-1.5 rounded-lg text-zinc-500 hover:text-yellow-500 hover:bg-zinc-800/50 transition-colors" title="聚焦模式">
                <Crosshair size={14} />
              </button>
            )}
            {session && (
              <button onClick={handleLogout} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800/50 transition-colors" title="退出登录">
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Thought sub-tabs */}
        {activeTab === 'thought' && (
          <div className="flex items-center gap-1 px-3 pb-2 overflow-x-auto no-scrollbar" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {thoughtCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveThoughtCategory(cat.id)}
                className={cn(
                  "px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-all",
                  activeThoughtCategory === cat.id
                    ? "bg-zinc-800 text-yellow-500"
                    : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}

        <div className="h-px bg-gradient-to-r from-transparent via-zinc-800/60 to-transparent" />
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!session ? (
          /* ── Auth ── */
          <div className="h-full flex flex-col items-center justify-center px-8 py-6" style={{ animation: 'fade-up 0.3s ease-out' }}>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-500/20 to-amber-600/10 flex items-center justify-center mb-5">
              <Sparkles size={22} className="text-yellow-500" />
            </div>
            <h2 className="text-base font-semibold text-zinc-100 mb-1">
              {authMode === 'login' ? '欢迎回来' : '创建账号'}
            </h2>
            <p className="text-xs text-zinc-500 mb-6 text-center leading-relaxed">
              登录后即可多设备同步待办与灵感
            </p>

            <form onSubmit={handleAuth} className="w-full space-y-2.5">
              <input
                type="email" placeholder="邮箱" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900/80 border border-zinc-800/80 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-yellow-500/40 focus:ring-1 focus:ring-yellow-500/20 transition-all placeholder:text-zinc-600"
                required
              />
              <input
                type="password" placeholder="密码" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900/80 border border-zinc-800/80 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:border-yellow-500/40 focus:ring-1 focus:ring-yellow-500/20 transition-all placeholder:text-zinc-600"
                required
              />
              <button
                type="submit" disabled={authLoading}
                className="w-full py-2.5 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 rounded-lg text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {authLoading && <Loader2 size={14} className="animate-spin" />}
                {authMode === 'login' ? '登录' : '注册'}
              </button>
            </form>

            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="mt-4 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              {authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
            </button>
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="animate-spin text-zinc-800" size={24} />
          </div>
        ) : filteredEntries.length === 0 ? (
          /* ── Empty state ── */
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 px-6" style={{ animation: 'fade-up 0.3s ease-out' }}>
            <div className="w-10 h-10 rounded-xl bg-zinc-900/80 flex items-center justify-center mb-3">
              {activeTab === 'todo'
                ? <Check size={18} className="text-zinc-700" />
                : <MessageSquareQuote size={18} className="text-zinc-700" />
              }
            </div>
            <p className="text-xs">{activeTab === 'todo' ? '暂无待办，享受当下' : '灵光一现？记下来'}</p>
          </div>
        ) : (
          /* ── List ── */
          activeTab === 'todo' ? (
          <Reorder.Group
            as="div"
            axis="y"
            values={orderedTodos}
            onReorder={(newOrder) => setTodoOrder(newOrder.map(e => e.id))}
            className="p-2.5 space-y-1.5"
          >
            {filteredEntries.map((entry, i) => (
              <Reorder.Item
                key={entry.id}
                value={entry}
                as="div"
                className={cn(
                  "group flex items-start gap-2.5 px-3.5 py-3 rounded-xl border transition-all duration-150",
                  entry.completed
                    ? "bg-zinc-900/30 border-zinc-800/30 opacity-60"
                    : "bg-zinc-900/50 border-zinc-800/50 hover:bg-zinc-900/80 hover:border-zinc-700/60 hover:shadow-md hover:shadow-black/20"
                )}
                style={{ animation: `fade-up 0.2s ease-out ${i * 0.03}s both` }}
              >
                <div className="flex-shrink-0 mt-1.5 cursor-grab active:cursor-grabbing text-zinc-700 hover:text-zinc-500 transition-colors">
                  <GripVertical size={12} />
                </div>
                <button
                  onClick={() => toggleTodo(entry)}
                  className={cn(
                    "mt-0.5 flex-shrink-0 w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-all",
                    entry.completed
                      ? "bg-yellow-500 border-yellow-500 text-zinc-950"
                      : "border-zinc-700 hover:border-yellow-500/60 text-transparent hover:text-yellow-500/60"
                  )}
                >
                  <Check size={10} strokeWidth={3} />
                </button>
                <p className={cn(
                  "flex-1 text-[13px] leading-relaxed break-words min-w-0",
                  entry.completed ? "text-zinc-600 line-through" : "text-zinc-300"
                )}>
                  {entry.text}
                </p>
                <button
                  onClick={() => deleteEntry(entry.id)}
                  className="flex-shrink-0 p-1 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 rounded transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
          ) : (
          <div className="p-2.5 space-y-1.5">
            {filteredEntries.map((entry, i) => (
              <div
                key={entry.id}
                className="group flex items-start gap-3 pl-0 pr-3.5 py-3 rounded-2xl bg-zinc-900/40 border border-zinc-800/40 hover:bg-zinc-900/70 hover:border-zinc-700/50 hover:shadow-md hover:shadow-black/20 transition-all duration-150"
                style={{ animation: `fade-up 0.2s ease-out ${i * 0.03}s both` }}
              >
                <div className="w-1 self-stretch rounded-full ml-3 bg-yellow-500/30 group-hover:bg-yellow-500/50 transition-colors" />
                <p className="flex-1 text-[13px] leading-relaxed break-words min-w-0 text-zinc-300">
                  {entry.text}
                </p>
                <button
                  onClick={() => deleteEntry(entry.id)}
                  className="flex-shrink-0 p-1 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 rounded transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          )
        )}
      </div>

      {/* ── Input ── */}
      {session && (
        <div
          className="shrink-0 px-3 pt-2.5 border-t border-zinc-800/40"
          style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
        >
          <form onSubmit={addEntry} className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={activeTab === 'todo' ? "添加待办..." : "记录想法..."}
              className="w-full bg-zinc-900/60 border border-zinc-800/60 rounded-lg py-2 pl-3 pr-10 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/30 focus:bg-zinc-900 transition-all"
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="absolute right-1.5 p-1.5 rounded-md text-zinc-500 hover:text-yellow-500 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors"
            >
              <Plus size={16} />
            </button>
          </form>
        </div>
      )}

      {/* ── WeChat Bind Panel ── */}
      {showWechatBind && session?.user?.id && (
        <WechatBind userId={session.user.id} onClose={() => setShowWechatBind(false)} />
      )}

      {/* ── Delete All Todos Modal ── */}
      {showDeleteAllConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-zinc-950/70 backdrop-blur-sm">
          <div className="w-full max-w-[260px] bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 shadow-2xl" style={{ animation: 'scale-in 0.15s ease-out' }}>
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">清空所有待办？</h3>
            <p className="text-xs text-zinc-500 mb-5 leading-relaxed">将删除全部 {orderedTodos.length} 条待办，此操作不可撤销。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDeleteAllTodos}
                className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white text-xs font-medium transition-all"
              >
                全部删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteConfirmId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-zinc-950/70 backdrop-blur-sm">
          <div className="w-full max-w-[260px] bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 shadow-2xl" style={{ animation: 'scale-in 0.15s ease-out' }}>
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">确认删除？</h3>
            <p className="text-xs text-zinc-500 mb-5 leading-relaxed">此操作不可撤销。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white text-xs font-medium transition-all"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ─── Root ───
  return (
    <div className="h-screen w-screen bg-zinc-950">
      {isPip && pipContainer ? (
        <>
          {createPortal(MainUI, pipContainer)}
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-3 p-6 text-center">
            <ExternalLink size={28} className="text-zinc-700" />
            <div className="space-y-1">
              <p className="text-zinc-400 text-sm font-medium">悬浮窗运行中</p>
              <p className="text-[11px]">始终置顶，随时记录</p>
            </div>
            <button
              onClick={togglePip}
              className="mt-2 px-5 py-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-all active:scale-95"
            >
              收回主窗口
            </button>
          </div>
        </>
      ) : MainUI}
    </div>
  );
}
