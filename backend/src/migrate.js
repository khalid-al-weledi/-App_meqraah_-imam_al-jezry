
require("dotenv").config();

const { pool, checkDatabase } = require("./db");

async function migrate() {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const database = await checkDatabase();

    console.log("Connected database:", database.database_name);

    // لا نحذف أي جدول أو سجل موجود.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ==================================================
    // USERS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        full_name VARCHAR(200) NOT NULL,
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(40) UNIQUE,
        password_hash TEXT,
        role VARCHAR(40) NOT NULL DEFAULT 'STUDENT'
          CHECK (
            role IN (
              'SUPER_ADMIN',
              'ACADEMIC_SUPERVISOR',
              'ACCOUNTANT',
              'TEACHER',
              'STUDENT'
            )
          ),
        preferred_language VARCHAR(10) NOT NULL DEFAULT 'ar'
          CHECK (
            preferred_language IN ('ar', 'am', 'en', 'om')
          ),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ==================================================
    // STUDENT PROFILES
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_profiles (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL UNIQUE
          REFERENCES users(id) ON DELETE RESTRICT,
        student_code VARCHAR(30) NOT NULL UNIQUE,
        gender VARCHAR(10) NOT NULL
          CHECK (gender IN ('MALE', 'FEMALE')),
        age INTEGER CHECK (age IS NULL OR age BETWEEN 3 AND 120),
        country VARCHAR(100),
        city VARCHAR(100),
        previous_school VARCHAR(200),
        previous_teacher VARCHAR(200),
        reading_level VARCHAR(30),
        has_read_quran_looking BOOLEAN NOT NULL DEFAULT FALSE,
        memorized_juz NUMERIC(4,1) NOT NULL DEFAULT 0
          CHECK (memorized_juz BETWEEN 0 AND 30),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE student_profiles
      ADD COLUMN IF NOT EXISTS previous_city VARCHAR(100)
    `);

    // يستخدم مسار الدفع ومسار الرصيد هذا العمود.
    await client.query(`
      ALTER TABLE student_profiles
      ADD COLUMN IF NOT EXISTS balance_minutes
      INTEGER NOT NULL DEFAULT 0
    `);

    // ==================================================
    // PROGRAMS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS programs (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        name_ar VARCHAR(200) NOT NULL,
        name_en VARCHAR(200),
        description_ar TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // توافق مع قواعد البيانات التي أُنشئت بإصدار أقدم.
    await client.query(`
      ALTER TABLE programs
      ADD COLUMN IF NOT EXISTS name_en VARCHAR(200)
    `);

    await client.query(`
      ALTER TABLE programs
      ADD COLUMN IF NOT EXISTS description_ar TEXT
    `);

    // ==================================================
    // ENROLLMENTS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        program_id BIGINT NOT NULL
          REFERENCES programs(id) ON DELETE RESTRICT,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
          CHECK (
            status IN (
              'PENDING',
              'APPROVED',
              'ACTIVE',
              'PAUSED',
              'COMPLETED',
              'REJECTED'
            )
          ),
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE (student_id, program_id)
      )
    `);

    // ==================================================
    // PACKAGES
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        minutes INTEGER NOT NULL UNIQUE CHECK (minutes > 0),
        price_etb NUMERIC(12,2) NOT NULL CHECK (price_etb >= 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ==================================================
    // PAYMENT ORDERS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        package_id BIGINT NOT NULL
          REFERENCES packages(id) ON DELETE RESTRICT,
        amount_etb NUMERIC(12,2) NOT NULL CHECK (amount_etb >= 0),
        requested_minutes INTEGER NOT NULL CHECK (requested_minutes > 0),
        payment_method VARCHAR(40) NOT NULL,
        receipt_key TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        idempotency_key UUID NOT NULL UNIQUE,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        rejection_reason TEXT,
        credited_at TIMESTAMPTZ
      )
    `);

    // ==================================================
    // MINUTE ACCOUNTS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS minute_accounts (
        student_id BIGINT PRIMARY KEY
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        balance_minutes INTEGER NOT NULL DEFAULT 0
          CHECK (balance_minutes >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ==================================================
    // MINUTE LEDGER
    // دعم أسماء الأعمدة القديمة والجديدة معًا.
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS minute_ledger (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        amount_minutes INTEGER CHECK (amount_minutes <> 0),
        entry_type VARCHAR(40),
        reference_type VARCHAR(40),
        reference_id BIGINT,
        idempotency_key UUID UNIQUE,
        note TEXT,
        created_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(40)
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS minutes_delta INTEGER
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS balance_after INTEGER
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS payment_order_id BIGINT
      REFERENCES payment_orders(id) ON DELETE RESTRICT
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS actor_user_id BIGINT
      REFERENCES users(id) ON DELETE RESTRICT
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS notes TEXT
    `);

    // أعمدة يستخدمها مسار تسجيل الحضور.
    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS minutes INTEGER
    `);

    await client.query(`
      ALTER TABLE minute_ledger
      ADD COLUMN IF NOT EXISTS description TEXT
    `);

    // نسخ البيانات بين أسماء الأعمدة المتقابلة فقط.
    await client.query(`
      UPDATE minute_ledger
      SET
        minutes_delta = COALESCE(minutes_delta, amount_minutes),
        amount_minutes = COALESCE(amount_minutes, minutes_delta),
        transaction_type = COALESCE(transaction_type, entry_type),
        entry_type = COALESCE(entry_type, transaction_type),
        actor_user_id = COALESCE(actor_user_id, created_by),
        created_by = COALESCE(created_by, actor_user_id),
        notes = COALESCE(notes, note, description),
        note = COALESCE(note, notes, description),
        description = COALESCE(description, notes, note),
        minutes = COALESCE(minutes, amount_minutes, minutes_delta)
      WHERE minutes_delta IS NULL
         OR amount_minutes IS NULL
         OR transaction_type IS NULL
         OR entry_type IS NULL
         OR actor_user_id IS NULL
         OR created_by IS NULL
         OR notes IS NULL
         OR note IS NULL
         OR description IS NULL
         OR minutes IS NULL
    `);

    // مسارات الحضور الجديدة لا ترسل idempotency_key.
    await client.query(`
      ALTER TABLE minute_ledger
      ALTER COLUMN idempotency_key DROP NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
      idx_minute_ledger_payment_order_unique
      ON minute_ledger(payment_order_id)
      WHERE payment_order_id IS NOT NULL
    `);

    // ==================================================
    // SESSIONS
    // دعم حقول الجلسات القديمة والجديدة.
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        teacher_id BIGINT NOT NULL
          REFERENCES users(id) ON DELETE RESTRICT,
        program_id BIGINT
          REFERENCES programs(id) ON DELETE RESTRICT,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        scheduled_at TIMESTAMPTZ,
        duration_minutes INTEGER,
        actual_minutes INTEGER
          CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
        status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
        portion_read TEXT,
        portion_memorized TEXT,
        portion_reviewed TEXT,
        teacher_notes TEXT,
        notes TEXT,
        approved_at TIMESTAMPTZ,
        approved_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
    `);

    await client.query(`
      ALTER TABLE sessions
      ADD COLUMN IF NOT EXISTS notes TEXT
    `);

    // إبقاء المواعيد القديمة متاحة عبر الحقول الجديدة.
    await client.query(`
      UPDATE sessions
      SET
        scheduled_at = COALESCE(scheduled_at, starts_at),
        duration_minutes = COALESCE(
          duration_minutes,
          CASE
            WHEN starts_at IS NOT NULL
             AND ends_at IS NOT NULL
             AND ends_at > starts_at
            THEN GREATEST(
              1,
              FLOOR(
                EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60
              )::INTEGER
            )
            ELSE NULL
          END
        ),
        notes = COALESCE(notes, teacher_notes)
      WHERE scheduled_at IS NULL
         OR duration_minutes IS NULL
         OR notes IS NULL
    `);

    // الحقول التالية يجب أن تقبل NULL للجلسات الجديدة
    // التي تستخدم scheduled_at وduration_minutes.
    await client.query(`
      ALTER TABLE sessions
      ALTER COLUMN starts_at DROP NOT NULL
    `);

    await client.query(`
      ALTER TABLE sessions
      ALTER COLUMN ends_at DROP NOT NULL
    `);

    await client.query(`
      ALTER TABLE sessions
      ALTER COLUMN program_id DROP NOT NULL
    `);

    // توحيد الحالات التي تستخدمها المسارات الحالية.
    await client.query(`
      ALTER TABLE sessions
      DROP CONSTRAINT IF EXISTS sessions_status_check
    `);

    await client.query(`
      ALTER TABLE sessions
      ADD CONSTRAINT sessions_status_check
      CHECK (
        status IN (
          'REQUESTED',
          'CONFIRMED',
          'SCHEDULED',
          'ATTENDED',
          'ABSENT',
          'CANCELLED',
          'COMPLETED',
          'REVIEW_REQUIRED'
        )
      )
    `);

    // ==================================================
    // EXAMS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        program_id BIGINT NOT NULL
          REFERENCES programs(id) ON DELETE RESTRICT,
        examiner_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        exam_type VARCHAR(40) NOT NULL,
        scheduled_at TIMESTAMPTZ,
        status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED'
          CHECK (
            status IN (
              'REQUESTED',
              'SCHEDULED',
              'COMPLETED',
              'PASSED',
              'FAILED',
              'RESIT_REQUIRED',
              'CANCELLED'
            )
          ),
        portion TEXT,
        result TEXT,
        feedback TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ==================================================
    // AUDIT LOGS
    // ==================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        actor_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        entity_id VARCHAR(100),
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ==================================================
    // INDEXES
    // ==================================================
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollments_student
      ON enrollments(student_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_orders_status
      ON payment_orders(status, submitted_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_student_start
      ON sessions(student_id, starts_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_student_scheduled
      ON sessions(student_id, scheduled_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_exams_student
      ON exams(student_id, scheduled_at DESC)
    `);

    // ==================================================
    // INITIAL PROGRAMS
    // لا تُستبدل البرامج الموجودة.
    // ==================================================
    await client.query(`
      INSERT INTO programs (
        code,
        name_ar,
        name_en,
        description_ar
      )
      VALUES
        (
          'TALQEEN_CORRECTION',
          'برنامج التلقين وتصحيح الأداء',
          'Talqeen and Recitation Correction',
          'تعليم القراءة وتصحيح التلاوة والأداء.'
        ),
        (
          'QURAN_HIFZ',
          'برنامج حفظ القرآن الكريم',
          'Quran Memorization',
          'الحفظ الجديد والربط والمراجعة والاختبارات.'
        ),
        (
          'HAFS_IJAZAH',
          'برنامج الإعداد لإجازة حفص عن عاصم',
          'Hafs an Asim Ijazah Preparation',
          'الإعداد العلمي والعملي للإجازة برواية حفص عن عاصم.'
        ),
        (
          'SEVEN_QIRAAT',
          'برنامج القراءات السبع',
          'Seven Qiraat',
          'دراسة القراءات السبع وأصولها وفرشها ومسارات الإفراد والجمع.'
        )
      ON CONFLICT (code) DO NOTHING
    `);

    // ==================================================
    // INITIAL PACKAGES
    // ==================================================
    await client.query(`
      INSERT INTO packages (minutes, price_etb)
      VALUES
        (100, 500),
        (200, 1000),
        (300, 1470),
        (400, 1920),
        (500, 2350),
        (600, 2760),
        (1000, 4500)
      ON CONFLICT (minutes) DO NOTHING
    `);

    // ==================================================
    // BALANCE COMPATIBILITY
    // لا نغيّر الأرصدة الموجودة في minute_accounts.
    // تُنقل الأرصدة إلى student_profiles فقط عندما يكون
    // رصيد الملف صفرًا ورصيد الحساب موجبًا.
    // ==================================================
    await client.query(`
      UPDATE student_profiles AS sp
      SET balance_minutes = ma.balance_minutes
      FROM minute_accounts AS ma
      WHERE ma.student_id = sp.id
        AND sp.balance_minutes = 0
        AND ma.balance_minutes > 0
    `);

    // تهيئة حساب دقائق مفقود فقط للطلاب الذين لا يملكونه.
    await client.query(`
      INSERT INTO minute_accounts (student_id, balance_minutes)
      SELECT sp.id, sp.balance_minutes
      FROM student_profiles AS sp
      WHERE NOT EXISTS (
        SELECT 1
        FROM minute_accounts AS ma
        WHERE ma.student_id = sp.id
      )
      ON CONFLICT (student_id) DO NOTHING
    `);

    // ==================================================
    // MIGRATION HISTORY
    // ==================================================
    await client.query(`
      INSERT INTO schema_migrations (version)
      VALUES
        ('001_initial_schema'),
        ('002_previous_city'),
        ('003_api_schema_compatibility')
      ON CONFLICT (version) DO NOTHING
    `);

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("Database migration completed successfully.");
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Database migration failed:", error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => {
  process.exitCode = 1;
});
