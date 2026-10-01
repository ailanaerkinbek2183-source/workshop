# workshop — дашборд акций Халык Банка (KASE: HSBK)

Дашборд показывает дневные цены закрытия **HSBK** (простые акции, ISIN KZ000A0LE0S4,
торги в ₸ в режиме T+2) и ГДР **HSBKd** ($) на KASE, индикаторы SMA50/SMA200, полосы
Боллинджера, RSI(14), сигналы точек входа, оценку входа «на сегодня» (0–100) и
историческую проверку сигналов.

```bash
npm install
npm run dev      # в dev-режиме котировки берутся с KASE напрямую через прокси Vite
npm run fetch    # обновить снимок котировок в public/data/*.json
npm run build    # статическая сборка в dist/
```

- Источник данных: `https://kase.kz/tv-charts/securities/history` (тот же, что у графиков на сайте KASE).
  CORS у него нет, поэтому собранный сайт читает снимок `public/data/<SYMBOL>.json`.
- Снимок обновляется GitHub Actions (`.github/workflows/update-prices.yml`) по будням в 17:40 по Алматы,
  после закрытия торгов; можно запустить вручную во вкладке Actions.
- Индикаторы и правила сигналов: `src/lib/indicators.js`.
- История с 2013 года: до сплита в декабре 2012 цены несопоставимы.

Это технический анализ, а не инвестиционная рекомендация.

Клиент Supabase: `src/lib/supabase.js`, настройки — в `.env`
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
