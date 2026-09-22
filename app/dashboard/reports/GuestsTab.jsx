'use client'

import { useState, useEffect, useRef } from 'react'
import { card, sectionTitle, btnPrimary, th, td, money } from './ui'
import { csvRow, downloadCsv } from './csv'

export default function GuestsTab({ startDate, endDate }) {
  const [guests, setGuests] = useState([])
  const [summary, setSummary] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Independent request counter — same out-of-order-response guard used by
  // every other tab's own fetch (BookingsTab, the parent's period load).
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true); setError('')
    fetch(`/api/admin/reports/guests?startDate=${startDate}&endDate=${endDate}`)
      .then(async res => {
        const data = await res.json()
        if (requestId !== requestIdRef.current) return
        if (!res.ok) throw new Error(data.error || 'Could not load guests report')
        setGuests(data.guests)
        setSummary(data.summary)
        setTruncated(data.truncated)
      })
      .catch(err => { if (requestId === requestIdRef.current) setError(err.message) })
      .finally(() => { if (requestId === requestIdRef.current) setLoading(false) })
  }, [startDate, endDate])

  const exportCsv = () => {
    const lines = []
    lines.push(csvRow(['Ton Mai Spa — Guests Report']))
    lines.push(csvRow(['Period', startDate, endDate]))
    lines.push(csvRow(['Generated', new Date().toISOString()]))
    lines.push('')
    if (summary) {
      lines.push(csvRow(['Summary']))
      lines.push(csvRow(['Metric', 'Value']))
      lines.push(csvRow(['Guests This Period', summary.totalGuestsInPeriod]))
      lines.push(csvRow(['New Guests This Period', summary.newCustomersInPeriod]))
      lines.push(csvRow(['Repeat Guests This Period', summary.repeatGuestsInPeriod]))
      lines.push(csvRow(['Repeat Rate (%)', summary.repeatRatePct]))
      lines.push(csvRow(['Total Spend This Period (THB)', summary.totalSpendInPeriod]))
      lines.push(csvRow(['Avg Spend per Guest (THB)', summary.avgSpendPerGuest]))
      lines.push('')
    }
    lines.push(csvRow(['Guests']))
    lines.push(csvRow(['Name', 'Phone', 'Email', 'Visits (this period)', 'Spend (this period, THB)', 'Lifetime Visits', 'Lifetime Value (THB)', 'Last Visit']))
    for (const g of guests) {
      lines.push(csvRow([g.name, g.phone, g.email, g.visitsInPeriod, g.spendInPeriod, g.lifetimeVisits, g.lifetimeValue, g.lastVisitAt ?? '']))
    }
    downloadCsv(`tonmai-report-guests_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Guests This Period</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{summary?.totalGuestsInPeriod ?? '—'}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>with a completed booking</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>New Guests</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{summary?.newCustomersInPeriod ?? '—'}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>first added this period</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Repeat Rate</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{summary?.repeatRatePct ?? '—'}%</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>{summary?.repeatGuestsInPeriod ?? 0} of this period&apos;s guests have visited before</div>
        </div>
        <div style={{ ...card, padding: 16, flex: 1, minWidth: 150 }}>
          <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#9B9390' }}>Avg Spend / Guest</div>
          <div style={{ font: '400 28px Cormorant Garamond,serif', color: '#1C1917', marginTop: 4 }}>{summary ? money(summary.avgSpendPerGuest) : '—'}</div>
          <div style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', marginTop: 2 }}>this period only</div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ ...sectionTitle, margin: 0 }}>Guests</h2>
            <p style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', margin: '6px 0 0' }}>
              &quot;This period&quot; columns are scoped to {startDate} → {endDate}. &quot;Lifetime&quot; columns cover the guest&apos;s entire history, kept up to date automatically as bookings complete.
            </p>
          </div>
          <button onClick={exportCsv} disabled={loading || guests.length === 0} style={{ ...btnPrimary, opacity: (loading || guests.length === 0) ? 0.6 : 1, flexShrink: 0 }}>⬇ Export CSV</button>
        </div>

        {error && <p style={{ color: '#DC2626', font: '400 12px Inter,sans-serif', marginTop: 10 }}>{error}</p>}
        {truncated && <p style={{ color: '#C4924A', font: '400 12px Inter,sans-serif', marginTop: 10 }}>Showing the top 500 by spend; narrow the period to see everyone.</p>}

        {guests.length === 0 ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif', marginTop: 14 }}>{loading ? 'Loading…' : 'No guests with a completed booking in this period.'}</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 14, maxHeight: 480, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Guest</th><th style={th}>Phone</th>
                  <th style={{ ...th, textAlign: 'right' }}>Visits</th>
                  <th style={{ ...th, textAlign: 'right' }}>Spend</th>
                  <th style={{ ...th, textAlign: 'right' }}>Lifetime Visits</th>
                  <th style={{ ...th, textAlign: 'right' }}>Lifetime Value</th>
                  <th style={th}>Last Visit</th>
                </tr>
              </thead>
              <tbody>
                {guests.map(g => (
                  <tr key={g.id}>
                    <td style={td}>{g.name}{g.isRepeat && <span style={{ marginLeft: 6, font: '600 9px Inter,sans-serif', color: '#3B5249', background: '#F0F4F2', padding: '2px 6px', borderRadius: 999 }}>REPEAT</span>}</td>
                    <td style={td}>{g.phone || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.visitsInPeriod}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(g.spendInPeriod)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.lifetimeVisits}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{money(g.lifetimeValue)}</td>
                    <td style={td}>{g.lastVisitAt ?? '—'}</td>
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
