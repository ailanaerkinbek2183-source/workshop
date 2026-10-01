import './lib/supabase.js'

const status = document.getElementById('status')
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Health-эндпоинт auth-сервиса отвечает без таблиц и ничего не меняет в базе
try {
  const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } })
  status.textContent = res.ok
    ? 'Supabase подключена ✓'
    : `Supabase ответила ошибкой: HTTP ${res.status}`
} catch (e) {
  status.textContent = `Нет связи с Supabase: ${e.message}`
}
