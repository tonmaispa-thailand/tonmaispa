// Unit test for lib/report-ranges (pure date logic, no DB).
//
// Run:  npm run test:ranges
//
// Guards the Reports page's preset math against boundary bugs — year
// rollover (Jan → last_month = Dec of prior year), leap years, and
// Monday-start week math — the kind of off-by-one that would quietly show
// an owner the wrong month's revenue.

import { reportRange } from '@/lib/report-ranges'

let ok = 0, bad = 0
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function check(name, cond, got) {
  if (cond) { ok++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  else { bad++; console.log(`  \x1b[31m✗\x1b[0m ${name} — got ${JSON.stringify(got)}`) }
}

console.log('\nreport-ranges')

// today
check('today', eq(reportRange('today', '2026-09-22'), { startDate: '2026-09-22', endDate: '2026-09-22' }),
  reportRange('today', '2026-09-22'))

// this_week — 2026-09-22 is a Tuesday, so Monday is 2026-09-21
check('this_week (Tue → prior Mon)', eq(reportRange('this_week', '2026-09-22'), { startDate: '2026-09-21', endDate: '2026-09-22' }),
  reportRange('this_week', '2026-09-22'))
// Monday itself → start == today
check('this_week (Mon → self)', eq(reportRange('this_week', '2026-09-21'), { startDate: '2026-09-21', endDate: '2026-09-21' }),
  reportRange('this_week', '2026-09-21'))
// Sunday → back to the Monday 6 days earlier
check('this_week (Sun → Mon 6d back)', eq(reportRange('this_week', '2026-09-27'), { startDate: '2026-09-21', endDate: '2026-09-27' }),
  reportRange('this_week', '2026-09-27'))

// this_month
check('this_month', eq(reportRange('this_month', '2026-09-22'), { startDate: '2026-09-01', endDate: '2026-09-22' }),
  reportRange('this_month', '2026-09-22'))

// last_month — plain case
check('last_month (Sep → Aug)', eq(reportRange('last_month', '2026-09-15'), { startDate: '2026-08-01', endDate: '2026-08-31' }),
  reportRange('last_month', '2026-09-15'))
// last_month — YEAR ROLLOVER: January must resolve to December of the PRIOR year
check('last_month (Jan → prior Dec)', eq(reportRange('last_month', '2026-01-10'), { startDate: '2025-12-01', endDate: '2025-12-31' }),
  reportRange('last_month', '2026-01-10'))
// last_month — 31-day month correctly bounded (not bleeding into next month)
check('last_month (Mar → Feb, non-leap)', eq(reportRange('last_month', '2027-03-05'), { startDate: '2027-02-01', endDate: '2027-02-28' }),
  reportRange('last_month', '2027-03-05'))
// last_month — LEAP YEAR: Feb 2028 (leap) must end on the 29th
check('last_month (Mar → Feb, leap year 2028)', eq(reportRange('last_month', '2028-03-05'), { startDate: '2028-02-01', endDate: '2028-02-29' }),
  reportRange('last_month', '2028-03-05'))

// this_year
check('this_year', eq(reportRange('this_year', '2026-09-22'), { startDate: '2026-01-01', endDate: '2026-09-22' }),
  reportRange('this_year', '2026-09-22'))

// unknown preset falls back to "today" rather than throwing
check('unknown preset falls back to today', eq(reportRange('bogus', '2026-09-22'), { startDate: '2026-09-22', endDate: '2026-09-22' }),
  reportRange('bogus', '2026-09-22'))

console.log(`\n${bad === 0 ? '\x1b[32m' : '\x1b[31m'}${ok} passed, ${bad} failed\x1b[0m\n`)
process.exit(bad === 0 ? 0 : 1)
