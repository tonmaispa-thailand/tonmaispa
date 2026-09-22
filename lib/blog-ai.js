// AI assistance for the blog editor — "Write with AI" (full draft) and
// "Generate with AI" (excerpt). Two separate one-shot MiniMax calls, not
// the full 3-stage critique pipeline (overkill for blog copy). Same hard
// timeout pattern as lib/analytics-interpret.js — MiniMax latency is
// unpredictable, a stuck call must fail clearly rather than hang.
import { getAiClient } from './minimax'

const TIMEOUT_MS = 60000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`MiniMax timed out after ${ms / 1000}s`)), ms)),
  ])
}

// Strips a leading/trailing markdown code fence if the model wraps its
// output in one despite instructions not to — cheap insurance, not relied on.
function stripFences(text) {
  return (text || '').trim().replace(/^```(?:html)?\n?/i, '').replace(/```$/, '').trim()
}

const DRAFT_SYSTEM_PROMPT = `You are writing a blog post for Ton Mai Spa, a traditional Thai spa with a garden restaurant in Rawai, Phuket. You are given the post's title, its category, and real facts about the business (location, hours, treatments, phone/WhatsApp) — use ONLY these facts when referencing the business specifically; never invent a treatment, price, or detail not given to you.

Write an 800-1200 word article body as clean HTML using <h2>, <h3>, <p>, <ul>/<li>, and <strong> where appropriate — no <html>/<head>/<body> wrapper, just the article content itself. Tone: warm, informative, editorial — like a knowledgeable local writing for a curious visitor, not a sales brochure.

Hard rule: do not make medical claims or health guarantees beyond general wellness language (e.g. "may help you relax" is fine, "cures back pain" is not). If the topic touches pregnancy, injury, or medical conditions, include a brief note recommending the reader consult their own doctor.

Return ONLY the HTML body, nothing else — no markdown fences, no explanation before or after.`

export async function generateDraft({ title, category, context }) {
  const ai = await getAiClient()
  if (!ai) return null

  try {
    const resp = await withTimeout(
      ai.client.messages.create({
        model: ai.model,
        max_tokens: 2500,
        system: DRAFT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify({ title, category, businessFacts: context }) }],
      }),
      TIMEOUT_MS,
    )
    const text = resp.content?.[0]?.text ?? ''
    return stripFences(text) || null
  } catch (err) {
    console.error('[blog-ai] generateDraft failed:', err.message)
    return null
  }
}

const EXCERPT_SYSTEM_PROMPT = `You are writing a short excerpt/teaser for a blog post, to be shown on a blog index page. You are given the full article body (HTML). Write exactly 1-2 plain-English sentences (no HTML tags) summarizing what the post covers, in an inviting but honest tone — not clickbait. Return ONLY the excerpt text, nothing else.`

export async function generateExcerpt({ body }) {
  const ai = await getAiClient()
  if (!ai) return null

  try {
    const resp = await withTimeout(
      ai.client.messages.create({
        model: ai.model,
        max_tokens: 200,
        system: EXCERPT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: body }],
      }),
      TIMEOUT_MS,
    )
    const text = resp.content?.[0]?.text ?? ''
    return stripFences(text) || null
  } catch (err) {
    console.error('[blog-ai] generateExcerpt failed:', err.message)
    return null
  }
}
