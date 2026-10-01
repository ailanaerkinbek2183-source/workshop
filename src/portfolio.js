import { createChart, LineSeries, AreaSeries } from 'lightweight-charts'
import './style.css'
import { analyze, history } from './lib/portfolio.js'

const SYMBOLS = {
  KZAP: { name: 'Казатомпром', isin: 'KZ1C00000876', color: '--series-1' },
  KMGZ: { name: 'КазМунайГаз', isin: 'KZ1C00001122', color: '--series-2' },
}
const STORAGE_KEY = 'portfolio-trades-v1'
const FROM_2013 = Date.UTC(2013, 0, 1) / 1000

const $ = (id) => document.getElementById(id)
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (x) => `${nf0.format(Math.round(x))} ₸`
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${nf0.format(Math.abs(Math.round(x)))} ₸`
const pct = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d).replace('.', ',')} %`)
const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '')
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

let quotes = {}
let dividends = {}
let filePortfolio = null
let portfolio = null
let range = 'ytd'
let chart = null
let series = {}
let hist = []

// ---------- загрузка ----------

async function loadLive(symbol) {
  // Только в dev: vite проксирует /kase → kase.kz (у KASE нет CORS)
  const to = Math.floor(Date.now() / 1000)
  const res = await fetch(`/kase/tv-charts/securities/history?symbol=${symbol}&resolution=D&from=${FROM_2013}&to=${to}`)
  const j = await res.json()
  if (j.s !== 'ok') throw new Error(j.s)
  return {
    symbol,
    source: 'kase.kz (live)',
    updatedAt: new Date().toISOString(),
    bars: j.t.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), c: j.c[i] })),
  }
}

