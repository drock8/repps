let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
const bufferCache = new Map<number, AudioBuffer>();
let goBuffer: AudioBuffer | null = null;
let unlocked = false;
let heartbeatId: ReturnType<typeof setInterval> | null = null;

const VOLUME_GAIN = 3.0;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = VOLUME_GAIN;
    gainNode.connect(audioCtx.destination);
  }
  return audioCtx;
}

function getGainNode(): GainNode {
  getAudioContext();
  return gainNode!;
}

export function unlockAudio() {
  if (unlocked) return;
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {}
  unlocked = true;
}

export async function ensureAudioReady(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state !== "running") {
    try { await ctx.resume(); } catch {}
  }
  if (!unlocked) unlockAudio();
}

export function startHeartbeat() {
  if (heartbeatId) return;
  heartbeatId = setInterval(() => {
    const ctx = getAudioContext();
    if (ctx.state !== "running") {
      ctx.resume().catch(() => {});
    }
  }, 2000);
}

export function stopHeartbeat() {
  if (heartbeatId) {
    clearInterval(heartbeatId);
    heartbeatId = null;
  }
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
  if (!goBuffer) {
    fetch("/audio/go.mp3")
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { goBuffer = buf; })
      .catch(() => {});
  }
}

export function playGoAudio() {
  const ctx = getAudioContext();
  const gain = getGainNode();
  if (ctx.state === "running" && goBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = goBuffer;
    src.connect(gain);
    src.start(0);
  } else {
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    playViaHtmlAudio("/audio/go.mp3");
  }
}

const htmlAudioCache = new Map<string, HTMLAudioElement>();

function playViaHtmlAudio(url: string) {
  let audio = htmlAudioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    htmlAudioCache.set(url, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playRepAudio(repNumber: number) {
  const ctx = getAudioContext();
  const url = `/audio/rep-${repNumber}.mp3`;

  // Try Web Audio first
  if (ctx.state === "running") {
    const gain = getGainNode();
    const cached = bufferCache.get(repNumber);
    if (cached) {
      const src = ctx.createBufferSource();
      src.buffer = cached;
      src.connect(gain);
      src.start(0);
    } else {
      playViaHtmlAudio(url);
    }
  } else {
    // AudioContext suspended/interrupted (common on iOS when HTML Audio plays)
    ctx.resume().catch(() => {});
    playViaHtmlAudio(url);
  }

  // Prefetch into Web Audio buffer cache
  for (let i = repNumber; i <= repNumber + 3; i++) {
    if (!bufferCache.has(i)) {
      fetch(`/audio/rep-${i}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => bufferCache.set(i, buf))
        .catch(() => {});
    }
  }
}
