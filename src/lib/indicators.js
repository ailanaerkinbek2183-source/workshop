// Технические индикаторы и сигналы точек входа.
// Все функции принимают массив цен закрытия и возвращают массив той же длины
// (null там, где индикатор ещё не определён).

export function sma(values, n) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

// RSI по Уайлдеру
export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null)
  let gain = 0
  let loss = 0
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    const g = Math.max(d, 0)
    const l = Math.max(-d, 0)
    if (i <= n) {
      gain += g / n
      loss += l / n
      if (i < n) continue
    } else {
      gain = (gain * (n - 1) + g) / n
      loss = (loss * (n - 1) + l) / n
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return out
}

export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n)
  const upper = new Array(values.length).fill(null)
  const lower = new Array(values.length).fill(null)
  for (let i = n - 1; i < values.length; i++) {
    let s = 0
    for (let j = i - n + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2
    const sd = Math.sqrt(s / n)
    upper[i] = mid[i] + k * sd
    lower[i] = mid[i] - k * sd
  }
  return { mid, upper, lower }
}

// Просадка от максимума за последние n дней (0.15 = −15 %)
export function drawdown(values, n = 252) {
  return values.map((v, i) => {
    let max = -Infinity
    for (let j = Math.max(0, i - n + 1); j <= i; j++) max = Math.max(max, values[j])
    return 1 - v / max
  })
}

export const SIGNALS = {
  rsi: {
    label: 'RSI вышел из перепроданности',
    short: 'RSI',
    rule: 'RSI(14) был ниже 30 и закрылся выше 30 — продавцы выдохлись.',
  },
  bb: {
    label: 'Возврат в полосы Боллинджера',
    short: 'BB',
    rule: 'Вчера закрытие ниже нижней полосы Боллинджера (20, 2σ), сегодня — снова внутри.',
  },
  pullback: {
    label: 'Откат к SMA50 в росте',
    short: 'SMA',
    rule: 'Тренд вверх (SMA50 > SMA200, цена выше SMA200): цена ушла под SMA50 и закрылась обратно над ней.',
  },
}

// Повторный сигнал того же типа не раньше, чем через COOLDOWN торговых дней
const COOLDOWN = 10

export function computeAll(bars) {
  const close = bars.map((b) => b.c)
  const ind = {
    sma50: sma(close, 50),
    sma200: sma(close, 200),
    rsi14: rsi(close, 14),
    bb: bollinger(close, 20, 2),
    dd: drawdown(close, 252),
  }

  const signals = []
  const lastAt = {}
  const push = (type, i) => {
    if (lastAt[type] != null && i - lastAt[type] < COOLDOWN) return
    lastAt[type] = i
    signals.push({ type, i, date: bars[i].date, price: close[i] })
  }

  for (let i = 1; i < bars.length; i++) {
    const r0 = ind.rsi14[i - 1]
    const r1 = ind.rsi14[i]
    if (r0 != null && r0 < 30 && r1 >= 30) push('rsi', i)

    const lo0 = ind.bb.lower[i - 1]
    const lo1 = ind.bb.lower[i]
    if (lo0 != null && close[i - 1] < lo0 && close[i] > lo1) push('bb', i)

    const s50 = ind.sma50[i]
    const s200 = ind.sma200[i]
    if (
      s200 != null && s50 > s200 && close[i] > s200 &&
      close[i - 1] < ind.sma50[i - 1] && close[i] > s50
    ) push('pullback', i)
  }

  return { close, ind, signals }
}

// Оценка привлекательности входа «сегодня», 0–100.
// Чем ниже RSI, ближе цена к нижней полосе и глубже просадка — тем выше балл;
// цена ниже SMA200 (нисходящий тренд) снижает балл.
export function entryScore({ close, ind }, i = close.length - 1) {
  const clamp = (x) => Math.min(1, Math.max(0, x))
  const r = ind.rsi14[i]
  const { upper, lower } = ind.bb
  const pctB = (close[i] - lower[i]) / (upper[i] - lower[i])
  const parts = {
    rsi: clamp((70 - r) / 40), // RSI 30 → 1, RSI 70 → 0
    bb: clamp(1 - pctB), // у нижней полосы → 1, у верхней → 0
    dd: clamp(ind.dd[i] / 0.25), // просадка 25 % от годового максимума → 1
  }
  const trendUp = ind.sma200[i] != null && close[i] > ind.sma200[i]
  const raw = 0.35 * parts.rsi + 0.35 * parts.bb + 0.3 * parts.dd
  const score = Math.round(100 * raw * (trendUp ? 1 : 0.8))
  return { score, parts, rsi: r, pctB, dd: ind.dd[i], trendUp }
}

// Историческая проверка: средняя доходность через h торговых дней после сигнала
// и доля прибыльных случаев. Цены не скорректированы на дивиденды,
// поэтому реальная доходность держателя была выше.
export const HORIZONS = [20, 60, 120]

export function backtest({ close, signals }) {
  const fwd = (i, h) => (i + h < close.length ? close[i + h] / close[i] - 1 : null)
  const stats = (idx) =>
    HORIZONS.map((h) => {
      const rets = idx.map((i) => fwd(i, h)).filter((r) => r != null)
      if (!rets.length) return { h, n: 0, avg: null, win: null }
      return {
        h,
        n: rets.length,
        avg: rets.reduce((a, b) => a + b, 0) / rets.length,
        win: rets.filter((r) => r > 0).length / rets.length,
      }
    })

  const rows = Object.keys(SIGNALS).map((type) => ({
    type,
    count: signals.filter((s) => s.type === type).length,
    stats: stats(signals.filter((s) => s.type === type).map((s) => s.i)),
  }))
  // База для сравнения: покупка в любой день
  const baseline = stats(close.map((_, i) => i))
  return { rows, baseline }
}
