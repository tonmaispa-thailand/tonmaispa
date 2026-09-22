// Revenue & Marketing Advisor — aggregates real booking/marketing-funnel
// data into compact, PII-free JSON and asks MiniMax for grounded, specific
// recommendations. Never send raw booking rows, guest names/phones/emails,
// or chat transcripts to the AI — only counts, sums, and business-level
// labels (treatment/category/therapist names, topic tags).
import { timeToMin } from './scheduling'
import { generateWithSelfCritique } from './ai-critique'

const FORWARD_WINDOW_DAYS = 90 // matches the public booking calendar's own horizon

function toYMD(d) {
  return d.toISOString().slice(0, 10)
}

function shiftMinutes(shift) {
  let mins = timeToMin(shift.end_time.slice(0, 5)) - timeToMin(shift.start_time.slice(0, 5))
  if (shift.break_start && shift.break_end) {
    mins -= timeToMin(shift.break_end.slice(0, 5)) - timeToMin(shift.break_start.slice(0, 5))
  }
  return Math.max(0, mins)
}

// ── Revenue summary — realized revenue for a historical period ─────────────
export async function getRevenueSummary(admin, { startDate, endDate }) {
  const [{ data: completed }, { data: cancelled }, { data: allInRange }] = await Promise.all([
    admin.from('bookings')
      .select('price, date, source, treatment_id, spa_treatments(name, category)')
      .eq('status', 'completed').gte('date', startDate).lte('date', endDate),
    admin.from('bookings').select('id').eq('status', 'cancelled').gte('date', startDate).lte('date', endDate),
    admin.from('bookings').select('id').gte('date', startDate).lte('date', endDate),
  ])

  const rows = completed ?? []
  const totalRevenue = rows.reduce((s, r) => s + (r.price ?? 0), 0)
  const bookingCount = rows.length

  const dailyTrend = {}
  const byTreatment = {}
  const byCategory = {}
  const bySource = {}
  for (const r of rows) {
    dailyTrend[r.date] = (dailyTrend[r.date] ?? 0) + (r.price ?? 0)
    const name = r.spa_treatments?.name ?? 'Unknown'
    const cat  = r.spa_treatments?.category ?? 'unknown'
    ;(byTreatment[name] ??= { revenue: 0, count: 0 }); byTreatment[name].revenue += r.price ?? 0; byTreatment[name].count += 1
    ;(byCategory[cat]  ??= { revenue: 0, count: 0 }); byCategory[cat].revenue += r.price ?? 0; byCategory[cat].count += 1
    ;(bySource[r.source] ??= { revenue: 0, count: 0 }); bySource[r.source].revenue += r.price ?? 0; bySource[r.source].count += 1
  }

  return {
    periodStart: startDate,
    periodEnd: endDate,
    totalRevenue,
    bookingCount,
    avgBookingValue: bookingCount ? Math.round(totalRevenue / bookingCount) : 0,
    cancellationRate: allInRange?.length ? +((cancelled?.length ?? 0) / allInRange.length * 100).toFixed(1) : 0,
    dailyTrend,
    byTreatment,
    byCategory,
    bySource,
  }
}

// ── Therapist utilization — booked time vs. scheduled time ─────────────────
export async function getTherapistUtilizationSummary(admin, { startDate, endDate }) {
  const [{ data: therapists }, { data: shifts }, { data: bookings }] = await Promise.all([
    admin.from('therapists').select('id, name').eq('is_active', true),
    admin.from('therapist_shifts').select('therapist_id, start_time, end_time, break_start, break_end').gte('date', startDate).lte('date', endDate),
    admin.from('bookings').select('therapist_id, secondary_therapist_id, duration').in('status', ['completed', 'confirmed']).gte('date', startDate).lte('date', endDate),
  ])

  const scheduledMin = {}
  for (const s of shifts ?? []) scheduledMin[s.therapist_id] = (scheduledMin[s.therapist_id] ?? 0) + shiftMinutes(s)

  const bookedMin = {}
  for (const b of bookings ?? []) {
    if (b.therapist_id) bookedMin[b.therapist_id] = (bookedMin[b.therapist_id] ?? 0) + b.duration
    if (b.secondary_therapist_id) bookedMin[b.secondary_therapist_id] = (bookedMin[b.secondary_therapist_id] ?? 0) + b.duration
  }

  return (therapists ?? []).map(t => {
    const scheduled = scheduledMin[t.id] ?? 0
    const booked = bookedMin[t.id] ?? 0
    return {
      id: t.id, // additive — existing consumers (Insights chart) only read name/*Hours/occupancyPct
      name: t.name,
      scheduledHours: +(scheduled / 60).toFixed(1),
      bookedHours: +(booked / 60).toFixed(1),
      occupancyPct: scheduled ? +(booked / scheduled * 100).toFixed(1) : 0,
    }
  })
}

