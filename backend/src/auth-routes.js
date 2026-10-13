
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

// اللغات المعتمدة: العربية والأمهرية فقط
function getLanguage(value) {
  return ["ar", "am"].includes(value) ? value : "ar";
}

// إنشاء رمز طالب مرتبط بمعرف الطالب
function generateStudentCode(gender, studentId) {
  const prefix = gender === "FEMALE" ? "IF" : "IM";
  const suffix = String(studentId)
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();

  return `${prefix}-${suffix}`;
}

// إنشاء حساب طالب جديد
router.post("/register", async (req, res) => {
  const checked = validate(registerSchema, req.body);

  if (!checked.success) {
    return validationResponse(res, checked.errors);
  }

  const data = checked.data;
  const phone = normalizePhone(data.phone);
  const language = getLanguage(data.language);
  const programCodes = [...new Set(data.programCodes || [])];

  if (!programCodes.length) {
    return res.status(400).json({
      success: false,
      message: "يرجى اختيار برنامج واحد على الأقل."
    });
  }

  const invalidCodes = programCodes.filter(
    (code) => !PROGRAM_CODES.includes(code)
  );

  if (invalidCodes.length) {
    return res.status(400).json({
      success: false,
      message: "توجد رموز برامج غير صحيحة.",
      invalidCodes
    });
  }

  if (!["MALE", "FEMALE"].includes(data.gender)) {
    return res.status(400).json({
      success: false,
      message: "يرجى تحديد الجنس بطريقة صحيحة."
    });
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    // منع التسجيل المكرر برقم الهاتف
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

    // إنشاء المستخدم
    const userResult = await client.query(
      `INSERT INTO users (
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

    // إنشاء ملف الطالب، مع حفظ المدينة السابقة
    const temporaryCode = `TMP-${randomUUID()}`;

    const studentResult = await client.query(
      `INSERT INTO student_profiles (
         user_id,
         student_code,
         balance_minutes,
         gender,
         age,
         country,
         city,
         previous_city,
         previous_school,
         previous_teacher,
         reading_level,
         has_read_quran_looking,
         memorized_juz
       )
       VALUES (
         $1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       RETURNING id, gender, balance_minutes`,
      [
        user.id,
        temporaryCode,
        data.gender,
        data.age ?? null,
        data.country ?? null,
        data.city ?? null,
        data.previousCity ?? null,
        data.previousSchool ?? null,
        data.previousTeacher ?? null,
        data.readingLevel ?? null,
        data.hasReadQuranLooking ?? false,
        data.memorizedJuz ?? 0
      ]
    );

    const student = studentResult.rows[0];
    const studentId = student.id;

    const studentCode = generateStudentCode(
      student.gender,
      studentId
    );

    await client.query(
      `UPDATE student_profiles
       SET student_code = $1
       WHERE id = $2`,
      [studentCode, studentId]
    );

    // التأكد من أن البرامج المطلوبة موجودة ومفعلة
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

    if (unavailableCodes.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: "بعض البرامج المختارة غير متاحة حاليًا.",
        unavailableCodes
      });
    }

    // إنشاء طلب التحاق لكل برنامج
    for (const programCode of programCodes) {
      await client.query(
        `INSERT INTO enrollments (
           student_id,
           program_id,
           status,
           requested_at
         )
         VALUES ($1, $2, 'PENDING', NOW())`,
        [
          studentId,
          availablePrograms.get(programCode)
        ]
      );
    }

    // تسجيل العملية في سجل التدقيق
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

    // إصدار الرمز قبل اعتماد المعاملة
    const token = createToken({
      id: user.id,
      role: user.role
    });

    await client.query("COMMIT");
    transactionStarted = false;

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
        balanceMinutes: student.balance_minutes,
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
        message: "توجد بيانات مسجلة مسبقًا. تحقق من رقم الهاتف أو أعد المحاولة."
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

    if (!result.rowCount) {
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
         sp.gender,
         sp.balance_minutes
       FROM users u
       LEFT JOIN student_profiles sp
         ON sp.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [req.user.id]
    );

    if (!result.rowCount) {
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
        gender: user.gender ?? null,
        balanceMinutes: user.balance_minutes ?? null
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
