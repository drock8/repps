/**
 * Generate coaching audio clips for burpee rejection/encouragement using ElevenLabs API.
 *
 * Usage:
 *   node --env-file=.env scripts/generate-coach-audio.mjs
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
const OUTPUT_DIR = "public/audio/coach";

const CLIPS = [
  // Rejection cues — primary
  { file: "all-the-way-down", text: "All the way down!" },
  { file: "touch-the-floor", text: "Touch the floor!" },
  { file: "stand-tall", text: "Stand tall!" },
  { file: "jump-up", text: "Jump up!" },
  { file: "knees-up", text: "Knees up!" },
  { file: "kick-back", text: "Kick back!" },
  { file: "keep-moving", text: "Keep moving!" },
  { file: "step-back-in", text: "Step back in!" },

  // Rejection cues — escalated
  { file: "chest-to-floor", text: "Chest to floor!" },
  { file: "lay-flat", text: "Lay flat!" },
  { file: "all-the-way-up", text: "All the way up!" },
  { file: "feet-off", text: "Feet off the ground!" },
  { file: "drive-those-knees", text: "Drive those knees!" },

  // Mid-movement coaching
  { file: "keep-going", text: "Keep going!" },
  { file: "push-up", text: "Push up!" },
  { file: "get-up", text: "Get up!" },

  // Encouragement
  { file: "nice", text: "Nice!" },
  { file: "lets-go", text: "Let's go!" },
  { file: "on-fire", text: "On fire!" },

  // Forward-drift rejection cues
  { file: "drop-in-place", text: "Drop in place!" },
  { file: "drop-straight-down", text: "Drop straight down!" },
  { file: "hands-to-feet", text: "Hands to feet!" },

  // Additional clips from COACHING_SPEC §9
  { file: "halfway", text: "Halfway!" },
  { file: "last-one", text: "Last one!" },
  { file: "step-in", text: "Step in!" },
  { file: "hold-still", text: "Hold still!" },
  { file: "great-session", text: "Great session!" },
];

async function generateClip({ file, text }) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
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
          stability: 0.75,
          similarity_boost: 0.85,
          style: 0.45,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs API error for "${text}": ${res.status} — ${err}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const path = `${OUTPUT_DIR}/${file}.mp3`;
  await writeFile(path, buffer);
  console.log(`  ✓ ${path} (${buffer.length} bytes)`);
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Generating ${CLIPS.length} coach clips with ElevenLabs...`);
  console.log(`Voice: Rachel (${VOICE_ID}), Model: ${MODEL_ID}\n`);

  for (const clip of CLIPS) {
    await generateClip(clip);
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nDone! ${CLIPS.length} clips saved to ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
