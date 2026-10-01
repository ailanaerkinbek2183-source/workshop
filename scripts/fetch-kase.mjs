// Скачивает дневные свечи с KASE и сохраняет в public/data/<SYMBOL>.json.
// Запуск: node scripts/fetch-kase.mjs [SYMBOL ...]   (по умолчанию HSBK, HSBKd, KZAP, KMGZ)
import { mkdir, writeFile } from 'node:fs/promises'

// До сплита в декабре 2012 цены несопоставимы, а торги были редкими
const FROM = Date.UTC(2013, 0, 1) / 1000
const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ['HSBK', 'HSBKd', 'KZAP', 'KMGZ']

async function fetchHistory(symbol) {
  const to = Math.floor(Date.now() / 1000)
  const url = `https://kase.kz/tv-charts/securities/history?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${FROM}&to=${to}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (hsbk-dashboard)' } })
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`)
  const j = await res.json()
  if (j.s !== 'ok' || !j.t?.length) throw new Error(`${symbol}: нет данных (${j.s})`)
  const bars = j.t.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v[i],
  }))
  return { symbol, source: 'kase.kz', updatedAt: new Date().toISOString(), bars }
}

await mkdir('public/data', { recursive: true })
let failed = false
for (const symbol of symbols) {
  try {
    const data = await fetchHistory(symbol)
    await writeFile(`public/data/${symbol}.json`, JSON.stringify(data))
    const last = data.bars.at(-1)
    console.log(`${symbol}: ${data.bars.length} дней, последний ${last.date} close=${last.c}`)
  } catch (e) {
    console.error(e.message)
    failed = true
  }
}
process.exit(failed ? 1 : 0)
