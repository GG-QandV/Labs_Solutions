import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const formatEventLabel = (eventType) => eventType.replace(/_/g, ' ');

export default function AuditLog() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/requests/events', { params: { limit: 100 } });
      setEvents(res.data.events);
    } catch (err) {
      console.error('Audit log fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <div className="min-h-screen bg-[#09090b] flex overflow-hidden relative">
      {/* Background elements */}
      <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-violet-900/10 to-transparent pointer-events-none" />
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-600/10 rounded-full blur-[120px] mix-blend-screen pointer-events-none" />

      <main className="flex-1 overflow-auto relative z-10 custom-scrollbar">
        <header className="glass-panel border-b border-x-0 border-t-0 border-white/5 px-8 py-6 sticky top-0 z-30">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <button
                onClick={() => navigate('/')}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all hover:-translate-x-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div>
                <h1 className="text-white font-bold text-2xl tracking-tight flex items-center gap-3">
                  Audit Log
                  <span className="bg-violet-500/20 text-violet-400 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-md border border-violet-500/20 font-bold">Admin Only</span>
                </h1>
                <p className="text-gray-400 text-sm font-medium mt-1">Immutable timeline of system actions and modifications.</p>
              </div>
            </div>
            
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-white text-black px-5 py-2.5 text-sm font-bold transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 shadow-[0_0_20px_rgba(255,255,255,0.1)] group"
            >
              <svg className={`w-4 h-4 transition-transform ${loading ? 'animate-spin' : 'group-hover:rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {loading ? 'Refreshing...' : 'Refresh Logs'}
            </button>
          </div>
        </header>

        <div className="max-w-6xl mx-auto p-8">
          <div className="glass-card rounded-3xl p-8 fade-in shadow-2xl border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500" />
            
            <div className="flex items-center justify-between mb-8 relative z-10">
              <h2 className="text-white font-semibold text-lg flex items-center gap-3">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                System Events
              </h2>
              <span className="text-gray-500 text-xs font-bold uppercase tracking-widest bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">{events.length} records</span>
            </div>

            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse border border-white/5" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="py-24 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <p className="text-white font-medium text-lg">No audit events found</p>
                <p className="text-gray-500 text-sm mt-1">System activity will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {events.map((event, idx) => (
                  <div key={event.id} className="bg-black/30 hover:bg-black/50 border border-white/5 hover:border-white/10 rounded-2xl p-6 transition-all group" style={{ animationDelay: `${idx * 30}ms` }}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/5 shrink-0 group-hover:scale-110 group-hover:bg-violet-500/10 group-hover:text-violet-400 group-hover:border-violet-500/20 transition-all">
                          <svg className="w-5 h-5 text-gray-500 group-hover:text-violet-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        </div>
                        <div>
                          <p className="text-white font-semibold tracking-wide">{formatEventLabel(event.eventType)}</p>
                          <div className="flex items-center gap-3 mt-1.5 text-xs">
                            <span className="text-gray-500 font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5">{new Date(event.createdAt).toLocaleString()}</span>
                            <span className="text-gray-600 font-mono">ID: {event.id.slice(-8)}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="lg:text-right flex flex-col gap-2">
                        <div className="inline-flex items-center lg:justify-end gap-2 text-sm">
                          <span className="text-gray-500">Request:</span>
                          <span className="bg-white/5 px-2 py-1 rounded border border-white/5 text-gray-300 font-mono text-xs cursor-pointer hover:bg-white/10 transition-colors" onClick={() => navigate(`/requests/${event.requestId}`)}>
                            #{event.requestId.slice(-8)}
                          </span>
                        </div>
                        {event.actor?.name && (
                          <div className="inline-flex items-center lg:justify-end gap-2 text-sm">
                            <span className="text-gray-500">Actor:</span>
                            <span className="text-violet-300 font-medium flex items-center gap-1.5">
                              <div className="w-4 h-4 bg-violet-500/20 rounded-full flex items-center justify-center text-[8px] font-bold text-violet-400">{event.actor.name[0]}</div>
                              {event.actor.name}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {(event.oldValue || event.newValue || event.metadata) && (
                      <div className="mt-6 pt-5 border-t border-white/5 grid gap-4 sm:grid-cols-2">
                        {event.oldValue && (
                          <div className="bg-black/40 rounded-xl p-4 border border-red-500/10 relative overflow-hidden group-hover:border-red-500/20 transition-colors">
                            <div className="absolute top-0 left-0 w-1 h-full bg-red-500/50" />
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2">
                              <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                              Previous Value
                            </p>
                            <p className="text-gray-300 text-sm font-mono truncate">{event.oldValue}</p>
                          </div>
                        )}
                        {event.newValue && (
                          <div className="bg-black/40 rounded-xl p-4 border border-green-500/10 relative overflow-hidden group-hover:border-green-500/20 transition-colors">
                            <div className="absolute top-0 left-0 w-1 h-full bg-green-500/50" />
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2">
                              <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                              New Value
                            </p>
                            <p className="text-white font-medium text-sm font-mono truncate">{event.newValue}</p>
                          </div>
                        )}
                        {event.metadata && (
                          <div className="bg-black/40 rounded-xl p-4 border border-white/5 sm:col-span-2 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50" />
                            <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 mb-2">
                              <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Metadata Context
                            </p>
                            <p className="text-gray-400 text-sm font-mono break-all">{event.metadata}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}