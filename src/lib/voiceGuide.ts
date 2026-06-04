const GUIDE_CLIPS: Record<string, string> = {
  "no-pose": "/audio/guide/step-into-frame.mp3",
  "too-far": "/audio/guide/move-closer.mp3",
  "too-close": "/audio/guide/step-back.mp3",
  "off-center": "/audio/guide/move-to-center.mp3",
  "off-left": "/audio/guide/move-left.mp3",
  "off-right": "/audio/guide/move-right.mp3",
  "head-cut": "/audio/guide/head-cut.mp3",
  "aligned": "/audio/guide/hold-still.mp3",
  "stabilizing": "/audio/guide/place-phone-down.mp3",
  "ready": "/audio/guide/ready.mp3",
  "head-down": "/audio/guide/head-down.mp3",
};

const MIN_INTERVAL_MS = 3000;
const MIN_SAME_MSG_MS = 5000;

let lastPlayedTime = 0;
let lastKey = "";
let currentAudio: HTMLAudioElement | null = null;

const audioCache = new Map<string, HTMLAudioElement>();

function getAudio(src: string): HTMLAudioElement {
  let audio = audioCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audioCache.set(src, audio);
  }
  return audio;
}

export function speakGuide(alignmentStatus: string) {
  const src = GUIDE_CLIPS[alignmentStatus];
  if (!src) return;

  const now = Date.now();
  if (alignmentStatus === lastKey && now - lastPlayedTime < MIN_SAME_MSG_MS) return;
  if (alignmentStatus !== lastKey && now - lastPlayedTime < MIN_INTERVAL_MS) return;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  const audio = getAudio(src);
  audio.currentTime = 0;
  audio.play().catch(() => {});
  currentAudio = audio;

  lastPlayedTime = now;
  lastKey = alignmentStatus;
}

export function speakReady() {
  speakGuideForce("ready");
  const readyAudio = getAudio(GUIDE_CLIPS["ready"]);
  const playHeadDown = () => speakGuideForce("head-down");
  if (readyAudio.duration && readyAudio.duration > 0) {
    setTimeout(playHeadDown, readyAudio.duration * 1000 + 300);
  } else {
    setTimeout(playHeadDown, 1500);
  }
}

function speakGuideForce(key: string) {
  const src = GUIDE_CLIPS[key];
  if (!src) return;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  const audio = getAudio(src);
  audio.currentTime = 0;
  audio.play().catch(() => {});
  currentAudio = audio;

  lastPlayedTime = Date.now();
  lastKey = key;
}

export function stopGuide() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  lastKey = "";
  lastPlayedTime = 0;
}

export function preloadGuideClips() {
  Object.values(GUIDE_CLIPS).forEach((src) => getAudio(src));
}
