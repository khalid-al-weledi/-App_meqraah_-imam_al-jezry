
const express = require("express");
const { z } = require("zod");
const { query, pool } = require("./db");
const { authenticateToken, requireRoles } = require("./security");

const router = express.Router();

router.use(authenticateToken);

const staffRoles = [
  "SUPER_ADMIN",
  "ACADEMIC_SUPERVISOR",
  "TEACHER"
];

const createExamSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(200),
  examType: z.enum([
    "PLACEMENT",
    "HIFZ",
    "TAJWEED",
    "RIWAYAH",
    "QIRAAT",
    "IJAZAH"
  ]),
  scheduledAt: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(2000).optional().default("")
});

const resultSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  resultStatus: z.enum([
    "PASS",
    "FAIL",
    "NEEDS_REVIEW"
  ]),
  feedback: z.string().trim().max(3000).optional().default("")
});

// GET /api/exams/my
// يعرض اختبارات الطالب فقط.
router.get("/my", requireRoles("STUDENT"), async (req, res) => {
  try {
    const result = await query(
      `SELECT
         e.id,
         e.title,
         e.exam_type,
         e.scheduled_at,
         e.status,
         e.score,
         e.result_status,
         e.feedback,
         e.notes
       FROM exams e
       JOIN student_profiles sp ON sp.id = e.student_id
       WHERE sp.user_id = $1
       ORDER BY e.scheduled_at DESC`,
      [req.user.id]
    );

    return res.json({
      success: true,
      exams: result.rows
    });
  } catch (error) {
    console.error("Student exams error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب الاختبارات."
    });
  }
});

// GET /api/exams
// يعرض اختبارات المعلم المسندة إليه، أو اختبارات الإدارة.
router.get("/", requireRoles(...staffRoles), async (req, res) => {
  try {
    const params = [];
    let teacherFilter = "";

    if (req.user.role === "TEACHER") {
      params.push(req.user.id);
      teacherFilter = `AND e.teacher_id = $${params.length}`;
    }

    const result = await query(
      `SELECT
         e.id,
         e.student_id,
         sp.student_code,
         u.full_name AS student_name,
         e.teacher_id,
         e.title,
         e.exam_type,
         e.scheduled_at,
         e.status,
         e.score,
         e.result_status,
         e.feedback,
         e.notes,
         e.created_at
       FROM exams e
       JOIN student_profiles sp ON sp.id = e.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE 1 = 1 ${teacherFilter}
       ORDER BY e.scheduled_at DESC
       LIMIT 300`,
      params
    );

    return res.json({
      success: true,
      count: result.rows.length,
      exams: result.rows
    });
  } catch (error) {
    console.error("Exam list error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب قائمة الاختبارات."
    });
  }
});

// POST /api/exams
// ينشئ اختبارًا للطالب.
router.post(
  "/",
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR"),
  async (req, res) => {
    const parsed = createExamSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "بيانات الاختبار غير صحيحة.",
        errors: parsed.error.flatten()
      });
    }

    const data = parsed.data;

    try {
      const student = await query(
        `SELECT sp.id
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.id = $1
           AND u.role = 'STUDENT'
           AND u.is_active = TRUE`,
        [data.studentId]
      );

      if (student.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "الطالب غير موجود أو غير نشط."
        });
      }

      const result = await query(
        `INSERT INTO exams
          (student_id, title, exam_type, scheduled_at, status, notes)
         VALUES ($1, $2, $3, $4, 'SCHEDULED', $5)
         RETURNING *`,
        [
          data.studentId,
          data.title,
          data.examType,
          data.scheduledAt,
          data.notes
        ]
      );

      return res.status(201).json({
        success: true,
        message: "تم إنشاء الاختبار.",
        exam: result.rows[0]
      });
    } catch (error) {
      console.error("Create exam error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر إنشاء الاختبار."
      });
    }
  }
);

// PATCH /api/exams/:id/result
// يسجل المعلم أو المشرف نتيجة الاختبار.
router.patch(
  "/:id/result",
  requireRoles(...staffRoles),
  async (req, res) => {
    const examId = Number(req.params.id);

    if (!Number.isSafeInteger(examId) || examId <= 0) {
      return res.status(400).json({
        success: false,
        message: "رقم الاختبار غير صحيح."
      });
    }

    const parsed = resultSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "بيانات النتيجة غير صحيحة.",
        errors: parsed.error.flatten()
      });
    }

    const data = parsed.data;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const found = await client.query(
        `SELECT id, teacher_id, status
         FROM exams
         WHERE id = $1
         FOR UPDATE`,
        [examId]
      );

      if (found.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          message: "الاختبار غير موجود."
        });
      }

      const exam = found.rows[0];

      if (
        req.user.role === "TEACHER" &&
        String(exam.teacher_id) !== String(req.user.id)
      ) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          success: false,
          message: "لا يمكنك تعديل اختبار غير مسند إليك."
        });
      }

      if (exam.status === "CANCELLED") {
        await client.query("ROLLBACK");

        return res.status(409).json({
          success: false,
          message: "لا يمكن تسجيل نتيجة اختبار ملغى."
        });
      }

      const updated = await client.query(
        `UPDATE exams
         SET score = $1,
             result_status = $2,
             feedback = $3,
             status = 'COMPLETED'
         WHERE id = $4
         RETURNING *`,
        [
          data.score,
          data.resultStatus,
          data.feedback,
          examId
        ]
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        message: "تم حفظ نتيجة الاختبار.",
        exam: updated.rows[0]
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}

      console.error("Save exam result error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر حفظ نتيجة الاختبار."
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
