// Unit test for lib/peak-times (pure logic, no DB).
//
// Run:  npm run test:peaktimes
//
// Guards the Peak Times heatmap's date math (the easy-to-get-subtly-wrong
// part — Monday-first day-of-week derived from a plain date string, immune
// to the server's own timezone) and the grid/summary aggregation.

import { dayIndexMondayFirst, buildPeakTimesGrid, DAY_LABELS } from '@/lib/peak-times'

let ok = 0, bad = 0
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function check(name, cond, got) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { bad++; console.log(`  \x1b[31m✗\x1b[0m ${name} — got ${JSON.stringify(got)}`) }
}

console.log('\nday-of-week (2026-09-21 is a real Monday)')
const WEEK = [
  ['2026-09-21', 'Mon'], ['2026-09-22', 'Tue'], ['2026-09-23', 'Wed'],
  ['2026-09-24', 'Thu'], ['2026-09-25', 'Fri'], ['2026-09-26', 'Sat'], ['2026-09-27', 'Sun'],
]
for (const [date, label] of WEEK) {
  const got = DAY_LABELS[dayIndexMondayFirst(date)]
  check(`${date} → ${label}`, got === label, got)
}
// Year boundary — 2025-12-29 is a Monday, 2026-01-01 is a Thursday.
check('year boundary: 2025-12-29 → Mon', DAY_LABELS[dayIndexMondayFirst('2025-12-29')] === 'Mon')
check('year boundary: 2026-01-01 → Thu', DAY_LABELS[dayIndexMondayFirst('2026-01-01')] === 'Thu')

console.log('\nbuildPeakTimesGrid')
{
  const empty = buildPeakTimesGrid([])
  check('empty input → totalBookings 0', empty.totalBookings === 0, empty.totalBookings)
  check('empty input → busiestDay null', empty.busiestDay === null, empty.busiestDay)
  check('empty input → busiestHour null', empty.busiestHour === null, empty.busiestHour)
  check('empty input → maxCount 0', empty.maxCount === 0, empty.maxCount)
  check('empty input → 7×24 zero grid', eq(empty.grid, Array.from({ length: 7 }, () => Array(24).fill(0))))
}
{
  // 3 bookings Monday 10am, 2 bookings Monday 10am+1 more, 1 booking Saturday 14:00.
  // (2026-09-21=Mon, 2026-09-26=Sat, from the same real week above.)
  const rows = [
    { date: '2026-09-21', time_slot: '10:00:00' },
    { date: '2026-09-21', time_slot: '10:30:00' }, // same HOUR (10), different minute — must still count as hour 10
    { date: '2026-09-21', time_slot: '10:15:00' },
    { date: '2026-09-26', time_slot: '14:00:00' },
  ]
  const r = buildPeakTimesGrid(rows)
  check('4 rows → totalBookings 4', r.totalBookings === 4, r.totalBookings)
  check('Monday hour 10 has 3 (grouped by hour, ignoring minutes)', r.grid[0][10] === 3, r.grid[0][10])
  check('Saturday hour 14 has 1', r.grid[5][14] === 1, r.grid[5][14])
  check('maxCount is 3', r.maxCount === 3, r.maxCount)
  check('busiestDay is Mon', r.busiestDay === 'Mon', r.busiestDay)
  check('busiestHour is 10', r.busiestHour === 10, r.busiestHour)
  const gridSum = r.grid.reduce((s, row) => s + row.reduce((s2, c) => s2 + c, 0), 0)
  check('grid sums to totalBookings (no row dropped/double-counted)', gridSum === r.totalBookings, gridSum)
}
{
  // Defensive: a malformed time_slot must never crash the report.
  const r = buildPeakTimesGrid([{ date: '2026-09-21', time_slot: 'garbage' }, { date: '2026-09-21', time_slot: '09:00:00' }])
  check('malformed time_slot is skipped, not crashed, real row still counted', r.totalBookings === 2 && r.grid[0][9] === 1, JSON.stringify(r.grid[0]))
}
{
  // Edge case the above test doesn't cover: EVERY row fails the guard (all
  // malformed), so totalBookings > 0 but nothing landed in the grid at all
  // (maxCount stays 0, byDayTotal/byHourTotal are all-zero arrays). Before
  // the fix, busiestDay/busiestHour were gated on totalBookings > 0, so
  // Math.max(...allZeros).indexOf(...) silently resolved to index 0 —
  // fabricating "busiestDay: Mon, busiestHour: 00:00" out of zero real data.
  const r = buildPeakTimesGrid([{ date: '2026-09-21', time_slot: 'garbage' }, { date: '2026-09-22', time_slot: 'also-garbage' }])
  check('all rows malformed → totalBookings still counts raw rows', r.totalBookings === 2, r.totalBookings)
  check('all rows malformed → maxCount is 0', r.maxCount === 0, r.maxCount)
  check('all rows malformed → busiestDay is null, not fabricated', r.busiestDay === null, r.busiestDay)
  check('all rows malformed → busiestHour is null, not fabricated', r.busiestHour === null, r.busiestHour)
}

console.log(`\n${bad === 0 ? '\x1b[32m' : '\x1b[31m'}${ok} passed, ${bad} failed\x1b[0m\n`)
process.exit(bad === 0 ? 0 : 1)
