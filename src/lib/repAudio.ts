const audioCache = new Map<number, HTMLAudioElement>();

const MAX_PRELOADED = 10;

export function preloadRepAudio(upTo = MAX_PRELOADED) {
  for (let i = 1; i <= upTo; i++) {
    if (!audioCache.has(i)) {
      const audio = new Audio(`/audio/rep-${i}.mp3`);
      audio.preload = "auto";
      audioCache.set(i, audio);
    }
  }
}

export function playRepAudio(repNumber: number) {
  let audio = audioCache.get(repNumber);
  if (!audio) {
    audio = new Audio(`/audio/rep-${repNumber}.mp3`);
    audioCache.set(repNumber, audio);
    // Preload the next few
    for (let i = repNumber + 1; i <= repNumber + 3; i++) {
      if (!audioCache.has(i)) {
        const next = new Audio(`/audio/rep-${i}.mp3`);
        next.preload = "auto";
        audioCache.set(i, next);
      }
    }
  }

  audio.currentTime = 0;
  audio.play().catch(() => {});
}
