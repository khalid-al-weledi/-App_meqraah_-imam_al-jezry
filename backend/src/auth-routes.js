
const express = require("express");
const { randomUUID } = require("crypto");

const { pool } = require("./db");

const {
  createToken,
  hashPassword,
  verifyPassword
} = require("./security");

const {
  registerSchema,
  loginSchema,
  validate
} = require("./validators");

const router = express.Router();

function sendValidationError(res, errors) {
  return res.status(400).json({
    success: false,
    message: "يرجى مراجعة البيانات المدخلة.",
    errors
  });
}

// إنشاء حساب طالب جديد
router.post("/register", async (req, res) => {
  const checked = validate(registerSchema, req.body);

  if (!checked.success) {
    return sendValidationError(res, checked.errors);
  }

  const data = checked.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const phone = data.phone.replace(/[\s()-]/g, "");

    const existing = await client.query(
      `SELECT id
       FROM users
       WHERE phone = $1
       LIMIT 1`,
      [phone]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        success: false,
        message: "رقم الهاتف مسجل من قبل. يرجى تسجيل الدخول."
      });
    }

    const passwordHash = await hashPassword(data.password);

    const userResult = await client.query(
      `INSERT INTO users (
         full_name,
         phone,
         password_hash,
         role,
         preferred_language
       )
       VALUES ($1, $2, $3, 'STUDENT', $4)
       RETURNING id, full_name, phone, role, preferred_language`,
      [
        data.fullName,
        phone,
        passwordHash,
        data.language
      ]
    );

    const user = userResult.rows[0];

    const serialResult = await client.query(
      `SELECT nextval(
         pg_get_serial_sequence('student_profiles', 'id')
       ) AS id`
    );

    const studentId = serialResult.rows[0].id;

    const prefix = data.gender === "MALE" ? "IM" : "IF";

    const studentCode =
      prefix + "-" + String(studentId).padStart(6, "0");

    await client.query(
      `INSERT INTO student_profiles (
         id,
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
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )`,
      [
        studentId,
        user.id,
        studentCode,
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

    await client.query(
      `INSERT INTO minute_accounts (student_id, balance_minutes)
       VALUES ($1, 0)`,
      [studentId]
    );

    const programResult = await client.query(
      `SELECT id, code
       FROM programs
       WHERE code = ANY($1::varchar[])
         AND is_active = TRUE`,
      [data.programCodes]
    );

    if (programResult.rowCount !== data.programCodes.length) {
      throw new Error(
        "One or more requested programs are unavailable."
      );
    }

    for (const program of programResult.rows) {
      await client.query(
        `INSERT INTO enrollments (
           student_id,
           program_id,
           status
         )
         VALUES ($1, $2, 'PENDING')
         ON CONFLICT (student_id, program_id) DO NOTHING`,
        [studentId, program.id]
      );
    }

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
          requestedPrograms: data.programCodes
        })
      ]
    );

    await client.query("COMMIT");

    const token = createToken({
      id: user.id,
      role: user.role
    });

    return res.status(201).json({
      success: true,
      message: "تم إنشاء الحساب وإرسال طلب التسجيل للمراجعة.",
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
        gender: data.gender,
        balanceMinutes: 0
      },
      enrollmentStatus: "PENDING"
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Registration error:", error.message);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "يوجد حساب أو رقم طالب مسجل بهذه البيانات."
      });
    }

    return res.status(500).json({
      success: false,
      message: "تعذر إتمام التسجيل حاليًا."
    });
  } finally {
    client.release();
  }
});

// تسجيل الدخول برقم الهاتف وكلمة المرور
router.post("/login", async (req, res) => {
  const checked = validate(loginSchema, req.body);

  if (!checked.success) {
    return sendValidationError(res, checked.errors);
  }

  const phone = checked.data.phone.replace(/[\s()-]/g, "");

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

    const passwordMatches = await verifyPassword(
      checked.data.password,
      user.password_hash
    );

    if (!passwordMatches || !user.is_active) {
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
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر تسجيل الدخول حاليًا."
    });
  }
});

// معلومات الحساب الحالي
const { authenticateToken } = require("./security");

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.phone,
         u.role,
         u.preferred_language,
         s.student_code,
         s.gender,
         s.id AS student_id
       FROM users u
       LEFT JOIN student_profiles s ON s.user_id = u.id
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

    return res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Account lookup error:", error.message);

    return res.status(500).json({
      success: false,
      message: "تعذر جلب بيانات الحساب."
    });
  }
});

module.exports = router;
