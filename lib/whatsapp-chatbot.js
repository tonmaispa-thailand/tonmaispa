import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getAiClient } from '@/lib/minimax'
import { buildSystemPrompt } from '@/lib/chatbot'
import { prepareModelMessages } from '@/lib/chat-history'
import { sendWhatsAppMessage } from '@/lib/twilio'
import { createWhatsAppBookingRequestUrl } from '@/lib/whatsapp-booking-request'
import {
  appendConversationMessage,
  claimReplyJob,
  finishReplyJob,
  getRecentConversationMessages,
} from '@/lib/conversations'

const RATE_LIMIT_MESSAGES = 30
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const HANDOFF_KEYWORDS = [
  'human',
  'staff',
  'manager',
  'agent',
  'real person',
  'talk to person',
  'speak to person',
  'complaint',
  'angry',
  'refund',
  'cancel my booking',
  'cancel booking',
  'medical problem',
  'pregnant',
  'injury',
  'allergy',
]

const BOOKING_INTENT_PATTERNS = [
  /\bbook\b/i,
  /\bbooking\b/i,
  /\breserve\b/i,
  /\breservation\b/i,
  /\bappointment\b/i,
  /\bmake a booking\b/i,
  /\bwant to come\b/i,
  /\bcan i come\b/i,
  /จอง/,
  /予約/,
  /预订/,
  /預訂/,
]

