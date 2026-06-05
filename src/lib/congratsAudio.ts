interface UserStats {
  total_reps: number;
  best_session_count: number;
  current_streak: number;
  longest_streak: number;
  days_active: number;
  previous_best_session?: number;
}

interface CongratsResult {
  message: string;
  audioFile: string;
}

interface MessageVariant {
  file: string;
  msg: string;
}

const STREAK_MILESTONES: { day: number; variants: MessageVariant[] }[] = [
  { day: 100, variants: [
    { file: "streak-100", msg: "100-day streak. Legendary." },
    { file: "streak-100-fun", msg: "100 days. You're not normal. That's a compliment." },
  ]},
  { day: 60, variants: [
    { file: "streak-60", msg: "60 days. This is who you are now." },
  ]},
  { day: 30, variants: [
    { file: "streak-30", msg: "30-day streak! You're unstoppable." },
    { file: "streak-30-fun", msg: "30 days! Basically an athlete now." },
  ]},
  { day: 14, variants: [
    { file: "streak-14", msg: "Two weeks strong. That's real commitment." },
    { file: "streak-14-fun", msg: "2 weeks. At this point you're just showing off." },
  ]},
  { day: 7, variants: [
    { file: "streak-7", msg: "7 days straight. You're building something." },
    { file: "streak-7-fun", msg: "A whole week. Your body is filing a complaint." },
  ]},
  { day: 3, variants: [
    { file: "streak-3", msg: "3 days in a row. The habit is forming." },
    { file: "streak-3-fun", msg: "3 days! Your muscles are starting to suspect something." },
  ]},
];

const TOTAL_MILESTONES = [
  { threshold: 10000, file: "total-10000", msg: "10,000 repps! That's elite." },
  { threshold: 5000, file: "total-5000", msg: "5,000 repps. You're in the top tier." },
  { threshold: 1000, file: "total-1000", msg: "One thousand repps. That's a milestone." },
  { threshold: 500, file: "total-500", msg: "500 repps! Half a thousand." },
  { threshold: 100, file: "total-100", msg: "100 total repps! Triple digits." },
];

const MESSAGES: Record<string, MessageVariant[]> = {
  "first-repps": [
    { file: "first-repps-1", msg: "Congrats on hitting your first repps!" },
    { file: "first-repps-2", msg: "Your first repps! Welcome to the movement." },
    { file: "first-repps-3", msg: "First repps done. You're officially in." },
    { file: "first-repps-4", msg: "And just like that, you're a repper." },
  ],
  "personal-best": [
    { file: "personal-best-1", msg: "New personal best! That's huge." },
    { file: "personal-best-2", msg: "You just beat your record. New PB!" },
    { file: "personal-best-3", msg: "That's a new personal best. Keep pushing." },
    { file: "personal-best-4", msg: "Who even are you right now? New PB!" },
    { file: "personal-best-5", msg: "You're built different. New personal best." },
  ],
  "longest-streak": [
    { file: "longest-streak-1", msg: "That's your longest streak ever. Don't stop now." },
    { file: "longest-streak-2", msg: "New streak record! You've never been this consistent." },
    { file: "longest-streak-3", msg: "Longest streak yet. You're on another level." },
    { file: "longest-streak-4", msg: "New streak record! Are you even human?" },
  ],
  comeback: [
    { file: "comeback-1", msg: "Welcome back. Streak starts now." },
    { file: "comeback-2", msg: "You showed up. That's what matters." },
    { file: "comeback-3", msg: "Back at it. Let's build from here." },
    { file: "comeback-4", msg: "Look who's back. The burpees missed you." },
    { file: "comeback-5", msg: "Gone but not forgotten. Welcome back legend." },
  ],
  "double-digits": [
    { file: "double-digits-1", msg: "Double digits! First time hitting 10+." },
    { file: "double-digits-2", msg: "Into the double digits. Now we're talking." },
    { file: "double-digits-3", msg: "10+ repps! Leveling up." },
    { file: "double-digits-4", msg: "Double digits! Somebody's been eating their vegetables." },
  ],
  "one-rep": [
    { file: "one-rep-1", msg: "One is more than zero. Always." },
    { file: "one-rep-2", msg: "One repp. That's all it takes to keep the streak." },
    { file: "one-rep-3", msg: "Showed up. That's the hardest part." },
    { file: "one-rep-4", msg: "One repp. Still lapped everyone on the couch." },
    { file: "one-rep-5", msg: "One and done. Respect the efficiency." },
  ],
  generic: [
    { file: "generic-1", msg: "Nice work. That's a wrap." },
    { file: "generic-2", msg: "Session done. Solid effort." },
    { file: "generic-3", msg: "Good session. See you tomorrow." },
    { file: "generic-4", msg: "Repps logged. You're getting stronger." },
    { file: "generic-5", msg: "Done! Every session counts." },
    { file: "generic-6", msg: "Your couch is crying right now." },
    { file: "generic-7", msg: "Burpees done. Snacks earned." },
    { file: "generic-8", msg: "You just out-repped everyone still in bed." },
    { file: "generic-9", msg: "That's more burpees than most people do in a year." },
    { file: "generic-10", msg: "Your future self just high-fived you." },
    { file: "generic-11", msg: "Somebody call the cops, you just murdered those burpees." },
  ],
};

