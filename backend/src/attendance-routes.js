
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

// PATCH /api/attendance/:sessionId
// تسجيل الحضور وتحديث الرصيد داخل معاملة واحدة.
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

    try {
      await client.query("BEGIN");

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

        return res.status(409).json({
          success: false,
          message: "تم تسجيل حالة هذه الجلسة مسبقًا. يلزم إجراء تصحيح موثق بدل إعادة تسجيلها."
        });
      }

      if (
        status === "ATTENDED" &&
        (actualMinutes === undefined || actualMinutes < 1)
      ) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message: "عند تسجيل الحضور، أدخل عدد دقائق القراءة الفعلية."
        });
      }

      if (
        status === "ATTENDED" &&
        actualMinutes > Number(session.duration_minutes)
      ) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message: "لا يمكن تسجيل دقائق تتجاوز مدة الجلسة المحددة."
        });
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

      let deductedMinutes = 0;
      let balanceAfter = null;

      if (status === "ATTENDED") {
        const minutes = actualMinutes;

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

        if (currentBalance < minutes) {
          await client.query("ROLLBACK");

          return res.status(409).json({
            success: false,
            code: "INSUFFICIENT_MINUTE_BALANCE",
            message: "رصيد الطالب لا يكفي لتسجيل خصم هذه الجلسة. يلزم مراجعة الرصيد أو اعتماد إجراء مالي مناسب."
          });
        }

        const newBalance = currentBalance - minutes;

        await client.query(
          `UPDATE minute_accounts
           SET balance_minutes = $1
           WHERE student_id = $2`,
          [newBalance, session.student_id]
        );

        await client.query(
          `INSERT INTO minute_ledger
            (student_id, entry_type, minutes, description)
           VALUES ($1, $2, $3, $4)`,
          [
            session.student_id,
            "SESSION_DEDUCTION",
            -minutes,
            `خصم دقائق جلسة القراءة رقم ${sessionId}`
          ]
        );

        deductedMinutes = minutes;
        balanceAfter = newBalance;
      }

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
            notes
          })
        ]
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        message: status === "ATTENDED"
          ? "تم تسجيل الحضور وخصم دقائق القراءة الفعلية."
          : status === "ABSENT"
            ? "تم تسجيل الغياب دون خصم دقائق."
            : "تم إلغاء الجلسة دون خصم دقائق.",
        session: updatedSession.rows[0],
        deductedMinutes,
        balanceAfter
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}

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
