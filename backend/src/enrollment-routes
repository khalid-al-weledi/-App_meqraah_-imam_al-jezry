
const express = require("express");
const { z } = require("zod");
const { query, pool } = require("./db");
const { authenticateToken, requireRoles } = require("./security");

const router = express.Router();

router.use(authenticateToken);

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(1000).optional().default("")
});

const allowedAdminRoles = [
  "SUPER_ADMIN",
  "ACADEMIC_SUPERVISOR"
];

// GET /api/enrollments/my
// عرض البرامج التي طلب الطالب الالتحاق بها.
router.get("/my", requireRoles("STUDENT"), async (req, res) => {
  try {
    const result = await query(
      `SELECT
         e.id,
         e.status,
         e.created_at,
         p.code AS program_code,
         p.name_ar,
         p.name_en
       FROM enrollments e
       JOIN student_profiles sp ON sp.id = e.student_id
       JOIN programs p ON p.id = e.program_id
       WHERE sp.user_id = $1
       ORDER BY e.created_at DESC`,
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
      const status = String(req.query.status || "").trim().toUpperCase();

      const validStatuses = [
        "PENDING",
        "APPROVED",
        "REJECTED"
      ];

      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "حالة الطلب غير صحيحة."
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
           e.created_at,
           e.student_id,
           u.full_name AS student_name,
           u.phone,
           u.language,
           sp.student_code,
           sp.gender,
           sp.country,
           sp.city,
           p.code AS program_code,
           p.name_ar,
           p.name_en
         FROM enrollments e
         JOIN student_profiles sp ON sp.id = e.student_id
         JOIN users u ON u.id = sp.user_id
         JOIN programs p ON p.id = e.program_id
         WHERE 1 = 1 ${statusFilter}
         ORDER BY
           CASE WHEN e.status = 'PENDING' THEN 0 ELSE 1 END,
           e.created_at DESC
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
// قبول أو رفض طلب الالتحاق مع تسجيل العملية في سجل التدقيق.
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
        errors: parsed.error.flatten()
      });
    }

    const { status, reason } = parsed.data;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const found = await client.query(
        `SELECT
           e.id,
           e.status,
           e.student_id,
           e.program_id,
           sp.user_id
         FROM enrollments e
         JOIN student_profiles sp ON sp.id = e.student_id
         WHERE e.id = $1
         FOR UPDATE OF e`,
        [enrollmentId]
      );

      if (found.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "طلب الالتحاق غير موجود."
        });
      }

      const enrollment = found.rows[0];

      if (enrollment.status !== "PENDING") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "تمت مراجعة هذا الطلب سابقًا."
        });
      }

      const updated = await client.query(
        `UPDATE enrollments
         SET status = $1
         WHERE id = $2
         RETURNING id, status, student_id, program_id, created_at`,
        [status, enrollmentId]
      );

      await client.query(
        `INSERT INTO audit_logs
          (actor_user_id, action, entity_type, entity_id, details)
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

      return res.json({
        success: true,
        message: status === "APPROVED"
          ? "تم قبول طلب الالتحاق."
          : "تم رفض طلب الالتحاق.",
        enrollment: updated.rows[0]
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}

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
