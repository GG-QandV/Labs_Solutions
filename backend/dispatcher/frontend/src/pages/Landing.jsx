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
            <a href="https://labs.mnemostroma.com/" className="block" aria-label="Labs.Mnemostroma">
              <svg viewBox="0 0 16730.7 1527.0" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Labs.Mnemostroma" className="h-5 w-auto">
                <g transform="translate(0 1490.0) scale(1 -1)">
                  <g data-logo-part="labs"><path d="M268 1490V0H139V1490Z"/><path d="M451 -25Q350 -25 266.0 14.5Q182 54 132.5 129.5Q83 205 83 313Q83 396 114.0 452.0Q145 508 203.0 544.5Q261 581 339.5 602.5Q418 624 513 635Q607 647 672.0 655.5Q737 664 771.0 683.0Q805 702 805 744V770Q805 885 737.0 950.5Q669 1016 542 1016Q421 1016 345.0 963.0Q269 910 239 838L115 883Q153 974 220.0 1029.0Q287 1084 370.0 1108.5Q453 1133 538 1133Q602 1133 671.0 1116.0Q740 1099 800.0 1058.0Q860 1017 897.5 943.5Q935 870 935 758V0H805V177H797Q775 128 729.0 81.5Q683 35 614.0 5.0Q545 -25 451 -25ZM469 93Q572 93 647.5 138.5Q723 184 764.0 261.0Q805 338 805 429V590Q790 576 756.5 565.0Q723 554 679.5 546.0Q636 538 591.5 532.0Q547 526 513 522Q419 510 351.5 485.0Q284 460 248.5 417.0Q213 374 213 306Q213 205 285.5 149.0Q358 93 469 93Z" transform="translate(346 0)"/></g>
                  <g data-logo-part="mnemo"><path d="M91 0V1118H384V919H398Q433 1018 515.0 1075.0Q597 1132 710 1132Q825 1132 905.5 1074.5Q986 1017 1013 919H1025Q1059 1016 1149.0 1074.0Q1239 1132 1361 1132Q1517 1132 1615.5 1033.0Q1714 934 1714 752V0H1404V690Q1404 784 1354.5 830.0Q1305 876 1231 876Q1147 876 1099.5 822.5Q1052 769 1052 682V0H752V698Q752 779 705.0 827.5Q658 876 582 876Q530 876 489.0 850.0Q448 824 424.0 778.5Q400 733 400 670V0Z" transform="translate(3880.65 0)"/></g>
                  <g data-logo-part="stroma"><path d="M889 871 771 839Q745 914 684.5 966.5Q624 1019 511 1019Q398 1019 325.0 964.5Q252 910 252 825Q252 754 301.5 708.5Q351 663 455 637L624 596Q764 561 834.5 487.5Q905 414 905 302Q905 208 852.5 134.0Q800 60 707.0 18.0Q614 -24 491 -24Q327 -24 221.0 50.5Q115 125 85 264L209 294Q232 195 303.0 144.0Q374 93 489 93Q617 93 695.0 151.0Q773 209 773 295Q773 433 590 478L408 522Q262 557 192.0 632.0Q122 707 122 819Q122 911 172.5 982.0Q223 1053 311.0 1093.0Q399 1133 511 1133Q665 1133 757.0 1062.5Q849 992 889 871Z" transform="translate(10800.65 0)"/></g>
                  <circle data-logo-part="dot" cx="3663.825" cy="566.000" r="206.500"/>
                </g>
              </svg>
            </a>
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
