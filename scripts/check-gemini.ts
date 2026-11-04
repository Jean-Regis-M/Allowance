try { process.loadEnvFile(".env.local"); } catch {}
const t = setTimeout(() => { console.log("Gemini: TIMEOUT after 40s"); process.exit(2); }, 40000);
import("../src/lib/ai/llm").then(async ({ genai, withModelFallback, activeModel }) => {
  try {
    const r = await withModelFallback((model) => genai().models.generateContent({ model, contents: "Reply with the single word: ready" }));
    console.log(`Gemini (${activeModel()}): OK ->`, r.text?.trim(), "| modelVersion:", r.modelVersion);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.log("Gemini: FAILED ->", err.status ?? "", (err.message ?? String(e)).slice(0, 400));
  }
  clearTimeout(t); process.exit(0);
});
export {};
