
const express = require("express");
const { query } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

router.use(authenticateToken);
router.use(
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR", "ACCOUNTANT")
);

// GET /api/reports/overview
// إحصاءات عامة عن المقرأة.
router.get("/overview", async (req, res) => {
  try {
    const [
      usersResult,
      enrollmentsResult,
      sessionsResult,
      paymentsResult,
      programsResult
    ] = await Promise.all([
      query(
        `SELECT
           COUNT(*) FILTER (
             WHERE role = 'STUDENT' AND is_active = TRUE
           ) AS active_students,
           COUNT(*) FILTER (
             WHERE role = 'TEACHER' AND is_active = TRUE
           ) AS active_teachers,
           COUNT(*) FILTER (
             WHERE role IN (
               'SUPER_ADMIN',
               'ACADEMIC_SUPERVISOR',
               'ACCOUNTANT'
             ) AND is_active = TRUE
           ) AS active_admin_staff
         FROM users`
      ),
      query(
        `SELECT
           COUNT(*) FILTER (
             WHERE status = 'PENDING'
           ) AS pending,
           COUNT(*) FILTER (
             WHERE status = 'APPROVED'
           ) AS approved,
           COUNT(*) FILTER (
             WHERE status = 'REJECTED'
           ) AS rejected
         FROM enrollments`
      ),
      query(
        `SELECT
           COUNT(*) FILTER (
             WHERE status = 'SCHEDULED'
           ) AS scheduled,
           COUNT(*) FILTER (
             WHERE status = 'ATTENDED'
           ) AS attended,
           COUNT(*) FILTER (
             WHERE status = 'ABSENT'
           ) AS absent,
           COUNT(*) FILTER (
             WHERE status = 'CANCELLED'
           ) AS cancelled
         FROM sessions`
      ),
      query(
        `SELECT
           COUNT(*) FILTER (
             WHERE status = 'PENDING'
           ) AS pending_orders,
           COUNT(*) FILTER (
             WHERE status = 'APPROVED'
           ) AS approved_orders,
           COUNT(*) FILTER (
             WHERE status = 'REJECTED'
           ) AS rejected_orders,
           COALESCE(
             SUM(amount_etb) FILTER (
               WHERE status = 'APPROVED'
             ), 0
           ) AS approved_amount_etb
         FROM payment_orders`
      ),
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (
             WHERE is_active = TRUE
           ) AS active
         FROM programs`
      )
    ]);

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      users: usersResult.rows[0],
      enrollments: enrollmentsResult.rows[0],
      sessions: sessionsResult.rows[0],
      payments: paymentsResult.rows[0],
      programs: programsResult.rows[0]
    });
  } catch (error) {
    console.error("Overview report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر إنشاء التقرير العام. تحقق من توافق مخطط قاعدة البيانات."
    });
  }
});

// GET /api/reports/programs
// عدد طلبات الالتحاق بكل برنامج.
router.get("/programs", async (req, res) => {
  try {
    const result = await query(
      `SELECT
         p.id,
         p.code,
         p.name_ar,
         p.name_en,
         p.is_active,
         COUNT(e.id) AS total_enrollments,
         COUNT(e.id) FILTER (
           WHERE e.status = 'PENDING'
         ) AS pending_enrollments,
         COUNT(e.id) FILTER (
           WHERE e.status = 'APPROVED'
         ) AS approved_enrollments,
         COUNT(e.id) FILTER (
           WHERE e.status = 'REJECTED'
         ) AS rejected_enrollments
       FROM programs p
       LEFT JOIN enrollments e ON e.program_id = p.id
       GROUP BY p.id, p.code, p.name_ar, p.name_en, p.is_active
       ORDER BY p.sort_order, p.code`
    );

    return res.json({
      success: true,
      programs: result.rows
    });
  } catch (error) {
    console.error("Program report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر إنشاء تقرير البرامج."
    });
  }
});

// GET /api/reports/attendance
// تقرير الحضور خلال فترة محددة.
router.get("/attendance", async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (
    !datePattern.test(from) ||
    !datePattern.test(to) ||
    from > to
  ) {
    return res.status(400).json({
      success: false,
      message: "أدخل تاريخ البداية والنهاية بالصيغة YYYY-MM-DD."
    });
  }

  try {
    const result = await query(
      `SELECT
         COUNT(*) AS total_sessions,
         COUNT(*) FILTER (
           WHERE status = 'ATTENDED'
         ) AS attended,
         COUNT(*) FILTER (
           WHERE status = 'ABSENT'
         ) AS absent,
         COUNT(*) FILTER (
           WHERE status = 'CANCELLED'
         ) AS cancelled,
         COUNT(*) FILTER (
           WHERE status = 'SCHEDULED'
         ) AS scheduled
       FROM sessions
       WHERE scheduled_at >= $1::date
         AND scheduled_at < ($2::date + INTERVAL '1 day')`,
      [from, to]
    );

    return res.json({
      success: true,
      period: { from, to },
      attendance: result.rows[0]
    });
  } catch (error) {
    console.error("Attendance report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر إنشاء تقرير الحضور."
    });
  }
});

module.exports = router;
