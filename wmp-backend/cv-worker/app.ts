import { Hono } from "hono";
import { cors } from "hono/cors";
import { FaceRecognitionClient } from "./client";

const app = new Hono().basePath("/api");

app.use("*", cors());

// Lazy singleton — initialised once, reused across warm invocations
let clientPromise: Promise<FaceRecognitionClient> | null = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = FaceRecognitionClient.create();
  }
  return clientPromise;
}

// Health check
app.get("/", (c) => c.json({ status: "ok" }));

// Search by base64 image
app.post("/search", async (c) => {
  try {
    const client = await getClient();
    const body = await c.req.json();
    const { image, topK, threshold } = body as {
      image: string;
      topK?: number;
      threshold?: number;
    };

    if (!image) {
      return c.json({ error: "Missing 'image' field (base64 string)" }, 400);
    }

    // Strip optional data-URI prefix (e.g. "data:image/jpeg;base64,")
    const base64 = image.includes(",") ? image.split(",")[1] : image;

    const result = await client.searchByBase64(base64, {
      topK: topK ?? 3,
      threshold: threshold ?? 0.4,
    });

    return c.json(result);
  } catch (err: any) {
    console.error("Search error:", err);
    return c.json({ error: err.message ?? "Internal server error" }, 500);
  }
});

// List registered people
app.get("/people", async (c) => {
  const client = await getClient();
  const people = await client.listPeople();
  return c.json(people);
});

// Database stats
app.get("/stats", async (c) => {
  const client = await getClient();
  const stats = await client.getStats();
  return c.json(stats);
});

export default app;
