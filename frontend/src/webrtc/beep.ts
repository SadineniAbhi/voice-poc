// Small synthesized "switching" cue — two short tones, no audio asset needed. Fired the
// instant a route switch is triggered (before the backend round trip even returns) so the
// ~100-300ms gap while we resolve the new destination doesn't read as dead air/a dropped call.

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}

function tone(frequency: number, startTime: number, duration: number): void {
  const audioCtx = getContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;

  // quick fade in/out to avoid clicks
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.15, startTime + 0.01);
  gain.gain.linearRampToValueAtTime(0, startTime + duration);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playSwitchBeep(): void {
  try {
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    tone(880, now, 0.12);
    tone(1175, now + 0.14, 0.14);
  } catch {
    // Web Audio unavailable — non-critical, silently skip the cue.
  }
}
