let audioCtx: AudioContext | null = null;
const bufferCache = new Map<number, AudioBuffer>();
let unlocked = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

// Call this during a user gesture (tap/click) to unlock iOS audio
export function unlockAudio() {
  if (unlocked) return;
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  // Play a silent buffer to fully unlock on iOS
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  unlocked = true;
}

export function preloadRepAudio(upTo = 10) {
  const ctx = getAudioContext();
  for (let i = 1; i <= upTo; i++) {
    if (!bufferCache.has(i)) {
      fetch(`/audio/rep-${i}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => bufferCache.set(i, buf))
        .catch(() => {});
    }
  }
}

export function playRepAudio(repNumber: number) {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const cached = bufferCache.get(repNumber);
  if (cached) {
    const src = ctx.createBufferSource();
    src.buffer = cached;
    src.connect(ctx.destination);
    src.start(0);
  } else {
    // Load and play immediately, cache for next time
    fetch(`/audio/rep-${repNumber}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        bufferCache.set(repNumber, buf);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      })
      .catch(() => {});
  }

  // Prefetch the next few
  for (let i = repNumber + 1; i <= repNumber + 3; i++) {
    if (!bufferCache.has(i)) {
      fetch(`/audio/rep-${i}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => bufferCache.set(i, buf))
        .catch(() => {});
    }
  }
}
