import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { currentUserId, currentUserRole } from '../api/axios';

const statusColor = {
  NEW: 'bg-gray-500/10 text-gray-400',
  QUEUED: 'bg-blue-500/10 text-blue-400',
  PROCESSING: 'bg-yellow-500/10 text-yellow-400',
  CLASSIFIED: 'bg-violet-500/10 text-violet-400',
  RESOLVED: 'bg-green-500/10 text-green-400',
  FAILED: 'bg-red-500/10 text-red-400',
};

const timeAgo = (date) => {
  const diff = Date.now() - new Date(date);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const getInitials = (name) => name?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

export default function RequestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newStatus, setNewStatus] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = currentUserRole === 'ADMIN';

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const res = await api.get(`/requests/${id}`);
        setRequest(res.data.request);
        setNewStatus(res.data.request.status);
      } catch (err) {
        if (err.response?.status === 403) {
          showToast('You do not have permission to view this request.', 'error');
          setTimeout(() => navigate('/'), 2000);
        } else {
          navigate('/');
        }
      } finally {
        setLoading(false);
      }
    };
    fetchRequest();
  }, [id]);

  const updateStatus = async () => {
    setSaving(true);
    try {
      await api.patch(`/requests/${id}/status`, { status: newStatus });
      setRequest((r) => ({ ...r, status: newStatus }));
      showToast('Status updated');
    } catch (err) {
      if (err.response?.status === 403) {
        showToast('Only admins and agents can update status.', 'error');
      } else {
        showToast('Failed to update status.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      const res = await api.post(`/requests/${id}/notes`, { body: note });
      setRequest((r) => ({
        ...r,
        internalNotes: [...(r.internalNotes || []), res.data.note],
      }));
      setNote('');
      showToast('Note added');
    } catch (err) {
      if (err.response?.status === 403) {
        showToast('You do not have permission to add notes.', 'error');
      } else {
        showToast('Failed to add note.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/requests/${id}/notes/${noteId}`);
      setRequest((r) => ({
        ...r,
        internalNotes: r.internalNotes.filter((n) => n.id !== noteId),
      }));
      showToast('Note deleted');
    } catch (err) {
      if (err.response?.status === 403) {
        showToast('Only admins can delete notes.', 'error');
      } else {
        showToast('Failed to delete note.', 'error');
      }
    }
  };

  const deleteRequest = async () => {
    if (!confirm('Delete this request permanently?')) return;
    setDeleting(true);
    try {
      await api.delete(`/requests/${id}`);
      navigate('/');
    } catch (err) {
      if (err.response?.status === 403) {
        showToast('Only admins can delete requests.', 'error');
      } else {
        showToast('Failed to delete request.', 'error');
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const ai = request?.aiClassification;

  return (
    <div className="min-h-screen bg-[#09090b] relative overflow-hidden">
      <div className="fixed top-0 right-0 w-[60%] h-[50%] bg-violet-600/10 rounded-full blur-[150px] mix-blend-screen pointer-events-none" />

      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-[0_8px_30px_rgba(0,0,0,0.4)] border flex items-center gap-3 fade-in ${
          toast.type === 'error'
            ? 'bg-red-500/10 text-red-400 border-red-500/20 backdrop-blur-md'
            : 'bg-violet-500/10 text-violet-400 border-violet-500/20 backdrop-blur-md'
        }`}>
          {toast.type === 'error' ? (
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          ) : (
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          )}
          {toast.msg}
        </div>
      )}

      <header className="glass-panel border-b border-white/5 px-8 py-5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <button onClick={() => navigate('/')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-all hover:scale-105 active:scale-95 group">
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-white font-bold text-xl tracking-tight">Request Details</h1>
            <p className="text-gray-500 text-xs font-mono mt-0.5 tracking-wider uppercase">ID: {request?.id?.slice(-12)}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border ${
            isAdmin
              ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          }`}>
            {isAdmin ? 'Admin' : 'Agent'}
          </span>

          {isAdmin && (
            <button
              onClick={deleteRequest}
              disabled={deleting}
              className="flex items-center gap-2 text-red-400 hover:text-white hover:bg-red-500 border border-red-500/20 hover:border-red-500 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-8 space-y-8 relative z-10">

        {/* Message */}
        <div className="glass-card rounded-3xl p-8 relative overflow-hidden fade-in">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-fuchsia-500" />
          <div className="flex items-start justify-between gap-6 mb-6">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg ${statusColor[request?.status]}`}>{request?.status}</span>
              {request?.prioritySnapshot && (
                <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border ${
                  request.prioritySnapshot === 'HIGH' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                  request.prioritySnapshot === 'MEDIUM' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                  'bg-green-500/10 text-green-400 border-green-500/20'
                }`}>{request.prioritySnapshot} Priority</span>
              )}
              {request?.categorySnapshot && (
                <span className="text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  {request.categorySnapshot}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-500 bg-white/5 px-3 py-1.5 rounded-lg shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-xs font-medium">{timeAgo(request?.createdAt)}</span>
            </div>
          </div>
          <div className="bg-black/20 rounded-2xl p-6 border border-white/5 relative">
            <svg className="absolute top-4 left-4 w-8 h-8 text-white/5 pointer-events-none" fill="currentColor" viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" /></svg>
            <p className="text-gray-200 text-lg leading-relaxed relative z-10 pl-6">{request?.message}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Customer Info */}
          <div className="glass-card rounded-3xl p-8 fade-in" style={{ animationDelay: '100ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-gray-400 border border-white/5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              </div>
              <h2 className="text-white font-semibold text-lg">Customer Profile</h2>
            </div>
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Name</p>
                <p className="text-white font-medium truncate">{request?.customerName}</p>
              </div>
              <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Source</p>
                <p className="text-white font-medium capitalize flex items-center gap-2">{request?.source}</p>
              </div>
              {request?.customerEmail && (
                <div className="bg-black/20 rounded-xl p-4 border border-white/5 col-span-2">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Email</p>
                  <p className="text-violet-400 font-medium truncate hover:text-violet-300 transition-colors cursor-pointer">{request.customerEmail}</p>
                </div>
              )}
              {request?.customerPhone && (
                <div className="bg-black/20 rounded-xl p-4 border border-white/5 col-span-2">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Phone</p>
                  <p className="text-white font-medium">{request.customerPhone}</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Classification */}
          {ai ? (
            <div className="glass-card bg-violet-600/5 border-violet-500/20 rounded-3xl p-8 fade-in relative overflow-hidden" style={{ animationDelay: '150ms' }}>
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600/10 to-transparent pointer-events-none" />
              <div className="flex items-center gap-3 mb-6 relative z-10">
                <div className="w-10 h-10 bg-violet-500/20 rounded-xl flex items-center justify-center text-violet-400 border border-violet-500/30 shadow-[0_0_15px_rgba(139,92,246,0.3)]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <h2 className="text-violet-300 font-semibold text-lg">AI Intelligence</h2>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
                <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Predicted Category</p>
                  <p className="text-white font-medium capitalize">{ai.category}</p>
                </div>
                <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-1">Confidence</p>
                  <div className="flex items-center gap-3">
                    <span className="text-white font-bold">{Math.round(ai.confidence * 100)}%</span>
                    <div className="flex-1 h-1.5 bg-black/50 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full" style={{ width: `${ai.confidence * 100}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 relative z-10">
                <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-2">Summary</p>
                  <p className="text-gray-300 text-sm leading-relaxed">{ai.summary}</p>
                </div>
                <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mb-2">Reasoning</p>
                  <p className="text-gray-300 text-sm leading-relaxed">{ai.reason}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-3xl p-8 fade-in flex flex-col items-center justify-center text-center opacity-50" style={{ animationDelay: '150ms' }}>
              <svg className="w-12 h-12 text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              <p className="text-white font-medium">No AI classification available</p>
            </div>
          )}
        </div>

        {/* Action Panel */}
        <div className="glass-card rounded-3xl p-8 fade-in" style={{ animationDelay: '200ms' }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="text-white font-semibold text-lg mb-1">Resolution Status</h2>
              <p className="text-gray-500 text-sm">Update the progress of this request</p>
            </div>
            <div className="flex gap-3">
              <div className="relative min-w-[200px]">
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full appearance-none bg-black/40 border border-white/10 text-white font-medium text-sm rounded-xl px-5 py-3.5 pr-10 focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all hover:bg-black/60"
                >
                  {['NEW', 'QUEUED', 'PROCESSING', 'CLASSIFIED', 'RESOLVED', 'FAILED'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
              <button
                onClick={updateStatus}
                disabled={saving || newStatus === request?.status}
                className="bg-white text-black hover:bg-gray-100 disabled:opacity-50 disabled:hover:bg-white text-sm font-bold px-6 py-3.5 rounded-xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                Update
              </button>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 pb-10">
          {/* Internal Notes */}
          <div className="lg:col-span-2 glass-panel rounded-3xl p-8 fade-in flex flex-col" style={{ animationDelay: '250ms' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                Internal Notes
              </h2>
              <span className="bg-white/5 text-gray-400 text-xs font-bold px-3 py-1 rounded-lg border border-white/5">
                {request?.internalNotes?.length || 0}
              </span>
            </div>

            <div className="flex-1 space-y-4 mb-6 overflow-y-auto custom-scrollbar max-h-[400px] pr-2">
              {request?.internalNotes?.length === 0 ? (
                <div className="text-center py-10 bg-black/20 rounded-2xl border border-white/5 border-dashed">
                  <p className="text-gray-500 text-sm">No internal notes yet. Add one below.</p>
                </div>
              ) : (
                request?.internalNotes?.map((n) => (
                  <div key={n.id} className="bg-black/30 rounded-2xl p-5 border border-white/5 group hover:border-white/10 transition-colors relative">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-lg">
                        {getInitials(n.author?.name)}
                      </div>
                      <div>
                        <p className="text-gray-200 text-sm font-medium">{n.author?.name || 'Unknown'}</p>
                        <p className="text-gray-500 text-[10px] font-mono">{timeAgo(n.createdAt)}</p>
                      </div>
                      {isAdmin && n.author?.id === currentUserId && (
                        <button
                          onClick={() => deleteNote(n.id)}
                          className="absolute top-5 right-5 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded-lg transition-all"
                          title="Delete note"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed pl-11">{n.body}</p>
                  </div>
                ))
              )}
            </div>

            <div className="relative mt-auto">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Type your internal note here..."
                rows={3}
                className="w-full bg-black/40 border border-white/10 text-gray-200 text-sm rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none placeholder-gray-600 transition-all hover:bg-black/60 custom-scrollbar"
              />
              <button
                onClick={addNote}
                disabled={saving || !note.trim()}
                className="absolute bottom-4 right-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:hover:bg-violet-600 text-white text-sm font-bold p-2.5 rounded-xl transition-all hover:scale-110 active:scale-95 shadow-lg shadow-violet-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
              </button>
            </div>
          </div>

          {/* Event Timeline */}
          <div className="glass-card rounded-3xl p-8 fade-in" style={{ animationDelay: '300ms' }}>
            <h2 className="text-white font-semibold text-lg mb-6 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Audit Trail
            </h2>

            {request?.requestEvents?.length > 0 ? (
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-white/10 before:to-transparent">
                {request.requestEvents.map((e) => (
                  <div key={e.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full border-4 border-[#12141c] bg-violet-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-lg z-10">
                      <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    </div>
                    <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.5rem)] p-4 rounded-2xl bg-black/20 border border-white/5 group-hover:border-white/10 transition-colors">
                      <span className="text-gray-200 text-xs font-bold uppercase tracking-wider">{e.eventType.replace(/_/g, ' ')}</span>
                      {(e.oldValue || e.newValue) && (
                        <div className="flex items-center gap-2 mt-2 bg-black/40 p-2 rounded-lg border border-white/5">
                          {e.oldValue && <span className="text-gray-500 text-[10px] font-mono truncate max-w-[40%]">{e.oldValue}</span>}
                          {e.oldValue && <svg className="w-3 h-3 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>}
                          <span className="text-violet-400 text-[10px] font-mono font-medium truncate">{e.newValue}</span>
                        </div>
                      )}
                      <p className="text-gray-500 text-[10px] font-medium mt-2">{timeAgo(e.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">No events recorded.</p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}