
const express = require("express");
const { z } = require("zod");
const { pool } = require("./db");
const { authenticateToken, requireRoles } = require("./security");

const router = express.Router();

router.use(authenticateToken);

const attendanceSchema = z.object({
  status: z.enum(["ATTENDED", "ABSENT", "CANCELLED"]),
  actualMinutes: z.coerce.number().int().min(0).max(300).optional(),
  notes: z.string().trim().max(2000).optional().default("")
});

router.patch(
  "/:sessionId",
  requireRoles("SUPER_ADMIN", "ACADEMIC_SUPERVISOR", "TEACHER"),
  async (req, res) => {
    const sessionId = Number(req.params.sessionId);

    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "رقم الجلسة غير صحيح."
      });
    }

    const parsed = attendanceSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "بيانات الحضور غير صحيحة.",
        errors: parsed.error.flatten()
      });
    }

    const { status, actualMinutes, notes } = parsed.data;
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const sessionResult = await client.query(
        `SELECT
           s.id,
           s.student_id,
           s.teacher_id,
           s.status AS session_status,
           s.duration_minutes,
           sp.user_id
         FROM sessions s
         JOIN student_profiles sp ON sp.id = s.student_id
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [sessionId]
      );

      if (sessionResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          success: false,
          message: "الجلسة غير موجودة."
        });
      }

      const session = sessionResult.rows[0];

      if (
        req.user.role === "TEACHER" &&
        String(session.teacher_id) !== String(req.user.id)
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          success: false,
          message: "لا يمكنك تسجيل حضور جلسة غير مسندة إليك."
        });
      }

      if (
        ["ATTENDED", "ABSENT", "CANCELLED"].includes(
          session.session_status
        )
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(409).json({
          success: false,
          message:
            "تم تسجيل حالة هذه الجلسة مسبقًا. يلزم إجراء تصحيح موثق بدل إعادة تسجيلها."
        });
      }

      if (
        status === "ATTENDED" &&
        (actualMinutes === undefined || actualMinutes < 1)
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "عند تسجيل الحضور، أدخل عدد دقائق القراءة الفعلية."
        });
      }

      if (
        status === "ATTENDED" &&
        (
          session.duration_minutes == null ||
          actualMinutes > Number(session.duration_minutes)
        )
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(400).json({
          success: false,
          message: "دقائق القراءة لا يمكن أن تتجاوز مدة الجلسة المحددة."
        });
      }

      let deductedMinutes = 0;
      let balanceAfter = null;

      if (status === "ATTENDED") {
        // مصدر الرصيد الأساسي: minute_accounts.
        // قفل سجل الطالب أولًا لتوحيد ترتيب الأقفال مع اعتماد الدفع.
        const profileResult = await client.query(
          `SELECT id, balance_minutes
           FROM student_profiles
           WHERE id = $1
           FOR UPDATE`,
          [session.student_id]
        );

        if (profileResult.rowCount === 0) {
          throw new Error("STUDENT_NOT_FOUND");
        }

        // لا ننسخ الرصيد القديم فوق حساب موجود، لأن الحساب قد يكون
        // أحدث من الرصيد المخزن في student_profiles.
        await client.query(
          `INSERT INTO minute_accounts (student_id, balance_minutes)
           VALUES ($1, $2)
           ON CONFLICT (student_id) DO NOTHING`,
          [
            session.student_id,
            Number(profileResult.rows[0].balance_minutes) || 0
          ]
        );

        const accountResult = await client.query(
          `SELECT balance_minutes
           FROM minute_accounts
           WHERE student_id = $1
           FOR UPDATE`,
          [session.student_id]
        );

        if (accountResult.rowCount === 0) {
          throw new Error("MINUTE_ACCOUNT_NOT_FOUND");
        }

        const currentBalance = Number(
          accountResult.rows[0].balance_minutes
        );
        const minutes = actualMinutes;

        if (
          !Number.isSafeInteger(currentBalance) ||
          currentBalance < 0
        ) {
          throw new Error("INVALID_BALANCE");
        }

        if (currentBalance < minutes) {
          await client.query("ROLLBACK");
          transactionStarted = false;

          return res.status(409).json({
            success: false,
            code: "INSUFFICIENT_MINUTE_BALANCE",
            message:
              "رصيد الطالب لا يكفي لتسجيل خصم هذه الجلسة. راجع الرصيد قبل اعتماد الحضور."
          });
        }

        const newBalance = currentBalance - minutes;
        const deductionNote = `خصم دقائق جلسة القراءة رقم ${sessionId}`;

        // تحديث الحساب الأساسي.
        await client.query(
          `UPDATE minute_accounts
           SET balance_minutes = $1,
               updated_at = NOW()
           WHERE student_id = $2`,
          [newBalance, session.student_id]
        );

        // إبقاء العمود القديم متزامنًا حتى لا تتعطل التقارير الحالية.
        await client.query(
          `UPDATE student_profiles
           SET balance_minutes = $1
           WHERE id = $2`,
          [newBalance, session.student_id]
        );

        // تسجيل الحقول القديمة والجديدة لتوافق المسارات الحالية.
        await client.query(
          `INSERT INTO minute_ledger (
             student_id,
             entry_type,
             amount_minutes,
             minutes,
             description,
             note,
             transaction_type,
             minutes_delta,
             balance_after,
             notes,
             actor_user_id,
             created_by
           )
           VALUES ($1, $2, $3, $3, $4, $4, $2, $3, $5, $4, $6, $6)`,
          [
            session.student_id,
            "SESSION_DEDUCTION",
            -minutes,
            deductionNote,
            newBalance,
            req.user.id
          ]
        );

        deductedMinutes = minutes;
        balanceAfter = newBalance;
      }

      const updatedSession = await client.query(
        `UPDATE sessions
         SET status = $1,
             notes = CASE
               WHEN $2 = '' THEN notes
               ELSE $2
             END
         WHERE id = $3
         RETURNING id, student_id, teacher_id, status,
                   duration_minutes, scheduled_at, notes`,
        [status, notes, sessionId]
      );

      await client.query(
        `INSERT INTO audit_logs
          (actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          req.user.id,
          "SESSION_ATTENDANCE_RECORDED",
          "session",
          String(sessionId),
          JSON.stringify({
            studentId: session.student_id,
            status,
            actualMinutes: status === "ATTENDED" ? actualMinutes : 0,
            deductedMinutes,
            balanceAfter,
            notes
          })
        ]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        success: true,
        message:
          status === "ATTENDED"
            ? "تم تسجيل الحضور وخصم دقائق القراءة الفعلية."
            : status === "ABSENT"
              ? "تم تسجيل الغياب دون خصم دقائق."
              : "تم إلغاء الجلسة دون خصم دقائق.",
        session: updatedSession.rows[0],
        deductedMinutes,
        balanceAfter
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => {});
      }

      console.error("Attendance recording error:", error.message);

      return res.status(500).json({
        success: false,
        message: "تعذر تسجيل الحضور. تحقق من بنية قاعدة البيانات."
      });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
