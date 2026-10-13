
require("dotenv").config();

const { pool, checkDatabase } = require("./db");

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const database = await checkDatabase();

    console.log(
      "Connected database:",
      database.database_name
    );

    // لا تحذف جداول موجودة ولا تعدّل بيانات قديمة.
    // تُنشأ الجداول فقط إذا لم تكن موجودة.

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS packages (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        minutes INTEGER NOT NULL UNIQUE CHECK (minutes > 0),
        price_etb NUMERIC(12,2) NOT NULL CHECK (price_etb >= 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

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
          CHECK (
            status IN (
              'PENDING',
              'APPROVED',
              'REJECTED'
            )
          ),
        idempotency_key UUID NOT NULL UNIQUE,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        rejection_reason TEXT,
        credited_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS minute_accounts (
        student_id BIGINT PRIMARY KEY
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        balance_minutes INTEGER NOT NULL DEFAULT 0
          CHECK (balance_minutes >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS minute_ledger (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        amount_minutes INTEGER NOT NULL CHECK (amount_minutes <> 0),
        entry_type VARCHAR(40) NOT NULL
          CHECK (
            entry_type IN (
              'PACKAGE_PURCHASE',
              'SESSION_DEDUCTION',
              'WELCOME_CREDIT',
              'ADVANCE_CREDIT',
              'ADVANCE_REPAYMENT',
              'ADMIN_ADJUSTMENT',
              'REFERRAL_REWARD',
              'REFUND'
            )
          ),
        reference_type VARCHAR(40),
        reference_id BIGINT,
        idempotency_key UUID NOT NULL UNIQUE,
        note TEXT,
        created_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        student_id BIGINT NOT NULL
          REFERENCES student_profiles(id) ON DELETE RESTRICT,
        teacher_id BIGINT NOT NULL
          REFERENCES users(id) ON DELETE RESTRICT,
        program_id BIGINT NOT NULL
          REFERENCES programs(id) ON DELETE RESTRICT,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        actual_minutes INTEGER
          CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
        status VARCHAR(30) NOT NULL DEFAULT 'REQUESTED'
          CHECK (
            status IN (
              'REQUESTED',
              'CONFIRMED',
              'ATTENDED',
              'ABSENT',
              'CANCELLED',
              'COMPLETED',
              'REVIEW_REQUIRED'
            )
          ),
        portion_read TEXT,
        portion_memorized TEXT,
        portion_reviewed TEXT,
        teacher_notes TEXT,
        approved_at TIMESTAMPTZ,
        approved_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (ends_at > starts_at)
      )
    `);

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
      CREATE INDEX IF NOT EXISTS idx_exams_student
      ON exams(student_id, scheduled_at DESC)
    `);

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

    await client.query(`
      INSERT INTO schema_migrations (version)
      VALUES ('001_initial_schema')
      ON CONFLICT (version) DO NOTHING
    `);

    await client.query("COMMIT");

    console.log("Database migration completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
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
