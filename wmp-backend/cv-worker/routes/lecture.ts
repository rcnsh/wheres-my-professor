import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { getDatabase } from "../mongo";

export const lectureRoute = new Hono<{ Bindings: Env }>();

const COLLECTION = "Lecture";

const createLectureSchema = z.object({
  lecture_id: z.string().min(1),
  lecturer_id: z.string().min(1),
  datetime: z.coerce.date(),
  location: z.string().min(1),
});

const updateLectureSchema = z.object({
  lecture_id: z.string().min(1).optional(),
  lecturer_id: z.string().min(1).optional(),
  datetime: z.coerce.date().optional(),
  location: z.string().min(1).optional(),
});

// GET /lecture — list all lectures (with optional filters)
lectureRoute.get("/", async (c) => {
  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const lecturerId = c.req.query("lecturer_id");
  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const skip = Number(c.req.query("skip") || 0);

  const filter: Record<string, unknown> = {};
  if (lecturerId) filter.lecturer_id = lecturerId;

  const results = await col
    .find(filter)
    .sort({ datetime: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  const total = await col.countDocuments(filter);

  return c.json({
    data: results,
    meta: { total, limit, skip, count: results.length },
  });
});

// GET /lecture/:lectureId — get a single lecture by lecture_id
lectureRoute.get("/:lectureId", async (c) => {
  const lectureId = c.req.param("lectureId");
  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const record = await col.findOne({ lecture_id: lectureId });

  if (!record) {
    return c.json({ error: "Lecture not found" }, 404);
  }

  return c.json({ data: record });
});

// POST /lecture — create a new lecture
lectureRoute.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createLectureSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      400
    );
  }

  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  // Check for duplicate lecture_id
  const existing = await col.findOne({ lecture_id: parsed.data.lecture_id });
  if (existing) {
    return c.json(
      { error: "A lecture with this lecture_id already exists" },
      409
    );
  }

  const result = await col.insertOne(parsed.data);

  return c.json({ data: { _id: result.insertedId, ...parsed.data } }, 201);
});

// PUT /lecture/:lectureId — update a lecture
lectureRoute.put("/:lectureId", async (c) => {
  const lectureId = c.req.param("lectureId");
  const body = await c.req.json();
  const parsed = updateLectureSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      400
    );
  }

  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const result = await col.findOneAndUpdate(
    { lecture_id: lectureId },
    { $set: parsed.data },
    { returnDocument: "after" }
  );

  if (!result) {
    return c.json({ error: "Lecture not found" }, 404);
  }

  return c.json({ data: result });
});

// DELETE /lecture/:lectureId — delete a lecture
lectureRoute.delete("/:lectureId", async (c) => {
  const lectureId = c.req.param("lectureId");
  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const result = await col.deleteOne({ lecture_id: lectureId });

  if (result.deletedCount === 0) {
    return c.json({ error: "Lecture not found" }, 404);
  }

  return c.json({ message: "Deleted successfully" });
});
