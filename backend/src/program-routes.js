
const express = require("express");
const { pool } = require("./db");
const {
  authenticateToken,
  requireRoles
} = require("./security");

const router = express.Router();

const ALLOWED_PROGRAM_CODES = [
  "TALQEEN_CORRECTION",
  "QURAN_HIFZ",
  "HAFS_IJAZAH",
  "SEVEN_QIRAAT"
];

// ترتيب عرض البرامج دون الحاجة إلى عمود sort_order
const PROGRAM_ORDER = [
  "TALQEEN_CORRECTION",
  "QURAN_HIFZ",
  "HAFS_IJAZAH",
  "SEVEN_QIRAAT"
];

function orderPrograms(rows) {
  const order = new Map(
    PROGRAM_ORDER.map((code, index) => [code, index])
  );

  return rows.sort((a, b) => {
    const aOrder = order.get(a.code) ?? 999;
    const bOrder = order.get(b.code) ?? 999;

    return aOrder - bOrder || a.code.localeCompare(b.code);
  });
}

// عرض البرامج النشطة للطلاب والزوار
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         code,
         name_ar,
         name_en,
         description_ar,
         is_active
       FROM programs
       WHERE is_active = TRUE
       ORDER BY code ASC`
    ).catch(async (error) => {
      // توافق احتياطي إذا لم يوجد عمود name_en
      if (error.code !== "42703") {
        throw error;
      }

      return pool.query(
        `SELECT
           id,
           code,
           name_ar,
           description_ar,
           is_active
         FROM programs
         WHERE is_active = TRUE
         ORDER BY code ASC`
      );
    });

    return res.json({
      success: true,
      programs: orderPrograms(result.rows)
    });
  } catch (error) {
    console.error("List programs failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب البرامج حاليًا."
    });
  }
});

// عرض جميع البرامج للمشرف الأكاديمي
router.get(
  "/admin/all",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           id,
           code,
           name_ar,
           description_ar,
           is_active,
           created_at
         FROM programs
         ORDER BY code ASC`
      );

      return res.json({
        success: true,
        programs: orderPrograms(result.rows)
      });
    } catch (error) {
      console.error("Admin list programs failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر جلب قائمة البرامج."
      });
    }
  }
);

// تفعيل برنامج أو تعطيله
router.patch(
  "/admin/:code/status",
  authenticateToken,
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR"),
  async (req, res) => {
    const { code } = req.params;
    const { isActive } = req.body || {};

    if (!ALLOWED_PROGRAM_CODES.includes(code)) {
      return res.status(400).json({
        success: false,
        message: "رمز البرنامج غير صالح."
      });
    }

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "يجب إرسال isActive بقيمة true أو false."
      });
    }

    try {
      const result = await pool.query(
        `UPDATE programs
         SET is_active = $1
         WHERE code = $2
         RETURNING
           id,
           code,
           name_ar,
           description_ar,
           is_active`,
        [isActive, code]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          message: "البرنامج غير موجود."
        });
      }

      return res.json({
        success: true,
        message: isActive
          ? "تم تفعيل البرنامج."
          : "تم تعطيل البرنامج.",
        program: result.rows[0]
      });
    } catch (error) {
      console.error("Update program status failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر تعديل حالة البرنامج."
      });
    }
  }
);

module.exports = router;
