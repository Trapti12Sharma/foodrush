import { useEffect, useRef } from 'react';

// A repeating two-tone chime for as long as `active` is true.
//
// Synthesised with the Web Audio API rather than shipping an audio file: there is
// no asset to load (so it can never be the thing that 404s), and no <audio>
// element for a browser to block as autoplaying media.
//
// Browsers still refuse to start an AudioContext until the page has been
// interacted with, so every call is defensive — a silent alert is a degraded
// alert, but a thrown error would take the whole dialog down with it. The
// visual popup is always the real notification; this is the thing that gets
// someone's attention when they are not looking at the screen.
export default function useAlertChime(active, { intervalMs = 2500 } = {}) {
  const contextRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    function chime() {
      try {
        if (!contextRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          contextRef.current = new Ctx();
        }
        const ctx = contextRef.current;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const startedAt = ctx.currentTime;
        [880, 1174].forEach((frequency, i) => {
          const offset = i * 0.18;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          // Ramped rather than switched, so it reads as a chime, not a click.
          gain.gain.setValueAtTime(0.0001, startedAt + offset);
          gain.gain.exponentialRampToValueAtTime(0.2, startedAt + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + offset + 0.16);
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start(startedAt + offset);
          oscillator.stop(startedAt + offset + 0.18);
        });
      } catch {
        /* Audio is a nicety; the visual alert is the real notification. */
      }
    }

    chime();
    const timer = setInterval(chime, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
}
