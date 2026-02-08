import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Env, searchByBase64, listPeople, getStats } from "./client";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => c.json({ status: "ok" }));

// ── Emotion analysis (proxies to HuggingFace) ──
app.post("/analyse", async (c) => {
  try {
    const { image } = await c.req.json();

    if (!image) {
      return c.json({ error: "Missing 'image' field (base64 string)" }, 400);
    }

    // Strip optional data-URI prefix (e.g. "data:image/jpeg;base64,")
    const base64 = image.includes(",") ? image.split(",")[1] : image;

    // Decode base64 → binary for HuggingFace endpoint
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Send raw image bytes to the HuggingFace emotion model
    const hfResponse = await fetch(c.env.HF_EMOTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Authorization": `Bearer ${c.env.HF_API_KEY}`,
      },
      body: bytes,
    });

    if (!hfResponse.ok) {
      const errText = await hfResponse.text().catch(() => "");
      throw new Error(
        `HuggingFace API responded with ${hfResponse.status}: ${errText}`
      );
    }

    const rawEmotions: Record<string, string>[] = await hfResponse.json();

    // Transform from [{happy: "0.1"}, {sad: "0.2"}]
    //            to  [{label: "happy", score: 0.1}, ...]
    const emotions = rawEmotions
      .map((obj) => {
        const [label, scoreStr] = Object.entries(obj)[0];
        return { label: label.toLowerCase(), score: parseFloat(scoreStr) };
      })
      .sort((a, b) => b.score - a.score);

    return c.json(emotions);
  } catch (err: any) {
    console.error("Analyse error:", err);
    return c.json({ error: err.message ?? "Internal server error" }, 500);
  }
});

app.post("/search", async (c) => {
  try {
    const { image, topK, threshold } = await c.req.json();

    if (!image) {
      return c.json({ error: "Missing 'image' field (base64 string)" }, 400);
    }

    // Strip optional data-URI prefix (e.g. "data:image/jpeg;base64,")
    const base64 = image.includes(",") ? image.split(",")[1] : image;

    const result = await searchByBase64(c.env, base64, {
      topK: topK ?? 3,
      threshold: threshold ?? 0.4,
    });

    return c.json(result);
  } catch (err: any) {
    console.error("Search error:", err);
    return c.json({ error: err.message ?? "Internal server error" }, 500);
  }
});

app.get("/people", async (c) => {
  try {
    return c.json(await listPeople(c.env));
  } catch (err: any) {
    console.error("People error:", err);
    return c.json({ error: err.message ?? "Internal server error" }, 500);
  }
});

app.get("/stats", async (c) => {
  try {
    return c.json(await getStats(c.env));
  } catch (err: any) {
    console.error("Stats error:", err);
    return c.json({ error: err.message ?? "Internal server error" }, 500);
  }
});

export default app;
