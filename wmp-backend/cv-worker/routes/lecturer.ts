import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { getDatabase } from "../mongo";

export const lecturerRoute = new Hono<{ Bindings: Env }>();

const COLLECTION = "Lecturer";

const createLecturerSchema = z.object({
  lecturer_id: z.string().min(1),
  fullname: z.string().min(1),
});

const updateLecturerSchema = z.object({
  lecturer_id: z.string().min(1).optional(),
  fullname: z.string().min(1).optional(),
});

// GET /lecturer — list all lecturers
lecturerRoute.get("/", async (c) => {
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

// POST /lecturer — create a new lecturer
lecturerRoute.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createLecturerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      400
    );
  }

  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const existing = await col.findOne({
    lecturer_id: parsed.data.lecturer_id,
  });
  if (existing) {
    return c.json(
      { error: "A lecturer with this lecturer_id already exists" },
      409
    );
  }

  const result = await col.insertOne(parsed.data);
  return c.json({ data: { _id: result.insertedId, ...parsed.data } }, 201);
});

// PUT /lecturer/:lecturerId — update a lecturer
lecturerRoute.put("/:lecturerId", async (c) => {
  const lecturerId = c.req.param("lecturerId");
  const body = await c.req.json();
  const parsed = updateLecturerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request body", issues: parsed.error.flatten() },
      400
    );
  }

  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const result = await col.findOneAndUpdate(
    { lecturer_id: lecturerId },
    { $set: parsed.data },
    { returnDocument: "after" }
  );

  if (!result) {
    return c.json({ error: "Lecturer not found" }, 404);
  }

  return c.json({ data: result });
});

// DELETE /lecturer/:lecturerId — delete a lecturer
lecturerRoute.delete("/:lecturerId", async (c) => {
  const lecturerId = c.req.param("lecturerId");
  const db = await getDatabase(c.env);
  const col = db.collection(COLLECTION);

  const result = await col.deleteOne({ lecturer_id: lecturerId });

  if (result.deletedCount === 0) {
    return c.json({ error: "Lecturer not found" }, 404);
  }

  return c.json({ message: "Deleted successfully" });
});

// GET /lecturer/:lecturerId/profile
// Returns lecturer info + aggregated stats
lecturerRoute.get("/:lecturerId/profile", async (c) => {
  const lecturerId = c.req.param("lecturerId");
  const nameParam = c.req.query('name');
  const db = await getDatabase(c.env);

  const lecturerCol = db.collection("Lecturer");
  const lectureCol = db.collection("Lecture");
  const attendanceCol = db.collection("Attendance");
  const studentCol = db.collection("Student");

  const lecturer = await lecturerCol.findOne({ lecturer_id: lecturerId });
  const lecturerName = lecturer?.fullname ?? nameParam ?? lecturerId;

  const lectures = await lectureCol
    .find({ lecturer_id: lecturerId })
    .toArray();
  const lectureIds = lectures.map((l) => l.lecture_id);
  const totalLectures = lectures.length;

  const attendanceRecords = await attendanceCol
    .find({
      $or: [
        { lecture_id: { $in: lectureIds } },
        { lecture_id: lecturerName },
        { lecture_id: lecturerId },
        { lecturer_id: lecturerName },
        { lecturer_id: lecturerId },
      ],
    })
    .toArray();

  const totalStudents = await studentCol.countDocuments({});

  const totalAttendableSlots = Math.max(totalLectures * totalStudents, attendanceRecords.length);
  const attendanceRate =
    totalAttendableSlots > 0
      ? Math.round((attendanceRecords.length / totalAttendableSlots) * 100)
      : 0;

  const avgEngagement =
    attendanceRecords.length > 0
      ? Math.round(
          attendanceRecords.reduce(
            (sum, r) => sum + (r.emotion_score ?? 0),
            0
          ) / attendanceRecords.length
        )
      : 0;

  const activeStudentIds = new Set(
    attendanceRecords.map((r) => r.student_id)
  );
  const activeStudents = activeStudentIds.size;

  return c.json({
    lecturer: {
      id: lecturerId,
      fullname: lecturerName,
    },
    stats: {
      avgEngagement,
      attendanceRate,
      totalLectures: Math.max(totalLectures, 1),
      activeStudents,
    },
  });
});

