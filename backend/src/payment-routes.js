
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

function validOrderId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message
  });
}

// ======================================================
// 1. عرض الباقات
// GET /api/payments/packages
// ======================================================

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
        minutes: Number(item.minutes),
        priceETB: Number(item.price_etb)
      }))
    });
  } catch (error) {
    console.error("List packages failed:", error.message);
    return sendError(res, 500, "تعذر جلب الباقات حاليًا.");
  }
});

// ======================================================
// 2. إنشاء طلب شراء باقة
// POST /api/payments/orders
// لا تضاف الدقائق عند إنشاء الطلب.
// ======================================================

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

    const receiptKey =
      typeof req.body?.receiptKey === "string"
        ? req.body.receiptKey.trim()
        : null;

    if (minutes === null) {
      return sendError(res, 400, "الباقة المحددة غير صالحة.");
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
        /^https?:\/\//i.test(receiptKey)
      )
    ) {
      return sendError(res, 400, "مفتاح الإيصال غير صالح.");
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

        return sendError(
          res,
          403,
          "لا يوجد ملف طالب مرتبط بهذا الحساب."
        );
      }

      const studentId = studentResult.rows[0].id;

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

        return sendError(
          res,
          400,
          "هذه الباقة غير متاحة حاليًا."
        );
      }

      const selectedPackage = packageResult.rows[0];
      const expectedPrice = PACKAGES[minutes];

      if (Number(selectedPackage.price_etb) !== expectedPrice) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return sendError(
          res,
          503,
          "سعر الباقة في قاعدة البيانات لا يطابق السعر المعتمد. راجع الإدارة."
        );
      }

      const idempotencyKey = randomUUID();

      const orderResult = await client.query(
        `INSERT INTO payment_orders (
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
        `INSERT INTO audit_logs (
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
            minutes: Number(selectedPackage.minutes),
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
        message:
          "تم إنشاء طلب الشراء. لن تضاف الدقائق إلا بعد اعتماد الدفع.",
        order: {
          id: order.id,
          packageId: order.package_id,
          minutes: Number(order.requested_minutes),
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
      return sendError(res, 500, "تعذر إنشاء طلب الشراء.");
    } finally {
      client.release();
    }
  }
);

// ======================================================
// 3. طلبات الطالب
// GET /api/payments/my-orders
// ======================================================

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
          minutes: Number(order.requested_minutes),
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
      return sendError(res, 500, "تعذر جلب طلبات الشراء.");
    }
  }
);

// ======================================================
// 4. عرض طلبات الدفع للإدارة والمحاسب
// GET /api/payments/admin/orders?status=PENDING
// ======================================================

router.get(
  "/admin/orders",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "")
        .trim()
        .toUpperCase();

      const validStatuses = [
        "PENDING",
        "APPROVED",
        "REJECTED"
      ];

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
          minutes: Number(order.requested_minutes),
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
      return sendError(res, 500, "تعذر جلب طلبات الدفع.");
    }
  }
);

// ======================================================
// 5. اعتماد طلب الدفع وإضافة الدقائق مرة واحدة
// POST /api/payments/admin/orders/:id/approve
// ======================================================

