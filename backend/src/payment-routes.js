
const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

const PACKAGES = {
  100: 500,
  200: 1000,
  300: 1470,
  400: 1920,
  500: 2350,
  600: 2760,
  1000: 4500
};

const PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "MOBILE_MONEY",
  "CASH",
  "OTHER"
];

function validPackageMinutes(value) {
  const minutes = Number(value);

  return Number.isSafeInteger(minutes) &&
    Object.prototype.hasOwnProperty.call(PACKAGES, minutes)
    ? minutes
    : null;
}

// عرض الباقات المتاحة من قاعدة البيانات
router.get("/packages", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, minutes, price_etb
       FROM packages
       WHERE is_active = TRUE
       ORDER BY minutes ASC`
    );

    return res.json({
      success: true,
      currency: "ETB",
      packages: result.rows.map((item) => ({
        id: item.id,
        minutes: item.minutes,
        priceETB: Number(item.price_etb)
      }))
    });
  } catch (error) {
    console.error("List packages failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب الباقات حاليًا."
    });
  }
});

// إنشاء طلب شراء باقة.
// لا تُضاف الدقائق عند إنشاء الطلب.
router.post(
  "/orders",
  authenticateToken,
  requireRoles("STUDENT"),
  async (req, res) => {
    const minutes = validPackageMinutes(req.body?.minutes);

    const paymentMethod =
      typeof req.body?.paymentMethod === "string"
        ? req.body.paymentMethod.trim().toUpperCase()
        : "";

    // receiptKey هو مفتاح الملف في خدمة تخزين موثوقة،
    // وليس رابطًا عامًا يرسله الطالب.
    const receiptKey =
      typeof req.body?.receiptKey === "string"
        ? req.body.receiptKey.trim()
        : null;

    if (minutes === null) {
      return res.status(400).json({
        success: false,
        message: "الباقة المحددة غير صالحة."
      });
    }

    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "طريقة الدفع غير صالحة.",
        allowedMethods: PAYMENT_METHODS
      });
    }

    if (
      receiptKey !== null &&
      (
        receiptKey.length === 0 ||
        receiptKey.length > 500 ||
        receiptKey.startsWith("http://") ||
        receiptKey.startsWith("https://")
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "مفتاح الإيصال غير صالح."
      });
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const studentResult = await client.query(
        `SELECT id
         FROM student_profiles
         WHERE user_id = $1
         LIMIT 1`,
        [req.user.id]
      );

      if (studentResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          success: false,
          message: "لا يوجد ملف طالب مرتبط بهذا الحساب."
        });
      }

      const studentId = studentResult.rows[0].id;

      // نقرأ السعر من قاعدة البيانات ولا نعتمد على سعر يرسله العميل.
      const packageResult = await client.query(
        `SELECT id, minutes, price_etb
         FROM packages
         WHERE minutes = $1
           AND is_active = TRUE
         LIMIT 1`,
        [minutes]
      );

      if (packageResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "هذه الباقة غير متاحة حاليًا."
        });
      }

      const selectedPackage = packageResult.rows[0];
      const expectedPrice = PACKAGES[minutes];

      // يمنع استمرار الطلب إذا خالفت بيانات الأسعار
      // القيم المعتمدة حاليًا للمقرأة.
      if (Number(selectedPackage.price_etb) !== expectedPrice) {
        console.error(
          "Package price mismatch:",
          selectedPackage.id
        );

        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(503).json({
          success: false,
          message: "تعذر إتمام الطلب بسبب اختلاف سعر الباقة. يرجى مراجعة الإدارة."
        });
      }

      const idempotencyKey = randomUUID();

      const orderResult = await client.query(
        `INSERT INTO payment_orders
          (
            student_id,
            package_id,
            amount_etb,
            requested_minutes,
            payment_method,
            receipt_key,
            status,
            idempotency_key,
            submitted_at
          )
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, NOW())
         RETURNING
           id,
           package_id,
           requested_minutes,
           amount_etb,
           payment_method,
           receipt_key,
           status,
           submitted_at`,
        [
          studentId,
          selectedPackage.id,
          selectedPackage.price_etb,
          selectedPackage.minutes,
          paymentMethod,
          receiptKey,
          idempotencyKey
        ]
      );

      const order = orderResult.rows[0];

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
          "PAYMENT_ORDER_CREATED",
          "payment_order",
          String(order.id),
          JSON.stringify({
            packageId: selectedPackage.id,
            minutes: selectedPackage.minutes,
            amountETB: Number(selectedPackage.price_etb),
            paymentMethod,
            hasReceipt: Boolean(receiptKey)
          })
        ]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.status(201).json({
        success: true,
        message: "تم إنشاء طلب الشراء. لن تُضاف الدقائق إلا بعد اعتماد الدفع.",
        order: {
          id: order.id,
          packageId: order.package_id,
          minutes: order.requested_minutes,
          amountETB: Number(order.amount_etb),
          paymentMethod: order.payment_method,
          hasReceipt: Boolean(order.receipt_key),
          status: order.status,
          submittedAt: order.submitted_at
        }
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }

      console.error("Create payment order failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر إنشاء طلب الشراء."
      });
    } finally {
      client.release();
    }
  }
);

// عرض طلبات الدفع للطالب الحالي
router.get(
  "/my-orders",
  authenticateToken,
  requireRoles("STUDENT"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           po.id,
           po.package_id,
           po.requested_minutes,
           po.amount_etb,
           po.payment_method,
           po.receipt_key,
           po.status,
           po.submitted_at,
           po.reviewed_at,
           po.rejection_reason
         FROM payment_orders po
         JOIN student_profiles sp
           ON sp.id = po.student_id
         WHERE sp.user_id = $1
         ORDER BY po.submitted_at DESC, po.id DESC`,
        [req.user.id]
      );

      return res.json({
        success: true,
        orders: result.rows.map((order) => ({
          id: order.id,
          packageId: order.package_id,
          minutes: order.requested_minutes,
          amountETB: Number(order.amount_etb),
          paymentMethod: order.payment_method,
          hasReceipt: Boolean(order.receipt_key),
          status: order.status,
          submittedAt: order.submitted_at,
          reviewedAt: order.reviewed_at,
          rejectionReason: order.rejection_reason
        }))
      });
    } catch (error) {
      console.error("List payment orders failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر جلب طلبات الشراء."
      });
    }
  }
);

