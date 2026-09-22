'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

const SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
const MONTHS  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS    = ['M','T','W','T','F','S','S']

// ── Turnstile widget ──────────────────────────────────────────────────────────
function TurnstileWidget({ onToken }) {
  const containerRef = useRef(null)
  const widgetId     = useRef(null)
  const cbRef        = useRef(onToken)
  cbRef.current      = onToken
  const [nearViewport, setNearViewport] = useState(false)

  // Cloudflare's Turnstile script + iframe are heavy — only fetch them once
  // this widget is about to scroll into view, not the moment the booking
  // engine mounts (which happens on every homepage load).
  useEffect(() => {
    if (!containerRef.current) return
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearViewport(true); io.disconnect() }
    }, { rootMargin: '600px' })
    io.observe(containerRef.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!SITEKEY || !nearViewport) return
    const render = () => {
      if (window.turnstile && containerRef.current && widgetId.current == null) {
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey:            SITEKEY,
          callback:           (t) => cbRef.current(t),
          'expired-callback': () => cbRef.current(''),
        })
      }
    }
    if (window.turnstile) { render() }
    else {
      const s = document.createElement('script')
      s.src    = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async  = true
      s.onload = render
      document.head.appendChild(s)
    }
    return () => {
      if (widgetId.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetId.current) } catch (_) {}
        widgetId.current = null
      }
    }
  }, [nearViewport])

  if (!SITEKEY) return null
  return <div ref={containerRef} style={{ marginTop: 4 }} />
}

