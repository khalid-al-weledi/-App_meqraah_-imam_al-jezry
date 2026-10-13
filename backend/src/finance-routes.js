
const express = require("express");
const { query } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

// المالية متاحة للإدارة العليا والمحاسب فقط.
router.use(authenticateToken);
router.use(requireRoles("SUPER_ADMIN", "ACCOUNTANT"));

// التحقق من UUID
function isValidUUID(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message
  });
}

// ======================================================
// GET /api/finance/summary
// ملخص طلبات الدفع والمبالغ.
// ======================================================

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

    const summary = result.rows[0];

    return res.json({
      success: true,
      currency: "ETB",
      summary: {
        pendingOrders: Number(summary.pending_orders),
        approvedOrders: Number(summary.approved_orders),
        rejectedOrders: Number(summary.rejected_orders),
        approvedAmountETB: Number(summary.approved_amount_etb),
        pendingAmountETB: Number(summary.pending_amount_etb)
      }
    });
  } catch (error) {
    console.error("Finance summary error:", error.message);

    return sendError(
      res,
      500,
      "تعذر جلب الملخص المالي."
    );
  }
});

// ======================================================
// GET /api/finance/ledger?studentId=<UUID>&limit=100
// سجل حركات الدقائق.
// ======================================================

router.get("/ledger", async (req, res) => {
  const studentId = req.query.studentId
    ? String(req.query.studentId).trim()
    : null;

  const limit = req.query.limit === undefined
    ? 100
    : Number(req.query.limit);

  if (
    studentId !== null &&
    !isValidUUID(studentId)
  ) {
    return sendError(
      res,
      400,
      "معرّف الطالب غير صحيح."
    );
  }

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 300
  ) {
    return sendError(
      res,
      400,
      "عدد النتائج يجب أن يكون بين 1 و300."
    );
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
         ml.payment_order_id,
         ml.transaction_type,
         ml.minutes_delta,
         ml.balance_after,
         ml.actor_user_id,
         ml.notes,
         ml.created_at
       FROM minute_ledger ml
       JOIN student_profiles sp
         ON sp.id = ml.student_id
       JOIN users u
         ON u.id = sp.user_id
       ${studentFilter}
       ORDER BY ml.created_at DESC, ml.id DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({
      success: true,
      count: result.rows.length,
      ledger: result.rows.map((item) => ({
        id: item.id,
        studentId: item.student_id,
        studentCode: item.student_code,
        studentName: item.student_name,
        paymentOrderId: item.payment_order_id,
        transactionType: item.transaction_type,
        minutesDelta: Number(item.minutes_delta),
        balanceAfter: Number(item.balance_after),
        actorUserId: item.actor_user_id,
        notes: item.notes,
        createdAt: item.created_at
      }))
    });
  } catch (error) {
    console.error("Finance ledger error:", error.message);

    return sendError(
      res,
      500,
      "تعذر جلب سجل حركات الدقائق."
    );
  }
});

// ======================================================
// GET /api/finance/low-balances?threshold=10
// الأرصدة المنخفضة من student_profiles مباشرة.
// ======================================================

router.get("/low-balances", async (req, res) => {
  const threshold = req.query.threshold === undefined
    ? 10
    : Number(req.query.threshold);

  if (
    !Number.isInteger(threshold) ||
    threshold < 0 ||
    threshold > 10000
  ) {
    return sendError(
      res,
      400,
      "حد الرصيد يجب أن يكون عددًا صحيحًا بين 0 و10000."
    );
  }

  try {
    const result = await query(
      `SELECT
         sp.id AS student_id,
         sp.student_code,
         sp.balance_minutes,
         u.full_name,
         u.phone,
         u.preferred_language
       FROM student_profiles sp
       JOIN users u
         ON u.id = sp.user_id
       WHERE sp.balance_minutes <= $1
         AND u.is_active = TRUE
       ORDER BY
         sp.balance_minutes ASC,
         u.full_name ASC
       LIMIT 500`,
      [threshold]
    );

    return res.json({
      success: true,
      thresholdMinutes: threshold,
      count: result.rows.length,
      students: result.rows.map((student) => ({
        studentId: student.student_id,
        studentCode: student.student_code,
        fullName: student.full_name,
        phone: student.phone,
        balanceMinutes: Number(student.balance_minutes),
        preferredLanguage: student.preferred_language
      }))
    });
  } catch (error) {
    console.error("Low balance report error:", error.message);

    return sendError(
      res,
      500,
      "تعذر جلب قائمة الأرصدة المنخفضة."
    );
  }
});

module.exports = router;
