/**
 * Voiceover with Gemini text-to-speech. One WAV per scene in .capture/vo/.
 * Usage: npx tsx scripts/video/tts.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env */
}

/** One model for every scene keeps the narrator's voice consistent. */
const MODELS = (process.env.TTS_MODELS ?? "gemini-3.1-flash-tts-preview").split(",");

/** Wrap raw 16-bit mono PCM in a WAV header. */
function wav(pcm: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function main() {
  const { genai } = await import("../../src/lib/ai/llm");
  const script = JSON.parse(readFileSync("scripts/video/script.json", "utf8")) as {
    voice: string;
    style: string;
    scenes: Array<{ id: string; vo: string }>;
  };
  mkdirSync(".capture/vo", { recursive: true });
  for (const s of script.scenes) {
    const out = `.capture/vo/${s.id}.wav`;
    if (existsSync(out) && !process.argv.includes("--force")) {
      console.log("skip", s.id);
      continue;
    }
    let done = false;
    for (let attempt = 0; attempt < 6 && !done; attempt++) {
      for (const model of MODELS) {
        try {
          const res = await genai().models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: `${script.style}\n\n${s.vo}` }] }],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: script.voice } } },
            },
          });
          const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
          if (!part?.inlineData?.data) throw new Error("no audio in response");
          const mime = part.inlineData.mimeType ?? "";
          const bytes = Buffer.from(part.inlineData.data, "base64");
          const isWav = bytes.subarray(0, 4).toString() === "RIFF";
          const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
          writeFileSync(out, isWav ? bytes : wav(bytes, rate));
          console.log(`✔ ${s.id} (${model}, ${mime})`);
          done = true;
          break;
        } catch (e) {
          console.log(`  ${s.id} ${model}: ${(e as Error).message.slice(0, 120)}`);
        }
      }
      if (!done) await new Promise((r) => setTimeout(r, 25000));
    }
    if (!done) throw new Error(`TTS failed for ${s.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✘", (e as Error).message);
    process.exit(1);
  });
export {};