// عرض الطلبات للمحاسب والإدارة
router.get(
  "/admin/orders",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "")
        .trim()
        .toUpperCase();

      const validStatuses = ["PENDING", "APPROVED", "REJECTED"];

      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "حالة الدفع غير صحيحة.",
          allowedStatuses: validStatuses
        });
      }

      const params = [];
      let statusFilter = "";

      if (status) {
        params.push(status);
        statusFilter = `AND po.status = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT
           po.id,
           po.package_id,
           po.requested_minutes,
           po.amount_etb,
           po.payment_method,
           po.receipt_key,
           po.status,
           po.submitted_at,
           po.reviewed_at,
           po.rejection_reason,
           sp.student_code,
           u.full_name,
           u.phone
         FROM payment_orders po
         JOIN student_profiles sp
           ON sp.id = po.student_id
         JOIN users u
           ON u.id = sp.user_id
         WHERE 1 = 1 ${statusFilter}
         ORDER BY
           CASE WHEN po.status = 'PENDING' THEN 0 ELSE 1 END,
           po.submitted_at DESC,
           po.id DESC
         LIMIT 200`,
        params
      );

      return res.json({
        success: true,
        count: result.rows.length,
        orders: result.rows.map((order) => ({
          id: order.id,
          packageId: order.package_id,
          minutes: order.requested_minutes,
          amountETB: Number(order.amount_etb),
          paymentMethod: order.payment_method,
          receiptKey: order.receipt_key,
          status: order.status,
          submittedAt: order.submitted_at,
          reviewedAt: order.reviewed_at,
          rejectionReason: order.rejection_reason,
          studentCode: order.student_code,
          studentName: order.full_name,
          phone: order.phone
        }))
      });
    } catch (error) {
      console.error("Admin payment orders failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر جلب طلبات الدفع."
      });
    }
  }
);

module.exports = router;
