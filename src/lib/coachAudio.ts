const REJECTION_CLIPS: Record<string, { primary: string; escalated: string | null; final: string | null }> = {
  shallow_descent: { primary: "all-the-way-down", escalated: "chest-to-floor", final: null },
  no_floor_contact: { primary: "touch-the-floor", escalated: "lay-flat", final: null },
  incomplete_rise: { primary: "stand-tall", escalated: "all-the-way-up", final: null },
  no_jump: { primary: "jump-up", escalated: "feet-off", final: null },
  no_tuck: { primary: "knees-up", escalated: "drive-those-knees", final: null },
  no_plank: { primary: "kick-back", escalated: null, final: null },
  forward_drift: { primary: "drop-in-place", escalated: "drop-straight-down", final: "hands-to-feet" },
  too_slow: { primary: "keep-moving", escalated: null, final: null },
  lost_tracking: { primary: "step-back-in", escalated: null, final: null },
};

const COACHING_CLIPS: Record<string, string> = {
  keep_going_down: "keep-going",
  push_up_and_stand: "push-up",
  lower_your_chest: "get-up",
};

const ENCOURAGEMENT_CLIPS = [
  { threshold: 10, clip: "on-fire" },
  { threshold: 5, clip: "lets-go" },
  { threshold: 3, clip: "nice" },
];

const PRIORITY_REJECTION = 2;
const PRIORITY_COACHING = 3;
const PRIORITY_ENCOURAGEMENT = 4;

const REJECTION_COOLDOWN_MS = 1500;

const audioCache = new Map<string, HTMLAudioElement>();
let currentAudio: HTMLAudioElement | null = null;
let currentPriority = 0;
let lastRejectionTime = 0;

function clipPath(name: string): string {
  return `/audio/coach/${name}.mp3`;
}

function getAudio(name: string): HTMLAudioElement | null {
  const path = clipPath(name);
  let audio = audioCache.get(path);
  if (!audio) {
    audio = new Audio(path);
    audioCache.set(path, audio);
  }
  return audio;
}

function playClip(name: string, priority: number): void {
  if (priority > currentPriority && currentPriority > 0) return;

  if (currentAudio && priority <= currentPriority) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  const audio = getAudio(name);
  if (!audio) return;

  currentPriority = priority;
  currentAudio = audio;
  audio.currentTime = 0;
  audio.play().catch(() => {});

  audio.onended = () => {
    if (currentAudio === audio) {
      currentPriority = 0;
      currentAudio = null;
    }
  };
}

export function preloadCoachAudio(): void {
  const allClips: string[] = [];

  for (const entry of Object.values(REJECTION_CLIPS)) {
    allClips.push(entry.primary);
    if (entry.escalated) allClips.push(entry.escalated);
  }
  for (const clip of Object.values(COACHING_CLIPS)) {
    allClips.push(clip);
  }
  for (const entry of ENCOURAGEMENT_CLIPS) {
    allClips.push(entry.clip);
  }

  for (const name of allClips) {
    const path = clipPath(name);
    if (!audioCache.has(path)) {
      const audio = new Audio(path);
      audio.preload = "auto";
      audioCache.set(path, audio);
    }
  }
}

export function playRejectionCue(reason: string, consecutiveCount: number): void {
  const now = Date.now();
  if (now - lastRejectionTime < REJECTION_COOLDOWN_MS) return;
  lastRejectionTime = now;

  const clips = REJECTION_CLIPS[reason];
  if (!clips) return;

  let clipName = clips.primary;
  if (consecutiveCount >= 5 && clips.final) {
    clipName = clips.final;
  } else if (consecutiveCount >= 3 && clips.escalated) {
    clipName = clips.escalated;
  }
  playClip(clipName, PRIORITY_REJECTION);
}

export function playCoachingCue(cue: string): void {
  const clipName = COACHING_CLIPS[cue];
  if (!clipName) return;
  playClip(clipName, PRIORITY_COACHING);
}

export function playEncouragement(cleanStreak: number): void {
  for (const entry of ENCOURAGEMENT_CLIPS) {
    if (cleanStreak === entry.threshold) {
      playClip(entry.clip, PRIORITY_ENCOURAGEMENT);
      return;
    }
  }
}

export function stopCoachAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  currentPriority = 0;
  lastRejectionTime = 0;
}
