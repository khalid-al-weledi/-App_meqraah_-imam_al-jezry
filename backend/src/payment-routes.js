
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

// عرض الباقات المتاحة
router.get("/packages", (req, res) => {
  const packages = Object.entries(PACKAGES).map(
    ([minutes, price]) => ({
      minutes: Number(minutes),
      priceETB: price
    })
  );

  return res.json({
    success: true,
    currency: "ETB",
    packages
  });
});

// إنشاء طلب شراء باقة
router.post(
  "/orders",
  authenticateToken,
  requireRoles("STUDENT"),
  async (req, res) => {
    const minutes = Number(req.body?.minutes);
    const receiptUrl =
      typeof req.body?.receiptUrl === "string"
        ? req.body.receiptUrl.trim()
        : "";

    if (
      !Number.isSafeInteger(minutes) ||
      !Object.prototype.hasOwnProperty.call(PACKAGES, minutes)
    ) {
      return res.status(400).json({
        success: false,
        message: "الباقة المحددة غير صالحة."
      });
    }

    if (
      receiptUrl &&
      (!receiptUrl.startsWith("https://") ||
        receiptUrl.length > 2000)
    ) {
      return res.status(400).json({
        success: false,
        message: "رابط الإيصال غير صالح."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const studentResult = await client.query(
        `SELECT id
         FROM student_profiles
         WHERE user_id = $1
         LIMIT 1`,
        [req.user.id]
      );

      if (studentResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(403).json({
          success: false,
          message: "لا يوجد ملف طالب مرتبط بهذا الحساب."
        });
      }

      const studentId = studentResult.rows[0].id;
      const idempotencyKey = randomUUID();

      const orderResult = await client.query(
        `INSERT INTO payment_orders
          (
            student_id,
            minutes,
            amount_etb,
            status,
            receipt_url,
            idempotency_key
          )
         VALUES ($1, $2, $3, 'PENDING', $4, $5)
         RETURNING
           id,
           minutes,
           amount_etb,
           status,
           receipt_url,
           created_at`,
        [
          studentId,
          minutes,
          PACKAGES[minutes],
          receiptUrl || null,
          idempotencyKey
        ]
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
          "PAYMENT_ORDER_CREATED",
          "payment_order",
          String(orderResult.rows[0].id),
          JSON.stringify({
            minutes,
            amountETB: PACKAGES[minutes]
          })
        ]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        message:
          "تم إنشاء طلب الشراء، وهو بانتظار مراجعة الدفع. لم تتم إضافة الدقائق بعد.",
        order: orderResult.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

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
           po.minutes,
           po.amount_etb,
           po.status,
           po.receipt_url,
           po.created_at
         FROM payment_orders po
         JOIN student_profiles sp
           ON sp.id = po.student_id
         WHERE sp.user_id = $1
         ORDER BY po.created_at DESC`,
        [req.user.id]
      );

      return res.json({
        success: true,
        orders: result.rows
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
      const result = await pool.query(
        `SELECT
           po.id,
           po.minutes,
           po.amount_etb,
           po.status,
           po.receipt_url,
           po.created_at,
           sp.student_code,
           u.full_name,
           u.phone
         FROM payment_orders po
         JOIN student_profiles sp
           ON sp.id = po.student_id
         JOIN users u
           ON u.id = sp.user_id
         ORDER BY po.created_at DESC
         LIMIT 200`
      );

      return res.json({
        success: true,
        orders: result.rows
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
