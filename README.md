# workshop

Vite + Supabase.

```bash
npm install
npm run dev
```

Клиент Supabase: `src/lib/supabase.js` (`import { supabase } from './lib/supabase.js'`).
Настройки — в `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
Publishable-ключ публичный и попадает в браузер — доступ к данным защищайте через RLS.
