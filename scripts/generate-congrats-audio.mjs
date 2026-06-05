/**
 * Generate congratulation audio clips using ElevenLabs API.
 *
 * Usage:
 *   node --env-file=.env scripts/generate-congrats-audio.mjs
 */

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("Set ELEVENLABS_API_KEY env var");
  process.exit(1);
}

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MODEL_ID = "eleven_turbo_v2_5";
const OUTPUT_DIR = "public/audio/congrats";

const CLIPS = [
  // First repps (first time ever)
  { file: "first-repps-1", text: "Congrats on hitting your first repps!" },
  { file: "first-repps-2", text: "Your first repps! Welcome to the movement." },
  { file: "first-repps-3", text: "First repps done. You're officially in." },

  // New personal best
  { file: "personal-best-1", text: "New personal best! That's huge." },
  { file: "personal-best-2", text: "You just beat your record. New P B!" },
  { file: "personal-best-3", text: "That's a new personal best. Keep pushing." },

  // Streak milestones
  { file: "streak-3", text: "3 days in a row. The habit is forming." },
  { file: "streak-7", text: "7 days straight. You're building something." },
  { file: "streak-14", text: "Two weeks strong. That's real commitment." },
  { file: "streak-30", text: "30 day streak! You're unstoppable." },
  { file: "streak-60", text: "60 days. This is who you are now." },
  { file: "streak-100", text: "100 day streak. Legendary." },

  // New longest streak
  { file: "longest-streak-1", text: "That's your longest streak ever. Don't stop now." },
  { file: "longest-streak-2", text: "New streak record! You've never been this consistent." },
  { file: "longest-streak-3", text: "Longest streak yet. You're on another level." },

  // Lifetime milestones
  { file: "total-100", text: "100 total repps! Triple digits." },
  { file: "total-500", text: "500 repps! Half a thousand." },
  { file: "total-1000", text: "One thousand repps. That's a milestone." },
  { file: "total-5000", text: "5,000 repps. You're in the top tier." },
  { file: "total-10000", text: "10,000 repps! That's elite." },

  // Comeback
  { file: "comeback-1", text: "Welcome back. Streak starts now." },
  { file: "comeback-2", text: "You showed up. That's what matters." },
  { file: "comeback-3", text: "Back at it. Let's build from here." },

  // Double digits first time
  { file: "double-digits-1", text: "Double digits! First time hitting ten plus." },
  { file: "double-digits-2", text: "Into the double digits. Now we're talking." },
  { file: "double-digits-3", text: "10 plus repps! Leveling up." },

  // Just one rep
  { file: "one-rep-1", text: "One is more than zero. Always." },
  { file: "one-rep-2", text: "One repp. That's all it takes to keep the streak." },
  { file: "one-rep-3", text: "Showed up. That's the hardest part." },

  // Generic / fallback
  { file: "generic-1", text: "Nice work. That's a wrap." },
  { file: "generic-2", text: "Session done. Solid effort." },
  { file: "generic-3", text: "Good session. See you tomorrow." },
  { file: "generic-4", text: "Repps logged. You're getting stronger." },
  { file: "generic-5", text: "Done! Every session counts." },
];

async function generateClip({ file, text }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${file}: ${res.status} ${err}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const path = `${OUTPUT_DIR}/${file}.mp3`;
  await writeFile(path, buf);
  console.log(`✓ ${path} (${buf.length} bytes)`);
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Generating ${CLIPS.length} congrats clips...\n`);

  // Generate sequentially to avoid rate limits
  for (const clip of CLIPS) {
    await generateClip(clip);
  }

  console.log(`\nDone! ${CLIPS.length} clips in ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
