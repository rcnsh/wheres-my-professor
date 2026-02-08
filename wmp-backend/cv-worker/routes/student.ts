import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { getDatabase } from "../mongo";

export const studentRoute = new Hono<{ Bindings: Env }>();

const COLLECTION = "Student";

const createStudentSchema = z.object({
  student_id: z.string().min(1),
  fullname: z.string().min(1),
});

const updateStudentSchema = z.object({
  student_id: z.string().min(1).optional(),
  fullname: z.string().min(1).optional(),
});

// GET /student — list all students
studentRoute.get("/", async (c) => {
  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const skip = Number(c.req.query("skip") || 0);

  const results = await col.find({}).skip(skip).limit(limit).toArray();
  const total = await col.countDocuments({});

  return c.json({
    data: results,
    meta: { total, limit, skip, count: results.length },
  });
});

// POST /student — create a new student
studentRoute.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createStudentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      400
    );
  }

  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const existing = await col.findOne({ student_id: parsed.data.student_id });
  if (existing) {
    return c.json(
      { error: "A student with this student_id already exists" },
      409
    );
  }

  const result = await col.insertOne(parsed.data);
  return c.json({ data: { _id: result.insertedId, ...parsed.data } }, 201);
});

// PUT /student/:studentId — update a student
studentRoute.put("/:studentId", async (c) => {
  const studentId = c.req.param("studentId");
  const body = await c.req.json();
  const parsed = updateStudentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      400
    );
  }

  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const result = await col.findOneAndUpdate(
    { student_id: studentId },
    { $set: parsed.data },
    { returnDocument: "after" }
  );

  if (!result) {
    return c.json({ error: "Student not found" }, 404);
  }

  return c.json({ data: result });
});

// DELETE /student/:studentId — delete a student
studentRoute.delete("/:studentId", async (c) => {
  const studentId = c.req.param("studentId");
  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const result = await col.deleteOne({ student_id: studentId });

  if (result.deletedCount === 0) {
    return c.json({ error: "Student not found" }, 404);
  }

  return c.json({ message: "Deleted successfully" });
});

// GET /student/:studentId/profile
// Returns student info + attendance stats + module count
studentRoute.get("/:studentId/profile", async (c) => {
  const studentId = c.req.param("studentId");
  const db = await getDatabase(c.env);

  const studentCol = db.collection("Student");
  const attendanceCol = db.collection("Attendance");
  const lectureCol = db.collection("Lecture");

  const student = await studentCol.findOne({ student_id: studentId });
  if (!student) {
    return c.json({ error: "Student not found" }, 404);
  }

  const totalLectures = await lectureCol.countDocuments({});
  const attendedCount = await attendanceCol.countDocuments({
    student_id: studentId,
  });

  const attendancePercent =
    totalLectures > 0
      ? Math.round((attendedCount / totalLectures) * 100)
      : 0;

  const distinctLectures = await attendanceCol.distinct("lecture_id", {
    student_id: studentId,
  });
  const modules = distinctLectures.length;

  return c.json({
    student: {
      id: student.student_id,
      fullname: student.fullname,
    },
    stats: {
      attendance: attendancePercent,
      modules,
      totalLectures,
      attendedCount,
    },
  });
});

// GET /student/:studentId/schedule?date=2026-02-08
// Returns upcoming lectures for the student on a given date
studentRoute.get("/:studentId/schedule", async (c) => {
  const studentId = c.req.param("studentId");
  const dateParam = c.req.query("date");
  const db = await getDatabase(c.env);

  const attendanceCol = db.collection("Attendance");
  const lectureCol = db.collection("Lecture");
  const lecturerCol = db.collection("Lecturer");

  const enrolledLectureIds = await attendanceCol.distinct("lecture_id", {
    student_id: studentId,
  });

  const filter: Record<string, unknown> = {
    lecture_id: { $in: enrolledLectureIds },
  };
  if (dateParam) {
    const start = new Date(dateParam);
    const end = new Date(dateParam);
    end.setDate(end.getDate() + 1);
    filter.datetime = { $gte: start, $lt: end };
  }

  const lectures = await lectureCol
    .find(filter)
    .sort({ datetime: 1 })
    .limit(20)
    .toArray();

  const lecturerIds = [...new Set(lectures.map((l) => l.lecturer_id))];
  const lecturers = await lecturerCol
    .find({ lecturer_id: { $in: lecturerIds } })
    .toArray();
  const lecturerMap = Object.fromEntries(
    lecturers.map((l) => [l.lecturer_id, l.fullname])
  );

  const schedule = lectures.map((l) => ({
    lecture_id: l.lecture_id,
    datetime: l.datetime,
    location: l.location,
    lecturer: lecturerMap[l.lecturer_id] ?? "Unknown",
  }));

  return c.json({ schedule });
});

// GET /student/:studentId/emotions
// Returns emotion score history for the student
studentRoute.get("/:studentId/emotions", async (c) => {
  const studentId = c.req.param("studentId");
  const db = await getDatabase(c.env);

  const attendanceCol = db.collection("Attendance");
  const lectureCol = db.collection("Lecture");

  const records = await attendanceCol
    .find({ student_id: studentId })
    .toArray();

  const lectureIds = [...new Set(records.map((r) => r.lecture_id))];
  const lectures = await lectureCol
    .find({ lecture_id: { $in: lectureIds } })
    .toArray();
  const lectureMap = Object.fromEntries(
    lectures.map((l) => [l.lecture_id, l])
  );

  const emotions = records.map((r) => ({
    lecture_id: r.lecture_id,
    emotion_score: r.emotion_score,
    datetime: lectureMap[r.lecture_id]?.datetime ?? null,
    location: lectureMap[r.lecture_id]?.location ?? null,
  }));

  const avg =
    records.length > 0
      ? Math.round(
          records.reduce((sum, r) => sum + (r.emotion_score ?? 0), 0) /
            records.length
        )
      : 0;

  return c.json({ emotions, avgEmotionScore: avg });
});