function textFromResponse(response) {
  return (response?.content ?? [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

async function featureIsEnabled(admin) {
  const { data } = await admin
    .from('site_content')
    .select('value_text')
    .eq('key', 'settings.whatsapp_chatbot_enabled')
    .maybeSingle()
  return data?.value_text === 'true'
}

async function isOverRateLimit(admin, threadId) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { count } = await admin
    .from('conversation_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', threadId)
    .eq('sender_type', 'customer')
    .gte('created_at', since)
  return (count ?? 0) > RATE_LIMIT_MESSAGES
}

function handoffReasonFor(text) {
  const normalized = String(text ?? '').toLowerCase()
  const keyword = HANDOFF_KEYWORDS.find(item => normalized.includes(item))
  if (!keyword) return null
  if (['pregnant', 'injury', 'allergy', 'medical problem'].includes(keyword)) return 'medical_or_safety'
  if (['complaint', 'angry', 'refund'].includes(keyword)) return 'complaint_or_refund'
  if (keyword.includes('cancel')) return 'booking_change_request'
  return 'customer_requested_staff'
}

function hasBookingIntent(text) {
  const value = String(text ?? '').trim()
  if (!value) return false
  return BOOKING_INTENT_PATTERNS.some(pattern => pattern.test(value))
}

async function buildReply(admin, thread) {
  const [treatmentsRes, settingsRes, recentMessages] = await Promise.all([
    admin.from('spa_treatments').select('*').eq('is_active', true).order('sort_order'),
    admin.from('site_content').select('key, value_text').eq('page', 'settings'),
    getRecentConversationMessages(admin, thread.id),
  ])

  const settings = Object.fromEntries((settingsRes.data ?? []).map(row => [row.key, row.value_text]))
  const system = buildSystemPrompt({
    treatments: treatmentsRes.data ?? [],
    settings,
    bookingEngineEnabled: false,
    channel: 'whatsapp',
  })

  const ai = await getAiClient()
  if (!ai) throw new Error('AI service unavailable')

  const response = await ai.client.messages.create({
    model: ai.model,
    max_tokens: 300,
    system,
    messages: prepareModelMessages(recentMessages),
  })
  const reply = textFromResponse(response)
  if (!reply) throw new Error('AI returned an empty response')
  return { reply: reply.slice(0, 1500), source: 'ai' }
}

export async function processWhatsAppReply({ messageSid, threadId, fromAddress, body }) {
  const admin = createSupabaseAdminClient()
  const job = await claimReplyJob(admin, messageSid)
  if (!job) return

  try {
    if (!await featureIsEnabled(admin)) {
      await finishReplyJob(admin, messageSid, 'skipped', 'WhatsApp chatbot is disabled')
      return
    }

    const { data: thread, error: threadError } = await admin
      .from('conversation_threads')
      .select('*')
      .eq('id', threadId)
      .single()
    if (threadError) throw threadError

    // Human ownership always wins. The bot must remain silent while a staff
    // member owns the conversation or the thread is waiting in their queue.
    if (thread.mode !== 'bot') {
      await finishReplyJob(admin, messageSid, 'skipped', `Thread mode is ${thread.mode}`)
      return
    }

    if (!body?.trim()) {
      await finishReplyJob(admin, messageSid, 'skipped', 'No text body to answer')
      return
    }

    if (await isOverRateLimit(admin, thread.id)) {
      await finishReplyJob(admin, messageSid, 'skipped', 'Inbound rate limit exceeded')
      return
    }

    const handoffReason = handoffReasonFor(body)
    if (handoffReason) {
      const handoffText = 'Thank you — I’ll leave this in the Ton Mai Spa staff inbox so the team can help you carefully here on WhatsApp.'
      await admin
        .from('conversation_threads')
        .update({
          mode: 'waiting_for_staff',
          metadata: {
            ...(thread.metadata ?? {}),
            handoff_reason: handoffReason,
            handoff_requested_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', thread.id)

      const result = await sendWhatsAppMessage({ to: fromAddress, body: handoffText })
      await appendConversationMessage(admin, {
        threadId: thread.id,
        senderType: 'bot',
        channel: 'whatsapp',
        body: handoffText,
        twilioMessageSid: result.sid,
        dedupeKey: `twilio:${result.sid}`,
        deliveryStatus: result.status || 'queued',
        metadata: { reply_to_sid: messageSid, reply_source: 'handoff', handoff_reason: handoffReason },
      })

      await finishReplyJob(admin, messageSid, 'completed')
      return
    }

    if (hasBookingIntent(body)) {
      const bookingUrl = createWhatsAppBookingRequestUrl({
        threadId: thread.id,
        whatsappAddress: thread.whatsapp_address || fromAddress,
      })
      const bookingText = [
        'Absolutely — please fill this secure Ton Mai Spa booking request form:',
        bookingUrl,
        '',
        'It will ask for your name, phone, email, treatment, date, and available time. After you submit, our team will confirm the booking here on WhatsApp.',
      ].join('\n')

      const result = await sendWhatsAppMessage({ to: fromAddress, body: bookingText })
      await appendConversationMessage(admin, {
        threadId: thread.id,
        senderType: 'bot',
        channel: 'whatsapp',
        body: bookingText,
        twilioMessageSid: result.sid,
        dedupeKey: `twilio:${result.sid}`,
        deliveryStatus: result.status || 'queued',
        metadata: { reply_to_sid: messageSid, reply_source: 'booking_request_link' },
      })

      await finishReplyJob(admin, messageSid, 'completed')
      return
    }

    let generated
    try {
      generated = await buildReply(admin, thread)
    } catch (aiError) {
      console.error('[whatsapp-chatbot] reply generation failed:', aiError)
      generated = {
        reply: "Thank you for messaging Ton Mai Spa. I'm having trouble replying just now, but our team can continue helping you here shortly.",
        source: 'fallback',
      }
    }

    const result = await sendWhatsAppMessage({ to: fromAddress, body: generated.reply })
    await appendConversationMessage(admin, {
      threadId: thread.id,
      senderType: 'bot',
      channel: 'whatsapp',
      body: generated.reply,
      twilioMessageSid: result.sid,
      dedupeKey: `twilio:${result.sid}`,
      deliveryStatus: result.status || 'queued',
      metadata: { reply_to_sid: messageSid, reply_source: generated.source },
    })

    await finishReplyJob(admin, messageSid, 'completed')
  } catch (error) {
    console.error('[whatsapp-chatbot] processing failed:', error)
    await finishReplyJob(admin, messageSid, 'failed', error.message)
  }
}
