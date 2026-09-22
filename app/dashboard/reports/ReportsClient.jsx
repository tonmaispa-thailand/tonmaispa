'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { TREATMENT_CATEGORIES } from '@/lib/display'
import { REPORT_PRESETS, reportRange } from '@/lib/report-ranges'
import { card, sectionTitle, btnGhost, btnPrimary, th, td, money, shortDate, TooltipBox, CHART_COLORS } from './ui'
import { csvRow, downloadCsv } from './csv'
import TherapistsTab from './TherapistsTab'
import BookingsTab from './BookingsTab'
import GuestsTab from './GuestsTab'
import AddOnsTab from './AddOnsTab'
import PeakTimesTab from './PeakTimesTab'

const TABS = [
  { id: 'revenue',    label: 'Revenue' },
  { id: 'therapists', label: 'Therapists' },
  { id: 'bookings',   label: 'Bookings' },
  { id: 'guests',     label: 'Guests' },
  { id: 'addons',     label: 'Add-Ons' },
  { id: 'peaktimes',  label: 'Peak Times' },
]

export default function ReportsClient({ defaultPreset, defaultRange, initialRevenue, treatments, therapists: therapistOptions }) {
  const [activeTab, setActiveTab] = useState('revenue')
  const [preset, setPreset] = useState(defaultPreset)
  const [startDate, setStartDate] = useState(defaultRange.startDate)
  const [endDate, setEndDate] = useState(defaultRange.endDate)
  const [revenue, setRevenue] = useState(initialRevenue)
  const [therapistReport, setTherapistReport] = useState([]) // the Therapists tab's own report rows — distinct from `therapistOptions`, the id+name list used for the Bookings-tab filter dropdown
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // A request counter guards against out-of-order responses — same pattern
  // as BookingEngine's slot fetch (components/ui/BookingEngine.jsx): if the
  // user changes the period again before an in-flight fetch resolves, a stale
  // reply must never overwrite a newer one. Revenue and Therapists are always
  // refetched together (one counter for both) since they share the same
  // period control; Bookings owns its own independent fetch (own filters on
  // top of the period) inside BookingsTab.
  const requestIdRef = useRef(0)

  const loadPeriod = async (s, e) => {
    const requestId = ++requestIdRef.current
    setLoading(true); setError('')
    try {
      const [revRes, therRes] = await Promise.all([
        fetch(`/api/admin/reports/revenue?startDate=${s}&endDate=${e}`),
        fetch(`/api/admin/reports/therapists?startDate=${s}&endDate=${e}`),
      ])
      const [revData, therData] = await Promise.all([revRes.json(), therRes.json()])
      if (requestId !== requestIdRef.current) return // a newer request has since superseded this one
      if (!revRes.ok) throw new Error(revData.error || 'Could not load revenue report')
      if (!therRes.ok) throw new Error(therData.error || 'Could not load therapists report')
      setRevenue(revData.revenue)
      setTherapistReport(therData.therapists)
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err.message)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  // Revenue has server-rendered initial data for the default period; Therapists
  // does not (kept page.jsx's initial query list short), so fetch once on
  // mount through the same guarded path subsequent period changes use — the
  // one redundant (but harmless — identical data) revenue re-fetch this costs
  // is a simple, deliberate trade against a second, unguarded fetch path that
  // could race the first period change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPeriod(startDate, endDate) }, [])

  const applyPreset = (id) => {
    setPreset(id)
    if (id === 'custom') return // wait for the user to pick dates below
    const { startDate: s, endDate: e } = reportRange(id)
    setStartDate(s); setEndDate(e)
    loadPeriod(s, e)
  }

  const applyCustomDate = (key, value) => {
    setPreset('custom')
    const s = key === 'start' ? value : startDate
    const e = key === 'end' ? value : endDate
    setStartDate(s); setEndDate(e)
    if (s && e && s <= e) loadPeriod(s, e)
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

  const exportRevenueCsv = () => {
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
    downloadCsv(`tonmai-report-revenue_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Period control — shared across all tabs */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {REPORT_PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPreset(p.id)} style={btnGhost(preset === p.id)}>{p.label}</button>
            ))}
          </div>
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

      {/* Tab bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, background: '#F2EDE5', padding: 4, borderRadius: 10, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ ...btnGhost(activeTab === t.id), border: 'none', background: activeTab === t.id ? '#3B5249' : 'transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'revenue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

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

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ ...sectionTitle, margin: 0 }}>Daily Revenue Trend</h2>
              <button onClick={exportRevenueCsv} disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.6 : 1 }}>⬇ Export CSV</button>
            </div>
            {dailyTrendData.length === 0 ? (
              <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif', marginTop: 14 }}>No completed bookings in this period.</p>
            ) : (
              <div style={{ marginTop: 14 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dailyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0ECE6" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9B9390' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9B9390' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<TooltipBox />} cursor={{ fill: '#F2EDE5' }} />
                    <Bar dataKey="revenue" fill="#3B5249" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

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
      )}

      {activeTab === 'therapists' && (
        <TherapistsTab therapists={therapistReport} loading={loading} startDate={startDate} endDate={endDate} />
      )}

      {activeTab === 'bookings' && (
        <BookingsTab startDate={startDate} endDate={endDate} treatments={treatments} therapists={therapistOptions} />
      )}

      {activeTab === 'guests' && (
        <GuestsTab startDate={startDate} endDate={endDate} />
      )}

      {activeTab === 'addons' && (
        <AddOnsTab startDate={startDate} endDate={endDate} />
      )}

      {activeTab === 'peaktimes' && (
        <PeakTimesTab startDate={startDate} endDate={endDate} />
      )}
    </div>
  )
}
