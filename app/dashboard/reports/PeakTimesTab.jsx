'use client'

import { useState, useEffect, useRef } from 'react'
import { card, sectionTitle, btnPrimary } from './ui'
import { csvRow, downloadCsv } from './csv'

// Opening hours are NOT one fixed constant — the slot_settings table lets
// each treatment scope its own first_slot/last_slot (lib/scheduling.js's
// getSlotConfig), and the global default itself (09:00–22:00) differs from
// the homepage's marketing copy ("Open daily 09:00–23:00", for the
// non-treatment sauna day pass). So rather than hardcode a window that could
// silently hide real data if hours ever change, the displayed hour range is
// derived from whichever hours the PERIOD'S OWN DATA actually touches
// (padded by one hour each side, floored/capped to a sane 0–23), falling
// back to a plain business-hours guess only when the period has zero
// bookings to derive a window from at all.
const FALLBACK_OPEN_HOUR = 9
const FALLBACK_CLOSE_HOUR = 22

function heatColor(count, max) {
  if (count === 0) return '#F5F2ED'
  const t = max > 0 ? count / max : 0
  // Interpolate from a pale to a deep version of the site's forest-green accent.
  const light = [224, 237, 230] // #E0EDE6-ish
  const dark = [59, 82, 73]     // #3B5249
  const mix = light.map((l, i) => Math.round(l + (dark[i] - l) * t))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

export default function PeakTimesTab({ startDate, endDate }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true); setError('')
    fetch(`/api/admin/reports/peak-times?startDate=${startDate}&endDate=${endDate}`)
      .then(async res => {
        const data = await res.json()
        if (requestId !== requestIdRef.current) return
        if (!res.ok) throw new Error(data.error || 'Could not load peak times report')
        setReport(data)
      })
      .catch(err => { if (requestId === requestIdRef.current) setError(err.message) })
      .finally(() => { if (requestId === requestIdRef.current) setLoading(false) })
  }, [startDate, endDate])

  const [openHour, closeHour] = (() => {
    if (!report) return [FALLBACK_OPEN_HOUR, FALLBACK_CLOSE_HOUR]
    const touchedHours = []
    for (const row of report.grid) row.forEach((count, h) => { if (count > 0) touchedHours.push(h) })
    // Falls back the same way when there's simply no data to derive a window
    // from AND in the (practically unreachable given the DB schema, but
    // defended anyway — see lib/peak-times.js) case where totalBookings > 0
    // yet nothing landed in the grid: Math.min/max of an empty array is
    // ±Infinity, which would otherwise corrupt openHour/closeHour and, via
    // Array.from clamping that negative length to 0, silently render a
    // heatmap with zero hour columns (not a crash, just a broken-looking
    // table) — busiestDay/busiestHour are null in this same case too (see
    // lib/peak-times.js), so the table body would be all we'd need to guard.
    if (touchedHours.length === 0) return [FALLBACK_OPEN_HOUR, FALLBACK_CLOSE_HOUR]
    const min = Math.max(0, Math.min(...touchedHours) - 1)
    const max = Math.min(23, Math.max(...touchedHours) + 1)
    return [min, max]
  })()
  const hours = Array.from({ length: closeHour - openHour + 1 }, (_, i) => openHour + i)

  // Full 24-hour grid (not just the trimmed display window) so the export is
  // a complete record even if the on-screen heatmap is cropped to save space.
  const exportCsv = () => {
    const lines = []
    lines.push(csvRow(['Ton Mai Spa — Peak Times Report']))
    lines.push(csvRow(['Period', startDate, endDate]))
    lines.push(csvRow(['Generated', new Date().toISOString()]))
    lines.push('')
    lines.push(csvRow(['Summary']))
    lines.push(csvRow(['Metric', 'Value']))
    lines.push(csvRow(['Total Bookings (confirmed + completed)', report.totalBookings]))
    lines.push(csvRow(['Busiest Day', report.busiestDay ?? '—']))
    lines.push(csvRow(['Busiest Hour', report.busiestHour !== null ? `${String(report.busiestHour).padStart(2, '0')}:00` : '—']))
    lines.push('')
    lines.push(csvRow(['Bookings by Day and Hour']))
    lines.push(csvRow(['Day', ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)]))
    for (const [dayIdx, label] of report.dayLabels.entries()) {
      lines.push(csvRow([label, ...report.grid[dayIdx]]))
    }
    downloadCsv(`tonmai-report-peaktimes_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ ...sectionTitle, margin: 0 }}>Peak Times</h2>
            <p style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', margin: '6px 0 0' }}>
              Booking volume by day and hour — confirmed + completed bookings, the actual demand on your schedule (not just realized revenue). Use this to plan shifts around when guests actually book.
            </p>
          </div>
          <button onClick={exportCsv} disabled={loading || !report || report.totalBookings === 0} style={{ ...btnPrimary, opacity: (loading || !report || report.totalBookings === 0) ? 0.6 : 1, flexShrink: 0 }}>⬇ Export CSV</button>
        </div>

        {error && <p style={{ color: '#DC2626', font: '400 12px Inter,sans-serif', marginTop: 10 }}>{error}</p>}

        {loading ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif' }}>Loading…</p>
        ) : !report || report.totalBookings === 0 ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif' }}>No confirmed or completed bookings in this period.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ font: '400 13px Inter,sans-serif', color: '#4A4745' }}>
                Busiest day: <strong style={{ color: '#1C1917' }}>{report.busiestDay ?? '—'}</strong>
              </div>
              <div style={{ font: '400 13px Inter,sans-serif', color: '#4A4745' }}>
                {/* busiestHour can be null (see lib/peak-times.js) even though
                    totalBookings > 0 — every row failed the malformed-time_slot
                    guard, so nothing landed in the grid. Same '—' placeholder
                    GuestsTab uses for other not-always-present fields. */}
                Busiest hour: <strong style={{ color: '#1C1917' }}>{report.busiestHour !== null ? `${String(report.busiestHour).padStart(2, '0')}:00` : '—'}</strong>
              </div>
              <div style={{ font: '400 13px Inter,sans-serif', color: '#4A4745' }}>
                Total bookings: <strong style={{ color: '#1C1917' }}>{report.totalBookings}</strong>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '4px 6px' }}></th>
                    {hours.map(h => (
                      <th key={h} style={{ padding: '4px 4px', font: '500 10px Inter,sans-serif', color: '#9B9390', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.dayLabels.map((label, dayIdx) => (
                    <tr key={label}>
                      <td style={{ padding: '4px 8px', font: '600 11px Inter,sans-serif', color: '#4A4745', whiteSpace: 'nowrap' }}>{label}</td>
                      {hours.map(h => {
                        const count = report.grid[dayIdx][h]
                        return (
                          <td key={h} title={`${label} ${String(h).padStart(2, '0')}:00 — ${count} booking${count === 1 ? '' : 's'}`}
                            style={{
                              width: 26, height: 26, textAlign: 'center', verticalAlign: 'middle',
                              background: heatColor(count, report.maxCount),
                              color: count > report.maxCount * 0.6 ? '#fff' : '#6B6663',
                              font: '500 10px Inter,sans-serif', border: '1px solid #fff',
                            }}>
                            {count > 0 ? count : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
