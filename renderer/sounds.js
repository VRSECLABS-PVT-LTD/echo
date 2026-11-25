// Echo's little sound effects. Synthesised live with the Web Audio API:
// no audio files, nothing loaded from disk or the network, works the same on every OS.
(() => {
  const MASTER = 0.22; // keep it gentle
  let ctx = null;

  function context() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // One soft note. `bell` adds quiet overtones so it rings like a tiny glockenspiel;
  // `to` glides the pitch (for bloops and boops).
  function note(c, out, { f, t = 0, d = 0.4, v = 0.5, type = 'sine', to, bell = true }) {
    const start = c.currentTime + 0.03 + t;
    const partials = bell ? [[1, 1], [2, 0.2], [3.01, 0.07]] : [[1, 1]];
    for (const [mult, amp] of partials) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * mult, start);
      if (to) o.frequency.exponentialRampToValueAtTime(to * mult, start + d * 0.6);
      const decay = mult > 1 ? d * 0.5 : d; // overtones fade first, like a real bell
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(v * amp, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      o.connect(g).connect(out);
      o.start(start);
      o.stop(start + decay + 0.05);
    }
  }

  const SOUNDS = {
    // Rising sparkle: "ti-ting!"
    reminder: [
      { f: 1318.5, d: 0.5, v: 0.55 },           // E6
      { f: 1975.5, t: 0.11, d: 0.6, v: 0.5 },   // B6
      { f: 2637.0, t: 0.22, d: 0.35, v: 0.18 }, // E7 shimmer
    ],
    // Friendly doorbell: "ding-dong"
    cardSoon: [
      { f: 783.99, d: 0.55, v: 0.55 },          // G5
      { f: 659.25, t: 0.2, d: 0.8, v: 0.5 },    // E5
    ],
    // Bubbly arpeggio: "do-mi-so-DO!"
    cardToday: [
      { f: 1046.5, d: 0.3, v: 0.45 },           // C6
      { f: 1318.5, t: 0.08, d: 0.3, v: 0.45 },  // E6
      { f: 1568.0, t: 0.16, d: 0.3, v: 0.45 },  // G6
      { f: 2093.0, t: 0.24, d: 0.6, v: 0.5 },   // C7
    ],
    // Playful "uh-oh, uh-oh"
    cardOverdue: [
      { f: 880, to: 870, d: 0.16, v: 0.5, type: 'triangle', bell: false },
      { f: 698.46, t: 0.17, to: 680, d: 0.28, v: 0.5, type: 'triangle', bell: false },
      { f: 880, t: 0.55, to: 870, d: 0.16, v: 0.45, type: 'triangle', bell: false },
      { f: 698.46, t: 0.72, to: 680, d: 0.3, v: 0.45, type: 'triangle', bell: false },
    ],
    // Soft bubble "bloop" when Echo answers
    reply: [
      { f: 520, to: 980, d: 0.16, v: 0.45, bell: false },
      { f: 1320, t: 0.08, d: 0.14, v: 0.12, bell: false },
    ],
    // Gentle descending "bwomp" when something went wrong
    error: [
      { f: 440, to: 300, d: 0.28, v: 0.4, type: 'triangle', bell: false },
    ],
  };

  function play(kind) {
    const notes = SOUNDS[kind];
    if (!notes) return;
    try {
      const c = context();
      const out = c.createGain();
      out.gain.value = MASTER;
      out.connect(c.destination);
      notes.forEach((n) => note(c, out, n));
    } catch {}
  }

  window.echoSound = { play, kinds: Object.keys(SOUNDS) };
})();
