import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const FLOW_STEPS = [
  { n: '01', t: 'Received', d: 'Mail, form, Telegram or API. Raw message stored untouched.' },
  { n: '02', t: 'Classified', d: 'Gemini reads the intent: category, priority, short summary, confidence.' },
  { n: '03', t: 'Queued', d: 'BullMQ queue — no lost requests, one worker, ordered processing.' },
  { n: '04', t: 'Assigned', d: 'Agent sees the classified request with full audit trail and internal notes.' },
  { n: '05', t: 'Resolved', d: 'Every status change recorded. Nothing silent, everything checkable.' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [demoMsg, setDemoMsg] = useState('');
  const [sent, setSent] = useState(false);

  const submitDemo = (e) => {
    e.preventDefault();
    if (!demoMsg.trim()) return;
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 relative overflow-hidden">
      {/* glow decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-violet-600/20 rounded-full blur-[140px] mix-blend-screen pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] bg-fuchsia-600/20 rounded-full blur-[140px] mix-blend-screen pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-6">
        {/* nav */}
        <nav className="flex items-center justify-between mb-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.3)] border border-white/10">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="font-bold tracking-tight text-lg">Dispatcher</span>
              <span className="block text-[10px] uppercase tracking-widest text-zinc-500">LABS · mnemostroma</span>
            </div>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors"
          >
            Agent dashboard →
          </button>
        </nav>

        {/* hero */}
        <header className="text-center mb-24 max-w-3xl mx-auto fade-in">
          <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Live demo · request intake & classification
          </p>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6 leading-[1.05]">
            Every request,
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
              classified and tracked.
            </span>
          </h1>
          <p className="text-lg text-zinc-400 leading-relaxed mb-10">
            Dispatcher takes free-text mail, form and Telegram messages, extracts the intent with
            an LLM and walks each one through an audited pipeline — from <b className="text-zinc-200">Received</b>
            to <b className="text-zinc-200">Resolved</b>. Nothing disappears, nothing is silent.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:opacity-90 font-semibold transition-opacity shadow-[0_0_30px_rgba(139,92,246,0.25)]"
            >
              Open the demo
            </button>
            <a href="#flow" className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors">
              How it works
            </a>
          </div>
        </header>

        {/* flow */}
        <section id="flow" className="mb-24">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">
            One track, no lost requests
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {FLOW_STEPS.map((s) => (
              <div key={s.n} className="glass-card rounded-2xl p-5">
                <span className="text-xs font-mono text-violet-400">{s.n}</span>
                <h3 className="text-lg font-semibold mt-2 mb-1">{s.t}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* try it */}
        <section className="glass-panel rounded-3xl p-8 sm:p-12 relative overflow-hidden mb-10">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
          <div className="relative z-10 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Send a real message</h2>
            <p className="text-zinc-400 mb-8">
              This posts to the live intake. The agent dashboard will show it classified with category,
              priority and confidence.
            </p>
            {sent ? (
              <div className="rounded-2xl bg-violet-500/10 border border-violet-500/20 p-5">
                <p className="font-semibold text-violet-300 mb-1">Request sent</p>
                <p className="text-sm text-zinc-400">
                  Open the <button onClick={() => navigate('/dashboard')} className="underline text-violet-300">dashboard</button>{' '}
                  to watch it move through the pipeline (login: demo@labs.mnemostroma.com).
                </p>
              </div>
            ) : (
              <form onSubmit={submitDemo} className="flex flex-col sm:flex-row gap-3">
                <input
                  value={demoMsg}
                  onChange={(e) => setDemoMsg(e.target.value)}
                  placeholder="e.g. Need an invoice issued for the shipment from Shanghai"
                  className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-violet-500/50 focus:outline-none text-sm"
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-medium transition-colors"
                >
                  Send
                </button>
              </form>
            )}
          </div>
        </section>

        {/* footer */}
        <footer className="border-t border-white/5 pt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-zinc-500">
            Dispatcher · LABS <span className="text-zinc-400">mnemostroma</span> — live demo
          </p>
          <p className="text-xs text-zinc-600">Powered by Gemini · BullMQ · Redis · Express</p>
        </footer>
      </div>
    </div>
  );
}
