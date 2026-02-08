import { Hono } from "hono";
import { cors } from "hono/cors";
import { OpenRouter } from "@openrouter/sdk";
import { type Env, searchByBase64, listPeople, getStats } from "./client";
import { getDatabase } from "./mongo";
import { attendanceRoute } from "./routes/attendance";
import { lectureRoute } from "./routes/lecture";
import { lecturerRoute } from "./routes/lecturer";
import { recordsRoute } from "./routes/records";
import { studentRoute } from "./routes/student";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// ── Health ──
app.get("/", (c) => c.json({ status: "ok" }));

app.get("/health", async (c) => {
  try {
    const db = await getDatabase(c.env);
    await db.command({ ping: 1 });
    return c.json({ ok: true, mongo: "reachable" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ ok: false, mongo: message }, 503);
  }
});

// ── CV / Face Recognition routes ──

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
        "Content-Type": "image/jpeg",
        Authorization: `Bearer ${c.env.HF_API_KEY}`,
      },
      body: bytes,
    });

    if (!hfResponse.ok) {
      const errText = await hfResponse.text().catch(() => "");
      throw new Error(
        `HuggingFace API responded with ${hfResponse.status}: ${errText}`
      );
    }

    const raw: any = await hfResponse.json();

    // HuggingFace may return [[...]] (nested) or [...] (flat)
    const list: any[] = Array.isArray(raw[0]) ? raw[0] : raw;

    const emotions = list
      .map((obj: any) => ({
        label: String(obj.label).toLowerCase(),
        score: Number(obj.score),
      }))
      .sort((a, b) => b.score - a.score);

    return c.json(emotions);
  } catch (err: any) {
    console.error("Analyse error:", err);
    return c.json({ error: err.message ?? "Internal server error" }, 500);
  }
});

app.post("/emotion-score", async (c) => {
  try {
    const { emotions } = await c.req.json();

    if (!emotions || !Array.isArray(emotions)) {
      return c.json({ error: "Missing 'emotions' array" }, 400);
    }

    const emotionSummary = emotions
      .map((e: any) => `${e.label}: ${(e.score * 100).toFixed(1)}%`)
      .join(", ");

    const openRouter = new OpenRouter({
      apiKey: c.env.OPENROUTER_API_KEY,
    });

    const completion = await openRouter.chat.send({
      chatGenerationParams: {
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "user",
            content: `Given the following facial emotion analysis results: ${emotionSummary}. Rate the overall emotion on a scale from 0 to 100, where 100 is the happiest and 0 is the saddest. Respond with ONLY a single integer number, nothing else.`,
          },
        ],
        stream: false,
      },
    });

    const raw = (completion as any).choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw.trim() : "";
    const score = parseInt(text, 10);

    if (isNaN(score) || score < 0 || score > 100) {
      return c.json({ error: "LLM returned unexpected value", raw: text }, 502);
    }

    return c.json({ score });
  } catch (err: any) {
    console.error("Emotion score error:", err);
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

// ── MongoDB CRUD routes ──
app.route("/attendance", attendanceRoute);
app.route("/lecture", lectureRoute);
app.route("/lecturer", lecturerRoute);
app.route("/records", recordsRoute);
app.route("/student", studentRoute);

export default app;
