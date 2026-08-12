import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import LangSwitch from '../components/LangSwitch';

const FLOW_STEPS = [
  { n: '01', t: 'f1.t', d: 'f1.d' },
  { n: '02', t: 'f2.t', d: 'f2.d' },
  { n: '03', t: 'f3.t', d: 'f3.d' },
  { n: '04', t: 'f4.t', d: 'f4.d' },
  { n: '05', t: 'f5.t', d: 'f5.d' },
];

export default function Landing() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [demoMsg, setDemoMsg] = useState('');
  const [sent, setSent] = useState(false);

  const submitDemo = (e) => {
    e.preventDefault();
    if (!demoMsg.trim()) return;
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-violet-600/20 rounded-full blur-[140px] mix-blend-screen pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] bg-fuchsia-600/20 rounded-full blur-[140px] mix-blend-screen pointer-events-none" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-6">
        <nav className="flex items-center justify-between gap-4 mb-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-fuchsia-600 rounded-xl flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.3)] border border-white/10">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="font-bold tracking-tight text-lg">{t('brand')}</span>
              <span className="block text-[10px] uppercase tracking-widest text-zinc-500">{t('brandSub')}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitch />
            <button
              onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-colors"
            >
              {t('nav.dashboard')}
            </button>
          </div>
        </nav>

        <header className="text-center mb-24 max-w-3xl mx-auto fade-in">
          <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            {t('hero.badge')}
          </p>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6 leading-[1.05]">
            {t('hero.h1a')}
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
              {t('hero.h1b')}
            </span>
          </h1>
          <p className="text-lg text-zinc-400 leading-relaxed mb-10">{t('hero.desc')}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:opacity-90 font-semibold transition-opacity shadow-[0_0_30px_rgba(139,92,246,0.25)]"
            >
              {t('hero.open')}
            </button>
            <a href="#flow" className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm transition-colors">
              {t('hero.how')}
            </a>
          </div>
        </header>

        <section id="flow" className="mb-24">
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">{t('flow.h')}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {FLOW_STEPS.map((s) => (
              <div key={s.n} className="glass-card rounded-2xl p-5">
                <span className="text-xs font-mono text-violet-400">{s.n}</span>
                <h3 className="text-lg font-semibold mt-2 mb-1">{t(s.t)}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{t(s.d)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-3xl p-8 sm:p-12 relative overflow-hidden mb-10">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
          <div className="relative z-10 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight mb-3">{t('try.h')}</h2>
            <p className="text-zinc-400 mb-8">{t('try.d')}</p>
            {sent ? (
              <div className="rounded-2xl bg-violet-500/10 border border-violet-500/20 p-5">
                <p className="font-semibold text-violet-300 mb-1">{t('try.ok')}</p>
                <p className="text-sm text-zinc-400">
                  {t('try.after')}{' '}
                  <button onClick={() => navigate('/dashboard')} className="underline text-violet-300">{t('nav.dashboard')}</button>
                </p>
              </div>
            ) : (
              <form onSubmit={submitDemo} className="flex flex-col sm:flex-row gap-3">
                <input
                  value={demoMsg}
                  onChange={(e) => setDemoMsg(e.target.value)}
                  placeholder={t('try.ph')}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-violet-500/50 focus:outline-none text-sm"
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-medium transition-colors"
                >
                  {t('try.btn')}
                </button>
              </form>
            )}
          </div>
        </section>

        <footer className="border-t border-white/5 pt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-zinc-500">{t('footer')}</p>
          <p className="text-xs text-zinc-600">{t('footer.stack')}</p>
        </footer>
      </div>
    </div>
  );
}
