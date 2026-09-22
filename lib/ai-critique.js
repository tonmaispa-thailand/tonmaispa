// Shared 3-stage anti-hallucination pipeline: Draft -> Critique -> Distill.
// A single AI pass tends to cite plausible-sounding but unverified figures.
// This runs a second pass with an adversarial persona whose only job is to
// find problems in the first draft, then a third pass that produces a
// corrected final answer. Reusable by any feature that needs AI output
// grounded in real business data (currently: campaigns; candidate for
// insights.js later).
import { getAiClient } from './minimax'

function extractJson(text) {
  const match = text?.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

// MiniMax-M3 response time is highly variable in practice (observed anywhere
// from ~13s to several minutes, occasionally hanging well past 10 minutes
// with no response at all). Passing {timeout} as a per-call request option
// did not reliably abort a hung request in testing, so this wraps the call
// in its own Promise.race against a hard timer — a stuck stage rejects on
// schedule no matter what the SDK does internally.
const STAGE_TIMEOUT_MS = 90000

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ])
}

async function callOnce(client, model, { system, userContent, maxTokens }, label) {
  const resp = await withTimeout(
    client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    STAGE_TIMEOUT_MS,
    label,
  )
  return resp.content?.[0]?.text ?? ''
}

// No retry on parse failure or timeout here — a blind retry would risk
// doubling an already-tight serverless time budget. Single attempt per
// stage; the route returns a clean 502 if the pipeline as a whole fails,
// per the "fail clearly, don't fail open" principle used across this project.
async function callWithRetry(client, model, args, label) {
  const text = await callOnce(client, model, args, label)
  return extractJson(text)
}

// draftSystemPrompt: full SPICE system prompt, must instruct the model to
//   return ONLY JSON matching the target schema (including interpretedBrief).
// draftUserContent: JSON.stringify({ context, brief }) — the actual data.
// critiquePersona: description of the skeptical-auditor persona/instructions;
//   the wrapper appends the draft + context and demands the issues schema.
// distillInstructions: description of how to resolve issues; the wrapper
//   appends draft + critique + context and demands the final schema again.
export async function generateWithSelfCritique({
  context,
  brief,
  draftSystemPrompt,
  critiquePersona,
  distillInstructions,
}) {
  const ai = await getAiClient()
  if (!ai) return null
  const { client, model } = ai

  try {
    // Stage 1 — Draft
    const draft = await callWithRetry(client, model, {
      system: draftSystemPrompt,
      userContent: JSON.stringify({ context, brief }),
      maxTokens: 2200,
    }, 'draft')
    if (!draft) return null

    // Stage 2 — Critique (adversarial review against the same real data).
    // Deliberately short output (a list of issues, not a full plan) so this
    // stage stays fast regardless of how slow the draft/distill stages are.
    // A timeout/failure here degrades to "no critique available" rather than
    // discarding an already-successful draft — the draft alone still has value.
    const critiqueSystem = `${critiquePersona} You are reviewing a draft campaign plan against the real business data it was supposed to be grounded in. Actively look for problems — do not rubber-stamp. Flag: (1) any specific figure (baht amount, percentage, count) in the draft that does NOT appear in or follow arithmetically from the provided context data, (2) budget line items that don't sum to the stated total budget, (3) timeline dates that fall outside the stated campaign period, (4) generic advice that could apply to any spa and isn't grounded in this business's actual data, (5) internal contradictions between sections of the draft. Be concise — one short sentence per issue, at most 6 issues. Return ONLY valid JSON matching this exact shape, no other text: {"issues":[{"location":string,"problem":string,"severity":"must-fix"|"minor"}],"verdict":string}.`
    let critique = null
    try {
      critique = await callWithRetry(client, model, {
        system: critiqueSystem,
        userContent: JSON.stringify({ context, draft }),
        maxTokens: 800,
      }, 'critique')
    } catch (err) {
      console.error('[ai-critique] critique stage failed, continuing without it:', err.message)
    }

    // Stage 3 — Distill (produce the corrected final plan). Testing showed a
    // softer version of this instruction let fabricated figures survive
    // unchanged into the final plan even after the critique correctly
    // flagged them — so this is deliberately blunt and mechanical about it.
    const distillSystem = `${distillInstructions} You are given your own earlier draft plan, a critique of that draft (issues found against the real data), and the original business data.

Before writing the final plan, go through the critique's "issues" array one at a time. For every issue with severity "must-fix": locate the exact text in the draft it refers to, and either (a) replace the unverifiable figure with a real figure computed from the context data, or (b) rewrite it as an explicitly labeled estimate (e.g. "~15% — estimated, not directly measured"), or (c) remove the claim entirely if it cannot be salvaged. A "must-fix" issue that still appears unchanged, or reappears merely reworded, in your final output is a failure — you are re-litigating the same draft, not correcting it. Do not carry a number forward from the draft into "groundingNotes" with source "actual data" unless you can trace it to a specific field in the context JSON; if you cannot, mark it "estimated" instead.

Produce the corrected FINAL plan following this process, then populate "groundingNotes": for each major claim/figure in your final plan, note whether its source is "actual data", "estimated", or "industry standard". Return ONLY valid JSON matching the exact schema you were given for the draft, plus the groundingNotes array — no other text.`
    const final = await callWithRetry(client, model, {
      system: distillSystem,
      userContent: JSON.stringify({ context, draft, critique }),
      maxTokens: 2200,
    }, 'distill')

    return { draft, critique, final: final ?? draft }
  } catch (err) {
    console.error('[ai-critique] generation failed:', err.message)
    return null
  }
}
