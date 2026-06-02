/**
 * Generate voice guide audio clips for DAB calibration using ElevenLabs API.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=xxx node scripts/generate-guide-audio.mjs
 *
 * Or with .env:
 *   node --env-file=.env scripts/generate-guide-audio.mjs
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
const OUTPUT_DIR = "public/audio/guide";

const CLIPS = [
  { file: "step-into-frame", text: "Step into the frame" },
  { file: "move-closer", text: "Move a bit closer" },
  { file: "step-back", text: "Step back a bit" },
  { file: "move-to-center", text: "Move to the center" },
  { file: "move-left", text: "Move a little left" },
  { file: "move-right", text: "Move a little right" },
  { file: "head-cut", text: "Tilt your phone up a bit" },
  { file: "hold-still", text: "Hold still" },
  { file: "place-phone-down", text: "Place your phone down" },
  { file: "ready", text: "Ready. Go!" },
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
          style: 0.3,
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

  console.log(`Generating ${CLIPS.length} guide clips with ElevenLabs...`);
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
