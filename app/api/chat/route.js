// ============================================================
// TON MAI SPA — /api/chat
// MiniMax-M3 chatbot — streaming, server-side, tool-capable
// System prompt built live from Supabase data every request
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAiClient }  from '@/lib/minimax'
import { checkRateLimit }             from '@/lib/ratelimit'
import { buildSystemPrompt, TOOLS_SIMPLE, TOOLS_FULL } from '@/lib/chatbot'
import { sendEmail, enquiryOwnerHtml } from '@/lib/brevo'
import { getAvailableSlots, getBookableTreatmentsAt } from '@/lib/scheduling'
import { chatMessageSchema } from '@/lib/schemas'
import { prepareModelMessages, prepareStoredMessages } from '@/lib/chat-history'
import {
  getRescheduleAvailability,
  listSessionBookings,
  prepareBookingDraft,
  prepareRescheduleDraft,
} from '@/lib/chat-booking'
import { recordWebExchange } from '@/lib/conversations'
import { getDictionary } from '@/lib/i18n/get-dictionary'

export const maxDuration = 60

export async function POST(req) {
  // ── 1. Rate limit — 30 messages per 10 min per IP ──────────
  const rl = await checkRateLimit(req, 'chat', { limit: 30, window: 600 })
  if (!rl.success) {
    const retryAfter = rl.retryAfter ?? 600
    return Response.json(
      {
        error: 'You have sent several messages in a short time. Please take a short pause, then try again.',
        retryAfter,
      },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  const body = await req.json()
  const parsed = chatMessageSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid chat message.' }, { status: 400 })
  }
  const { messages, sessionId } = parsed.data

  const admin = createSupabaseAdminClient()

  // ── 2. Load live spa data for system prompt ─────────────────
  const [treatmentsRes, settingsRes, blogRes, dict] = await Promise.all([
    admin.from('spa_treatments').select('*').eq('is_active', true).order('sort_order'),
    admin.from('site_content').select('key, value_text').eq('page', 'settings'),
    // Published blog guides — lets the bot answer "what should I eat before a
    // massage?"-type questions with a grounded pointer to the real article
    // instead of only a summary, and gives it exact URLs it may share.
    admin.from('blog_posts').select('title, slug').eq('is_published', true).order('publish_date', { ascending: false }).limit(30),
    // The real booking-page FAQ (cancellation policy, deposit, what to bring,
    // etc.) — always loaded in English as the single source of truth; the
    // model already translates every other fact into the guest's language on
    // its own, same as treatments/settings. Without this the bot could
    // neither invent nor state the real cancellation policy — it just went
    // silent on a question with a real, verified answer (found via knowledge
    // test, 2026-07-09).
    getDictionary('en'),
  ])

  const settings = Object.fromEntries(
    (settingsRes.data ?? []).map(r => [r.key, r.value_text])
  )
  // booking_engine_enabled is the master switch for the whole booking system;
  // chatbot_booking_mode ('simple' | 'full') decides whether the chatbot,
  // specifically, is allowed to check availability and create bookings
  // autonomously, or just captures a lead for staff follow-up. Both must be
  // true/'full' for the chatbot to get the full tool set.
  const bookingEngineEnabled = settings['settings.booking_engine_enabled'] === 'true'
  const chatbotFullMode = bookingEngineEnabled && settings['settings.chatbot_booking_mode'] === 'full'

  // ── 3. Build dynamic system prompt ─────────────────────────
  const systemPrompt = buildSystemPrompt({
    treatments: treatmentsRes.data ?? [],
    settings,
    bookingEngineEnabled: chatbotFullMode,
    blogPosts: blogRes.data ?? [],
    faq: dict.book?.faq ?? [],
  })

  const tools = chatbotFullMode ? TOOLS_FULL : TOOLS_SIMPLE

  // ── 4. Call MiniMax with streaming ─────────────────────────
  const ai = await getAiClient()
  if (!ai) {
    return Response.json({ error: 'AI service unavailable' }, { status: 503 })
  }
  const { client, model: aiModel } = ai

  // Bound both message count and total characters. A few long answers can be
  // more expensive than dozens of short turns, so count-only trimming is not
  // enough to protect the model context.
  const modelMessages = prepareModelMessages(messages)

  // ── 5. Stream response + run the tool-use loop ──────────────
  // Anthropic/MiniMax tool calling is a round-trip: the model emits a
  // tool_use block, we execute it, then we must send the result BACK to
  // the model in a follow-up call so it can write the actual answer.
  // Previously this route executed the tool and stopped — the model never
  // saw the result, so it just kept saying "let me check" / "one moment"
  // forever on every subsequent message. This loop keeps calling MiniMax
  // with the accumulated tool results appended until it produces a final
  // text answer (stop_reason !== 'tool_use'), capped at a few rounds.
  const encoder = new TextEncoder()
  const MAX_TOOL_ROUNDS = 4
  // MiniMax latency is unpredictable (13s → indefinite hangs observed) — a
  // per-round abort deadline means a stuck stream degrades into a friendly
  // fallback instead of the widget silently dying at Vercel's 60s kill.
  const ROUND_TIMEOUT_MS = 45000

  // The model must never tell the guest a review card exists unless a
  // prepare_* tool actually ran this exchange — the widget only renders
  // cards from real tool results, so a claimed-but-unprepared card is a
  // visible dead end. Detected server-side and corrected with one extra
  // round, because prompt rules alone have been observed to fail here.
  // Kept broadening this list phrase-by-phrase as new wording slipped through
  // ("the secure card that just opened", now "press Confirm reschedule
  // request... that button" with no literal "card" at all) — switched the
  // last alternative to a general "press/tap/click near confirm" pattern so
  // new phrasings of the same claim don't need their own new literal.
  const CARD_CLAIM_RE = /(summary card|review card|booking card|confirm booking button|reschedule card|reschedule summary|the card (below|above|here)|\b(press|tap|click)\b[^.]{0,25}\bconfirm\b)/i

  // The model must never describe an existing booking (ref, treatment, date,
  // time) it has not fetched. Observed live: asked to reschedule TMS-024, it
  // confidently invented the booking's details without any lookup call, then
  // contradicted itself two turns later. A ref is "known" only if a previous
  // ASSISTANT message already stated it (i.e. it came from a real tool result
  // in an earlier exchange) — refs the guest typed themselves don't count.
  // Same class of lie in simple/lead-capture mode: "I've passed your details
  // to the team" is only true if capture_booking_intent actually inserted an
  // enquiry. Narrow phrasing on purpose — "the team will contact you" alone is
  // legitimate after-confirmation talk and must not trigger this.
  const SENT_CLAIM_RE = /((passed|sent|forwarded|logged|saved) (your|the) (details|request|enquiry|information)|team has been (notified|alerted))/i

  // The model must never present a booking LIST as complete/exhaustive from
  // conversation memory alone — refs it mentioned earlier this chat are
  // "known" for the ref-hallucination guard above, but "here are ALL your
  // bookings" is a distinct, stronger claim that specifically requires a
  // FRESH find_my_bookings/start_booking_lookup call THIS turn. Observed
  // live: guest had 6 real active bookings; asked to see them again later
  // in the same chat, the bot recited only the 2 refs it happened to have
  // mentioned earlier, silently omitting the other 4 — no tool ran that
  // turn. The ref-guard correctly stayed quiet (both refs were "known"),
  // but the completeness claim was false.
  const LISTING_CLAIM_RE = /\b(here are|these are|those are)\s+(your|the)(\s+only)?(\s+\d+)?\s+(active\s+)?bookings?\b/i

  // The corrective guard above is a backstop, not a guarantee — MiniMax can
  // (and did, live, ~1 in 3 tries) ignore the correction and repeat the same
  // unproven claim, burning the guard's one-shot budget. For financial/
  // scheduling data a probabilistic guard isn't good enough, so for this one
  // well-known intent we don't ask the model to choose correctly at all:
  // detect "show/see/list my bookings" server-side on the GUEST's own latest
  // message and run the real fetch before the model ever responds, exactly
  // like the Cancel button bypasses tool-choice for an irreversible action.
  // False positives just cost one harmless extra read — err broad.
  const lastUserMsg = [...modelMessages].reverse().find(m => m.role === 'user')
  const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.toLowerCase() : ''
  const LISTING_INTENT_RE = /\b(show|see|check|list|recall|remind|all|again)\b/i
  const listingIntentDetected = /\bbookings?\b/i.test(lastUserText) && LISTING_INTENT_RE.test(lastUserText)

  const BOOKING_REF_RE = /TMS-\d+/gi
  const knownRefs = new Set()
  for (const m of modelMessages) {
    if (m.role !== 'assistant') continue
    const text = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content.map(c => c.text ?? '').join(' ') : '')
    for (const ref of text.match(BOOKING_REF_RE) ?? []) knownRefs.add(ref.toUpperCase())
  }

  // P3 — generalize the deterministic pre-fetch beyond "show my bookings".
  // When a guest asks about a SPECIFIC booking (a TMS-### ref, or reschedule/
  // change/cancel/"my booking" intent), the model could recite its details
  // from memory instead of fresh data — the same class as the listing bug.
  // We ground it the same way: run the real fetch first. But ONLY when the
  // session is already VERIFIED — an unverified session has no accessible
  // booking data, so pre-fetching there would inject an empty list and could
  // short-circuit the (working, audited 3/3) "open the secure lookup card"
  // flow. Verified → strictly more grounding; unverified → untouched.
  let sessionVerified = false
  if (chatbotFullMode) {
    try {
      const { data: s } = await admin.from('chat_sessions')
        .select('metadata').eq('session_id', sessionId).maybeSingle()
      const access = s?.metadata?.booking_access
      sessionVerified = Boolean(access?.customer_id && access.expires_at && Date.parse(access.expires_at) > Date.now())
    } catch { /* treat as unverified on any read error */ }
  }
  const BOOKING_DETAIL_RE = /\b(reschedule|re-schedule|change|move|cancel|my booking|my appointment|my reservation|when is|what time)\b/i
  const bookingDetailIntent = BOOKING_REF_RE.test(lastUserText) || BOOKING_DETAIL_RE.test(lastUserText)
  BOOKING_REF_RE.lastIndex = 0 // reset: /g regex is stateful across .test()
  const shouldPrefetchBookings = chatbotFullMode &&
    (listingIntentDetected || (sessionVerified && bookingDetailIntent))

  // Deterministic duration-fact guard. When the guest names a specific
  // treatment AND a duration that treatment does not offer ("a 60-minute head
  // & shoulder"), inject the treatment's REAL durations as a fact before the
  // model composes its reply — so it can't verbally accept or price a
  // non-existent length. prepareBookingDraft already blocks BOOKING such a
  // duration, but the bot could still misquote it in chat (~1 in 5 on blunt
  // phrasing); prompt rules alone don't hold, so we ground it like the booking
  // pre-fetch. Conservative on purpose: fires only on a clear treatment-name
  // match + a real unit, so it can't inject the wrong fact.
  const normalizeForMatch = (s) => s.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9฀-๿一-鿿]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
  let durationFact = null
  let durationFactInfo = ''
  if (chatbotFullMode) {
    const normMsg = normalizeForMatch(lastUserText)
    const minMatch = normMsg.match(/\b(\d{2,3})\s*(min|mins|minute|minutes|นาที|分钟|минут|мин)\b/)
    const hrMatch  = normMsg.match(/\b(\d{1,2})\s*(hour|hours|hr|hrs|ชั่วโมง|小时|час|часа|часов)\b/)
    const reqDuration = minMatch ? Number(minMatch[1]) : (hrMatch ? Number(hrMatch[1]) * 60 : null)
    if (reqDuration && reqDuration >= 15 && reqDuration <= 600) {
      // Longest core-name match wins (most specific treatment).
      let best = null
      for (const t of treatmentsRes.data ?? []) {
        const core = normalizeForMatch(t.name).replace(/\b(massage|treatment|therapy)\b/g, '').replace(/\s+/g, ' ').trim()
        if (core.length >= 4 && normMsg.includes(core)) {
          if (!best || core.length > best.core.length) best = { t, core }
        }
      }
      const opts = best?.t.duration_options ?? []
      if (best && opts.length && !opts.includes(reqDuration)) {
        const priceStr = opts.map(d => `${d} min (${best.t.prices?.[String(d)] ?? '?'} THB)`).join(', ')
        durationFact = `[SYSTEM FACT — not the guest speaking] "${best.t.name}" is only offered in these durations: ${priceStr}. It has NO ${reqDuration}-minute option. Do not state, accept, confirm, or price a ${reqDuration}-minute "${best.t.name}" — that would be false. Tell the guest the real durations plainly, and if they want about ${reqDuration} minutes, offer the nearest real duration of this treatment, a different treatment whose real duration fits, or a listed add-on to reach that length. Never invent a duration or a price.`
        durationFactInfo = `${best.t.name} req=${reqDuration}`
      }
    }
  }

  // P5 — observability: emit a structured line whenever a guard/pre-fetch
  // fires, so production logs show how often the model tries to hallucinate
  // and which guard caught it (→ tells you which surface to harden next).
  const logGuard = (guard, extra = '') =>
    console.error(`[chat-guard] ${guard} session=${sessionId}${extra ? ' ' + extra : ''}`)

  const readable = new ReadableStream({
    async start(controller) {
      let fullText = ''
      const conversationMessages = [...modelMessages]
      let draftToolRan = false
      let cardCorrectionUsed = false
      let lookupToolRan = false
      let refCorrectionUsed = false
      let enquiryToolRan = false
      let sentCorrectionUsed = false
      let listingCorrectionUsed = false

      // Deterministic pre-fetch: run the REAL find_my_bookings call now and
      // hand the model its result as if it had already called the tool this
      // turn, rather than trusting the model to choose to call it. Fires for
      // "show my bookings" intent (any session) and for specific booking-detail
      // intent when verified (P3, see shouldPrefetchBookings above).
      if (shouldPrefetchBookings) {
        try {
          const listingResult = await listSessionBookings(admin, sessionId)
          logGuard('prefetch-bookings', `verified=${sessionVerified}`)
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: 'tool_result', tool: 'find_my_bookings', result: listingResult }) + '\n'
          ))
          const syntheticId = `pre_${crypto.randomUUID()}`
          conversationMessages.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: syntheticId, name: 'find_my_bookings', input: {} }],
          })
          conversationMessages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: syntheticId, content: JSON.stringify(listingResult) }],
          })
          lookupToolRan = true
        } catch (err) {
          console.error('[chat] listing pre-fetch failed:', err)
        }
      }

      // Ground the model with the real durations BEFORE its first reply when
      // the guest asked for a length a named treatment doesn't offer.
      if (durationFact) {
        logGuard('duration-fact', durationFactInfo)
        conversationMessages.push({ role: 'user', content: durationFact })
      }

      try {
        let resolvedNaturally = false

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const roundAbort = new AbortController()
          const roundTimer = setTimeout(() => roundAbort.abort(), ROUND_TIMEOUT_MS)
          const stream = await client.messages.create({
            model:       aiModel,
            max_tokens:  700,
            temperature: 0.6,
            system:      systemPrompt,
            messages:    conversationMessages,
            tools,
            stream:      true,
          }, { signal: roundAbort.signal })

          const blocks = {} // index -> accumulated content block
          let stopReason = null
          let roundText = ''

          for await (const event of stream) {
            if (event.type === 'content_block_start') {
              const block = event.content_block
              blocks[event.index] = block.type === 'tool_use'
                ? { type: 'tool_use', id: block.id, name: block.name, inputJson: '' }
                : { type: 'text', text: '' }
            }

            if (event.type === 'content_block_delta') {
              const block = blocks[event.index]
              if (event.delta?.type === 'text_delta') {
                // Later rounds (after tool results or a system-check round)
                // stream straight after the previous round's text — without a
                // separator the guest sees "…for you.Got it —" glued together.
                if (roundText === '' && fullText !== '' && !/\s$/.test(fullText)) {
                  fullText += '\n\n'
                  controller.enqueue(encoder.encode(
                    JSON.stringify({ type: 'text', text: '\n\n' }) + '\n'
                  ))
                }
                block.text += event.delta.text
                fullText += event.delta.text
                roundText += event.delta.text
                controller.enqueue(encoder.encode(
                  JSON.stringify({ type: 'text', text: event.delta.text }) + '\n'
                ))
              }
              if (event.delta?.type === 'input_json_delta') {
                block.inputJson += event.delta.partial_json ?? ''
              }
            }

            if (event.type === 'message_delta') {
              stopReason = event.delta?.stop_reason
            }
          }
          clearTimeout(roundTimer)

          const assistantContent = Object.keys(blocks).sort((a, b) => a - b).map(i => {
            const b = blocks[i]
            if (b.type === 'tool_use') {
              let input = {}
              try { input = JSON.parse(b.inputJson || '{}') } catch {}
              return { type: 'tool_use', id: b.id, name: b.name, input }
            }
            return { type: 'text', text: b.text }
          })
          conversationMessages.push({ role: 'assistant', content: assistantContent })

          if (stopReason !== 'tool_use') {
            // Card-claim guard: the model just told the guest a review card
            // exists, but no prepare_* tool ran this exchange — no card will
            // render. Inject one corrective round so it either actually calls
            // the tool or walks the claim back. (Observed live in testing.)
            if (!draftToolRan && !cardCorrectionUsed && CARD_CLAIM_RE.test(roundText)) {
              cardCorrectionUsed = true
              logGuard('card-claim')
              conversationMessages.push({
                role: 'user',
                content: '[SYSTEM CHECK — not the guest speaking] You told the guest a review/booking card is shown, but you did not call prepare_booking or prepare_reschedule this turn, so NO card is visible to them. Fix this now: if you have the treatment, date, time and duration agreed, call the appropriate prepare tool immediately. Otherwise, briefly tell the guest what detail you still need. Do not apologise at length.',
              })
              continue
            }
            // Ref-claim guard: the model mentioned a booking reference that no
            // tool returned this exchange and no earlier assistant turn ever
            // stated — so any details attached to it are invented. Force one
            // corrective round to ground it in a real lookup.
            // Sent-claim guard: the model told the guest their request/details
            // were passed to the team, but no enquiry-creating tool ran.
            if (!enquiryToolRan && !sentCorrectionUsed && SENT_CLAIM_RE.test(roundText)) {
              sentCorrectionUsed = true
              logGuard('sent-claim')
              conversationMessages.push({
                role: 'user',
                content: '[SYSTEM CHECK — not the guest speaking] You told the guest their details/request were sent to the team, but you did not call capture_booking_intent this turn, so nothing was recorded. Fix this now: if you have their name and phone, call capture_booking_intent immediately. Otherwise ask for the missing detail. Never claim something was sent unless the tool ran. Keep the reply short.',
              })
              continue
            }
            const mentionedRefs = (roundText.match(BOOKING_REF_RE) ?? []).map(r => r.toUpperCase())
            const unknownRef = mentionedRefs.find(r => !knownRefs.has(r))
            if (!lookupToolRan && !refCorrectionUsed && unknownRef) {
              refCorrectionUsed = true
              logGuard('ref-claim', unknownRef)
              conversationMessages.push({
                role: 'user',
                content: `[SYSTEM CHECK — not the guest speaking] You mentioned booking ${unknownRef}, but you have not retrieved it with any tool, so any treatment/date/time you stated for it is INVENTED and may be wrong. Fix this now: call find_my_bookings if this chat is already verified, otherwise call start_booking_lookup and ask the guest to verify on the secure card first. Never restate details for a booking a tool has not returned. Keep the reply short.`,
              })
              continue
            }
            // Listing-claim guard: the model presented a booking LIST as
            // complete without a fresh find_my_bookings/start_booking_lookup
            // call this turn — it may be reciting only the refs it happened
            // to mention earlier, silently omitting real bookings it never
            // fetched. Distinct from the ref-guard above (which only checks
            // individual refs are grounded, not that a list is exhaustive).
            if (!lookupToolRan && !listingCorrectionUsed && LISTING_CLAIM_RE.test(roundText)) {
              listingCorrectionUsed = true
              logGuard('listing-claim')
              conversationMessages.push({
                role: 'user',
                content: '[SYSTEM CHECK — not the guest speaking] You presented a list of bookings as complete, but you did not call find_my_bookings this turn — refs you recall from earlier in this chat may not be the guest\'s FULL current list. Fix this now: call find_my_bookings and answer only from its fresh result. Keep the reply short.',
              })
              continue
            }
            resolvedNaturally = true
            break
          }

          // Execute every tool_use block from this turn, then feed the
          // results back as a user turn so the next round can use them.
          const toolResultContent = []
          for (const block of assistantContent) {
            if (block.type !== 'tool_use') continue

            // executeToolCall's own `bookingEngineEnabled` guard is really asking
            // "is the chatbot allowed to check_availability/prepare_booking right
            // now" — that's chatbotFullMode, not the raw master switch.
            const toolResult = await executeToolCall(
              block.name,
              block.input,
              { admin, sessionId, bookingEngineEnabled: chatbotFullMode, settings }
            )
            if (['prepare_booking', 'prepare_reschedule'].includes(block.name)) draftToolRan = true
            if (block.name === 'capture_booking_intent') enquiryToolRan = true
            if (['find_my_bookings', 'start_booking_lookup', 'check_reschedule_availability', 'prepare_reschedule'].includes(block.name)) {
              lookupToolRan = true
              // Refs returned by a real lookup this exchange become known, so
              // the guard doesn't re-fire when the model then talks about them.
              for (const ref of JSON.stringify(toolResult).match(BOOKING_REF_RE) ?? []) knownRefs.add(ref.toUpperCase())
            }

            controller.enqueue(encoder.encode(
              JSON.stringify({ type: 'tool_result', tool: block.name, result: toolResult }) + '\n'
            ))

            toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult) })
          }
          conversationMessages.push({ role: 'user', content: toolResultContent })
        }

        if (!resolvedNaturally) {
          const fallback = "I'm having trouble finishing that check — let me connect you with our team on WhatsApp."
          fullText += fallback
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', text: fallback }) + '\n'))
        }

      } catch (err) {
        console.error('[chat] stream error:', err)
        const friendly = err?.name === 'AbortError' || /abort/i.test(String(err?.message))
          ? 'That took longer than it should — please try once more, or message our team on WhatsApp for an instant answer.'
          : "I'm having a moment — please try again, or WhatsApp us directly."
        fullText += (fullText ? ' ' : '') + friendly
        controller.enqueue(encoder.encode(
          JSON.stringify({ type: 'error', text: friendly }) + '\n'
        ))
      }

      // ── 6. Persist conversation to Supabase ────────────────
      // Outside the model try/catch: a storage hiccup must never surface an
      // error bubble after the guest already received a complete answer.
      try {
        await persistSession({ admin, sessionId, messages, assistantText: fullText })
      } catch (err) {
        console.error('[chat] persist failed:', err)
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ============================================================
// TOOL EXECUTION
// ============================================================

async function executeToolCall(toolName, input, { admin, sessionId, bookingEngineEnabled, settings }) {
  switch (toolName) {

    case 'update_guest_info': {
      const updates = {}
      if (input.guest_name)  updates.guest_name  = input.guest_name
      if (input.guest_phone) updates.guest_phone = input.guest_phone
      if (Object.keys(updates).length > 0) {
        // Upsert, not update: on a guest's very first message the session
        // row doesn't exist yet (persistSession runs after the tool loop),
        // and a bare update would silently drop their name/phone.
        await admin.from('chat_sessions')
          .upsert({ session_id: sessionId, ...updates, last_active: new Date().toISOString() }, { onConflict: 'session_id' })
      }
      return { ok: true }
    }

    case 'capture_booking_intent': {
      // Upsert session with guest info (row may not exist yet — see above)
      await admin.from('chat_sessions')
        .upsert({
          session_id:  sessionId,
          guest_name:  input.guest_name,
          guest_phone: input.guest_phone,
          last_active: new Date().toISOString(),
        }, { onConflict: 'session_id' })

      // Save to enquiries table — staff will follow up via WhatsApp
      const { data: enquiry } = await admin.from('enquiries').insert({
        name:    input.guest_name,
        phone:   input.guest_phone,
        message: buildEnquiryMessage(input),
        source:  'chatbot',
        status:  'new',
        metadata: {
          treatment_interest: input.treatment_name,
          preferred_date:     input.preferred_date,
          preferred_time:     input.preferred_time,
          party_size:         input.party_size ?? 1,
          chat_session_id:    sessionId,
          notes:              input.notes,
        },
      }).select().single()

      // Notify staff — no guest email available in this flow, so guest
      // confirmation is skipped (they're told the team will WhatsApp them)
      if (process.env.INQUIRY_EMAIL) {
        await sendEmail({
          to:      process.env.INQUIRY_EMAIL,
          subject: `New enquiry from ${input.guest_name} (chatbot)`,
          html:    enquiryOwnerHtml({
            name:    input.guest_name,
            phone:   input.guest_phone,
            message: buildEnquiryMessage(input),
            source:  'chatbot',
          }),
        }).catch(err => console.error('[chat] enquiry email failed:', err))
      }

      return { ok: true, enquiry_id: enquiry?.id }
    }

    case 'recommend_treatments': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }

      const { date, time, duration } = input
      const { closed, treatments } = await getBookableTreatmentsAt(admin, {
        date, startTime: time, durationPref: duration,
      })
      if (closed) return { ok: true, available: false, message: 'The spa is closed on this date.' }
      if (!treatments.length) {
        return { ok: true, available: false, date, time, message: 'Nothing is free at that exact time — suggest a slightly different time or date.' }
      }
      // Grouped by category so the model can present a tidy, varied set.
      return { ok: true, available: true, date, time, bookable_treatments: treatments }
    }

    case 'check_availability': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }

      const { date, duration } = input
      const treatment = await resolveTreatment(admin, input)
      if (!treatment) return { ok: false, error: 'Unknown treatment — ask the guest which treatment from the menu they mean.' }

      // Same shared logic as the public /book page — therapist shifts,
      // qualifications, overlapping-duration bookings, and room capacity all
      // taken into account, so the chatbot can never over-promise a slot.
      const { slots, closed } = await getAvailableSlots(admin, {
        date, treatmentId: treatment.id, duration: duration ?? treatment.duration_options?.[0] ?? 60,
      })
      if (closed) return { ok: true, available: false, message: 'The spa is closed on this date.' }

      const openTimes = slots.filter(s => s.available).map(s => s.time)
      return {
        ok: true,
        available: openTimes.length > 0,
        treatment: treatment.name,
        date,
        open_times: openTimes,
        message: openTimes.length === 0
          ? 'Fully booked for this treatment on this date — suggest another date or a different treatment.'
          : undefined,
      }
    }

    case 'prepare_booking': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }
      return prepareBookingDraft(admin, sessionId, input)
    }

    case 'find_my_bookings': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }
      return listSessionBookings(admin, sessionId)
    }

    case 'start_booking_lookup': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }
      const { data: session } = await admin.from('chat_sessions')
        .select('metadata').eq('session_id', sessionId).maybeSingle()
      const access = session?.metadata?.booking_access
      if (access?.customer_id && access.expires_at && Date.parse(access.expires_at) > Date.now()) {
        // Already verified — nothing to re-show on restore, so clear any
        // stale pending flag from an earlier, unfinished lookup attempt.
        if (session?.metadata?.booking_lookup_pending) {
          const nextMetadata = { ...session.metadata }
          delete nextMetadata.booking_lookup_pending
          await admin.from('chat_sessions').update({ metadata: nextMetadata }).eq('session_id', sessionId)
        }
        const existing = await listSessionBookings(admin, sessionId)
        return { ok: true, lookup_ready: true, already_verified: true, bookings: existing.bookings ?? [] }
      }
      // Unlike prepare_booking/prepare_reschedule, this card has no token or
      // capacity binding — but it's exactly as ephemeral client-side, and the
      // client never restored it on reload (only booking_draft/reschedule_draft
      // were). A page reload or a mobile browser reclaiming a backgrounded tab
      // wiped the card while the "please verify" text stayed in history —
      // observed live, guest saw the prompt with no card to act on. Persist a
      // pending flag, mirroring the draft pattern, so ChatWidget can restore it.
      await admin.from('chat_sessions').upsert({
        session_id: sessionId,
        metadata: { ...(session?.metadata ?? {}), booking_lookup_pending: { started_at: new Date().toISOString() } },
        last_active: new Date().toISOString(),
      }, { onConflict: 'session_id' })
      return {
        ok: true,
        lookup_ready: true,
        message: 'Secure booking lookup is ready. Ask the guest to use the card and never request their verification code in chat.',
      }
    }

    case 'check_reschedule_availability': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }
      return getRescheduleAvailability(admin, sessionId, input)
    }

    case 'prepare_reschedule': {
      if (!bookingEngineEnabled) return { ok: false, error: 'Booking engine is not active' }
      return prepareRescheduleDraft(admin, sessionId, input)
    }

    default:
      return { ok: false, error: `Unknown tool: ${toolName}` }
  }
}

