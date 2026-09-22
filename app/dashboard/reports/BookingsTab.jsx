'use client'

import { useState, useEffect, useRef } from 'react'
import { BOOKING_STATUS_LABELS } from '@/lib/display'
import { card, sectionTitle, btnPrimary, th, td, money } from './ui'
import { csvRow, downloadCsv } from './csv'

// Same fixed lists the dashboard's own Bookings page uses for its filters and
// its Add/Edit forms (app/dashboard/bookings/BookingsClient.jsx) — kept in
// sync by hand since that file doesn't export them.
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled']
const SOURCES = ['online', 'walk_in', 'phone', 'chatbot']

export default function BookingsTab({ startDate, endDate, treatments, therapists }) {
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [treatmentId, setTreatmentId] = useState('')
  const [therapistId, setTherapistId] = useState('')
  const [bookings, setBookings] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Independent request counter — this tab has its own trigger dimensions
  // (period AND four filters) on top of the shared period, so it can't share
  // the parent's counter; same out-of-order-response guard as everywhere else
  // in this feature (BookingEngine's slot fetch, the Revenue tab's period load).
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true); setError('')
    const params = new URLSearchParams({ startDate, endDate })
    if (status) params.set('status', status)
    if (source) params.set('source', source)
    if (treatmentId) params.set('treatmentId', treatmentId)
    if (therapistId) params.set('therapistId', therapistId)

    fetch(`/api/admin/reports/bookings?${params}`)
      .then(async res => {
        const data = await res.json()
        if (requestId !== requestIdRef.current) return
        if (!res.ok) throw new Error(data.error || 'Could not load bookings')
        setBookings(data.bookings)
        setTruncated(data.truncated)
      })
      .catch(err => { if (requestId === requestIdRef.current) setError(err.message) })
      .finally(() => { if (requestId === requestIdRef.current) setLoading(false) })
  }, [startDate, endDate, status, source, treatmentId, therapistId])

  const exportCsv = () => {
    const lines = []
    lines.push(csvRow(['Ton Mai Spa — Bookings Report']))
    lines.push(csvRow(['Period', startDate, endDate]))
    lines.push(csvRow(['Filters', `status=${status || 'all'}`, `source=${source || 'all'}`]))
    lines.push(csvRow(['Generated', new Date().toISOString()]))
    lines.push('')
    lines.push(csvRow(['Ref', 'Date', 'Time', 'Guest', 'Treatment', 'Therapist', 'Duration (min)', 'Status', 'Source', 'Price (THB)']))
    for (const b of bookings) {
      lines.push(csvRow([b.ref_code, b.date, b.time_slot?.slice(0, 5), b.guest_name, b.spa_treatments?.name ?? '', b.therapists?.name ?? '', b.duration, b.status, b.source, b.price]))
    }
    downloadCsv(`tonmai-report-bookings_${startDate}_to_${endDate}.csv`, lines.join('\n'))
  }

  const statusColor = { pending: '#C4924A', confirmed: '#3B5249', completed: '#6E8B7F', cancelled: '#B04A4A' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>Bookings</h2>
          <button onClick={exportCsv} disabled={loading || bookings.length === 0} style={{ ...btnPrimary, opacity: (loading || bookings.length === 0) ? 0.6 : 1 }}>⬇ Export CSV</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{BOOKING_STATUS_LABELS[s] ?? s}</option>)}
          </select>
          <select className="input" value={source} onChange={e => setSource(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="">All sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={treatmentId} onChange={e => setTreatmentId(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">All treatments</option>
            {treatments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="input" value={therapistId} onChange={e => setTherapistId(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All therapists</option>
            {therapists.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div style={{ font: '400 12px Inter,sans-serif', color: '#9B9390', marginTop: 10 }}>
          {loading ? 'Loading…' : `${bookings.length} booking${bookings.length === 1 ? '' : 's'}`}
          {truncated && ` — showing the first 1000; narrow the filters or period to see fewer.`}
        </div>
        {error && <p style={{ color: '#DC2626', font: '400 12px Inter,sans-serif', marginTop: 8 }}>{error}</p>}

        {!loading && bookings.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 14, maxHeight: 480, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Date</th><th style={th}>Guest</th><th style={th}>Treatment</th>
                  <th style={th}>Therapist</th><th style={th}>Status</th><th style={th}>Source</th>
                  <th style={{ ...th, textAlign: 'right' }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => (
                  <tr key={b.id}>
                    <td style={td}>{b.date} {b.time_slot?.slice(0, 5)}</td>
                    <td style={td}>{b.guest_name}</td>
                    <td style={td}>{b.spa_treatments?.name ?? '—'}</td>
                    <td style={td}>{b.therapists?.name ?? '—'}</td>
                    <td style={{ ...td, color: statusColor[b.status] ?? '#1C1917', textTransform: 'capitalize' }}>{b.status}</td>
                    <td style={{ ...td, textTransform: 'capitalize' }}>{b.source}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{b.price != null ? money(b.price) : '—'}</td>
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
