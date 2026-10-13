
const express = require("express");
const { query } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

router.use(authenticateToken);

router.use(
  requireRoles("SUPER_ADMIN", "ACCOUNTANT")
);

// GET /api/finance/summary
// ملخص مالي للطلبات المعتمدة والمعلقة والمرفوضة.
router.get("/summary", async (req, res) => {
  try {
    const result = await query(
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
         ) AS approved_amount_etb,
         COALESCE(
           SUM(amount_etb) FILTER (
             WHERE status = 'PENDING'
           ), 0
         ) AS pending_amount_etb
       FROM payment_orders`
    );

    return res.json({
      success: true,
      summary: result.rows[0],
      currency: "ETB"
    });
  } catch (error) {
    console.error("Finance summary error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب الملخص المالي."
    });
  }
});

// GET /api/finance/ledger
// عرض سجل الحركات المالية مع إمكانية تحديد طالب.
router.get("/ledger", async (req, res) => {
  const studentId = req.query.studentId
    ? Number(req.query.studentId)
    : null;

  const limit = req.query.limit === undefined
    ? 100
    : Number(req.query.limit);

  if (
    studentId !== null &&
    (!Number.isSafeInteger(studentId) || studentId <= 0)
  ) {
    return res.status(400).json({
      success: false,
      message: "رقم الطالب غير صحيح."
    });
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 300) {
    return res.status(400).json({
      success: false,
      message: "عدد النتائج يجب أن يكون بين 1 و300."
    });
  }

  try {
    const params = [];
    let studentFilter = "";

    if (studentId !== null) {
      params.push(studentId);
      studentFilter = `WHERE ml.student_id = $${params.length}`;
    }

    params.push(limit);

    const result = await query(
      `SELECT
         ml.id,
         ml.student_id,
         sp.student_code,
         u.full_name AS student_name,
         ml.entry_type,
         ml.minutes,
         ml.description,
         ml.created_at
       FROM minute_ledger ml
       JOIN student_profiles sp ON sp.id = ml.student_id
       JOIN users u ON u.id = sp.user_id
       ${studentFilter}
       ORDER BY ml.created_at DESC, ml.id DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({
      success: true,
      count: result.rows.length,
      ledger: result.rows
    });
  } catch (error) {
    console.error("Finance ledger error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب سجل الحركات المالية."
    });
  }
});

// GET /api/finance/low-balances
// قائمة الطلاب الذين لديهم رصيد منخفض.
router.get("/low-balances", async (req, res) => {
  const threshold = req.query.threshold === undefined
    ? 10
    : Number(req.query.threshold);

  if (
    !Number.isInteger(threshold) ||
    threshold < 0 ||
    threshold > 10000
  ) {
    return res.status(400).json({
      success: false,
      message: "حد الرصيد غير صحيح."
    });
  }

  try {
    const result = await query(
      `SELECT
         sp.id AS student_id,
         sp.student_code,
         u.full_name,
         u.phone,
         ma.balance_minutes
       FROM minute_accounts ma
       JOIN student_profiles sp ON sp.id = ma.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE ma.balance_minutes <= $1
         AND u.is_active = TRUE
       ORDER BY ma.balance_minutes ASC, u.full_name ASC
       LIMIT 500`,
      [threshold]
    );

    return res.json({
      success: true,
      thresholdMinutes: threshold,
      count: result.rows.length,
      students: result.rows
    });
  } catch (error) {
    console.error("Low balance report error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب قائمة الأرصدة المنخفضة."
    });
  }
});

module.exports = router;
