
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

// عرض البرامج النشطة للطلاب والزوار
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         code,
         name_ar,
         name_en,
         description_ar,
         description_en,
         is_active
       FROM programs
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, code ASC`
    );

    return res.json({
      success: true,
      programs: result.rows
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
           code,
           name_ar,
           name_en,
           description_ar,
           description_en,
           is_active,
           sort_order
         FROM programs
         ORDER BY sort_order ASC, code ASC`
      );

      return res.json({
        success: true,
        programs: result.rows
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
         SET is_active = $1,
             updated_at = NOW()
         WHERE code = $2
         RETURNING code, name_ar, name_en, is_active`,
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
