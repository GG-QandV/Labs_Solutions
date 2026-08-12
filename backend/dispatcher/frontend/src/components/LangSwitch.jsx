import { useI18n } from '../i18n';

export default function LangSwitch() {
  const { lang, setLang, LANGS, LANG_LABELS } = useI18n();
  return (
    <div className="flex items-center gap-1 px-1 py-1 rounded-xl bg-white/5 border border-white/10">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            lang === l ? 'bg-violet-500/30 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
