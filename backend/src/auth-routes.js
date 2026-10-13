
const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("./db");

const {
  createToken,
  hashPassword,
  verifyPassword,
  authenticateToken
} = require("./security");

const {
  registerSchema,
  loginSchema,
  validate
} = require("./validators");

const router = express.Router();

const PROGRAM_CODES = [
  "TALQEEN_CORRECTION",
  "QURAN_HIFZ",
  "HAFS_IJAZAH",
  "SEVEN_QIRAAT"
];

function validationResponse(res, errors) {
  return res.status(400).json({
    success: false,
    message: "يرجى مراجعة البيانات المدخلة.",
    errors
  });
}

function normalizePhone(phone) {
  return phone.replace(/[\s()-]/g, "");
}

function getLanguage(value) {
  const allowedLanguages = ["ar", "am", "en", "om"];
  return allowedLanguages.includes(value) ? value : "ar";
}

// إنشاء حساب طالب جديد
router.post("/register", async (req, res) => {
  const checked = validate(registerSchema, req.body);

  if (!checked.success) {
    return validationResponse(res, checked.errors);
  }

  const data = checked.data;
  const phone = normalizePhone(data.phone);
  const programCodes = [...new Set(data.programCodes || [])];

  if (programCodes.length === 0) {
    return res.status(400).json({
      success: false,
      message: "يرجى اختيار برنامج واحد على الأقل."
    });
  }

  const invalidCodes = programCodes.filter(
    (code) => !PROGRAM_CODES.includes(code)
  );

  if (invalidCodes.length > 0) {
    return res.status(400).json({
      success: false,
      message: "توجد رموز برامج غير صحيحة.",
      invalidCodes
    });
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const existing = await client.query(
      `SELECT id
       FROM users
       WHERE phone = $1
       LIMIT 1`,
      [phone]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: "رقم الهاتف مسجل مسبقًا. يرجى تسجيل الدخول."
      });
    }

    const passwordHash = await hashPassword(data.password);
    const language = getLanguage(data.language);

    // اسم العمود الصحيح في قاعدة البيانات: preferred_language
    const userResult = await client.query(
      `INSERT INTO users
        (
          full_name,
          phone,
          password_hash,
          role,
          preferred_language,
          is_active
        )
       VALUES ($1, $2, $3, 'STUDENT', $4, TRUE)
       RETURNING
         id,
         full_name,
         phone,
         role,
         preferred_language`,
      [
        data.fullName,
        phone,
        passwordHash,
        language
      ]
    );

    const user = userResult.rows[0];

    // إنشاء الملف الشخصي برمز مؤقت داخل المعاملة نفسها
    const temporaryCode = `TMP-${randomUUID()}`;

    const studentResult = await client.query(
      `INSERT INTO student_profiles
        (
          user_id,
          student_code,
          gender,
          age,
          country,
          city,
          previous_school,
          previous_teacher,
          reading_level,
          has_read_quran_looking,
          memorized_juz
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, gender`,
      [
        user.id,
        temporaryCode,
        data.gender,
        data.age ?? null,
        data.country ?? null,
        data.city ?? null,
        data.previousSchool ?? null,
        data.previousTeacher ?? null,
        data.readingLevel ?? null,
        data.hasReadQuranLooking,
        data.memorizedJuz
      ]
    );

    const student = studentResult.rows[0];
    const studentId = student.id;

    const prefix = student.gender === "FEMALE" ? "IF" : "IM";
    const studentCode =
      `${prefix}-${String(studentId).padStart(6, "0")}`;

    await client.query(
      `UPDATE student_profiles
       SET student_code = $1
       WHERE id = $2`,
      [studentCode, studentId]
    );

    // إنشاء حساب الدقائق الابتدائي
    await client.query(
      `INSERT INTO minute_accounts
        (student_id, balance_minutes)
       VALUES ($1, 0)`,
      [studentId]
    );

    // التحقق من البرامج المطلوبة باستخدام رموزها الفعلية
    const programResult = await client.query(
      `SELECT id, code
       FROM programs
       WHERE code = ANY($1::text[])
         AND is_active = TRUE`,
      [programCodes]
    );

    const availablePrograms = new Map(
      programResult.rows.map((program) => [
        program.code,
        program.id
      ])
    );

    const unavailableCodes = programCodes.filter(
      (code) => !availablePrograms.has(code)
    );

    if (unavailableCodes.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: "بعض البرامج المختارة غير متاحة حاليًا.",
        unavailableCodes
      });
    }

    // جدول enrollments يستخدم program_id وليس program_code
    for (const programCode of programCodes) {
      const programId = availablePrograms.get(programCode);

      await client.query(
        `INSERT INTO enrollments
          (
            student_id,
            program_id,
            status,
            requested_at
          )
         VALUES ($1, $2, 'PENDING', NOW())`,
        [studentId, programId]
      );
    }

    // تسجيل العملية في سجل التدقيق
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
        user.id,
        "STUDENT_REGISTERED",
        "student",
        String(studentId),
        JSON.stringify({
          studentCode,
          programCodes,
          preferredLanguage: language
        })
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    const token = createToken({
      id: user.id,
      role: user.role
    });

    return res.status(201).json({
      success: true,
      message: "تم إنشاء الحساب بنجاح، وطلبات البرامج بانتظار المراجعة.",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        language: user.preferred_language
      },
      student: {
        id: studentId,
        studentCode,
        gender: student.gender,
        status: "PENDING"
      },
      enrollments: programCodes.map((code) => ({
        programCode: code,
        status: "PENDING"
      }))
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Registration failed:", error.message);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "البيانات مسجلة مسبقًا. تحقق من رقم الهاتف."
      });
    }

    return res.status(500).json({
      success: false,
      message: "تعذر إكمال التسجيل حاليًا."
    });
  } finally {
    client.release();
  }
});

// تسجيل الدخول
router.post("/login", async (req, res) => {
  const checked = validate(loginSchema, req.body);

  if (!checked.success) {
    return validationResponse(res, checked.errors);
  }

  const phone = normalizePhone(checked.data.phone);

  try {
    const result = await pool.query(
      `SELECT
         id,
         full_name,
         phone,
         password_hash,
         role,
         preferred_language,
         is_active
       FROM users
       WHERE phone = $1
       LIMIT 1`,
      [phone]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        success: false,
        message: "رقم الهاتف أو كلمة المرور غير صحيحة."
      });
    }

    const user = result.rows[0];

    const passwordIsValid = await verifyPassword(
      checked.data.password,
      user.password_hash
    );

    if (!passwordIsValid || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: "رقم الهاتف أو كلمة المرور غير صحيحة."
      });
    }

    const token = createToken({
      id: user.id,
      role: user.role
    });

    return res.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح.",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        language: user.preferred_language
      }
    });
  } catch (error) {
    console.error("Login failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر تسجيل الدخول حاليًا."
    });
  }
});

// بيانات الحساب الحالي
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.phone,
         u.role,
         u.preferred_language,
         u.is_active,
         sp.student_code,
         sp.gender
       FROM users u
       LEFT JOIN student_profiles sp
         ON sp.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "الحساب غير موجود."
      });
    }

    const user = result.rows[0];

    return res.json({
      success: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        language: user.preferred_language,
        isActive: user.is_active,
        studentCode: user.student_code ?? null,
        gender: user.gender ?? null
      }
    });
  } catch (error) {
    console.error("Get account failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب بيانات الحساب."
    });
  }
});

module.exports = router;
