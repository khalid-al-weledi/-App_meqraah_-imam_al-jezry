
const express = require("express");
const { z } = require("zod");
const { query } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

router.use(authenticateToken);

const staffRoles = [
  "SUPER_ADMIN",
  "ACADEMIC_SUPERVISOR"
];

const notificationSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(2).max(200),
  message: z.string().trim().min(2).max(3000),
  type: z.enum([
    "GENERAL",
    "REGISTRATION",
    "PAYMENT",
    "LOW_BALANCE",
    "SESSION",
    "EXAM",
    "SYSTEM"
  ]).default("GENERAL")
});

// GET /api/notifications
// جلب إشعارات المستخدم الحالي.
router.get("/", async (req, res) => {
  try {
    const result = await query(
      `SELECT
         id,
         title,
         message,
         type,
         is_read,
         created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );

    return res.json({
      success: true,
      notifications: result.rows
    });
  } catch (error) {
    console.error("Notifications list error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب الإشعارات. تحقق من وجود جدول notifications."
    });
  }
});

// PATCH /api/notifications/:id/read
// تحديد إشعار واحد كمقروء.
router.patch("/:id/read", async (req, res) => {
  const notificationId = Number(req.params.id);

  if (
    !Number.isSafeInteger(notificationId) ||
    notificationId <= 0
  ) {
    return res.status(400).json({
      success: false,
      message: "رقم الإشعار غير صحيح."
    });
  }

  try {
    const result = await query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1
         AND user_id = $2
       RETURNING id, is_read`,
      [notificationId, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "الإشعار غير موجود."
      });
    }

    return res.json({
      success: true,
      message: "تم تحديد الإشعار كمقروء.",
      notification: result.rows[0]
    });
  } catch (error) {
    console.error("Mark notification read error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر تحديث الإشعار."
    });
  }
});

// PATCH /api/notifications/read-all
// تحديد جميع إشعارات المستخدم كمقروءة.
router.patch("/read-all", async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1
         AND is_read = FALSE`,
      [req.user.id]
    );

    return res.json({
      success: true,
      message: "تم تحديد الإشعارات كمقروءة.",
      updatedCount: result.rowCount
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر تحديث الإشعارات."
    });
  }
});

// POST /api/notifications/admin/send
// إنشاء إشعار داخل النظام لمستخدم محدد أو لجميع المستخدمين.
router.post(
  "/admin/send",
  requireRoles(...staffRoles),
  async (req, res) => {
    const parsed = notificationSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "بيانات الإشعار غير صحيحة.",
        errors: parsed.error.flatten()
      });
    }

    const { userId, title, message, type } = parsed.data;

    try {
      let result;

      if (userId) {
        const user = await query(
          `SELECT id
           FROM users
           WHERE id = $1
             AND is_active = TRUE`,
          [userId]
        );

        if (user.rowCount === 0) {
          return res.status(404).json({
            success: false,
            message: "المستخدم غير موجود أو غير نشط."
          });
        }

        result = await query(
          `INSERT INTO notifications
            (user_id, title, message, type, is_read)
           VALUES ($1, $2, $3, $4, FALSE)
           RETURNING id, user_id, title, message, type, created_at`,
          [userId, title, message, type]
        );
      } else {
        result = await query(
          `INSERT INTO notifications
            (user_id, title, message, type, is_read)
           SELECT id, $1, $2, $3, FALSE
           FROM users
           WHERE is_active = TRUE
           RETURNING id, user_id, title, message, type, created_at`,
          [title, message, type]
        );
      }

      return res.status(201).json({
        success: true,
        message: userId
          ? "تم إنشاء الإشعار."
          : "تم إنشاء الإشعار للمستخدمين النشطين.",
        count: result.rowCount
      });
    } catch (error) {
      console.error("Send notification error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر إنشاء الإشعار. تحقق من بنية جدول notifications."
      });
    }
  }
);

module.exports = router;
