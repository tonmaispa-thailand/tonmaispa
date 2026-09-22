'use client'

import { useState, useEffect, useRef } from 'react'
import { card, sectionTitle, btnPrimary, th, td, money } from './ui'
import { csvRow, downloadCsv } from './csv'

export default function AddOnsTab({ startDate, endDate }) {
  const [addons, setAddons] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true); setError('')
    fetch(`/api/admin/reports/addons?startDate=${startDate}&endDate=${endDate}`)
      .then(async res => {
        const data = await res.json()
        if (requestId !== requestIdRef.current) return
        if (!res.ok) throw new Error(data.error || 'Could not load add-ons report')
        setAddons(data.addons)
        setSummary(data.summary)
      })
      .catch(err => { if (requestId === requestIdRef.current) setError(err.message) })
      .finally(() => { if (requestId === requestIdRef.current) setLoading(false) })
  }, [startDate, endDate])

  const exportCsv = () => {
    const lines = []
    lines.push(csvRow(['Ton Mai Spa — Add-Ons Report']))
    lines.push(csvRow(['Period', startDate, endDate]))
    lines.push(csvRow(['Generated', new Date().toISOString()]))
    lines.push('')
    if (summary) {
      lines.push(csvRow(['Summary']))
      lines.push(csvRow(['Metric', 'Value']))
      lines.push(csvRow(['Total Add-On Revenue (THB)', summary.totalAddonRevenue]))
      lines.push(csvRow(['Add-On Line Items', summary.totalAddonLineItems]))
      lines.push(csvRow(['Bookings With an Add-On', summary.bookingsWithAddon]))
      lines.push(csvRow(['Total Completed Bookings', summary.totalCompletedBookings]))
      lines.push(csvRow(['Attach Rate (%)', summary.attachRatePct]))
      lines.push('')
    }
    lines.push(csvRow(['Add-On', 'Times Booked', 'Revenue (THB)', 'Total Minutes']))
    for (const a of addons) lines.push(csvRow([a.name, a.count, a.revenue, a.minutes]))
    downloadCsv(`tonmai-report-addons_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Add-On Revenue</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{summary ? money(summary.totalAddonRevenue) : '—'}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>{summary?.totalAddonLineItems ?? 0} add-ons booked</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Attach Rate</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{summary?.attachRatePct ?? '—'}%</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>{summary?.bookingsWithAddon ?? 0} of {summary?.totalCompletedBookings ?? 0} completed bookings</div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>Add-Ons by Revenue</h2>
          <button onClick={exportCsv} disabled={loading || addons.length === 0} style={{ ...btnPrimary, opacity: (loading || addons.length === 0) ? 0.6 : 1 }}>⬇ Export CSV</button>
        </div>
        {error && <p style={{ color: '#DC2626', font: '400 12px Inter,sans-serif', marginTop: 10 }}>{error}</p>}

        {addons.length === 0 ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif', marginTop: 14 }}>
            {loading ? 'Loading…' : 'No add-ons booked in this period yet — they show up here as soon as a guest adds one at checkout.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Add-On</th><th style={{ ...th, textAlign: 'right' }}>Times Booked</th><th style={{ ...th, textAlign: 'right' }}>Revenue</th></tr></thead>
              <tbody>
                {addons.map(a => (
                  <tr key={a.name}>
                    <td style={td}>{a.name}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{a.count}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(a.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
