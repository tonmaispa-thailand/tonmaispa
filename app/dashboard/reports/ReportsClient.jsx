'use client'

import { useState, useMemo, useRef } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { TREATMENT_CATEGORIES } from '@/lib/display'
import { REPORT_PRESETS, reportRange } from '@/lib/report-ranges'

const card = { background: '#fff', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, boxShadow: '0 1px 2px rgba(28,25,23,0.04)' }
const sectionTitle = { font: '600 12px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390', margin: '0 0 14px' }
const btnGhost = (active) => ({ padding: '8px 16px', borderRadius: 8, border: '1px solid ' + (active ? '#3B5249' : 'var(--color-border)'), background: active ? '#3B5249' : '#fff', color: active ? '#fff' : '#1C1917', font: '500 13px Inter,sans-serif', cursor: 'pointer', transition: 'all .15s' })
const btnPrimary = { background: '#3B5249', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', font: '600 13px Inter,sans-serif', cursor: 'pointer' }
const th = { textAlign: 'left', padding: '8px 10px', font: '600 10px Inter,sans-serif', letterSpacing: 0.5, textTransform: 'uppercase', color: '#9B9390', borderBottom: '1px solid #F0ECE6' }
const td = { padding: '8px 10px', font: '400 13px Inter,sans-serif', color: '#1C1917', borderBottom: '1px solid #F5F2ED' }
const CHART_COLORS = ['#3B5249', '#C4924A', '#6E8B7F', '#D9B98A', '#8C6D4F', '#A8BDB4', '#E8D5B7', '#5C7A6E']

const money = (n) => `฿${Math.round(n ?? 0).toLocaleString()}`
const shortDate = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}` }

const TooltipBox = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1C1917', color: '#FAF6F0', padding: '8px 12px', borderRadius: 6, font: '500 12px Inter,sans-serif' }}>
      <div style={{ opacity: 0.7, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i}>{p.name}: {money(p.value)}</div>)}
    </div>
  )
}

// CSV cell: quote whenever the value could otherwise break the format, and
// neutralize a leading =, +, -, @, tab or CR so the cell can never be read
// as a formula by Excel/Sheets (CSV formula injection). Treatment names are
// admin-entered, but the Source column ultimately comes from bookings.source,
// which the staff booking form writes from a fixed dropdown — but the POST
// /api/admin/bookings API itself accepts any string for it server-side (no
// allowlist), so this can't be assumed safe by provenance alone. Belt and
// braces, and it protects every later Reports stage (bookings/guests) that
// will include real guest-supplied free text.
function csvCell(v) {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function csvRow(cells) { return cells.map(csvCell).join(',') }

function downloadCsv(filename, text) {
  // Leading BOM so Excel opens UTF-8 (Thai treatment names, ฿) without mangling it.
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ReportsClient({ defaultPreset, defaultRange, initialRevenue }) {
  const [preset, setPreset] = useState(defaultPreset)
  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [revenue, setRevenue] = useState(initialRevenue)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // A request counter guards against out-of-order responses — same pattern
  // as BookingEngine's slot fetch (components/ui/BookingEngine.jsx): if the
  // user clicks another preset before an in-flight fetch resolves, a stale
  // reply must never overwrite a newer one (or flip loading/error for a
  // request that's no longer the current one).
  const requestIdRef = useRef(0)

  const load = async (s, e) => {
    const requestId = ++requestIdRef.current
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/admin/reports/revenue?startDate=${s}&endDate=${e}`)
      const data = await res.json()
      if (requestId !== requestIdRef.current) return // a newer request has since superseded this one
      if (!res.ok) throw new Error(data.error || 'Could not load report')
      setRevenue(data.revenue)
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err.message)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  const applyPreset = (id) => {
    setPreset(id)
    if (id === 'custom') return // wait for the user to pick dates below
    const { startDate: s, endDate: e } = reportRange(id)
    setStartDate(s); setEndDate(e)
    load(s, e)
  }

  const applyCustomDate = (key, value) => {
    setPreset('custom')
    const s = key === 'start' ? value : startDate
    const e = key === 'end' ? value : endDate
    setStartDate(s); setEndDate(e)
    if (s && e && s <= e) load(s, e)
  }

  const treatmentRows = useMemo(() => (
    Object.entries(revenue.byTreatment ?? {})
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  ), [revenue])

  const categoryRows = useMemo(() => (
    Object.entries(revenue.byCategory ?? {})
      .map(([key, v]) => ({ key, label: TREATMENT_CATEGORIES[key] ?? key, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  ), [revenue])

  const sourceRows = useMemo(() => (
    Object.entries(revenue.bySource ?? {})
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  ), [revenue])

  const dailyTrendData = useMemo(() => (
    Object.entries(revenue.dailyTrend ?? {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rev]) => ({ date: shortDate(date), revenue: rev }))
  ), [revenue])

  const exportCsv = () => {
    const lines = []
    lines.push(csvRow(['Ton Mai Spa — Revenue & Treatments Report']))
    lines.push(csvRow(['Period', startDate, endDate]))
    lines.push(csvRow(['Generated', new Date().toISOString()]))
    lines.push('')
    lines.push(csvRow(['Summary']))
    lines.push(csvRow(['Metric', 'Value']))
    lines.push(csvRow(['Total Revenue (THB)', revenue.totalRevenue]))
    lines.push(csvRow(['Completed Bookings', revenue.bookingCount]))
    lines.push(csvRow(['Avg Booking Value (THB)', revenue.avgBookingValue]))
    lines.push(csvRow(['Cancellation Rate (%)', revenue.cancellationRate]))
    lines.push('')
    lines.push(csvRow(['Revenue by Treatment']))
    lines.push(csvRow(['Treatment', 'Bookings', 'Revenue (THB)']))
    for (const r of treatmentRows) lines.push(csvRow([r.name, r.count, r.revenue]))
    lines.push('')
    lines.push(csvRow(['Revenue by Category']))
    lines.push(csvRow(['Category', 'Bookings', 'Revenue (THB)']))
    for (const r of categoryRows) lines.push(csvRow([r.label, r.count, r.revenue]))
    lines.push('')
    lines.push(csvRow(['Revenue by Source']))
    lines.push(csvRow(['Source', 'Bookings', 'Revenue (THB)']))
    for (const r of sourceRows) lines.push(csvRow([r.key, r.count, r.revenue]))
    lines.push('')
    lines.push(csvRow(['Daily Revenue Trend']))
    lines.push(csvRow(['Date', 'Revenue (THB)']))
    for (const [date, rev] of Object.entries(revenue.dailyTrend ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(csvRow([date, rev]))
    }
    downloadCsv(`tonmai-report_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Period control */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {REPORT_PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPreset(p.id)} style={btnGhost(preset === p.id)}>{p.label}</button>
            ))}
          </div>
          <button onClick={exportCsv} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>⬇ Export CSV</button>
        </div>
        {preset === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
            <input className="input" type="date" value={startDate} onChange={e => applyCustomDate('start', e.target.value)} style={{ maxWidth: 150 }} />
            <span style={{ color: '#9B9390' }}>–</span>
            <input className="input" type="date" value={endDate} onChange={e => applyCustomDate('end', e.target.value)} style={{ maxWidth: 150 }} />
          </div>
        )}
        <div style={{ font: '400 12px Inter,sans-serif', color: '#9B9390', marginTop: 10 }}>
          {startDate} → {endDate}{loading ? ' · loading…' : ''}
        </div>
        {error && <p style={{ color: '#DC2626', font: '400 12px Inter,sans-serif', marginTop: 8 }}>{error}</p>}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Total Revenue</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{money(revenue.totalRevenue)}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>{revenue.bookingCount} completed bookings</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Avg Booking Value</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{money(revenue.avgBookingValue)}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>per completed booking</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Cancellation Rate</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{revenue.cancellationRate}%</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>of all bookings in period</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Treatments Sold</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{treatmentRows.length}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>distinct treatments booked</div>
        </div>
      </div>

      {/* Daily trend */}
      <div style={card}>
        <h2 style={sectionTitle}>Daily Revenue Trend</h2>
        {dailyTrendData.length === 0 ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif' }}>No completed bookings in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0ECE6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9B9390' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9B9390' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<TooltipBox />} cursor={{ fill: '#F2EDE5' }} />
              <Bar dataKey="revenue" fill="#3B5249" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Treatments table */}
      <div style={card}>
        <h2 style={sectionTitle}>Revenue by Treatment</h2>
        {treatmentRows.length === 0 ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif' }}>No completed bookings in this period.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Treatment</th><th style={{ ...th, textAlign: 'right' }}>Bookings</th><th style={{ ...th, textAlign: 'right' }}>Revenue</th></tr></thead>
              <tbody>
                {treatmentRows.map(r => (
                  <tr key={r.name}>
                    <td style={td}>{r.name}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.count}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Category + Source */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={card}>
          <h2 style={sectionTitle}>Revenue by Category</h2>
          {categoryRows.length === 0 ? (
            <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif' }}>No data.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Category</th><th style={{ ...th, textAlign: 'right' }}>Bookings</th><th style={{ ...th, textAlign: 'right' }}>Revenue</th></tr></thead>
              <tbody>
                {categoryRows.map((r, i) => (
                  <tr key={r.key}>
                    <td style={{ ...td, display: 'flex', alignItems: 'center', gap: 8, border: 'none' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                      {r.label}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.count}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h2 style={sectionTitle}>Revenue by Source Channel</h2>
          {sourceRows.length === 0 ? (
            <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif' }}>No data.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Source</th><th style={{ ...th, textAlign: 'right' }}>Bookings</th><th style={{ ...th, textAlign: 'right' }}>Revenue</th></tr></thead>
              <tbody>
                {sourceRows.map(r => (
                  <tr key={r.key}>
                    <td style={td}>{r.key}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.count}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