// GET /lecturer/:lecturerId/heatmap
// Returns daily engagement scores for heatmap visualisation
lecturerRoute.get("/:lecturerId/heatmap", async (c) => {
  const lecturerId = c.req.param("lecturerId");
  const db = await getDatabase(c.env);

  const lectureCol = db.collection("Lecture");
  const attendanceCol = db.collection("Attendance");
  const lecturerCol = db.collection("Lecturer");

  // Resolve lecturer name for matching against lecture_id in Attendance
  const nameParam = c.req.query('name');
  const lecturer = await lecturerCol.findOne({ lecturer_id: lecturerId });
  const lecturerName = lecturer?.fullname ?? nameParam ?? lecturerId;

  // Get lecture_ids from the Lecture collection for this lecturer
  const lectures = await lectureCol
    .find({ lecturer_id: lecturerId })
    .toArray();
  const lectureIds = lectures.map((l) => l.lecture_id);

  // Query attendance matching Lecture.lecture_id, lecturer name, or lecturer_id field
  const attendanceRecords = await attendanceCol
    .find({
      $or: [
        { lecture_id: { $in: lectureIds } },
        { lecture_id: lecturerName },
        { lecture_id: lecturerId },
        { lecturer_id: lecturerName },
        { lecturer_id: lecturerId },
      ],
    })
    .toArray();

  // Build lecture datetime lookup
  const lectureMap = Object.fromEntries(
    lectures.map((l) => [l.lecture_id, l])
  );

  const dayMap: Record<string, { total: number; count: number }> = {};
  for (const record of attendanceRecords) {
    // Prefer the attendance record's own timestamp, fall back to lecture datetime
    let dateKey: string | null = null;
    if (record.timestamp) {
      dateKey = new Date(record.timestamp).toISOString().slice(0, 10);
    } else {
      const lecture = lectureMap[record.lecture_id];
      if (lecture?.datetime) {
        dateKey = new Date(lecture.datetime).toISOString().slice(0, 10);
      }
    }
    if (!dateKey) continue;
    if (!dayMap[dateKey]) dayMap[dateKey] = { total: 0, count: 0 };
    dayMap[dateKey].total += record.emotion_score ?? 0;
    dayMap[dateKey].count += 1;
  }

  const heatmap = Object.entries(dayMap)
    .map(([date, { total, count }]) => ({
      date,
      score: Math.round(total / count),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return c.json({ heatmap });
});

// GET /lecturer/:lecturerId/next-session
// Returns the next upcoming lecture for this lecturer
lecturerRoute.get("/:lecturerId/next-session", async (c) => {
  const lecturerId = c.req.param("lecturerId");
  const db = await getDatabase(c.env);

  const lectureCol = db.collection("Lecture");
  const attendanceCol = db.collection("Attendance");

  const now = new Date();
  const nextLecture = await lectureCol.findOne(
    { lecturer_id: lecturerId, datetime: { $gte: now } },
    { sort: { datetime: 1 } }
  );

  if (!nextLecture) {
    return c.json({ session: null });
  }

  const pastRecords = await attendanceCol
    .find({ lecture_id: nextLecture.lecture_id })
    .toArray();

  const targetScore =
    pastRecords.length > 0
      ? Math.round(
          pastRecords.reduce((sum, r) => sum + (r.emotion_score ?? 0), 0) /
            pastRecords.length
        )
      : null;

  return c.json({
    session: {
      lecture_id: nextLecture.lecture_id,
      datetime: nextLecture.datetime,
      location: nextLecture.location,
      targetScore,
    },
  });
});

// GET /lecturer/:lecturerId/lectures
// Returns all lectures for this lecturer with per-lecture stats
lecturerRoute.get("/:lecturerId/lectures", async (c) => {
  const lecturerId = c.req.param("lecturerId");
  const db = await getDatabase(c.env);

  const lectureCol = db.collection("Lecture");
  const attendanceCol = db.collection("Attendance");

  const lectures = await lectureCol
    .find({ lecturer_id: lecturerId })
    .sort({ datetime: -1 })
    .toArray();

  const lectureIds = lectures.map((l) => l.lecture_id);
  const attendanceRecords = await attendanceCol
    .find({ lecture_id: { $in: lectureIds } })
    .toArray();

  const attendanceByLecture: Record<
    string,
    { count: number; totalScore: number }
  > = {};
  for (const record of attendanceRecords) {
    if (!attendanceByLecture[record.lecture_id]) {
      attendanceByLecture[record.lecture_id] = { count: 0, totalScore: 0 };
    }
    attendanceByLecture[record.lecture_id].count += 1;
    attendanceByLecture[record.lecture_id].totalScore +=
      record.emotion_score ?? 0;
  }

  const result = lectures.map((l) => {
    const stats = attendanceByLecture[l.lecture_id];
    return {
      lecture_id: l.lecture_id,
      datetime: l.datetime,
      location: l.location,
      attendees: stats?.count ?? 0,
      avgEngagement: stats ? Math.round(stats.totalScore / stats.count) : 0,
    };
  });

  return c.json({ lectures: result });
});
