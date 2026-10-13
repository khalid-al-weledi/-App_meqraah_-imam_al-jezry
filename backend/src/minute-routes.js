
const express = require("express");
const { pool } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getStudentId(userId) {
  const result = await pool.query(
    `SELECT id
     FROM student_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0]?.id ?? null;
}

// رصيد الطالب وسجل حركات الدقائق
router.get(
  "/my-balance",
  authenticateToken,
  requireRoles("STUDENT"),
  async (req, res) => {
    try {
      const studentId = await getStudentId(req.user.id);

      if (!studentId) {
        return res.status(404).json({
          success: false,
          message: "ملف الطالب غير موجود."
        });
      }

      const result = await pool.query(
        `SELECT
           balance_minutes,
           created_at
         FROM student_profiles
         WHERE id = $1
         LIMIT 1`,
        [studentId]
      );

      const history = await pool.query(
        `SELECT
           id,
           transaction_type,
           minutes_delta,
           balance_after,
           payment_order_id,
           notes,
           created_at
         FROM minute_ledger
         WHERE student_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [studentId]
      );

      return res.json({
        success: true,
        balanceMinutes: Number(result.rows[0].balance_minutes),
        history: history.rows
      });
    } catch (error) {
      console.error("Get minute balance failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "تعذر جلب رصيد الدقائق."
      });
    }
  }
);

// رصيد طالب محدد للإدارة والمحاسب
router.get(
  "/admin/student/:studentId",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    const studentId = req.params.studentId;

    if (!UUID_PATTERN.test(studentId)) {
      return res.status(400).json({
        success: false,
        message: "معرّف الطالب غير صالح."
      });
    }

    try {
      const result = await pool.query(
        `SELECT
           sp.id AS student_id,
           sp.student_code,
           sp.balance_minutes,
           sp.created_at,
           u.full_name,
           u.phone
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         WHERE sp.id = $1
         LIMIT 1`,
        [studentId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "الطالب غير موجود."
        });
      }

      const history = await pool.query(
        `SELECT
           id,
           transaction_type,
           minutes_delta,
           balance_after,
           payment_order_id,
           actor_user_id,
           notes,
           created_at
         FROM minute_ledger
         WHERE student_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [studentId]
      );

      const student = result.rows[0];

      return res.json({
        success: true,
        student: {
          id: student.student_id,
          studentCode: student.student_code,
          fullName: student.full_name,
          phone: student.phone,
          balanceMinutes: Number(student.balance_minutes),
          createdAt: student.created_at
        },
        history: history.rows
      });
    } catch (error) {
      console.error("Admin minute balance failed:", error.message);
      return res.status(500).json({
        success: false,
        message: "تعذر جلب بيانات رصيد الطالب."
      });
    }
  }
);

module.exports = router;