// ── Mini calendar ─────────────────────────────────────────────────────────────
function Calendar({ year, month, selected, onSelect }) {
  const today   = new Date(); today.setHours(0,0,0,0)
  const maxDate = new Date(today); maxDate.setDate(today.getDate() + 90)

  const firstDay = new Date(year, month, 1)
  const startDay = new Date(firstDay)
  const dow0     = firstDay.getDay()
  startDay.setDate(firstDay.getDate() - (dow0 === 0 ? 6 : dow0 - 1))

  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startDay); d.setDate(startDay.getDate() + i); return d
  })

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {DAYS.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', font: '600 10px Inter,sans-serif', letterSpacing: 1, color: '#6E6963', padding: '6px 0' }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth  = d.getMonth() === month
          const isPast   = d < today
          const isFuture = d > maxDate
          const dateStr  = d.toISOString().split('T')[0]
          const isSel    = dateStr === selected
          const disabled = isPast || isFuture || !inMonth

          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(dateStr)}
              style={{
                padding: '7px 2px', borderRadius: 4, border: 'none',
                font: '400 13px Inter,sans-serif',
                background: isSel ? '#3B5249' : 'transparent',
                color:      isSel ? '#fff' : disabled ? (inMonth ? '#C8C3BC' : 'transparent') : '#1C1917',
                cursor:     disabled ? 'default' : 'pointer',
                transition: 'background 150ms',
              }}
            >
              {inMonth ? d.getDate() : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const inputSt = { width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1px solid #D6D0C8', borderRadius: 2, font: '400 14px Inter,sans-serif', color: '#1C1917', background: '#fff', outline: 'none', fontFamily: 'Inter, sans-serif' }
const labelSt = { display: 'block', font: '600 10px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase', color: '#6B6663', marginBottom: 6 }
const stepBtnSt = (active) => ({ background: active ? '#3B5249' : '#FAF6F0', color: active ? '#fff' : '#1C1917', border: '1px solid #D6D0C8', padding: '12px 20px', borderRadius: 2, font: '600 11px Inter,sans-serif', letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer' })

// ── Main component ────────────────────────────────────────────────────────────
export default function BookingEngine({ presetSlug }) {
  const supabase = createClientComponentClient()

  const [step, setStep]               = useState(1)
  const [treatments, setTreatments]   = useState([])
  const [popularTreatmentIds, setPopularTreatmentIds] = useState([])
  const [loadingTx, setLoadingTx]     = useState(true)

  // Step 1: treatment + duration
  const [treatment, setTreatment]     = useState(null)
  const [duration, setDuration]       = useState(null)
  // When arriving from a specific treatment's "Book This Treatment" button,
  // step 1 locks to just that treatment + add-on upsells instead of showing
  // the full service list.
  const [locked, setLocked]           = useState(!!presetSlug)
  const [selectedAddonIds, setSelectedAddonIds] = useState([])

  // Step 2: date + time
  const [calYear, setCalYear]         = useState(new Date().getFullYear())
  const [calMonth, setCalMonth]       = useState(new Date().getMonth())
  const [selDate, setSelDate]         = useState('')
  const [slots, setSlots]             = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selSlot, setSelSlot]         = useState('')

  // Step 3: guest details
  const [guestName, setGuestName]     = useState('')
  const [guestPhone, setGuestPhone]   = useState('')
  const [guestEmail, setGuestEmail]   = useState('')
  const [notes, setNotes]             = useState('')
  const [token, setToken]             = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [errMsg, setErrMsg]           = useState('')

  // Step 4: confirmation
  const [refCode, setRefCode]         = useState('')

  // Fetch treatments on mount
  useEffect(() => {
    Promise.all([
      supabase.from('spa_treatments')
        .select('id, slug, name, category, description, duration_options, prices, badge, is_featured')
        .eq('is_active', true)
        .order('sort_order'),
      fetch('/api/bookings/popular-treatments')
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
    ]).then(([{ data }, popularity]) => {
        const list = data ?? []
        setTreatments(list)
        setPopularTreatmentIds(popularity?.treatment_ids ?? [])
        setLoadingTx(false)
        if (presetSlug) {
          const preset = list.find(t => t.slug === presetSlug)
          if (preset) {
            setTreatment(preset)
            setDuration(preset.duration_options?.[0] ?? 60)
          } else {
            setLocked(false) // bad/unknown slug — fall back to the full picker
          }
        }
      })
  }, [supabase, presetSlug])

  const addOns = treatments.filter(t => t.category === 'add_on' && t.id !== treatment?.id)
  // Build the five-item shortlist shown in "Choose a treatment", in priority
  // order (first match wins, no duplicates, capped at five):
  //   1. Owner-pinned `is_featured` treatments — a deliberate override so a new
  //      or promoted service can jump the queue even with no booking history.
  //   2. Auto best-sellers from the rolling 45-day window (popularTreatmentIds).
  //   3. Anything left, to top the list up to five.
  // `treatments` arrives already sorted by sort_order, so featured and the
  // top-up fill in menu order. With nothing pinned this reduces to exactly the
  // previous behaviour ([...popular, ...rest].slice(0, 5)).
  const bestSellingTreatments = useMemo(() => {
    const eligible = treatments.filter(t => t.category !== 'add_on')
    const byId = new Map(eligible.map(t => [t.id, t]))
    const featured = eligible.filter(t => t.is_featured)
    const popular = popularTreatmentIds.map(id => byId.get(id)).filter(Boolean)
    const seen = new Set()
    const result = []
    for (const t of [...featured, ...popular, ...eligible]) {
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      result.push(t)
      if (result.length === 5) break
    }
    return result
  }, [treatments, popularTreatmentIds])
  const toggleAddon = (id) => setSelectedAddonIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  // Fetch slots when date changes. A request counter guards against
  // out-of-order responses — if the user changes treatment/duration again
  // before an in-flight fetch resolves, a stale reply must never overwrite
  // a newer one (or a newer request's loading state).
  const slotsRequestId = useRef(0)
  const fetchSlots = useCallback(async (date) => {
    if (!treatment || !duration) return
    const requestId = ++slotsRequestId.current
    setSlotsLoading(true)
    setSelSlot('')
    try {
      // Add-ons lengthen the visit, so the slot grid must be asked for the
      // full span — otherwise we'd show a time that the booking POST rejects.
      const addonParam = selectedAddonIds.length ? `&addon_ids=${selectedAddonIds.join(',')}` : ''
      const res  = await fetch(`/api/bookings/availability?date=${date}&treatment_id=${treatment.id}&duration=${duration}${addonParam}`)
      const json = await res.json()
      if (requestId !== slotsRequestId.current) return // a newer request has since superseded this one
      setSlots(json.slots ?? [])
    } catch {
      if (requestId === slotsRequestId.current) setSlots([])
    } finally {
      if (requestId === slotsRequestId.current) setSlotsLoading(false)
    }
  }, [treatment, duration, selectedAddonIds])

  const handleDateSelect = async (date) => {
    setSelDate(date)
    await fetchSlots(date)
  }

  // If the guest already picked a date, then goes back and changes the
  // treatment, duration or add-ons, the previously-fetched slots are for the
  // wrong window and must never be shown as if they still applied — refetch.
  useEffect(() => {
    if (selDate) fetchSlots(selDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatment?.id, duration, selectedAddonIds.join(',')])

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  const selectedAddons = addOns.filter(a => selectedAddonIds.includes(a.id))
  // Mirror of the server's sum (lib/booking-addons.js). The server stays the
  // source of truth for what is charged; this only has to agree with it, so
  // the guest is never shown a total that the booking doesn't contain.
  const addonMinutesTotal = selectedAddons.reduce((sum, a) => sum + (a.duration_options?.[0] ?? 0), 0)
  const addonPriceTotal   = selectedAddons.reduce((sum, a) => sum + (a.prices?.[String(a.duration_options?.[0])] ?? 0), 0)
  const basePrice         = treatment?.prices?.[String(duration)] ?? null
  const totalPrice        = basePrice == null ? null : basePrice + addonPriceTotal
  const totalMinutes      = duration + addonMinutesTotal

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setErrMsg('')
    try {
      // Add-ons are real line items now: send ids only and let the server
      // re-read their minutes and price from the catalog (lib/booking-addons).
      const res  = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          guest_name:     guestName,
          guest_phone:    guestPhone,
          guest_email:    guestEmail,
          treatment_id:   treatment.id,
          date:           selDate,
          time_slot:      selSlot,
          duration,
          addon_ids:      selectedAddonIds,
          notes:          notes || undefined,
          turnstileToken: token || 'dev-bypass',
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Something went wrong')
      setRefCode(json.refCode)
      setStep(4)
      // Report the real basket value, add-ons included.
      if (window.gtag) window.gtag('event', 'booking_complete', { treatment: treatment.name, duration: totalMinutes, value: totalPrice ?? 0 })
    } catch (err) {
      setErrMsg(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const formatDate = (d) => {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`
  }

  // ── Step indicators ────────────────────────────────────────────────────────
  const StepBar = () => (
    <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
      {['Treatment','Date & Time','Your Details'].map((label, i) => {
        const n = i + 1
        const done = step > n
        const active = step === n
        return (
          <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, cursor: done ? 'pointer' : 'default' }}
            onClick={() => done && setStep(n)}>
            <div style={{ height: 3, borderRadius: 2, background: done || active ? '#3B5249' : '#E5E0D8', transition: 'background 300ms' }} />
            <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: done || active ? '#3B5249' : '#6E6963' }}>{label}</div>
          </div>
        )
      })}
    </div>
  )

  // ── Step 1: Select treatment ───────────────────────────────────────────────
  if (step === 1) return (
    <div>
      <StepBar />
      <h3 style={{ font: '400 26px Cormorant Garamond,serif', color: '#1C1917', margin: '0 0 20px' }}>
        {locked ? 'Your treatment' : 'Choose a treatment'}
      </h3>
      {loadingTx ? (
        <p style={{ font: '400 14px Inter,sans-serif', color: '#9B9390' }}>Loading treatments…</p>
      ) : locked && treatment ? (
        <>
          {/* Locked-in treatment card — arrived here via "Book This Treatment",
              so no other services are shown, only this one + add-on upsells. */}
          <div style={{ padding: '16px 18px', border: '1.5px solid #3B5249', borderRadius: 4, background: '#F0F4F2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase', color: '#3B5249' }}>{treatment.category}</div>
                <div style={{ font: '400 18px Cormorant Garamond,serif', color: '#1C1917', marginTop: 2 }}>{treatment.name}</div>
              </div>
              {treatment.badge && <span style={{ background: '#8A6528', color: '#fff', padding: '3px 10px', borderRadius: 999, font: '600 9px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase' }}>{treatment.badge}</span>}
            </div>
            {treatment.description && <p style={{ font: '400 13px/1.5 Inter,sans-serif', color: '#6B6663', margin: '8px 0 0' }}>{treatment.description}</p>}
            {treatment.duration_options && (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {treatment.duration_options.map(dur => (
                  <button key={dur} type="button" onClick={() => setDuration(dur)}
                    style={{ padding: '7px 14px', borderRadius: 2, border: `1.5px solid ${duration === dur ? '#3B5249' : '#D6D0C8'}`, background: duration === dur ? '#3B5249' : '#fff', color: duration === dur ? '#fff' : '#1C1917', font: `600 11px Inter,sans-serif`, cursor: 'pointer' }}>
                    {dur} min {treatment.prices?.[String(dur)] ? `· ฿${treatment.prices[String(dur)]}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setLocked(false)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: '#9B9390', font: '400 12px Inter,sans-serif', textDecoration: 'underline', cursor: 'pointer' }}>
            Choose a different treatment
          </button>

          {addOns.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase', color: '#6B6663', marginBottom: 10 }}>Add to your visit</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {addOns.map(a => {
                  const checked = selectedAddonIds.includes(a.id)
                  const price = a.prices?.[String(a.duration_options?.[0])]
                  return (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: `1.5px solid ${checked ? '#C4924A' : '#E5E0D8'}`, borderRadius: 4, cursor: 'pointer', background: checked ? '#FBF3E7' : '#fff' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAddon(a.id)} style={{ width: 16, height: 16, accentColor: '#C4924A' }} />
                      <span style={{ flex: 1, font: '400 14px Inter,sans-serif', color: '#1C1917' }}>{a.name}</span>
                      {price && <span style={{ font: '600 13px Inter,sans-serif', color: '#6B6663' }}>+฿{price}</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div data-testid="booking-treatment-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bestSellingTreatments.map(t => {
            const sel = treatment?.id === t.id
            return (
              <div key={t.id} data-testid="booking-treatment-card"
                onClick={() => { setTreatment(t); setDuration(t.duration_options?.[0] ?? 60) }}
                style={{ padding: '16px 18px', border: `1.5px solid ${sel ? '#3B5249' : '#E5E0D8'}`, borderRadius: 4, cursor: 'pointer', background: sel ? '#F0F4F2' : '#fff', transition: 'all 200ms' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase', color: '#3B5249' }}>{t.category}</div>
                    <div style={{ font: '400 18px Cormorant Garamond,serif', color: '#1C1917', marginTop: 2 }}>{t.name}</div>
                  </div>
                  {t.badge && <span style={{ background: '#8A6528', color: '#fff', padding: '3px 10px', borderRadius: 999, font: '600 9px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase' }}>{t.badge}</span>}
                </div>
                {t.description && <p style={{ font: '400 13px/1.5 Inter,sans-serif', color: '#6B6663', margin: '8px 0 0' }}>{t.description}</p>}
                {sel && t.duration_options && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    {t.duration_options.map(dur => (
                      <button key={dur} type="button" onClick={e => { e.stopPropagation(); setDuration(dur) }}
                        style={{ padding: '7px 14px', borderRadius: 2, border: `1.5px solid ${duration === dur ? '#3B5249' : '#D6D0C8'}`, background: duration === dur ? '#3B5249' : '#fff', color: duration === dur ? '#fff' : '#1C1917', font: `600 11px Inter,sans-serif`, cursor: 'pointer' }}>
                        {dur} min {t.prices?.[String(dur)] ? `· ฿${t.prices[String(dur)]}` : ''}
                      </button>
                    ))}
                  </div>
                )}
                {sel && (
                  <button
                    data-testid="booking-treatment-continue"
                    type="button"
                    onClick={e => { e.stopPropagation(); setStep(2) }}
                    style={{ ...stepBtnSt(true), width: '100%', marginTop: 14 }}
                  >
                    Book this treatment →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {locked && (
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={!treatment} onClick={() => setStep(2)} style={{ ...stepBtnSt(true), opacity: treatment ? 1 : 0.4 }}>
            Next: Pick a Date →
          </button>
        </div>
      )}
    </div>
  )

  // ── Step 2: Date + time ────────────────────────────────────────────────────
  if (step === 2) return (
    <div>
      <StepBar />
      <h3 style={{ font: '400 26px Cormorant Garamond,serif', color: '#1C1917', margin: '0 0 4px' }}>
        {treatment?.name} · {duration} min
      </h3>
      <p style={{ font: '400 14px Inter,sans-serif', color: '#9B9390', margin: '0 0 20px' }}>Select a date and time</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 24 }}>
        {/* Calendar */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <button type="button" onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', font: '400 18px Inter,sans-serif', color: '#3B5249', padding: '4px 8px' }}>‹</button>
            <div style={{ font: '600 13px Inter,sans-serif', letterSpacing: 1, textTransform: 'uppercase', color: '#1C1917' }}>{MONTHS[calMonth]} {calYear}</div>
            <button type="button" onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', font: '400 18px Inter,sans-serif', color: '#3B5249', padding: '4px 8px' }}>›</button>
          </div>
          <Calendar year={calYear} month={calMonth} selected={selDate} onSelect={handleDateSelect} />
        </div>

        {/* Time slots */}
        <div>
          {!selDate ? (
            <p style={{ font: '400 14px Inter,sans-serif', color: '#9B9390', marginTop: 8 }}>← Pick a date to see available times</p>
          ) : slotsLoading ? (
            <p style={{ font: '400 14px Inter,sans-serif', color: '#9B9390' }}>Loading times…</p>
          ) : !slots.length ? (
            <p style={{ font: '400 14px Inter,sans-serif', color: '#9B9390' }}>No available times on {formatDate(selDate)}. Try another date.</p>
          ) : (
            <>
              <div style={{ font: '600 10px Inter,sans-serif', letterSpacing: 1.5, textTransform: 'uppercase', color: '#6B6663', marginBottom: 10 }}>
                {formatDate(selDate)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                {slots.map(s => {
                  const isSel = selSlot === s.time
                  return (
                    <button key={s.time} type="button" disabled={!s.available}
                      onClick={() => setSelSlot(s.time)}
                      style={{ padding: '10px 6px', borderRadius: 2, border: `1.5px solid ${isSel ? '#3B5249' : s.available ? '#D6D0C8' : '#EEDFD0'}`, background: isSel ? '#3B5249' : s.available ? '#fff' : '#FAFAFA', color: isSel ? '#fff' : s.available ? '#1C1917' : '#C8C3BC', font: '400 13px Inter,sans-serif', cursor: s.available ? 'pointer' : 'default', transition: 'all 150ms', textAlign: 'center' }}>
                      {s.time}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'space-between' }}>
        <button type="button" onClick={() => setStep(1)} style={stepBtnSt(false)}>← Back</button>
        <button type="button" disabled={!selSlot} onClick={() => setStep(3)} style={{ ...stepBtnSt(true), opacity: selSlot ? 1 : 0.4 }}>
          Next: Your Details →
        </button>
      </div>
    </div>
  )

  // ── Step 3: Guest details ──────────────────────────────────────────────────
  if (step === 3) return (
    <form onSubmit={handleSubmit} noValidate>
      <StepBar />
      <h3 style={{ font: '400 26px Cormorant Garamond,serif', color: '#1C1917', margin: '0 0 6px' }}>Your details</h3>
      <div style={{ font: '400 13px Inter,sans-serif', color: '#9B9390', marginBottom: 20 }}>
        {treatment?.name} · {totalMinutes} min · {formatDate(selDate)} at {selSlot}
        {selectedAddons.length > 0 && (
          <>
            <br />+ {selectedAddons.map(a => a.name).join(', ')}
            {totalPrice != null && <> · total ฿{totalPrice.toLocaleString()}</>}
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="bk-name" style={labelSt}>Full name</label>
          <input id="bk-name" type="text" required minLength={2} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="e.g. Sarah Johnson" style={inputSt} />
        </div>
        <div>
          <label htmlFor="bk-phone" style={labelSt}>WhatsApp / mobile</label>
          <input id="bk-phone" type="tel" required value={guestPhone} onChange={e => setGuestPhone(e.target.value)} placeholder="+66 63 117 5211" style={inputSt} />
        </div>
        <div>
          <label htmlFor="bk-email" style={labelSt}>Email <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional — for confirmation)</span></label>
          <input id="bk-email" type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} placeholder="you@email.com" style={inputSt} />
        </div>
        <div>
          <label htmlFor="bk-notes" style={labelSt}>Special requests <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></label>
          <textarea id="bk-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Allergies, preferred pressure, therapist gender preference…" style={{ ...inputSt, resize: 'vertical' }} />
        </div>

        <TurnstileWidget onToken={setToken} />

        {errMsg && <p role="alert" style={{ font: '400 13px Inter,sans-serif', color: '#C0392B', margin: 0 }}>{errMsg}</p>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'space-between' }}>
        <button type="button" onClick={() => setStep(2)} style={stepBtnSt(false)}>← Back</button>
        <button type="submit" disabled={submitting} style={{ ...stepBtnSt(true), opacity: submitting ? 0.7 : 1, cursor: submitting ? 'wait' : 'pointer' }}>
          {submitting ? 'Confirming…' : 'Confirm Booking'}
        </button>
      </div>
    </form>
  )

  // ── Step 4: Confirmed ──────────────────────────────────────────────────────
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#3B5249', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h3 style={{ font: '400 30px Cormorant Garamond,serif', color: '#1C1917', margin: '16px 0 0' }}>Booking confirmed</h3>
      <div style={{ font: '400 32px/1 Cormorant Garamond,serif', color: '#3B5249', margin: '12px 0', letterSpacing: 2 }}>{refCode}</div>
      <p style={{ font: '400 14px/1.7 Inter,sans-serif', color: '#6B6663', maxWidth: '34ch', margin: '0 auto' }}>
        {treatment?.name} · {duration} min<br />
        {selectedAddons.length > 0 && <>+ {selectedAddons.map(a => a.name).join(', ')}<br /></>}
        {formatDate(selDate)} at {selSlot}<br /><br />
        We will send a WhatsApp confirmation within minutes.
      </p>
      <button type="button" onClick={() => { setStep(1); setTreatment(null); setDuration(null); setSelDate(''); setSelSlot(''); setGuestName(''); setGuestPhone(''); setGuestEmail(''); setNotes(''); setToken(''); setRefCode(''); setSelectedAddonIds([]); setLocked(false) }}
        style={{ marginTop: 20, ...stepBtnSt(false) }}>
        Make Another Booking
      </button>
    </div>
  )
}
