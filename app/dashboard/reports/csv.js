// Shared CSV export helpers for every Reports tab. Single source of truth so
// the formula-injection fix (code review, Stage 1) can't drift or get lost if
// copy-pasted into a new tab — every tab's "Export CSV" button imports this.

// CSV cell: quote whenever the value could otherwise break the format, and
// neutralize a leading =, +, -, @, tab or CR so the cell can never be read as
// a formula by Excel/Sheets (CSV formula injection). Some of what lands here
// is admin-entered (treatment names), but bookings.source and guest-supplied
// free text (later stages) are NOT allowlisted server-side, so this can't be
// assumed safe by provenance — every cell gets the same treatment.
export function csvCell(v) {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells) {
  return cells.map(csvCell).join(',')
}

export function downloadCsv(filename, text) {
  // Leading BOM so Excel opens UTF-8 (Thai treatment/guest names, ฿) without mangling it.
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
