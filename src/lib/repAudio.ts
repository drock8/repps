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

function playViaWebAudio(buffer: AudioBuffer) {
  const ctx = getAudioContext();
  const gain = getGainNode();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  src.start(0);
}

function playViaHtmlAudio(url: string) {
  const audio = new Audio(url);
  audio.volume = 1.0;
  audio.play().catch(() => {});
}

function playBuffer(buffer: AudioBuffer | undefined, url: string) {
  const ctx = getAudioContext();
  if (buffer && ctx.state === "running") {
    try {
      playViaWebAudio(buffer);
      return;
    } catch {}
  }
  playViaHtmlAudio(url);
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
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  if (!unlocked) unlockAudio();
}

export function startHeartbeat() {
  if (heartbeatId) return;
  heartbeatId = setInterval(() => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
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
  if (goBuffer) {
    playBuffer(goBuffer, "/audio/go.mp3");
  } else {
    playViaHtmlAudio("/audio/go.mp3");
    fetch("/audio/go.mp3")
      .then((r) => r.arrayBuffer())
      .then((ab) => getAudioContext().decodeAudioData(ab))
      .then((buf) => { goBuffer = buf; })
      .catch(() => {});
  }
}

export function playRepAudio(repNumber: number) {
  const url = `/audio/rep-${repNumber}.mp3`;
  const cached = bufferCache.get(repNumber);

  if (cached) {
    playBuffer(cached, url);
  } else {
    playViaHtmlAudio(url);
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((ab) => getAudioContext().decodeAudioData(ab))
      .then((buf) => bufferCache.set(repNumber, buf))
      .catch(() => {});
  }

  // Prefetch the next few
  for (let i = repNumber + 1; i <= repNumber + 3; i++) {
    if (!bufferCache.has(i)) {
      fetch(`/audio/rep-${i}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((ab) => getAudioContext().decodeAudioData(ab))
        .then((buf) => bufferCache.set(i, buf))
        .catch(() => {});
    }
  }
}
