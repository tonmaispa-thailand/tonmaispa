// Date-range presets for the Reports page.
//
// "Today" is anchored via nowInSpaTz() — the spa's Asia/Bangkok calendar day,
// not the server's (Vercel runs UTC; see lib/scheduling.js's own note on why
// the server-local clock can never be trusted for this). Every further
// calculation (week/month/year math) then operates on that YYYY-MM-DD string
// as a plain UTC calendar date — safe once "today" itself is correct, since
// Asia/Bangkok has no DST to drift across.
import { nowInSpaTz } from '@/lib/scheduling'

const pad = n => String(n).padStart(2, '0')
const toYMD = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const parseYMD = s => new Date(`${s}T00:00:00Z`)

function addDays(ymd, days) {
  const d = parseYMD(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return toYMD(d)
}

export function todaySpaYMD() {
  return nowInSpaTz().date
}

export const REPORT_PRESETS = [
  { id: 'today',      label: 'Today' },
  { id: 'this_week',  label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year',  label: 'This year' },
  { id: 'custom',     label: 'Custom range' },
]

// { startDate, endDate } inclusive, both YYYY-MM-DD. `today` is injectable
// for tests; real callers always use the default (actual Bangkok today).
export function reportRange(preset, today = todaySpaYMD()) {
  const d = parseYMD(today)
  switch (preset) {
    case 'today':
      return { startDate: today, endDate: today }
    case 'this_week': {
      // Monday-start week — matches the repo's own convention elsewhere
      // (BookingEngine's calendar DAYS row starts Monday).
      const dow = d.getUTCDay() // 0=Sun..6=Sat
      const diffToMonday = (dow + 6) % 7
      return { startDate: addDays(today, -diffToMonday), endDate: today }
    }
    case 'this_month':
      return { startDate: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`, endDate: today }
    case 'last_month': {
      const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()
      const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth() // 1-indexed previous month
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate() // day 0 of next month = last day of this one
      return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-${pad(lastDay)}` }
    }
    case 'this_year':
      return { startDate: `${d.getUTCFullYear()}-01-01`, endDate: today }
    default:
      return { startDate: today, endDate: today }
  }
}
