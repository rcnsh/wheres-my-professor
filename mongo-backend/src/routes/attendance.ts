import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDatabase } from '../services/mongo';

export const attendanceRoute = new Hono();

const COLLECTION = 'Attendance';

const createAttendanceSchema = z.object({
  lecture_id: z.string().min(1),
  student_id: z.string().min(1),
  emotion_score: z.number().min(0).max(100),
});

const updateAttendanceSchema = z.object({
  lecture_id: z.string().min(1).optional(),
  student_id: z.string().min(1).optional(),
  emotion_score: z.number().min(0).max(100).optional(),
});

// GET /attendance — list all attendance records (with optional filters)
attendanceRoute.get('/', async (c) => {
  const db = await getDatabase();
  const col = db.collection(COLLECTION);

  const lectureId = c.req.query('lecture_id');
  const studentId = c.req.query('student_id');
  const limit = Math.min(Number(c.req.query('limit') || 50), 100);
  const skip = Number(c.req.query('skip') || 0);

  const filter: Record<string, unknown> = {};
  if (lectureId) filter.lecture_id = lectureId;
  if (studentId) filter.student_id = studentId;

  const results = await col.find(filter).skip(skip).limit(limit).toArray();
  const total = await col.countDocuments(filter);

  return c.json({ data: results, meta: { total, limit, skip, count: results.length } });
});

// GET /attendance/:id — get a single attendance record
attendanceRoute.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDatabase();
  const col = db.collection(COLLECTION);

  let record;
  try {
    record = await col.findOne({ _id: new ObjectId(id) });
  } catch {
    return c.json({ error: 'Invalid ID format' }, 400);
  }

  if (!record) {
    return c.json({ error: 'Attendance record not found' }, 404);
  }

  return c.json({ data: record });
});

// POST /attendance — create a new attendance record
attendanceRoute.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createAttendanceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.flatten() }, 400);
  }

  const db = await getDatabase();
  const col = db.collection(COLLECTION);

  const result = await col.insertOne(parsed.data);

  return c.json({ data: { _id: result.insertedId, ...parsed.data } }, 201);
});

// PUT /attendance/:id — update an attendance record
attendanceRoute.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateAttendanceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.flatten() }, 400);
  }

  const db = await getDatabase();
  const col = db.collection(COLLECTION);

  let result;
  try {
    result = await col.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: parsed.data },
      { returnDocument: 'after' },
    );
  } catch {
    return c.json({ error: 'Invalid ID format' }, 400);
  }

  if (!result) {
    return c.json({ error: 'Attendance record not found' }, 404);
  }

  return c.json({ data: result });
});

// DELETE /attendance/:id — delete an attendance record
attendanceRoute.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = await getDatabase();
  const col = db.collection(COLLECTION);

  let result;
  try {
    result = await col.deleteOne({ _id: new ObjectId(id) });
  } catch {
    return c.json({ error: 'Invalid ID format' }, 400);
  }

  if (result.deletedCount === 0) {
    return c.json({ error: 'Attendance record not found' }, 404);
  }

  return c.json({ message: 'Deleted successfully' });
});
