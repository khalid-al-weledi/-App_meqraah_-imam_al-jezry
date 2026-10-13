
const express = require("express");
const { z } = require("zod");
const { query, pool } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

router.use(authenticateToken);

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(1000).optional().default("")
}).strict();

const allowedAdminRoles = [
  "SUPER_ADMIN",
  "ACADEMIC_SUPERVISOR"
];

const VALID_STATUSES = [
  "PENDING",
  "APPROVED",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "REJECTED"
];

// GET /api/enrollments/my
// عرض طلبات البرامج الخاصة بالطالب الحالي.
router.get("/my", requireRoles("STUDENT"), async (req, res) => {
  try {
    const result = await query(
      `SELECT
         e.id,
         e.status,
         e.requested_at,
         e.reviewed_at,
         p.code AS program_code,
         p.name_ar,
         p.description_ar
       FROM enrollments e
       JOIN student_profiles sp
         ON sp.id = e.student_id
       JOIN programs p
         ON p.id = e.program_id
       WHERE sp.user_id = $1
       ORDER BY e.requested_at DESC, e.id DESC`,
      [req.user.id]
    );

    return res.json({
      success: true,
      enrollments: result.rows
    });
  } catch (error) {
    console.error("My enrollments error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب طلبات الالتحاق."
    });
  }
});

// GET /api/enrollments/admin
// عرض طلبات الالتحاق للمشرف الأكاديمي والمدير.
router.get(
  "/admin",
  requireRoles(...allowedAdminRoles),
  async (req, res) => {
    try {
      const status = String(req.query.status || "")
        .trim()
        .toUpperCase();

      if (status && !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "حالة الطلب غير صحيحة.",
          allowedStatuses: VALID_STATUSES
        });
      }

      const params = [];
      let statusFilter = "";

      if (status) {
        params.push(status);
        statusFilter = `AND e.status = $${params.length}`;
      }

      const result = await query(
        `SELECT
           e.id,
           e.status,
           e.requested_at,
           e.reviewed_at,
           e.reviewed_by,
           e.student_id,
           e.program_id,
           u.full_name AS student_name,
           u.phone,
           u.preferred_language,
           sp.student_code,
           sp.gender,
           sp.age,
           sp.country,
           sp.city,
           sp.previous_school,
           sp.previous_teacher,
           sp.reading_level,
           sp.has_read_quran_looking,
           sp.memorized_juz,
           p.code AS program_code,
           p.name_ar,
           p.description_ar
         FROM enrollments e
         JOIN student_profiles sp
           ON sp.id = e.student_id
         JOIN users u
           ON u.id = sp.user_id
         JOIN programs p
           ON p.id = e.program_id
         WHERE 1 = 1 ${statusFilter}
         ORDER BY
           CASE WHEN e.status = 'PENDING' THEN 0 ELSE 1 END,
           e.requested_at DESC,
           e.id DESC
         LIMIT 300`,
        params
      );

      return res.json({
        success: true,
        count: result.rows.length,
        enrollments: result.rows
      });
    } catch (error) {
      console.error("Admin enrollments error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر جلب طلبات الالتحاق."
      });
    }
  }
);

// PATCH /api/enrollments/admin/:id/review
// قبول أو رفض طلب معلّق مع تسجيل المراجع ووقت المراجعة.
router.patch(
  "/admin/:id/review",
  requireRoles(...allowedAdminRoles),
  async (req, res) => {
    const enrollmentId = Number(req.params.id);

    if (
      !Number.isSafeInteger(enrollmentId) ||
      enrollmentId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "رقم الطلب غير صحيح."
      });
    }

    const parsed = reviewSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "بيانات المراجعة غير صحيحة.",
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const { status, reason } = parsed.data;
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const found = await client.query(
        `SELECT
           e.id,
           e.status,
           e.student_id,
           e.program_id
         FROM enrollments e
         WHERE e.id = $1
         FOR UPDATE`,
        [enrollmentId]
      );

      if (found.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          success: false,
          message: "طلب الالتحاق غير موجود."
        });
      }

      const enrollment = found.rows[0];

      if (enrollment.status !== "PENDING") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          message: "تمت مراجعة هذا الطلب سابقًا."
        });
      }

      const updated = await client.query(
        `UPDATE enrollments
         SET
           status = $1,
           reviewed_at = NOW(),
           reviewed_by = $2
         WHERE id = $3
         RETURNING
           id,
           status,
           student_id,
           program_id,
           requested_at,
           reviewed_at,
           reviewed_by`,
        [status, req.user.id, enrollmentId]
      );

      await client.query(
        `INSERT INTO audit_logs
          (
            actor_user_id,
            action,
            entity_type,
            entity_id,
            details
          )
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          req.user.id,
          status === "APPROVED"
            ? "ENROLLMENT_APPROVED"
            : "ENROLLMENT_REJECTED",
          "enrollment",
          String(enrollmentId),
          JSON.stringify({
            studentId: enrollment.student_id,
            programId: enrollment.program_id,
            reason
          })
        ]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        success: true,
        message: status === "APPROVED"
          ? "تم قبول طلب الالتحاق."
          : "تم رفض طلب الالتحاق.",
        enrollment: updated.rows[0]
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }

      console.error("Enrollment review error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذرت مراجعة طلب الالتحاق."
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
