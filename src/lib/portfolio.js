// Расчёт показателей портфеля по сделкам, дневным котировкам и истории дивидендов.
// Все суммы в тенге. Даты — строки YYYY-MM-DD.

// На KASE расчёты T+2: чтобы попасть в реестр на дату фиксации,
// акцию нужно купить не позже чем за 2 рабочих дня до неё
export function lastTradeDateForRecord(recordDate) {
  const d = new Date(recordDate + 'T00:00:00Z')
  let left = 2
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d.toISOString().slice(0, 10)
}

// Цена закрытия на дату или последняя до неё
export function closeOn(bars, date) {
  let lo = 0
  let hi = bars.length - 1
  let ans = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].date <= date) {
      ans = bars[mid].c
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

const qtyOn = (trades, date) => trades.filter((t) => t.date <= date).reduce((s, t) => s + t.qty, 0)
const cost = (t) => t.qty * t.price + (t.fee || 0)

// Дивиденды, причитающиеся по сделкам; paid — уже начались выплаты на дату today
export function dividendEvents(trades, divs, tax, today) {
  return divs
    .map((d) => {
      const qty = qtyOn(trades, lastTradeDateForRecord(d.recordDate))
      return { ...d, qty, amount: qty * d.dps * (1 - tax), paid: d.payDate <= today }
    })
    .filter((e) => e.qty > 0)
}

/**
 * @param portfolio { trades: [{symbol,date,qty,price,fee}], dividendTax }
 * @param quotes    { [symbol]: { bars, updatedAt } }
 * @param dividends { [symbol]: [{year,dps,recordDate,payDate}] }
 */
export function analyze(portfolio, quotes, dividends) {
  const tax = portfolio.dividendTax || 0
  const symbols = Object.keys(quotes)
  const lastDate = symbols.map((s) => quotes[s].bars.at(-1).date).sort().at(-1)
  const year = lastDate.slice(0, 4)
  const yearStart = `${year}-01-01`
  const prevYearEnd = `${Number(year) - 1}-12-31`

  const positions = symbols.map((symbol) => {
    const bars = quotes[symbol].bars
    const trades = portfolio.trades.filter((t) => t.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date))
    const qty = qtyOn(trades, lastDate)
    const invested = trades.reduce((s, t) => s + cost(t), 0)
    const price = bars.at(-1).c
    const prevClose = bars.at(-2)?.c ?? price
    const value = qty * price
    const events = dividendEvents(trades, dividends[symbol] || [], tax, lastDate)
    const divPaid = events.filter((e) => e.paid).reduce((s, e) => s + e.amount, 0)
    const divPaidYtd = events.filter((e) => e.paid && e.payDate >= yearStart).reduce((s, e) => s + e.amount, 0)

    // Начало года: позиция на 31 декабря по цене последнего закрытия прошлого года
    const startPrice = closeOn(bars, prevYearEnd)
    const startValue = startPrice == null ? 0 : qtyOn(trades, prevYearEnd) * startPrice
    const buysYtd = trades.filter((t) => t.date >= yearStart).reduce((s, t) => s + cost(t), 0)

    return {
      symbol,
      qty,
      price,
      priceDate: bars.at(-1).date,
      dayChange: prevClose ? price / prevClose - 1 : 0,
      avgPrice: qty ? invested / qty : 0,
      invested,
      value,
      pnl: value - invested,
      divPaid,
      divPaidYtd,
      events,
      startPrice,
      startValue,
      buysYtd,
      priceYtd: startPrice ? price / startPrice - 1 : null,
    }
  })

  const sum = (k) => positions.reduce((s, p) => s + p[k], 0)
  const value = sum('value')
  const invested = sum('invested')
  const divPaid = sum('divPaid')
  const startValue = sum('startValue')
  const buysYtd = sum('buysYtd')
  const divPaidYtd = sum('divPaidYtd')
  // База для доходности за год — стоимость на начало года плюс вложенное в этом году
  const ytdBase = startValue + buysYtd
  const changeYtd = value - startValue - buysYtd // изменение стоимости без учёта новых покупок
  const returnYtd = changeYtd + divPaidYtd // с дивидендами

  return {
    year,
    lastDate,
    positions,
    value,
    invested,
    pnl: value - invested,
    pnlPct: invested ? (value - invested) / invested : null,
    divPaid,
    totalPnl: value - invested + divPaid,
    totalPnlPct: invested ? (value - invested + divPaid) / invested : null,
    divPaidYtd,
    changeYtd,
    changeYtdPct: ytdBase ? changeYtd / ytdBase : null,
    returnYtd,
    returnYtdPct: ytdBase ? returnYtd / ytdBase : null,
    upcoming: positions.flatMap((p) => p.events.filter((e) => !e.paid).map((e) => ({ ...e, symbol: p.symbol }))),
  }
}

// Ежедневная стоимость портфеля и вложенная сумма — для графика
export function history(portfolio, quotes) {
  const first = portfolio.trades.map((t) => t.date).sort()[0]
  if (!first) return []
  const dates = [...new Set(Object.values(quotes).flatMap((q) => q.bars.map((b) => b.date)))]
    .filter((d) => d >= first)
    .sort()
  return dates.map((date) => {
    let value = 0
    let invested = 0
    for (const [symbol, q] of Object.entries(quotes)) {
      const trades = portfolio.trades.filter((t) => t.symbol === symbol && t.date <= date)
      const qty = trades.reduce((s, t) => s + t.qty, 0)
      invested += trades.reduce((s, t) => s + cost(t), 0)
      if (qty) value += qty * (closeOn(q.bars, date) ?? 0)
    }
    return { date, value, invested }
  })
}
