// Pure aggregation for the Reports "Peak Times" heatmap — day-of-week ×
// hour-of-day booking volume. Extracted from the API route so the date-math
// (the one part of this that's easy to get subtly wrong) is unit-testable
// directly, the same way lib/report-ranges.js and lib/booking-ranking.js are.

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] // Monday-first, matches the rest of the app

// bookings.date is already a Bangkok calendar day (not a UTC instant), so it
// must be parsed as a plain UTC calendar date (Date.UTC + getUTCDay) — never
// through a local-timezone Date, which could shift it to the wrong day at a
// boundary (the server itself runs UTC on Vercel). Same safe pattern as
// lib/report-ranges.js's parseYMD.
export function dayIndexMondayFirst(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const sundayFirst = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  return (sundayFirst + 6) % 7 // 0=Mon..6=Sun
}

// rows: [{date: 'YYYY-MM-DD', time_slot: 'HH:MM:SS'}, ...]. Returns the 7×24
// grid plus the summary fields the Peak Times tab and its CSV export need.
export function buildPeakTimesGrid(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxCount = 0
  for (const b of rows) {
    const day = dayIndexMondayFirst(b.date)
    const hour = Number(b.time_slot.slice(0, 2))
    if (hour < 0 || hour > 23 || Number.isNaN(hour)) continue // defensive — a malformed time_slot must never crash the report
    grid[day][hour] += 1
    if (grid[day][hour] > maxCount) maxCount = grid[day][hour]
  }

  const byDayTotal = grid.map(row => row.reduce((s, c) => s + c, 0))
  const byHourTotal = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0))
  const totalBookings = rows.length
  // Gate on maxCount (did anything actually land in the grid), NOT totalBookings
  // (the raw row count, which — by design, see the guard above — can be > 0
  // even when every single row was skipped as malformed). Gating on
  // totalBookings here would fabricate a "busiest day: Mon, busiest hour:
  // 00:00" out of an all-zero grid (byDayTotal/byHourTotal are all zeros, so
  // indexOf(Math.max(...)) resolves to index 0, not "no data"). Practically
  // unreachable given the DB schema (see above), but a defensive guard that
  // itself lies when triggered isn't a guard worth having.
  const busiestDayIdx = maxCount > 0 ? byDayTotal.indexOf(Math.max(...byDayTotal)) : -1
  const busiestHour = maxCount > 0 ? byHourTotal.indexOf(Math.max(...byHourTotal)) : -1

  return {
    dayLabels: DAY_LABELS,
    grid,
    maxCount,
    totalBookings,
    busiestDay: busiestDayIdx >= 0 ? DAY_LABELS[busiestDayIdx] : null,
    busiestHour: maxCount > 0 ? busiestHour : null,
  }
}