async function getJson(path) {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

async function loadQuotes(symbol) {
  if (import.meta.env.DEV) {
    try {
      return await loadLive(symbol)
    } catch (e) {
      console.warn('KASE напрямую недоступна, берём сохранённый снимок', e)
    }
  }
  return getJson(`data/${symbol}.json`)
}

function savedTrades() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveTrades(trades) {
  try {
    if (trades) localStorage.setItem(STORAGE_KEY, JSON.stringify(trades))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* хранилище недоступно — изменения живут до перезагрузки */
  }
}

// ---------- плитки ----------

function tile(label, value, sub, valueCls = '') {
  return `<div class="tile"><div class="label">${label}</div><div class="value ${valueCls}">${value}</div><div class="sub">${sub}</div></div>`
}

function renderTiles(a) {
  $('tiles').innerHTML = [
    tile('Общая стоимость портфеля', money(a.value), `на ${fmtDate(a.lastDate)}`),
    tile('Вложено', money(a.invested), `сделок: ${portfolio.trades.length}`),
    tile(
      'Прибыль / убыток',
      signed(a.pnl),
      `<span class="${cls(a.pnl)}">${pct(a.pnlPct)}</span> · с дивидендами <span class="${cls(a.totalPnl)}">${signed(a.totalPnl)}</span>`,
      cls(a.pnl),
    ),
    tile('Полученные дивиденды', money(a.divPaid), `в ${a.year} году: ${money(a.divPaidYtd)}`),
    tile(
      `Доходность за ${a.year} год`,
      pct(a.returnYtdPct),
      `<span class="${cls(a.returnYtd)}">${signed(a.returnYtd)}</span> с учётом дивидендов`,
      cls(a.returnYtd),
    ),
    tile(
      'Изменение с начала года',
      pct(a.changeYtdPct),
      `<span class="${cls(a.changeYtd)}">${signed(a.changeYtd)}</span> · цена: ${a.positions
        .map((p) => `${p.symbol} <span class="${cls(p.priceYtd)}">${pct(p.priceYtd)}</span>`)
        .join(', ')}`,
      cls(a.changeYtd),
    ),
  ].join('')
}

function renderUpdated() {
  const stamps = Object.values(quotes).map((q) => q.updatedAt).sort()
  const at = new Date(stamps.at(-1))
  const when = at.toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const live = Object.values(quotes).some((q) => q.source.includes('live'))
  const lastBar = Object.values(quotes).map((q) => q.bars.at(-1).date).sort().at(-1)
  $('updated').innerHTML = `<span class="dot-live" aria-hidden="true"></span>Последнее обновление: <b>${when}</b> (Алматы)
    · торги KASE на ${fmtDate(lastBar)}${live ? ' · данные в реальном времени' : ''}`
}

// ---------- таблицы ----------

function renderPositions(a) {
  const rows = a.positions
    .map(
      (p) => `<tr>
      <td class="text"><span class="swatch-dot" style="background:${css(SYMBOLS[p.symbol].color)}"></span><b>${p.symbol}</b> <span class="muted">${SYMBOLS[p.symbol].name}</span></td>
      <td>${nf0.format(p.qty)}</td>
      <td>${nf2.format(p.avgPrice)}</td>
      <td>${nf2.format(p.price)} <span class="${cls(p.dayChange)} small">${pct(p.dayChange, 2)}</span></td>
      <td>${money(p.invested)}</td>
      <td>${money(p.value)}</td>
      <td class="${cls(p.pnl)}">${signed(p.pnl)}</td>
      <td class="${cls(p.pnl)}">${pct(p.invested ? p.pnl / p.invested : null)}</td>
      <td>${money(p.divPaid)}</td>
      <td class="${cls(p.priceYtd)}">${pct(p.priceYtd)}</td>
      <td>${a.value ? nf0.format((p.value / a.value) * 100) : 0} %</td>
    </tr>`,
    )
    .join('')
  $('positions-table').innerHTML = `<thead><tr>
      <th class="text">Бумага</th><th>Акций</th><th>Средняя цена, ₸</th><th>Цена, ₸</th><th>Вложено</th>
      <th>Стоимость</th><th>П/У</th><th>П/У, %</th><th>Дивиденды</th><th>Цена с нач. года</th><th>Доля</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr>
      <td class="text"><b>Итого</b></td><td></td><td></td><td></td><td>${money(a.invested)}</td><td>${money(a.value)}</td>
      <td class="${cls(a.pnl)}">${signed(a.pnl)}</td><td class="${cls(a.pnl)}">${pct(a.pnlPct)}</td>
      <td>${money(a.divPaid)}</td><td class="${cls(a.changeYtdPct)}">${pct(a.changeYtdPct)}</td><td>100 %</td>
    </tr></tfoot>`
}

function renderDividends(a) {
  const tax = portfolio.dividendTax || 0
  $('tax-note').textContent = tax ? ` × (1 − налог ${nf0.format(tax * 100)} %)` : ''
  const events = a.positions
    .flatMap((p) => p.events.map((e) => ({ ...e, symbol: p.symbol })))
    .sort((x, y) => y.recordDate.localeCompare(x.recordDate))
  $('div-table').innerHTML = events.length
    ? `<thead><tr><th class="text">Бумага</th><th>За год</th><th>На акцию, ₸</th><th>Фиксация</th><th>Акций</th><th>Сумма</th><th class="text">Статус</th></tr></thead>
      <tbody>${events
        .map(
          (e) => `<tr><td class="text">${e.symbol}</td><td>${e.year}</td><td>${nf2.format(e.dps)}</td><td>${fmtDate(e.recordDate)}</td>
            <td>${nf0.format(e.qty)}</td><td>${money(e.amount)}</td>
            <td class="text">${e.paid ? `<span class="good-text">✓ выплата с ${fmtDate(e.payDate)}</span>` : `<span class="muted">◷ ожидается ${fmtDate(e.payDate)}</span>`}</td></tr>`,
        )
        .join('')}</tbody>`
    : '<tbody><tr><td class="text muted">По вашим сделкам дивидендов пока не было.</td></tr></tbody>'
}

function renderTrades() {
  const custom = savedTrades() != null
  $('trades-note').textContent = custom
    ? 'Сделки изменены в этом браузере. Чтобы сохранить их для всех устройств, скачайте JSON и замените им public/portfolio.json в репозитории.'
    : 'Сделки из public/portfolio.json (сейчас там пример). Изменения здесь сохраняются в этом браузере.'
  const opts = (sel) => Object.keys(SYMBOLS).map((s) => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('')
  $('trades-table').innerHTML = `<thead><tr><th class="text">Бумага</th><th class="text">Дата</th><th>Акций</th><th>Цена, ₸</th><th>Комиссия, ₸</th><th></th></tr></thead>
    <tbody>${portfolio.trades
      .map(
        (t, i) => `<tr data-i="${i}">
        <td class="text"><select data-k="symbol" aria-label="Бумага">${opts(t.symbol)}</select></td>
        <td class="text"><input type="date" data-k="date" value="${esc(t.date)}" aria-label="Дата"></td>
        <td><input type="number" min="1" step="1" data-k="qty" value="${t.qty}" aria-label="Акций"></td>
        <td><input type="number" min="0" step="0.01" data-k="price" value="${t.price}" aria-label="Цена"></td>
        <td><input type="number" min="0" step="0.01" data-k="fee" value="${t.fee || 0}" aria-label="Комиссия"></td>
        <td><button class="btn icon" data-del="${i}" aria-label="Удалить сделку">✕</button></td>
      </tr>`,
      )
      .join('')}</tbody>`
}

function commitTrades() {
  saveTrades(portfolio.trades)
  renderAll({ trades: false })
  renderTrades()
}

$('trades-table').addEventListener('change', (e) => {
  const row = e.target.closest('tr[data-i]')
  const k = e.target.dataset.k
  if (!row || !k) return
  const t = portfolio.trades[Number(row.dataset.i)]
  t[k] = k === 'symbol' || k === 'date' ? e.target.value : Number(e.target.value) || 0
  commitTrades()
})
$('trades-table').addEventListener('click', (e) => {
  const i = e.target.dataset.del
  if (i == null) return
  portfolio.trades.splice(Number(i), 1)
  commitTrades()
})
$('add-trade').addEventListener('click', () => {
  const lastDate = Object.values(quotes).map((q) => q.bars.at(-1).date).sort().at(-1)
  portfolio.trades.push({ symbol: 'KZAP', date: lastDate, qty: 1, price: quotes.KZAP.bars.at(-1).c, fee: 0 })
  commitTrades()
})
$('reset-trades').addEventListener('click', () => {
  saveTrades(null)
  portfolio = structuredClone(filePortfolio)
  renderAll()
})
$('export-trades').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ...filePortfolio, trades: portfolio.trades }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'portfolio.json'
  a.click()
  URL.revokeObjectURL(a.href)
})

