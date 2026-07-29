/* theme-init.js — грузится синхронно в <head>, чтобы не было вспышки чужой темы.
   Держать маленьким. Отдельный файл (а не inline) — чтобы CSP работала без 'unsafe-inline'. */
(function () {
  try {
    var saved = localStorage.getItem('lm.theme');           // 'dark' | 'light' | null
    var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', saved || (sysDark ? 'dark' : 'light'));

    /* Язык: сохранённый > браузерный (ru/uk/be → uk) > en */
    var lang = localStorage.getItem('lm.lang');
    if (!lang) {
      var list = navigator.languages && navigator.languages.length
        ? navigator.languages : [navigator.language || 'en'];
      lang = 'en';
      for (var i = 0; i < list.length; i++) {
        var c = String(list[i]).toLowerCase().slice(0, 2);
        if (c === 'uk' || c === 'ru' || c === 'be') { lang = 'uk'; break; }
        if (c === 'en') { lang = 'en'; break; }
      }
    }
    document.documentElement.setAttribute('data-lang-target', lang);
  } catch (e) { /* приватный режим / отключённый storage — остаются значения из HTML */ }
})();
