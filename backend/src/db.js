
const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Configure Supabase PostgreSQL in environment variables."
  );
}

// Prevent accidental use of an explicitly forbidden old database.
if (process.env.ALLOW_OLD_DATABASE === "true") {
  throw new Error(
    "Refusing to connect: old database access is not allowed."
  );
}

const isProduction = process.env.NODE_ENV === "production";
const databaseSsl = process.env.DATABASE_SSL;

const pool = new Pool({
  connectionString: databaseUrl,

  // Configure SSL explicitly for hosted PostgreSQL when enabled.
  ssl:
    databaseSsl === "true"
      ? { rejectUnauthorized: true }
      : databaseSsl === "false"
        ? false
        : isProduction
          ? { rejectUnauthorized: true }
          : undefined,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {
  console.error(
    "Unexpected database pool error:",
    error.message
  );
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function checkDatabase() {
  const result = await query(
    "SELECT current_database() AS database_name"
  );

  return result.rows[0];
}

module.exports = {
  pool,
  query,
  checkDatabase
};
