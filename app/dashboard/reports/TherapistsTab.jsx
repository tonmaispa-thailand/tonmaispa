'use client'

import { useState, Fragment } from 'react'
import { card, sectionTitle, btnPrimary, th, td, money } from './ui'
import { csvRow, downloadCsv } from './csv'

export default function TherapistsTab({ therapists, loading, startDate, endDate }) {
  const [expandedId, setExpandedId] = useState(null)

  const exportCsv = () => {
    const lines = []
    lines.push(csvRow(['Ton Mai Spa — Therapist Report']))
    lines.push(csvRow(['Period', startDate, endDate]))
    lines.push(csvRow(['Generated', new Date().toISOString()]))
    lines.push('')
    lines.push(csvRow(['Therapist', 'Occupancy %', 'Scheduled Hours', 'Booked Hours', 'Completed Bookings', 'Revenue (THB)']))
    for (const t of therapists) lines.push(csvRow([t.name, t.occupancyPct, t.scheduledHours, t.bookedHours, t.completedBookings, t.revenue]))
    lines.push('')
    lines.push(csvRow(['Treatments Performed — per therapist']))
    lines.push(csvRow(['Therapist', 'Treatment', 'Bookings', 'Revenue (THB)']))
    for (const t of therapists) {
      for (const tr of t.treatments) lines.push(csvRow([t.name, tr.name, tr.count, tr.revenue]))
    }
    downloadCsv(`tonmai-report-therapists_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ ...sectionTitle, margin: 0 }}>Therapist Performance</h2>
            <p style={{ font: '400 11px Inter,sans-serif', color: '#9B9390', margin: '6px 0 0' }}>
              Occupancy counts booked vs. scheduled time (confirmed + completed). Revenue and treatments performed count only completed bookings — same realized-revenue rule as the Revenue tab. Click a row to see which treatments a therapist performed.
            </p>
          </div>
          <button onClick={exportCsv} disabled={loading || therapists.length === 0} style={{ ...btnPrimary, opacity: (loading || therapists.length === 0) ? 0.6 : 1, flexShrink: 0 }}>⬇ Export CSV</button>
        </div>

        {therapists.length === 0 ? (
          <p style={{ color: '#9B9390', font: '400 13px Inter,sans-serif', marginTop: 14 }}>{loading ? 'Loading…' : 'No active therapists.'}</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Therapist</th>
                  <th style={{ ...th, textAlign: 'right' }}>Occupancy</th>
                  <th style={{ ...th, textAlign: 'right' }}>Scheduled</th>
                  <th style={{ ...th, textAlign: 'right' }}>Booked</th>
                  <th style={{ ...th, textAlign: 'right' }}>Completed</th>
                  <th style={{ ...th, textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {therapists.map(t => {
                  const expanded = expandedId === t.id
                  return (
                    <Fragment key={t.id}>
                      <tr onClick={() => setExpandedId(expanded ? null : t.id)} style={{ cursor: t.treatments.length ? 'pointer' : 'default' }}>
                        <td style={td}>
                          {t.treatments.length > 0 && <span style={{ display: 'inline-block', width: 14, color: '#9B9390' }}>{expanded ? '▾' : '▸'}</span>}
                          {t.name}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{t.occupancyPct}%</td>
                        <td style={{ ...td, textAlign: 'right' }}>{t.scheduledHours}h</td>
                        <td style={{ ...td, textAlign: 'right' }}>{t.bookedHours}h</td>
                        <td style={{ ...td, textAlign: 'right' }}>{t.completedBookings}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{money(t.revenue)}</td>
                      </tr>
                      {expanded && t.treatments.length > 0 && (
                        <tr>
                          <td colSpan={6} style={{ ...td, background: '#FAF8F5', padding: '10px 10px 10px 34px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {t.treatments.map(tr => (
                                <div key={tr.name} style={{ display: 'flex', justifyContent: 'space-between', font: '400 12px Inter,sans-serif', color: '#4A4745', maxWidth: 420 }}>
                                  <span>{tr.name}</span>
                                  <span style={{ color: '#9B9390' }}>{tr.count}× · {money(tr.revenue)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