// ---------- график ----------

function themeOptions() {
  return {
    layout: {
      background: { color: css('--surface-1') },
      textColor: css('--text-secondary'),
      fontFamily: 'system-ui, sans-serif',
      attributionLogo: false,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border') },
  }
}

function legendHtml(point) {
  const v = point ? money(point.value) : ''
  const inv = point ? money(point.invested) : ''
  return `<span class="legend-item"><span class="swatch" style="background:${css('--series-1')}"></span>Стоимость <b>${v}</b></span>
    <span class="legend-item"><span class="swatch dashed"></span>Вложено <b>${inv}</b></span>
    ${point ? `<span class="muted small">${fmtDate(point.date)}</span>` : ''}`
}

function createMainChart() {
  chart = createChart($('chart'), {
    ...themeOptions(),
    autoSize: true,
    localization: { locale: 'ru-RU', priceFormatter: (p) => nf0.format(p) },
    crosshair: { mode: 0 },
  })
  const base = { priceLineVisible: false, lastValueVisible: false }
  series.invested = chart.addSeries(LineSeries, { ...base, lineWidth: 2, lineStyle: 2, lineType: 1, crosshairMarkerVisible: false })
  // Заливка площади должна начинаться от нуля, иначе она искажает величину
  const fromZero = (orig) => {
    const r = orig()
    return r && { ...r, priceRange: { ...r.priceRange, minValue: 0 } }
  }
  series.value = chart.addSeries(AreaSeries, { ...base, lineWidth: 2, lastValueVisible: true, autoscaleInfoProvider: fromZero })
  applyColors()
  chart.subscribeCrosshairMove((param) => {
    const p = param.time ? hist.find((h) => h.date === param.time) : null
    $('legend').innerHTML = legendHtml(p || hist.at(-1))
  })
}

function applyColors() {
  const c = css('--series-1')
  chart.applyOptions(themeOptions())
  series.value.applyOptions({ lineColor: c, topColor: c + '33', bottomColor: c + '00' })
  series.invested.applyOptions({ color: css('--band') })
}

function renderChart() {
  hist = history(portfolio, quotes)
  if (!chart) createMainChart()
  series.value.setData(hist.map((h) => ({ time: h.date, value: h.value })))
  series.invested.setData(hist.map((h) => ({ time: h.date, value: h.invested })))
  $('legend').innerHTML = legendHtml(hist.at(-1))
  setRange()
}

function setRange() {
  if (!hist.length) return
  const last = hist.at(-1).date
  let from = hist[0].date
  if (range === 'ytd') from = `${last.slice(0, 4)}-01-01`
  else if (Number(range)) {
    const d = new Date(last + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - Number(range))
    from = d.toISOString().slice(0, 10)
  }
  const fromBar = hist.find((h) => h.date >= from) || hist[0]
  chart.timeScale().setVisibleRange({ from: fromBar.date, to: last })
}

$('range-switch').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  range = b.dataset.range
  for (const x of $('range-switch').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b))
  setRange()
})

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!chart) return
  applyColors()
  renderAll({ trades: false })
})

// ---------- запуск ----------

function renderAll({ trades = true } = {}) {
  const a = analyze(portfolio, quotes, dividends)
  renderUpdated()
  renderTiles(a)
  renderPositions(a)
  renderDividends(a)
  renderChart()
  if (trades) renderTrades()
}

async function init() {
  try {
    const symbols = Object.keys(SYMBOLS)
    const [qs, divs, pf] = await Promise.all([
      Promise.all(symbols.map(loadQuotes)),
      getJson('data/dividends.json'),
      getJson('portfolio.json'),
    ])
    symbols.forEach((s, i) => (quotes[s] = qs[i]))
    dividends = divs
    filePortfolio = pf
    portfolio = { ...structuredClone(pf), trades: savedTrades() ?? structuredClone(pf.trades) }
    renderAll()
  } catch (e) {
    console.error(e)
    $('updated').innerHTML = `<span class="error">Не удалось загрузить данные: ${esc(e.message)}</span>`
  }
}

init()
