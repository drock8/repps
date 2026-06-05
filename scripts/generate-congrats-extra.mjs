/**
 * Generate additional fun/edgy congratulation audio clips using ElevenLabs API.
 *
 * Usage:
 *   node --env-file=.env scripts/generate-congrats-extra.mjs
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
  // Generic — fun
  { file: "generic-6", text: "Your couch is crying right now." },
  { file: "generic-7", text: "Burpees done. Snacks earned." },
  { file: "generic-8", text: "You just out-repped everyone still in bed." },
  { file: "generic-9", text: "That's more burpees than most people do in a year." },
  { file: "generic-10", text: "Your future self just high fived you." },
  { file: "generic-11", text: "Somebody call the cops, you just murdered those burpees." },

  // One rep — fun
  { file: "one-rep-4", text: "One repp. Still lapped everyone on the couch." },
  { file: "one-rep-5", text: "One and done. Respect the efficiency." },

  // Comeback — fun
  { file: "comeback-4", text: "Look who's back. The burpees missed you." },
  { file: "comeback-5", text: "Gone but not forgotten. Welcome back legend." },

  // First repps — fun
  { file: "first-repps-4", text: "And just like that, you're a repper." },

  // Personal best — fun
  { file: "personal-best-4", text: "Who even are you right now? New P B!" },
  { file: "personal-best-5", text: "You're built different. New personal best." },

  // Streak milestones — fun alternates
  { file: "streak-3-fun", text: "3 days! Your muscles are starting to suspect something." },
  { file: "streak-7-fun", text: "A whole week. Your body is filing a complaint." },
  { file: "streak-14-fun", text: "2 weeks. At this point you're just showing off." },
  { file: "streak-30-fun", text: "30 days! Basically an athlete now." },
  { file: "streak-100-fun", text: "100 days. You're not normal. That's a compliment." },

  // Double digits — fun
  { file: "double-digits-4", text: "Double digits! Somebody's been eating their vegetables." },

  // Longest streak — fun
  { file: "longest-streak-4", text: "New streak record! Are you even human?" },
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

  console.log(`Generating ${CLIPS.length} extra congrats clips...\n`);

  for (const clip of CLIPS) {
    await generateClip(clip);
  }

  console.log(`\nDone! ${CLIPS.length} clips in ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
