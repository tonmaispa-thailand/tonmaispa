// Turns a GA4 summary (lib/ga4.js) into a short plain-English "so what" for
// a non-technical owner — not just numbers, but what they mean and what to
// do next. One-shot MiniMax call, same JSON-mode pattern as lib/translate.js.
import { getAiClient } from './minimax'

// MiniMax-M3 response time is highly variable (observed ~13s to several
// minutes) — wrap in a hard timeout so a stuck call fails clearly instead of
// hanging the request indefinitely (same pattern as lib/ai-critique.js).
const TIMEOUT_MS = 45000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`MiniMax timed out after ${ms / 1000}s`)), ms)),
  ])
}

function extractJson(text) {
  const match = text?.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

const SYSTEM_PROMPT = `You are explaining a website traffic report to the owner of Ton Mai Spa, a boutique Thai spa in Rawai, Phuket. The owner is not technical and does not know analytics jargon (never say "sessions," "engagement rate," "channel," "bounce rate," etc — use plain words like "visitors," "how they found the site," "clicked away"). You are given a JSON summary of real website data for a period: visitor counts, where visitors came from, top pages, what actions visitors took (clicked Book Now, completed a booking, clicked WhatsApp, etc), device type, and visitor locations.

Write a short, honest interpretation grounded ONLY in the numbers given — never invent a figure that isn't in the data. Return ONLY valid JSON, no markdown fences, matching this exact schema:
{
  "headline": string (max 12 words, the single most important takeaway),
  "summary": string (2-3 plain-English sentences describing what happened, citing real numbers from the data),
  "soWhat": string (1-2 sentences: why this matters for the business right now — e.g. a weak conversion rate means visitors are curious but not booking, so ad spend on more traffic won't help until that's fixed first),
  "actions": [string] (2-3 short, concrete, specific next steps the owner could actually do this week — not generic advice like "improve marketing," but specific to what the data shows, e.g. "Add a WhatsApp button near the top of the homepage since 92 people viewed the homepage but only 11 clicked WhatsApp")
}
If the data shows too little traffic to say anything meaningful (e.g. under 20 total visitors), say so honestly in "headline" and keep "actions" focused on getting more data (e.g. share the site more, wait for more traffic) rather than fabricating patterns from noise.`

export async function interpretAnalytics(summary) {
  const ai = await getAiClient()
  if (!ai) return null

  try {
    const resp = await withTimeout(
      ai.client.messages.create({
        model: ai.model,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(summary) }],
      }),
      TIMEOUT_MS,
    )
    const text = resp.content?.[0]?.text ?? ''
    return extractJson(text)
  } catch (err) {
    console.error('[analytics-interpret] failed:', err.message)
    return null
  }
}
