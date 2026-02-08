import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Env, searchByBase64, listPeople, getStats } from "./client";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => c.json({ status: "ok" }));

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