router.post(
  "/admin/orders/:id/approve",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    const orderId = validOrderId(req.params.id);

    if (orderId === null) {
      return sendError(res, 400, "رقم الطلب غير صالح.");
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      // قفل الطلب لمنع اعتماده بالتزامن مرتين.
      const orderResult = await client.query(
        `SELECT *
         FROM payment_orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (orderResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return sendError(res, 404, "طلب الدفع غير موجود.");
      }

      const order = orderResult.rows[0];

      if (order.status !== "PENDING") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return sendError(
          res,
          409,
          order.status === "APPROVED"
            ? "تم اعتماد هذا الطلب سابقًا."
            : "لا يمكن اعتماد طلب مرفوض."
        );
      }

      // التأكد من تطابق الطلب مع الباقة.
      const packageResult = await client.query(
        `SELECT minutes, price_etb
         FROM packages
         WHERE id = $1`,
        [order.package_id]
      );

      if (packageResult.rowCount === 0) {
        throw new Error("PACKAGE_NOT_FOUND");
      }

      const selectedPackage = packageResult.rows[0];

      if (
        Number(selectedPackage.minutes) !==
          Number(order.requested_minutes) ||
        Number(selectedPackage.price_etb) !==
          Number(order.amount_etb)
      ) {
        throw new Error("ORDER_PACKAGE_MISMATCH");
      }

      const addedMinutes = Number(order.requested_minutes);

      if (
        !Number.isSafeInteger(addedMinutes) ||
        addedMinutes <= 0
      ) {
        throw new Error("INVALID_MINUTES");
      }

      // إنشاء حساب دقائق عند عدم وجوده.
      // يتطلب ذلك وجود قيد UNIQUE على student_id.
      await client.query(
        `INSERT INTO minute_accounts (
           student_id,
           balance_minutes
         )
         VALUES ($1, 0)
         ON CONFLICT (student_id) DO NOTHING`,
        [order.student_id]
      );

      // قفل حساب الطالب وقراءة الرصيد الحالي.
      const accountResult = await client.query(
        `SELECT balance_minutes
         FROM minute_accounts
         WHERE student_id = $1
         FOR UPDATE`,
        [order.student_id]
      );

      if (accountResult.rowCount === 0) {
        throw new Error("MINUTE_ACCOUNT_NOT_FOUND");
      }

      const currentBalance = Number(
        accountResult.rows[0].balance_minutes
      );

      const newBalance = currentBalance + addedMinutes;

      if (
        !Number.isSafeInteger(currentBalance) ||
        currentBalance < 0 ||
        !Number.isSafeInteger(newBalance)
      ) {
        throw new Error("INVALID_MINUTES");
      }

      // تحديث رصيد الدقائق.
      await client.query(
        `UPDATE minute_accounts
         SET balance_minutes = $1,
             updated_at = NOW()
         WHERE student_id = $2`,
        [newBalance, order.student_id]
      );

      // تسجيل حركة الشراء في سجل الدقائق.
      // نستخدم idempotency_key الموجود في طلب الدفع.
      await client.query(
        `INSERT INTO minute_ledger (
           student_id,
           amount_minutes,
           note,
           idempotency_key,
           entry_type,
           reference_type,
           reference_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          order.student_id,
          addedMinutes,
          `اعتماد شراء الباقة رقم ${order.package_id}`,
          order.idempotency_key || randomUUID(),
          "PACKAGE_PURCHASE",
          "payment_order",
          String(order.id)
        ]
      );

      // تحديث حالة الطلب.
      await client.query(
        `UPDATE payment_orders
         SET status = 'APPROVED',
             reviewed_at = NOW(),
             reviewed_by = $1,
             rejection_reason = NULL
         WHERE id = $2`,
        [req.user.id, order.id]
      );

      // تسجيل عملية الاعتماد.
      await client.query(
        `INSERT INTO audit_logs (
           actor_user_id,
           action,
           entity_type,
           entity_id,
           details
         )
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          req.user.id,
          "PAYMENT_ORDER_APPROVED",
          "payment_order",
          String(order.id),
          JSON.stringify({
            studentId: order.student_id,
            minutesAdded: addedMinutes,
            previousBalance: currentBalance,
            newBalance,
            amountETB: Number(order.amount_etb)
          })
        ]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        success: true,
        message: "تم اعتماد الدفع وإضافة الدقائق بنجاح.",
        orderId: order.id,
        minutesAdded: addedMinutes,
        previousBalance: currentBalance,
        newBalance
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }

      console.error("Approve payment failed:", error.message);

      const knownErrors = {
        PACKAGE_NOT_FOUND:
          "الباقة المرتبطة بالطلب غير موجودة.",
        ORDER_PACKAGE_MISMATCH:
          "بيانات الطلب لا تتطابق مع الباقة المسجلة.",
        MINUTE_ACCOUNT_NOT_FOUND:
          "تعذر العثور على حساب دقائق الطالب.",
        INVALID_MINUTES:
          "عدد الدقائق أو الرصيد غير صالح."
      };

      if (knownErrors[error.message]) {
        return sendError(res, 409, knownErrors[error.message]);
      }

      return sendError(
        res,
        500,
        "تعذر اعتماد الدفع. تم التراجع عن تغييرات هذه المعاملة."
      );
    } finally {
      client.release();
    }
  }
);

// ======================================================
// 6. رفض طلب الدفع مع تسجيل السبب
// POST /api/payments/admin/orders/:id/reject
// Body: { "reason": "سبب الرفض" }
// ======================================================

router.post(
  "/admin/orders/:id/reject",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    const orderId = validOrderId(req.params.id);

    const reason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim()
        : "";

    if (orderId === null) {
      return sendError(res, 400, "رقم الطلب غير صالح.");
    }

    if (!reason || reason.length > 1000) {
      return sendError(
        res,
        400,
        "أدخل سبب الرفض، بحد أقصى 1000 حرف."
      );
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const result = await client.query(
        `SELECT id, status
         FROM payment_orders
         WHERE id = $1
         FOR UPDATE`,
        [orderId]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return sendError(res, 404, "طلب الدفع غير موجود.");
      }

      if (result.rows[0].status !== "PENDING") {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return sendError(
          res,
          409,
          "لا يمكن رفض طلب تمت مراجعته سابقًا."
        );
      }

      await client.query(
        `UPDATE payment_orders
         SET status = 'REJECTED',
             reviewed_at = NOW(),
             reviewed_by = $1,
             rejection_reason = $2
         WHERE id = $3`,
        [req.user.id, reason, orderId]
      );

      await client.query(
        `INSERT INTO audit_logs (
           actor_user_id,
           action,
           entity_type,
           entity_id,
           details
         )
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          req.user.id,
          "PAYMENT_ORDER_REJECTED",
          "payment_order",
          String(orderId),
          JSON.stringify({ reason })
        ]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        success: true,
        message: "تم رفض طلب الدفع وتسجيل السبب.",
        orderId
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }

      console.error("Reject payment failed:", error.message);
      return sendError(res, 500, "تعذر رفض طلب الدفع.");
    } finally {
      client.release();
    }
  }
);

module.exports = router;
