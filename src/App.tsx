import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, Check, ExternalLink, X, ListTodo, Lightbulb, MessageSquareQuote, LogOut, LogIn, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';

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

export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeTab, setActiveTab] = useState<ItemType>('todo');
  const [activeThoughtCategory, setActiveThoughtCategory] = useState<ThoughtCategory>('general');
  const [inputValue, setInputValue] = useState('');
  const [isPip, setIsPip] = useState(false);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isElectron, setIsElectron] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);

  // Check if running in Electron
  useEffect(() => {
    if (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1) {
      setIsElectron(true);
    }
  }, []);

  // PWA Install Prompt
  useEffect(() => {
    console.log('PWA: Checking installability...');
    const handler = (e: any) => {
      console.log('PWA: beforeinstallprompt event fired!');
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      console.log('PWA: App is already running in standalone mode.');
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Check configuration
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
      setIsConfigured(false);
      setLoading(false);
    }
  }, []);

  // Auth Listener
  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch and Realtime Sync
  useEffect(() => {
    if (!session?.user.id) {
      setEntries([]);
      return;
    }

    const fetchEntries = async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) console.error('Error fetching:', error);
      else setEntries(data || []);
    };

    fetchEntries();

    // Subscribe to changes
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entries', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setEntries(prev => {
              if (prev.some(e => e.id === payload.new.id)) return prev;
              return [payload.new as Entry, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            setEntries(prev => prev.map(e => e.id === payload.new.id ? payload.new as Entry : e));
          } else if (payload.eventType === 'DELETE') {
            setEntries(prev => prev.filter(e => e.id === payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

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
      alert(`添加失败: ${error.message}\n请确保已在 Supabase 中更新了 entries 表（添加了 thought_category 字段）。`);
    } else {
      if (data && data.length > 0) {
        setEntries(prev => [data[0] as Entry, ...prev]);
      }
      setInputValue('');
    }
  };

  const toggleTodo = async (entry: Entry) => {
    const { data, error } = await supabase
      .from('entries')
      .update({ completed: !entry.completed })
      .eq('id', entry.id)
      .select();
    
    if (error) {
      console.error('Error toggling:', error);
      alert(`更新失败: ${error.message}`);
    } else if (data && data.length > 0) {
      setEntries(prev => prev.map(e => e.id === entry.id ? data[0] as Entry : e));
    }
  };

  const deleteEntry = async (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    
    // Optimistic update
    const previousEntries = [...entries];
    setEntries(prev => prev.filter(e => e.id !== id));

    const { error, data } = await supabase
      .from('entries')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      console.error('Error deleting:', error);
      setEntries(previousEntries); // Rollback
      alert(`删除失败: ${error.message}`);
    } else if (!data || data.length === 0) {
      setEntries(previousEntries); // Rollback
      console.warn('No rows deleted. Check RLS policies.');
      alert('删除失败：未找到记录或权限不足。请确保已在 Supabase 中配置了 DELETE 策略。');
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
        alert('注册成功！请检查邮箱确认（如果开启了邮箱验证）。');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      alert(error.message || '认证失败');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => supabase.auth.signOut();

  const togglePip = async () => {
    if (isPip) {
      pipWindowRef.current?.close();
      return;
    }

    if (!('documentPictureInPicture' in window)) {
      alert('Your browser does not support the Document Picture-in-Picture API.');
      return;
    }

    try {
      // @ts-ignore
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 340,
        height: 550,
      });

      const styles = document.head.querySelectorAll('style, link[rel="stylesheet"]');
      styles.forEach((style) => {
        pipWindow.document.head.appendChild(style.cloneNode(true));
      });

      const container = pipWindow.document.createElement('div');
      container.id = 'pip-root';
      container.className = 'h-full bg-zinc-950 text-zinc-50';
      pipWindow.document.body.appendChild(container);
      pipWindow.document.body.className = 'bg-zinc-950 m-0 p-0 h-screen overflow-hidden';

      setPipContainer(container);
      setIsPip(true);
      pipWindowRef.current = pipWindow;

      pipWindow.addEventListener('pagehide', () => {
        setIsPip(false);
        setPipContainer(null);
        pipWindowRef.current = null;
      });
    } catch (error) {
      console.error('Failed to open PiP window:', error);
    }
  };

  const filteredEntries = entries.filter(e => {
    if (e.type !== activeTab) return false;
    if (activeTab === 'thought') {
      return e.thought_category === activeThoughtCategory;
    }
    return true;
  });

  const MainUI = (
    <div className="flex flex-col h-full w-full max-w-md mx-auto bg-zinc-950 text-zinc-50 font-sans shadow-2xl overflow-hidden sm:border sm:border-zinc-800 sm:rounded-2xl">
      {/* Header */}
      <div 
        className="flex flex-col border-b border-zinc-800/50 bg-zinc-900/80 backdrop-blur-xl sticky top-0 z-10"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="flex p-1 bg-zinc-800/50 rounded-lg">
              <button
                onClick={() => setActiveTab('todo')}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  activeTab === 'todo' ? "bg-zinc-700 text-yellow-500 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <ListTodo size={14} />
                待办
              </button>
              <button
                onClick={() => setActiveTab('thought')}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  activeTab === 'thought' ? "bg-zinc-700 text-yellow-500 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <Lightbulb size={14} />
                想法
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {deferredPrompt && (
              <button
                onClick={handleInstall}
                className="p-1.5 rounded-md text-yellow-500 hover:bg-yellow-500/10 transition-colors"
                title="安装应用"
              >
                <Plus size={16} />
              </button>
            )}
            {!isElectron && (
              <button
                onClick={togglePip}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                title={isPip ? "关闭悬浮窗" : "开启悬浮窗"}
              >
                {isPip ? <X size={16} /> : <ExternalLink size={16} />}
              </button>
            )}
            {session && (
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                title="退出登录"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Sub Tabs for Thoughts */}
        {activeTab === 'thought' && (
          <div className="flex items-center gap-4 px-5 pb-3 overflow-x-auto no-scrollbar">
            {[
              { id: 'general', label: '全部' },
              { id: 'work', label: '工作' },
              { id: 'life', label: '生活' },
              { id: 'inspire', label: '灵感' },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveThoughtCategory(cat.id as ThoughtCategory)}
                className={cn(
                  "text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap transition-all",
                  activeThoughtCategory === cat.id 
                    ? "text-yellow-500" 
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {!isConfigured ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-6">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center text-yellow-500">
              <X size={32} />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-medium">需要配置 Supabase</h2>
              <p className="text-sm text-zinc-500">请在项目设置中添加 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 环境变量以启用同步功能。</p>
            </div>
            <div className="p-4 bg-zinc-900 rounded-xl text-left space-y-2">
              <p className="text-xs text-zinc-400 font-mono">1. 打开 Settings -{'>'} Secrets</p>
              <p className="text-xs text-zinc-400 font-mono">2. 添加 Supabase URL 和 Key</p>
              <p className="text-xs text-zinc-400 font-mono">3. 刷新页面</p>
            </div>
          </div>
        ) : !session ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-6">
            <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center text-yellow-500">
              <LogIn size={32} />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-medium">{authMode === 'login' ? '欢迎回来' : '创建账号'}</h2>
              <p className="text-sm text-zinc-500">登录后即可在所有设备上同步你的待办和灵感</p>
            </div>
            
            <form onSubmit={handleAuth} className="w-full space-y-3">
              <input
                type="email"
                placeholder="邮箱地址"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
                required
              />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-yellow-500/50 transition-all"
                required
              />
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-zinc-950 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {authLoading && <Loader2 size={16} className="animate-spin" />}
                {authMode === 'login' ? '登录' : '注册'}
              </button>
            </form>

            <button
              onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
            </button>
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="animate-spin text-zinc-700" size={32} />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-3">
            <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center">
              {activeTab === 'todo' ? <Check size={20} className="text-zinc-700" /> : <MessageSquareQuote size={20} className="text-zinc-700" />}
            </div>
            <p className="text-sm">{activeTab === 'todo' ? '暂无待办，休息一下吧' : '灵光一现？记下来吧'}</p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "group flex items-start gap-3 p-3.5 rounded-xl border transition-all duration-200",
                entry.completed 
                  ? "bg-zinc-900/30 border-zinc-800/30" 
                  : "bg-zinc-900 border-zinc-800 hover:border-zinc-700 shadow-sm"
              )}
            >
              {activeTab === 'todo' && (
                <button
                  onClick={() => toggleTodo(entry)}
                  className={cn(
                    "mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                    entry.completed
                      ? "bg-yellow-500 border-yellow-500 text-zinc-950"
                      : "border-zinc-600 hover:border-yellow-500 text-transparent"
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </button>
              )}
              
              {activeTab === 'thought' && (
                <div className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-yellow-500/50 shadow-[0_0_8px_rgba(234,179,8,0.3)]" />
              )}

              <p 
                className={cn(
                  "flex-1 text-sm leading-relaxed break-words transition-all duration-200",
                  entry.completed ? "text-zinc-600 line-through" : "text-zinc-200"
                )}
              >
                {entry.text}
              </p>

              <button
                onClick={() => deleteEntry(entry.id)}
                className="opacity-40 hover:opacity-100 p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded-md transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Input Area */}
      {session && (
        <div className="p-4 border-t border-zinc-800/50 bg-zinc-900/50 backdrop-blur-xl">
          <form onSubmit={addEntry} className="relative flex items-center">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={activeTab === 'todo' ? "添加待办..." : "记录想法..."}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 pl-4 pr-12 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all"
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="absolute right-2 p-2 text-zinc-400 hover:text-yellow-500 disabled:opacity-50 disabled:hover:text-zinc-400 transition-colors"
            >
              <Plus size={20} />
            </button>
          </form>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {deleteConfirmId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-zinc-950/60 backdrop-blur-sm">
          <div className="w-full max-w-[280px] bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-base font-medium text-zinc-100 mb-2">确认删除？</h3>
            <p className="text-sm text-zinc-500 mb-6">此操作不可撤销，该记录将从云端永久移除。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-sm font-medium transition-all"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen w-screen bg-zinc-950 sm:bg-zinc-900 flex items-center justify-center sm:p-4">
      {isPip && pipContainer ? (
        <>
          {createPortal(MainUI, pipContainer)}
          <div className="flex flex-col items-center justify-center text-zinc-500 space-y-4 p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/50 flex items-center justify-center">
              <ExternalLink size={32} className="text-zinc-600" />
            </div>
            <div className="space-y-1">
              <p className="text-zinc-300 font-medium">应用已在悬浮窗运行</p>
              <p className="text-xs">该窗口始终置顶，方便你随时记录</p>
            </div>
            <button 
              onClick={togglePip}
              className="px-6 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-sm font-medium transition-all active:scale-95"
            >
              收回主窗口
            </button>
          </div>
        </>
      ) : (
        MainUI
      )}
    </div>
  );
}
