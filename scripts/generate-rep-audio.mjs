/**
 * Generate rep count audio clips using ElevenLabs API.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=xxx node scripts/generate-rep-audio.mjs
 *
 * Generates public/audio/rep-1.mp3 through rep-50.mp3
 */

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("Set ELEVENLABS_API_KEY env var");
  process.exit(1);
}

// Rachel voice — clear, energetic female voice. Change voice_id as desired.
// Popular options: "21m00Tcm4TlvDq8ikWAM" (Rachel), "EXAVITQu4vr4xnSDxMaL" (Bella)
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = "eleven_turbo_v2_5";
const OUTPUT_DIR = "public/audio";
const MAX_REPS = 100;

async function generateClip(number) {
  const text = String(number);

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
          style: 0.4,
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
  const path = `${OUTPUT_DIR}/rep-${number}.mp3`;
  await writeFile(path, buffer);
  console.log(`  ✓ ${path} (${buffer.length} bytes)`);
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Generating ${MAX_REPS} audio clips with ElevenLabs...`);
  console.log(`Voice: ${VOICE_ID}, Model: ${MODEL_ID}\n`);

  // Generate in batches of 5 to respect rate limits
  for (let i = 1; i <= MAX_REPS; i += 5) {
    const batch = [];
    for (let j = i; j < Math.min(i + 5, MAX_REPS + 1); j++) {
      batch.push(generateClip(j));
    }
    await Promise.all(batch);
    // Small delay between batches
    if (i + 5 <= MAX_REPS) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\nDone! ${MAX_REPS} clips saved to ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