// ── Therapist × treatment breakdown — realized revenue only ────────────────
// Deliberately a separate function from getTherapistUtilizationSummary rather
// than folding this in: occupancy above intentionally blends confirmed +
// completed bookings (booked time, whether or not it's been paid out yet),
// while "revenue generated" and "treatments performed" below count only
// completed bookings — the same realized-revenue rule getRevenueSummary uses.
// Mixing the two status sets into one function would make that rule invisible
// to callers. Revenue/count are attributed to the PRIMARY therapist only: a
// booking has one price for the whole visit, so crediting a secondary/assist
// therapist too would double-count revenue in any report that sums this list.
export async function getTherapistTreatmentBreakdown(admin, { startDate, endDate }) {
  const [{ data: therapists }, { data: bookings }] = await Promise.all([
    admin.from('therapists').select('id, name').eq('is_active', true),
    admin.from('bookings')
      .select('therapist_id, price, spa_treatments(name)')
      .eq('status', 'completed').gte('date', startDate).lte('date', endDate),
  ])

  const byTherapist = new Map((therapists ?? []).map(t => [t.id, { id: t.id, name: t.name, bookingCount: 0, revenue: 0, treatments: new Map() }]))

  for (const b of bookings ?? []) {
    const entry = b.therapist_id ? byTherapist.get(b.therapist_id) : null
    if (!entry) continue // therapist deactivated since, or booking has no therapist assigned
    entry.bookingCount += 1
    entry.revenue += b.price ?? 0
    const name = b.spa_treatments?.name ?? 'Unknown'
    const t = entry.treatments.get(name) ?? { name, count: 0, revenue: 0 }
    t.count += 1
    t.revenue += b.price ?? 0
    entry.treatments.set(name, t)
  }

  return [...byTherapist.values()]
    .map(e => ({ ...e, treatments: [...e.treatments.values()].sort((a, b) => b.revenue - a.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)
}

// ── Forward bookings — everything already on the books, next 90 days ───────
export async function getForwardBookingSummary(admin) {
  const today = new Date()
  const todayStr = toYMD(today)
  const endDate = new Date(today); endDate.setDate(endDate.getDate() + FORWARD_WINDOW_DAYS)
  const endStr = toYMD(endDate)

  const [{ data: bookings }, { data: shifts }] = await Promise.all([
    admin.from('bookings').select('price, date, duration, therapist_id, secondary_therapist_id')
      .in('status', ['pending', 'confirmed']).gte('date', todayStr).lte('date', endStr),
    admin.from('therapist_shifts').select('date, start_time, end_time, break_start, break_end')
      .gte('date', todayStr).lte('date', endStr),
  ])

  const weekOf = (dateStr) => Math.floor((new Date(dateStr) - today) / (7 * 24 * 60 * 60 * 1000))

  const byWeek = {}
  for (const b of bookings ?? []) {
    const w = weekOf(b.date)
    const bucket = (byWeek[w] ??= { forecastRevenue: 0, bookingCount: 0, bookedMinutes: 0 })
    bucket.forecastRevenue += b.price ?? 0
    bucket.bookingCount += 1
    bucket.bookedMinutes += b.duration * (b.secondary_therapist_id ? 2 : 1)
  }
  for (const s of shifts ?? []) {
    const w = weekOf(s.date)
    const bucket = (byWeek[w] ??= { forecastRevenue: 0, bookingCount: 0, bookedMinutes: 0 })
    bucket.scheduledMinutes = (bucket.scheduledMinutes ?? 0) + shiftMinutes(s)
  }

  const weeks = Object.keys(byWeek).sort((a, b) => a - b).map(w => {
    const b = byWeek[w]
    return {
      weekOffset: Number(w), // 0 = this week, 1 = next week, etc.
      forecastRevenue: b.forecastRevenue,
      bookingCount: b.bookingCount,
      occupancyPct: b.scheduledMinutes ? +(b.bookedMinutes / b.scheduledMinutes * 100).toFixed(1) : 0,
    }
  })

  return {
    windowDays: FORWARD_WINDOW_DAYS,
    totalForecastRevenue: weeks.reduce((s, w) => s + w.forecastRevenue, 0),
    totalBookingCount: weeks.reduce((s, w) => s + w.bookingCount, 0),
    weeks,
  }
}

// ── Marketing funnel — enquiries + chatbot topic interest, no PII ──────────
export async function getMarketingFunnelSummary(admin, { startDate, endDate }) {
  const [{ data: enquiries }, { data: chats }, { data: bookingPhones }] = await Promise.all([
    admin.from('enquiries').select('phone, status, metadata').gte('created_at', startDate).lte('created_at', `${endDate}T23:59:59`),
    admin.from('chat_sessions').select('metadata').gte('created_at', startDate).lte('created_at', `${endDate}T23:59:59`),
    admin.from('bookings').select('guest_phone'),
  ])

  const bookedPhones = new Set((bookingPhones ?? []).map(b => b.guest_phone))
  const statusBreakdown = {}
  const treatmentInterest = {}
  let converted = 0
  for (const e of enquiries ?? []) {
    statusBreakdown[e.status] = (statusBreakdown[e.status] ?? 0) + 1
    const interest = e.metadata?.treatment_interest
    if (interest) treatmentInterest[interest] = (treatmentInterest[interest] ?? 0) + 1
    if (e.phone && bookedPhones.has(e.phone)) converted += 1
  }

  const chatInterests = {}
  const mentionedTreatments = {}
  const visitIntent = {}
  for (const c of chats ?? []) {
    for (const i of c.metadata?.interests ?? []) chatInterests[i] = (chatInterests[i] ?? 0) + 1
    for (const t of c.metadata?.mentioned_treatments ?? []) mentionedTreatments[t] = (mentionedTreatments[t] ?? 0) + 1
    if (c.metadata?.visit_intent) visitIntent[c.metadata.visit_intent] = (visitIntent[c.metadata.visit_intent] ?? 0) + 1
  }

  return {
    enquiryCount: enquiries?.length ?? 0,
    enquiryStatusBreakdown: statusBreakdown,
    enquiryTreatmentInterest: treatmentInterest,
    enquiryConversionRatePct: enquiries?.length ? +(converted / enquiries.length * 100).toFixed(1) : 0,
    chatSessionCount: chats?.length ?? 0,
    chatInterests,
    chatMentionedTreatments: mentionedTreatments,
    chatVisitIntent: visitIntent,
  }
}

// ── MiniMax call — structured, dual-perspective recommendations ────────────
// Runs the same 3-stage self-critique pipeline as the Campaign Planner
// (see lib/ai-critique.js): a draft pass, then an adversarial critique pass
// that hunts for figures not traceable to the real data, then a distill pass
// that produces the corrected final recommendations with a transparency
// trail of which claims are actual data vs. estimated.
const INSIGHTS_SCHEMA = `{
  "revenueInsights": [{"title": string, "detail": string (max 30 words, must cite a specific figure from the data), "suggestedAction": string (max 20 words), "priority": "high"|"medium"|"low"}] (3-5 items, ordered by priority),
  "marketingInsights": [{"title": string, "detail": string (max 30 words, must cite a specific figure from the data), "suggestedAction": string (max 20 words), "priority": "high"|"medium"|"low"}] (3-5 items, ordered by priority),
  "groundingNotes": [{"claim": string (max 15 words), "source": "actual data" | "estimated" | "industry standard"}] (4-6 items, distill stage only)
}`

function draftSystemPrompt() {
  return `You are advising the owner of Ton Mai Spa, a traditional Thai spa and garden restaurant in Rawai, Phuket. You have two areas of expertise: (1) hospitality revenue management — pricing, scheduling, therapist/room capacity utilization, and (2) marketing strategy for boutique spas — positioning, channel mix, conversion, guest acquisition, seasonality. You are given a JSON summary of real booking data for a historical period, forward (future) bookings already on the calendar, therapist utilization, and marketing funnel data (enquiries and chatbot conversation topic tags — no personal guest data). Analyze this data and return SPECIFIC, ACTIONABLE recommendations grounded in the actual numbers provided — cite concrete figures (revenue amounts, percentages, treatment/therapist names) from the data in every insight. Do not give generic spa advice; every insight must reference this business's actual data. Be concise — respect every word limit in the schema exactly, this is a hard constraint. Return ONLY valid JSON matching this exact schema, no other text, no markdown fences:
${INSIGHTS_SCHEMA}`
}

export async function generateRecommendations(aggregatedData) {
  const result = await generateWithSelfCritique({
    context: aggregatedData,
    draftSystemPrompt: draftSystemPrompt(),
    critiquePersona: 'You are a skeptical senior revenue-management and marketing auditor reviewing a junior consultant\'s recommendations before they reach the business owner.',
    distillInstructions: 'You are the same senior advisor for Ton Mai Spa, revising your own draft recommendations after an internal audit.',
  })
  if (!result) return null
  return {
    draftRecommendations: result.draft,
    critique: result.critique,
    finalRecommendations: result.final,
  }
}
