
const express = require("express");
const { z } = require("zod");
const { query } = require("./db");
const { authenticateToken, requireRoles } = require("./security");

const router = express.Router();

router.use(authenticateToken);

const teacherRoles = [
  "SUPER_ADMIN",
  "ACADEMIC_SUPERVISOR"
];

const assignTeacherSchema = z.object({
  teacherId: z.coerce.number().int().positive()
});

// GET /api/teachers
// عرض المعلمين النشطين.
router.get("/", async (req, res) => {
  try {
    const result = await query(
      `SELECT
         u.id,
         u.full_name,
         u.language,
         u.is_active
       FROM users u
       WHERE u.role = 'TEACHER'
         AND u.is_active = TRUE
       ORDER BY u.full_name ASC`
    );

    return res.json({
      success: true,
      teachers: result.rows
    });
  } catch (error) {
    console.error("Teachers list error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب قائمة المعلمين."
    });
  }
});

// GET /api/teachers/:id/students
// عرض الطلاب المرتبطين بجلسات المعلم.
router.get(
  "/:id/students",
  requireRoles(...teacherRoles, "TEACHER"),
  async (req, res) => {
    const teacherId = Number(req.params.id);

    if (!Number.isSafeInteger(teacherId) || teacherId <= 0) {
      return res.status(400).json({
        success: false,
        message: "رقم المعلم غير صحيح."
      });
    }

    if (
      req.user.role === "TEACHER" &&
      String(req.user.id) !== String(teacherId)
    ) {
      return res.status(403).json({
        success: false,
        message: "لا يمكنك عرض طلاب معلم آخر."
      });
    }

    try {
      const teacher = await query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND role = 'TEACHER'`,
        [teacherId]
      );

      if (teacher.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "المعلم غير موجود."
        });
      }

      const result = await query(
        `SELECT DISTINCT
           sp.id AS student_id,
           sp.student_code,
           u.full_name AS student_name,
           u.phone,
           u.language,
           s.status AS latest_session_status,
           s.scheduled_at AS latest_session_at
         FROM sessions s
         JOIN student_profiles sp ON sp.id = s.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE s.teacher_id = $1
         ORDER BY latest_session_at DESC NULLS LAST`,
        [teacherId]
      );

      return res.json({
        success: true,
        teacherId,
        students: result.rows
      });
    } catch (error) {
      console.error("Teacher students error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر جلب طلاب المعلم."
      });
    }
  }
);

// PATCH /api/teachers/sessions/:sessionId/assign
// إسناد جلسة إلى معلم أو تغيير المعلم المسؤول عنها.
router.patch(
  "/sessions/:sessionId/assign",
  requireRoles(...teacherRoles),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId);

    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "رقم الجلسة غير صحيح."
      });
    }

    const parsed = assignTeacherSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "يجب تحديد رقم معلم صحيح.",
        errors: parsed.error.flatten()
      });
    }

    const { teacherId } = parsed.data;

    try {
      const result = await query(
        `UPDATE sessions AS s
         SET teacher_id = $1
         WHERE s.id = $2
           AND s.status = 'SCHEDULED'
           AND EXISTS (
             SELECT 1
             FROM users u
             WHERE u.id = $1
               AND u.role = 'TEACHER'
               AND u.is_active = TRUE
           )
         RETURNING
           s.id,
           s.student_id,
           s.teacher_id,
           s.scheduled_at,
           s.duration_minutes,
           s.status`,
        [teacherId, sessionId]
      );

      if (result.rowCount === 0) {
        return res.status(409).json({
          success: false,
          message: "تعذر الإسناد. تحقق من وجود الجلسة، وأنها مجدولة، وأن المعلم نشط."
        });
      }

      await query(
        `INSERT INTO audit_logs
          (actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          req.user.id,
          "SESSION_TEACHER_ASSIGNED",
          "session",
          String(sessionId),
          JSON.stringify({ teacherId })
        ]
      );

      return res.json({
        success: true,
        message: "تم إسناد الجلسة إلى المعلم.",
        session: result.rows[0]
      });
    } catch (error) {
      console.error("Teacher assignment error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر إسناد الجلسة."
      });
    }
  }
);

module.exports = router;
