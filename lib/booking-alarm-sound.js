// Synthesizes a repeating attention alert entirely in the browser (Web Audio
// API) — no audio file to source, license, host, or fail to load. A two-tone
// chime (like a doorbell), repeating every ~1.8s while active.
//
// Volume is on the settings.booking_alarm_volume scale (0–100), mapped to a
// gain of 0–0.5 so "100" reads as loud-but-not-clipping, not deafening.
//
// Browsers block audio from starting without a prior user gesture on the
// page (autoplay policy) — creating the player is always safe, but a beep
// may silently no-op if the AudioContext is still 'suspended' because the
// user hasn't clicked/tapped anywhere on the page yet this load. Callers
// check isSuspended() and prompt for a click to resume() if so.
export function createAlarmPlayer() {
  let ctx = null
  let timer = null
  let volume = 70

  function ensureContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
    return ctx
  }

  function beepPair() {
    const audioCtx = ensureContext()
    if (audioCtx.state === 'suspended') return // can't play yet — see resume()
    const now = audioCtx.currentTime
    // A malformed/NaN volume (bad settings.booking_alarm_volume value) must
    // never crash the AudioContext — gain.linearRampToValueAtTime throws on
    // a non-finite value, which would silently kill the alarm loop entirely
    // rather than just this one beep. Falls back to the default (70) instead.
    const safeVolume = Number.isFinite(volume) ? volume : 70
    const gain = Math.max(0, Math.min(100, safeVolume)) / 100 * 0.5
    if (gain <= 0) return

    for (const [freq, delay] of [[880, 0], [1108, 0.18]]) {
      const osc = audioCtx.createOscillator()
      const g = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(g)
      g.connect(audioCtx.destination)
      const t0 = now + delay
      // Quick attack/decay envelope per note — avoids a harsh click at the
      // start/end of each tone.
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(gain, t0 + 0.02)
      g.gain.linearRampToValueAtTime(0, t0 + 0.16)
      osc.start(t0)
      osc.stop(t0 + 0.18)
    }
  }

  return {
    setVolume(v) { volume = v },
    isSuspended() { return ctx?.state === 'suspended' },
    async resume() {
      await ensureContext().resume()
    },
    start() {
      if (timer) return // already running — don't stack intervals
      beepPair()
      timer = window.setInterval(beepPair, 1800)
    },
    stop() {
      if (timer) { window.clearInterval(timer); timer = null }
    },
  }
}
