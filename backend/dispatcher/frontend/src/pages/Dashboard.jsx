import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { clearAccessToken, currentUserRole } from '../api/axios';
import { useSocket } from '../hooks/useSocket';

const priorityColor = {
  HIGH: 'bg-red-500/10 text-red-400 border-red-500/20',
  MEDIUM: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  LOW: 'bg-green-500/10 text-green-400 border-green-500/20',
};

const statusColor = {
  NEW: 'bg-gray-500/10 text-gray-400',
  QUEUED: 'bg-blue-500/10 text-blue-400',
  PROCESSING: 'bg-yellow-500/10 text-yellow-400',
  CLASSIFIED: 'bg-violet-500/10 text-violet-400',
  RESOLVED: 'bg-green-500/10 text-green-400',
  FAILED: 'bg-red-500/10 text-red-400',
};

const Toast = ({ message, onClose }) => (
  <div className="fixed top-4 right-4 z-50 bg-violet-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 max-w-sm">
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
    <span className="text-sm">{message}</span>
    <button onClick={onClose} className="ml-2 text-white/70 hover:text-white">✕</button>
  </div>
);

const timeAgo = (date) => {
  const diff = Date.now() - new Date(date);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const status = searchParams.get('status') || '';
  const priority = searchParams.get('priority') || '';
  const category = searchParams.get('category') || '';
  const page = parseInt(searchParams.get('page') || '1');

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (status) params.status = status;
      if (priority) params.priority = priority;
      if (category) params.category = category;
      const res = await api.get('/requests', { params });
      setRequests(res.data.requests);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
    } catch { }
    finally { setLoading(false); }
  }, [status, priority, category, page]);

  const fetchStats = useCallback(async () => {
    try {
      const [all, high, processing, resolved, failed] = await Promise.all([
        api.get('/requests', { params: { limit: 1 } }),
        api.get('/requests', { params: { priority: 'HIGH', limit: 1 } }),
        api.get('/requests', { params: { status: 'PROCESSING', limit: 1 } }),
        api.get('/requests', { params: { status: 'RESOLVED', limit: 1 } }),
        api.get('/requests', { params: { status: 'FAILED', limit: 1 } }),
      ]);
      setStats({
        total: all.data.total,
        high: high.data.total,
        processing: processing.data.total,
        resolved: resolved.data.total,
        failed: failed.data.total,
      });
    } catch { }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleClassified = useCallback((data) => {
    showToast(`New request classified: ${data.category} / ${data.priority}`);
    fetchRequests();
    fetchStats();
  }, [fetchRequests, fetchStats, showToast]);

  const handleFailed = useCallback(() => {
    showToast('Classification failed for a request');
    fetchRequests();
  }, [fetchRequests, showToast]);

  useSocket(handleClassified, handleFailed);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    next.set('page', '1');
    setSearchParams(next);
  };

  const setPage = (newPage) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(newPage));
    setSearchParams(next);
  };

  const logout = async () => {
    await api.post('/auth/logout');
    clearAccessToken();
    navigate('/login');
  };

  const statCards = [
    { label: 'Total Requests', value: stats.total, color: 'violet' },
    { label: 'High Priority', value: stats.high, color: 'red' },
    { label: 'In Progress', value: stats.processing, color: 'yellow' },
    { label: 'Resolved', value: stats.resolved, color: 'green' },
    { label: 'Failed', value: stats.failed, color: 'red' },
  ];

  const colorMap = {
    violet: 'text-violet-400 bg-violet-500/10',
    red: 'text-red-400 bg-red-500/10',
    yellow: 'text-yellow-400 bg-yellow-500/10',
    green: 'text-green-400 bg-green-500/10',
  };

  const navItems = [
    { label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', active: !status },
    { label: 'High Priority', icon: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9', count: stats.high },
    { label: 'Failed', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', count: stats.failed },
    ...(currentUserRole === 'ADMIN' ? [{ label: 'Audit Log', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#09090b] flex overflow-hidden selection:bg-violet-500/30">
      {/* Background ambient glow */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-600/10 rounded-full blur-[150px] mix-blend-screen pointer-events-none" />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:static z-50 w-72 h-full min-h-screen glass-panel flex flex-col transition-transform duration-300 border-r border-white/5 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b border-white/5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent pointer-events-none" />
          <div className="flex items-center gap-4 relative z-10">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20 border border-white/10">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-white text-lg tracking-tight">FlowDesk AI</span>
              <p className="text-[10px] text-violet-400 font-medium uppercase tracking-widest">Enterprise</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto custom-scrollbar relative z-10">
          <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-widest px-3 mb-4 mt-2">Navigation</p>
          {navItems.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                if (item.label === 'High Priority') setFilter('priority', 'HIGH');
                else if (item.label === 'Failed') setFilter('status', 'FAILED');
                else if (item.label === 'Audit Log') navigate('/audit-log');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all group ${item.active ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'}`}
            >
              <div className="flex items-center gap-3">
                <svg className={`w-5 h-5 transition-transform group-hover:scale-110 ${item.active ? 'text-violet-400' : 'text-gray-500 group-hover:text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                {item.label}
              </div>
              {item.count !== undefined && (
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold transition-colors ${item.active ? 'bg-violet-500/20 text-violet-300' : 'bg-black/30 text-gray-400 group-hover:bg-black/50 group-hover:text-gray-300'}`}>{item.count}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5 relative z-10">
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl text-sm font-medium transition-colors group">
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto relative z-10 h-screen custom-scrollbar flex flex-col">
        <header className="glass-panel border-b border-x-0 border-t-0 border-white/5 px-8 py-5 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="text-white font-bold text-xl tracking-tight">Overview</h1>
              <p className="text-gray-400 text-xs font-medium mt-0.5">Real-time intelligence dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </div>
              <span className="text-gray-300 text-xs font-medium">System Online</span>
            </div>
            <div className="h-6 w-px bg-white/10 hidden sm:block" />
            <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border ${currentUserRole === 'ADMIN'
              ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>
              {currentUserRole === 'ADMIN' ? 'Admin' : 'Agent'}
            </span>
          </div>
        </header>

        <div className="p-8 space-y-8 max-w-[1600px] mx-auto w-full flex-1">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-5 fade-in">
            {statCards.map((s, i) => (
              <div key={s.label} className="glass-card rounded-2xl p-5 relative overflow-hidden group" style={{ animationDelay: `${i * 50}ms` }}>
                <div className={`absolute top-0 right-0 w-24 h-24 bg-${s.color}-500/10 rounded-full blur-2xl -mr-10 -mt-10 transition-transform group-hover:scale-150`} />
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-2 relative z-10">{s.label}</p>
                <div className="flex items-baseline gap-2 relative z-10">
                  <p className={`text-3xl font-bold text-${s.color}-400`}>{s.value ?? '-'}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="glass-panel rounded-2xl p-2 fade-in" style={{ animationDelay: '200ms' }}>
            <div className="flex flex-wrap gap-2 items-center">
              {[
                { key: 'status', options: ['', 'NEW', 'QUEUED', 'PROCESSING', 'CLASSIFIED', 'RESOLVED', 'FAILED'], label: 'Status' },
                { key: 'priority', options: ['', 'LOW', 'MEDIUM', 'HIGH'], label: 'Priority' },
                { key: 'category', options: ['', 'support', 'sales', 'urgent', 'spam', 'other'], label: 'Category' },
              ].map((f) => (
                <div key={f.key} className="relative min-w-[140px] flex-1 sm:flex-none">
                  <select
                    value={f.key === 'status' ? status : f.key === 'priority' ? priority : category}
                    onChange={(e) => setFilter(f.key, e.target.value)}
                    className="w-full appearance-none bg-black/40 border border-white/5 text-gray-300 text-sm font-medium rounded-xl px-4 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:bg-black/60 transition-all hover:bg-black/60"
                  >
                    <option value="">All {f.label}</option>
                    {f.options.filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => setSearchParams({})}
                className="text-gray-400 hover:text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-white/5 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                Clear
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between fade-in" style={{ animationDelay: '250ms' }}>
            <h2 className="text-white font-semibold flex items-center gap-2">
              Recent Requests
              <span className="bg-white/10 text-gray-300 text-xs px-2 py-0.5 rounded-md">{total}</span>
            </h2>
          </div>

          {/* Request List */}
          <div className="fade-in" style={{ animationDelay: '300ms' }}>
            {loading ? (
              <div className="grid gap-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="glass-card rounded-2xl p-6 animate-pulse">
                    <div className="flex gap-4">
                      <div className="h-10 w-10 bg-white/5 rounded-xl shrink-0" />
                      <div className="flex-1 space-y-3">
                        <div className="h-4 bg-white/5 rounded w-1/4" />
                        <div className="h-3 bg-white/5 rounded w-2/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : requests.length === 0 ? (
              <div className="glass-panel rounded-3xl py-24 text-center">
                <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-white font-medium text-lg">No requests found</p>
                <p className="text-gray-500 text-sm mt-2">Try adjusting your filters or wait for new requests.</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/requests/${r.id}`)}
                    className="glass-card rounded-2xl p-5 cursor-pointer group hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <span className="bg-black/40 border border-white/10 text-gray-400 text-[11px] font-mono px-2 py-1 rounded-md uppercase tracking-wider">
                            #{r.id.slice(-6)}
                          </span>
                          <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border ${priorityColor[r.prioritySnapshot] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {r.prioritySnapshot || 'UNCLASSIFIED'}
                          </span>
                          <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${statusColor[r.status]}`}>
                            {r.status}
                          </span>
                          {r.categorySnapshot && (
                            <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-violet-500/10 text-violet-400 border border-violet-500/20">
                              {r.categorySnapshot}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-200 text-base font-medium truncate group-hover:text-white transition-colors">{r.message}</p>

                        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 font-medium">
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            {r.customerName}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                            {r.source}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {timeAgo(r.createdAt)}
                          </div>
                        </div>
                      </div>

                      {r.aiClassification?.confidence && (
                        <div className="md:w-32 shrink-0 md:text-right bg-black/20 p-3 rounded-xl border border-white/5">
                          <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wider mb-2">AI Confidence</p>
                          <div className="flex items-center md:justify-end gap-2 mb-1.5">
                            <span className="text-white font-semibold text-sm">{Math.round(r.aiClassification.confidence * 100)}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full relative"
                              style={{ width: `${r.aiClassification.confidence * 100}%` }}
                            >
                              <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite]" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="px-4 py-2.5 text-sm font-medium text-white disabled:text-gray-500 disabled:bg-transparent bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
                >
                  Previous
                </button>
                <div className="px-4 py-2.5 rounded-xl bg-black/40 border border-white/5 text-gray-300 text-sm font-medium">
                  <span className="text-white">{page}</span> <span className="text-gray-600 mx-1">/</span> {totalPages}
                </div>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-4 py-2.5 text-sm font-medium text-white disabled:text-gray-500 disabled:bg-transparent bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
