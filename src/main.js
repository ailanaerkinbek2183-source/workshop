import { createChart, createSeriesMarkers, LineSeries } from 'lightweight-charts'
import './style.css'
import { SIGNALS, HORIZONS, computeAll, entryScore, backtest } from './lib/indicators.js'

const SYMBOLS = {
  HSBK: { label: 'HSBK · KASE · ISIN KZ000A0LE0S4', unit: '₸', digits: 2 },
  HSBKd: { label: 'HSBKd · ГДР на KASE', unit: '$', digits: 2 },
}
const FROM_2013 = Date.UTC(2013, 0, 1) / 1000

const $ = (id) => document.getElementById(id)
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const pct = (x, digits = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(digits)} %`)
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

let state = { symbol: 'HSBK', range: 252 }
let current = null // { data, analysis }
let chart = null
let series = {}
let markersApi = null

// ---------- загрузка данных ----------

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
    bars: j.t.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v[i],
    })),
  }
}

async function loadSnapshot(symbol) {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${symbol}.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function load(symbol) {
  if (import.meta.env.DEV) {
    try {
      return await loadLive(symbol)
    } catch (e) {
      console.warn('KASE напрямую недоступна, берём сохранённый снимок', e)
    }
  }
  return loadSnapshot(symbol)
}

// ---------- плитки ----------

function scoreStatus(score) {
  if (score >= 65) return { text: 'Привлекательная зона', color: css('--good'), icon: '▲' }
  if (score >= 40) return { text: 'Нейтрально', color: css('--warning'), icon: '●' }
  return { text: 'Дорого / перегрев', color: css('--critical'), icon: '▼' }
}

function renderTiles() {
  const { data, analysis } = current
  const { unit, digits } = SYMBOLS[state.symbol]
  const bars = data.bars
  const n = bars.length - 1
  const last = bars[n]
  const ret = (k) => (n - k >= 0 ? last.c / bars[n - k].c - 1 : null)
  const s = entryScore(analysis)
  const st = scoreStatus(s.score)
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '')
  const low52 = Math.min(...bars.slice(-252).map((b) => b.c))
  const high52 = Math.max(...bars.slice(-252).map((b) => b.c))

  $('tiles').innerHTML = `
    <div class="tile">
      <div class="label">Цена закрытия, ${fmtDate(last.date)}</div>
      <div class="value">${last.c.toFixed(digits)} ${unit}</div>
      <div class="sub ${cls(ret(1))}">${pct(ret(1), 2)} за день</div>
    </div>
    <div class="tile">
      <div class="label">Изменение</div>
      <div class="value ${cls(ret(21))}">${pct(ret(21))}</div>
      <div class="sub">за месяц · <span class="${cls(ret(252))}">${pct(ret(252))}</span> за год</div>
    </div>
    <div class="tile">
      <div class="label">RSI (14)</div>
      <div class="value">${s.rsi.toFixed(0)}</div>
      <div class="sub">${s.rsi < 30 ? 'перепроданность' : s.rsi > 70 ? 'перекупленность' : 'нейтрально'}</div>
    </div>
    <div class="tile">
      <div class="label">От максимума за год</div>
      <div class="value">${pct(-s.dd)}</div>
      <div class="sub">диапазон ${low52.toFixed(digits)} – ${high52.toFixed(digits)} ${unit}</div>
    </div>
    <div class="tile score" style="border-color:${st.color}">
      <div class="label">Оценка точки входа</div>
      <div class="value">${s.score}<span class="muted small"> / 100</span></div>
      <div class="status"><span aria-hidden="true" style="color:${st.color}">${st.icon}</span>${st.text}</div>
      <div class="sub">${s.trendUp ? 'цена выше SMA200 — тренд вверх' : 'цена ниже SMA200 — тренд вниз'}</div>
    </div>`

  const src = data.source.includes('live') ? 'данные KASE в реальном времени' : `снимок от ${new Date(data.updatedAt).toLocaleString('ru-RU')}`
  $('updated').textContent = `Дневные котировки KASE · ${src}`
}

// ---------- график ----------

const LEGEND = [
  { key: 'close', label: 'Цена закрытия', swatch: () => `background:${css('--series-1')}` },
  { key: 'sma50', label: 'SMA 50', swatch: () => `background:${css('--series-2')}` },
  { key: 'sma200', label: 'SMA 200', swatch: () => `background:${css('--series-3')}` },
  { key: 'bb', label: 'Полосы Боллинджера', cls: 'dashed' },
  { key: 'signals', label: 'Сигналы входа', cls: 'marker' },
]
const visible = { close: true, sma50: true, sma200: true, bb: true, signals: true }

function renderLegend() {
  $('legend').innerHTML = LEGEND.map(
    (l) => `<label><input type="checkbox" data-key="${l.key}" ${visible[l.key] ? 'checked' : ''}>
      <span class="swatch ${l.cls || ''}" style="${l.swatch ? l.swatch() : ''}"></span>${l.label}</label>`,
  ).join('')
}

$('legend').addEventListener('change', (e) => {
  const key = e.target.dataset.key
  visible[key] = e.target.checked
  applyVisibility()
})

function applyVisibility() {
  series.close.applyOptions({ visible: visible.close })
  series.sma50.applyOptions({ visible: visible.sma50 })
  series.sma200.applyOptions({ visible: visible.sma200 })
  series.bbUpper.applyOptions({ visible: visible.bb })
  series.bbLower.applyOptions({ visible: visible.bb })
  markersApi.setMarkers(visible.signals ? buildMarkers() : [])
}

function themeOptions() {
  return {
    layout: {
      background: { color: css('--surface-1') },
      textColor: css('--text-secondary'),
      fontFamily: 'system-ui, sans-serif',
      panes: { separatorColor: css('--border') },
      attributionLogo: false,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border') },
  }
}

function buildMarkers() {
  const { data, analysis } = current
  return analysis.signals.map((s) => ({
    time: data.bars[s.i].date,
    position: 'belowBar',
    shape: 'arrowUp',
    color: css('--good'),
    text: SIGNALS[s.type].short,
  }))
}

function line(values, bars) {
  return values.map((v, i) => (v == null ? { time: bars[i].date } : { time: bars[i].date, value: v }))
}

function createMainChart() {
  chart = createChart($('chart'), {
    ...themeOptions(),
    autoSize: true,
    localization: { locale: 'ru-RU' },
    crosshair: { mode: 0 },
    handleScroll: true,
    handleScale: true,
  })
  const base = { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
  series.bbUpper = chart.addSeries(LineSeries, { ...base, lineWidth: 1, lineStyle: 2 })
  series.bbLower = chart.addSeries(LineSeries, { ...base, lineWidth: 1, lineStyle: 2 })
  series.sma200 = chart.addSeries(LineSeries, base)
  series.sma50 = chart.addSeries(LineSeries, base)
  series.close = chart.addSeries(LineSeries, { ...base, lastValueVisible: true, crosshairMarkerVisible: true })
  series.rsi = chart.addSeries(LineSeries, { ...base, lastValueVisible: true, crosshairMarkerVisible: true }, 1)
  series.rsi.createPriceLine({ price: 70, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, color: css('--band') })
  series.rsi.createPriceLine({ price: 30, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, color: css('--band') })
  chart.panes()[0].setStretchFactor(3)
  chart.panes()[1].setStretchFactor(1)
  markersApi = createSeriesMarkers(series.close, [])
  applyColors()
}

function applyColors() {
  chart.applyOptions(themeOptions())
  series.close.applyOptions({ color: css('--series-1') })
  series.sma50.applyOptions({ color: css('--series-2') })
  series.sma200.applyOptions({ color: css('--series-3') })
  series.bbUpper.applyOptions({ color: css('--band') })
  series.bbLower.applyOptions({ color: css('--band') })
  series.rsi.applyOptions({ color: css('--series-1') })
}

function renderChart() {
  const { data, analysis } = current
  const bars = data.bars
  const { ind } = analysis
  series.close.setData(bars.map((b) => ({ time: b.date, value: b.c })))
  series.sma50.setData(line(ind.sma50, bars))
  series.sma200.setData(line(ind.sma200, bars))
  series.bbUpper.setData(line(ind.bb.upper, bars))
  series.bbLower.setData(line(ind.bb.lower, bars))
  series.rsi.setData(line(ind.rsi14, bars))
  applyVisibility()
  setRange(state.range)
}

function setRange(days) {
  const n = current.data.bars.length
  if (!days || days >= n) chart.timeScale().fitContent()
  else chart.timeScale().setVisibleLogicalRange({ from: n - days, to: n + 2 })
}

// ---------- таблицы ----------

function renderSignalsTable() {
  const { data, analysis } = current
  const { digits } = SYMBOLS[state.symbol]
  const last = data.bars.at(-1).c
  const rows = analysis.signals.slice(-12).reverse()
  $('signals-table').innerHTML = `
    <thead><tr><th>Дата</th><th class="text">Сигнал</th><th>Цена</th><th>С тех пор</th></tr></thead>
    <tbody>${rows
      .map((s) => {
        const r = last / s.price - 1
        return `<tr><td>${fmtDate(s.date)}</td><td class="text">${SIGNALS[s.type].label}</td>
          <td>${s.price.toFixed(digits)}</td><td class="${r >= 0 ? 'up' : 'down'}">${pct(r)}</td></tr>`
      })
      .join('')}</tbody>`
}

function renderBacktest() {
  const bt = backtest(current.analysis)
  const head = HORIZONS.map((h) => `<th>${h} дн.</th>`).join('')
  const cell = (s, base) => {
    if (!s.n) return '<td>—</td>'
    const better = base && s.avg > base.avg
    return `<td><span class="${better ? 'better' : ''}">${pct(s.avg)}</span><br><span class="muted">${Math.round(s.win * 100)} % в плюс</span></td>`
  }
  $('backtest-table').innerHTML = `
    <thead><tr><th>Сигнал</th><th>Кол-во</th>${head}</tr></thead>
    <tbody>
      ${bt.rows
        .map((r) => `<tr><td class="text">${SIGNALS[r.type].label}</td><td>${r.count}</td>${r.stats.map((s, k) => cell(s, bt.baseline[k])).join('')}</tr>`)
        .join('')}
      <tr class="base"><td>Любой день</td><td>—</td>${bt.baseline.map((s) => cell(s)).join('')}</tr>
    </tbody>`
}

function renderRules() {
  $('rules').innerHTML = Object.values(SIGNALS)
    .map((s) => `<li><b>${s.short} — ${s.label}.</b> ${s.rule}</li>`)
    .join('')
}

// ---------- управление ----------

function bindSeg(groupId, attr, onPick) {
  $(groupId).addEventListener('click', (e) => {
    const btn = e.target.closest('button')
    if (!btn) return
    for (const b of $(groupId).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn))
    onPick(btn.dataset[attr])
  })
}

bindSeg('range-switch', 'range', (v) => {
  state.range = Number(v)
  setRange(state.range)
})
bindSeg('symbol-switch', 'symbol', (v) => {
  state.symbol = v
  show()
})

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyColors()
  renderLegend()
  if (current) {
    renderTiles()
    applyVisibility()
  }
})

async function show() {
  try {
    const data = await load(state.symbol)
    current = { data, analysis: computeAll(data.bars) }
    $('ticker-label').textContent = SYMBOLS[state.symbol].label
    renderTiles()
    renderChart()
    renderSignalsTable()
    renderBacktest()
  } catch (e) {
    $('updated').innerHTML = `<span class="error">Не удалось загрузить котировки: ${e.message}</span>`
  }
}

renderLegend()
renderRules()
createMainChart()
show()