// ============================================================
// HELPERS
// ============================================================

async function persistSession({ admin, sessionId, messages, assistantText }) {
  const updatedMessages = prepareStoredMessages(messages, assistantText)

  const { data: session, error } = await admin.from('chat_sessions').upsert(
    {
      session_id:  sessionId,
      messages:    updatedMessages,
      last_active: new Date().toISOString(),
    },
    { onConflict: 'session_id' }
  ).select('customer_id').single()
  if (error) throw error

  // Dual-write during the migration period: the legacy JSON keeps existing
  // website restore behaviour stable while the normalized rows become the
  // shared web/WhatsApp/staff timeline.
  try {
    await recordWebExchange(admin, {
      sessionId,
      customerId: session?.customer_id,
      messages,
      assistantText,
    })
  } catch (timelineError) {
    console.error('[chat] unified timeline write failed:', timelineError)
  }
}

function buildEnquiryMessage(input) {
  const parts = [`Booking request via chatbot.`]
  if (input.treatment_name)  parts.push(`Treatment: ${input.treatment_name}`)
  if (input.preferred_date)  parts.push(`Preferred date: ${input.preferred_date}`)
  if (input.preferred_time)  parts.push(`Preferred time: ${input.preferred_time}`)
  if (input.party_size > 1)  parts.push(`Party size: ${input.party_size}`)
  if (input.notes)           parts.push(`Notes: ${input.notes}`)
  return parts.join(' | ')
}

// Resolve the treatment the model is referring to — by UUID when it copied
// the [id: …] tag correctly, falling back to a name match when it didn't
// (models occasionally garble UUIDs; a wrong id must not book the wrong
// treatment or silently fail).
async function resolveTreatment(admin, input) {
  if (input.treatment_id) {
    const { data } = await admin.from('spa_treatments')
      .select('id, name, prices, duration_options')
      .eq('id', input.treatment_id).eq('is_active', true).maybeSingle()
    if (data) return data
  }
  if (input.treatment_name) {
    const { data } = await admin.from('spa_treatments')
      .select('id, name, prices, duration_options')
      .ilike('name', `%${input.treatment_name.replace(/[%_]/g, '')}%`)
      .eq('is_active', true).limit(1).maybeSingle()
    if (data) return data
  }
  return null
}
