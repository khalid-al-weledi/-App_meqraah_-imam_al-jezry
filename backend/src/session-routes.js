
const express = require("express");
const { pool } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

const SESSION_STATUSES = [
  "SCHEDULED",
  "ATTENDED",
  "ABSENT",
  "CANCELLED"
];

// جلب جلسات الطالب أو المعلم
router.get(
  "/",
  authenticateToken,
  async (req, res) => {
    try {
      let result;

      if (req.user.role === "STUDENT") {
        result = await pool.query(
          `SELECT
             s.id,
             s.student_id,
             s.teacher_id,
             s.scheduled_at,
             s.duration_minutes,
             s.status,
             s.notes
           FROM sessions s
           JOIN student_profiles sp
             ON sp.id = s.student_id
           WHERE sp.user_id = $1
           ORDER BY s.scheduled_at DESC
           LIMIT 100`,
          [req.user.id]
        );
      } else if (req.user.role === "TEACHER") {
        result = await pool.query(
          `SELECT
             s.id,
             s.student_id,
             s.teacher_id,
             s.scheduled_at,
             s.duration_minutes,
             s.status,
             s.notes
           FROM sessions s
           JOIN users u
             ON u.id = s.teacher_id
           WHERE u.id = $1
           ORDER BY s.scheduled_at DESC
           LIMIT 100`,
          [req.user.id]
        );
      } else if (
        ["SUPER_ADMIN", "ACADEMIC_SUPERVISOR"].includes(
          req.user.role
        )
      ) {
        result = await pool.query(
          `SELECT
             id,
             student_id,
             teacher_id,
             scheduled_at,
             duration_minutes,
             status,
             notes
           FROM sessions
           ORDER BY scheduled_at DESC
           LIMIT 200`
        );
      } else {
        return res.status(403).json({
          success: false,
          message: "ليس لديك إذن لعرض الجلسات."
        });
      }

      return res.json({
        success: true,
        sessions: result.rows
      });
    } catch (error) {
      console.error("List sessions failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر جلب الجلسات."
      });
    }
  }
);

// إنشاء جلسة جديدة بواسطة الإدارة أو المشرف
router.post(
  "/",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR"),
  async (req, res) => {
    const studentId = Number(req.body?.studentId);
    const teacherId = Number(req.body?.teacherId);
    const scheduledAt = req.body?.scheduledAt;
    const durationMinutes = Number(req.body?.durationMinutes);
    const notes =
      typeof req.body?.notes === "string"
        ? req.body.notes.trim()
        : null;

    if (
      !Number.isSafeInteger(studentId) ||
      studentId < 1 ||
      !Number.isSafeInteger(teacherId) ||
      teacherId < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "رقم الطالب أو المعلم غير صالح."
      });
    }

    if (
      typeof scheduledAt !== "string" ||
      Number.isNaN(Date.parse(scheduledAt))
    ) {
      return res.status(400).json({
        success: false,
        message: "موعد الجلسة غير صالح."
      });
    }

    if (
      !Number.isSafeInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "مدة الجلسة يجب أن تكون من دقيقة إلى 180 دقيقة."
      });
    }

    try {
      const student = await pool.query(
        `SELECT id
         FROM student_profiles
         WHERE id = $1`,
        [studentId]
      );

      if (student.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "الطالب غير موجود."
        });
      }

      const teacher = await pool.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND role = 'TEACHER'
           AND is_active = TRUE`,
        [teacherId]
      );

      if (teacher.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "المعلم غير موجود أو غير نشط."
        });
      }

      const result = await pool.query(
        `INSERT INTO sessions
          (
            student_id,
            teacher_id,
            scheduled_at,
            duration_minutes,
            status,
            notes
          )
         VALUES ($1, $2, $3, $4, 'SCHEDULED', $5)
         RETURNING
           id,
           student_id,
           teacher_id,
           scheduled_at,
           duration_minutes,
           status,
           notes`,
        [
          studentId,
          teacherId,
          scheduledAt,
          durationMinutes,
          notes
        ]
      );

      return res.status(201).json({
        success: true,
        message: "تم إنشاء الجلسة.",
        session: result.rows[0]
      });
    } catch (error) {
      console.error("Create session failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر إنشاء الجلسة."
      });
    }
  }
);

// تسجيل الحضور أو الغياب أو الإلغاء
router.patch(
  "/:id/status",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR"),
  async (req, res) => {
    const sessionId = Number(req.params.id);
    const { status } = req.body || {};

    if (!Number.isSafeInteger(sessionId) || sessionId < 1) {
      return res.status(400).json({
        success: false,
        message: "رقم الجلسة غير صالح."
      });
    }

    if (!SESSION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "حالة الجلسة غير صالحة."
      });
    }

    try {
      const result = await pool.query(
        `UPDATE sessions
         SET status = $1
         WHERE id = $2
         RETURNING
           id,
           student_id,
           teacher_id,
           scheduled_at,
           duration_minutes,
           status`,
        [status, sessionId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "الجلسة غير موجودة."
        });
      }

      return res.json({
        success: true,
        message:
          status === "ATTENDED"
            ? "تم تسجيل الحضور. لم يتم خصم الدقائق تلقائيًا."
            : "تم تحديث حالة الجلسة.",
        session: result.rows[0]
      });
    } catch (error) {
      console.error("Update session status failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر تحديث حالة الجلسة."
      });
    }
  }
);

module.exports = router;
