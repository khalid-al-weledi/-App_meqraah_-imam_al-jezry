
const express = require("express");
const { pool } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

// تحديد ملف الطالب المرتبط بالحساب الحالي
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

// عرض رصيد الطالب وسجل الدقائق
router.get("/my-balance", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        success: false,
        message: "هذه الواجهة مخصصة لحساب الطالب."
      });
    }

    const studentId = await getStudentId(req.user.id);

    if (!studentId) {
      return res.status(404).json({
        success: false,
        message: "ملف الطالب غير موجود."
      });
    }

    const accountResult = await pool.query(
      `SELECT balance_minutes
       FROM minute_accounts
       WHERE student_id = $1
       LIMIT 1`,
      [studentId]
    );

    if (accountResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "لم يتم إنشاء حساب الدقائق لهذا الطالب."
      });
    }

    const ledgerResult = await pool.query(
      `SELECT
         id,
         entry_type,
         minutes,
         description,
         created_at
       FROM minute_ledger
       WHERE student_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      [studentId]
    );

    return res.json({
      success: true,
      balanceMinutes: accountResult.rows[0].balance_minutes,
      history: ledgerResult.rows
    });
  } catch (error) {
    console.error("Get minute balance failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب رصيد الدقائق."
    });
  }
});

// عرض رصيد طالب محدد للمحاسب والإدارة
router.get(
  "/admin/student/:studentId",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACCOUNTANT"),
  async (req, res) => {
    const studentId = Number(req.params.studentId);

    if (!Number.isSafeInteger(studentId) || studentId < 1) {
      return res.status(400).json({
        success: false,
        message: "رقم الطالب غير صالح."
      });
    }

    try {
      const accountResult = await pool.query(
        `SELECT
           sp.id AS student_id,
           sp.student_code,
           u.full_name,
           ma.balance_minutes
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN minute_accounts ma ON ma.student_id = sp.id
         WHERE sp.id = $1
         LIMIT 1`,
        [studentId]
      );

      if (accountResult.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "الطالب غير موجود."
        });
      }

      const historyResult = await pool.query(
        `SELECT
           id,
           entry_type,
           minutes,
           description,
           created_at
         FROM minute_ledger
         WHERE student_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [studentId]
      );

      return res.json({
        success: true,
        student: accountResult.rows[0],
        history: historyResult.rows
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