function pick(arr: MessageVariant[]): MessageVariant {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickCongratsMessage(reps: number, stats: UserStats): CongratsResult {
  const prevTotal = stats.total_reps - reps;

  // 1. First repps ever
  if (prevTotal === 0) {
    const m = pick(MESSAGES["first-repps"]);
    return { message: m.msg, audioFile: m.file };
  }

  // 2. New personal best
  const prevBest = stats.previous_best_session ?? stats.best_session_count;
  if (reps > prevBest && reps > 1 && stats.days_active > 1) {
    const m = pick(MESSAGES["personal-best"]);
    return { message: m.msg, audioFile: m.file };
  }

  // 3. Streak milestones
  for (const { day, variants } of STREAK_MILESTONES) {
    if (stats.current_streak === day) {
      const m = pick(variants);
      return { message: m.msg, audioFile: m.file };
    }
  }

  // 4. New longest streak
  if (stats.current_streak > 1 && stats.current_streak >= stats.longest_streak) {
    const m = pick(MESSAGES["longest-streak"]);
    return { message: m.msg, audioFile: m.file };
  }

  // 5. Lifetime milestones (crossed threshold this session)
  for (const { threshold, file, msg } of TOTAL_MILESTONES) {
    if (stats.total_reps >= threshold && prevTotal < threshold) {
      return { message: msg, audioFile: file };
    }
  }

  // 6. Comeback
  if (stats.current_streak === 1 && stats.days_active > 1) {
    const m = pick(MESSAGES.comeback);
    return { message: m.msg, audioFile: m.file };
  }

  // 7. Double digits first time
  if (reps >= 10 && reps >= stats.best_session_count && prevTotal > 0) {
    const m = pick(MESSAGES["double-digits"]);
    return { message: m.msg, audioFile: m.file };
  }

  // 8. Just one rep
  if (reps === 1) {
    const m = pick(MESSAGES["one-rep"]);
    return { message: m.msg, audioFile: m.file };
  }

  // 9. Generic
  const m = pick(MESSAGES.generic);
  return { message: m.msg, audioFile: m.file };
}

const audioCache = new Map<string, HTMLAudioElement>();

function cacheAudio(file: string) {
  const path = `/audio/congrats/${file}.mp3`;
  const audio = new Audio();
  audio.preload = "auto";
  audio.src = path;
  audioCache.set(file, audio);
}

export function preloadCongratsAudio() {
  for (const variants of Object.values(MESSAGES)) {
    for (const { file } of variants) {
      cacheAudio(file);
    }
  }
  for (const { variants } of STREAK_MILESTONES) {
    for (const { file } of variants) {
      cacheAudio(file);
    }
  }
  for (const { file } of TOTAL_MILESTONES) {
    cacheAudio(file);
  }
}

export function playCongratsAudio(file: string): void {
  const path = `/audio/congrats/${file}.mp3`;
  let audio = audioCache.get(file);
  if (!audio) {
    audio = new Audio(path);
    audioCache.set(file, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}
