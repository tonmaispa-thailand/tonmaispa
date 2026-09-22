'use client'

// New-booking alarm — sits in the dashboard layout (mounted on every page,
// for every logged-in role) so it's alive for as long as the backoffice is
// open, per the spec: a booking that arrived without staff already knowing
// about it (guest-placed online, or the chatbot) keeps the alarm looping
// until staff presses Confirm or Cancel on it — there is no snooze/dismiss.
// Bookings staff enter themselves never appear here (see migration 036 /
// app/api/admin/bookings/alarm's own comment for why status/source alone
// aren't reliable enough signals on their own).
import { useState, useEffect, useRef, useCallback } from 'react'
import { createAlarmPlayer } from '@/lib/booking-alarm-sound'

const POLL_MS = 7000
const ORIGINAL_TITLE = typeof document !== 'undefined' ? document.title : ''

export default function BookingAlarmBar({ initialBookings, initialEnabled, initialVolume }) {
  const [bookings, setBookings] = useState(initialBookings)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [volume, setVolume] = useState(initialVolume)
  const [needsGesture, setNeedsGesture] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({}) // id -> message

  const playerRef = useRef(null)
  const requestIdRef = useRef(0)

  if (!playerRef.current && typeof window !== 'undefined') {
    playerRef.current = createAlarmPlayer()
  }

  const poll = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const res = await fetch('/api/admin/bookings/alarm')
      if (!res.ok) return // a transient 401/500 shouldn't wipe the current list — try again next tick
      const data = await res.json()
      if (requestId !== requestIdRef.current) return // a newer poll has since superseded this one
      setBookings(data.bookings)
      setEnabled(data.enabled)
      setVolume(data.volume)
    } catch {
      // network hiccup — silently retry on the next tick rather than
      // surfacing a persistent error banner for something this transient
    }
  }, [])

  // Deliberately NOT gated on document.visibilityState (unlike this app's
  // other polling, e.g. Conversations) — the entire point of an audio alarm
  // is to notify staff even when this tab isn't the one they're looking at.
  useEffect(() => {
    const interval = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(interval)
  }, [poll])

  // Sound lifecycle: on exactly when there's something to alert about AND
  // the owner/super_admin hasn't turned it off from Settings.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    player.setVolume(volume)
    if (bookings.length > 0 && enabled) {
      player.start()
      setNeedsGesture(player.isSuspended())
    } else {
      player.stop()
      setNeedsGesture(false)
    }
    return () => player.stop()
  }, [bookings.length, enabled, volume])

  // Browser tab title — catches attention even when this tab isn't focused
  // at all (a different app entirely, not just a different browser tab).
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = bookings.length > 0 && enabled ? `🔔 (${bookings.length}) ${ORIGINAL_TITLE}` : ORIGINAL_TITLE
    return () => { document.title = ORIGINAL_TITLE }
  }, [bookings.length, enabled])

  const enableSound = async () => {
    await playerRef.current?.resume()
    setNeedsGesture(false)
  }

  const resolve = async (id, status) => {
    setBusyId(id)
    setRowError(prev => { const next = { ...prev }; delete next[id]; return next })
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not update this booking')
      // Optimistically drop it now rather than waiting up to POLL_MS for the
      // next tick — the sound/title effects above react to bookings.length
      // immediately, so this is what actually stops the alarm on click.
      setBookings(prev => prev.filter(b => b.id !== id))
      // Invalidate any poll already in flight: its server-side read may have
      // run BEFORE this PATCH committed, so its response (arriving after
      // this optimistic removal) could still contain this row and resurrect
      // it — silently restarting the alarm for a booking staff just
      // resolved, for up to POLL_MS until the next tick self-corrects.
      // Bumping requestIdRef makes poll()'s own staleness check discard that
      // response instead of applying it.
      requestIdRef.current++
    } catch (err) {
      setRowError(prev => ({ ...prev, [id]: err.message }))
    } finally {
      setBusyId(null)
    }
  }

  if (bookings.length === 0 || !enabled) return null

  return (
    <div style={{ background: '#8A2E2E', color: '#fff', padding: '10px 20px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ font: '600 13px Inter,sans-serif' }}>
          🔔 {bookings.length} new booking{bookings.length === 1 ? '' : 's'} waiting — confirm or cancel to stop the alert
        </span>
        {needsGesture && (
          <button onClick={enableSound} style={{ background: '#fff', color: '#8A2E2E', border: 'none', borderRadius: 4, padding: '4px 10px', font: '600 11px Inter,sans-serif', cursor: 'pointer' }}>
            🔇 Click to enable sound
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bookings.map(b => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '6px 10px' }}>
            <span style={{ font: '400 12px Inter,sans-serif' }}>
              <strong>{b.guest_name}</strong> · {b.spa_treatments?.name ?? 'Unknown treatment'} · {b.date} {b.time_slot?.slice(0, 5)} · {b.ref_code}
            </span>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button onClick={() => resolve(b.id, 'confirmed')} disabled={busyId === b.id}
                style={{ background: '#3B5249', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 12px', font: '600 11px Inter,sans-serif', cursor: busyId === b.id ? 'wait' : 'pointer', opacity: busyId === b.id ? 0.6 : 1 }}>
                Confirm
              </button>
              <button onClick={() => resolve(b.id, 'cancelled')} disabled={busyId === b.id}
                style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', borderRadius: 4, padding: '4px 12px', font: '600 11px Inter,sans-serif', cursor: busyId === b.id ? 'wait' : 'pointer', opacity: busyId === b.id ? 0.6 : 1 }}>
                Cancel
              </button>
            </div>
            {rowError[b.id] && <span style={{ font: '400 11px Inter,sans-serif', color: '#FFD7D7', width: '100%' }}>{rowError[b.id]}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
