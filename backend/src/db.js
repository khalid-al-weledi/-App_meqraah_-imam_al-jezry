
const { Pool } = require("pg");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Configure the NEW database in environment variables."
  );
}

if (
  process.env.ALLOW_OLD_DATABASE === "true"
) {
  throw new Error(
    "Refusing to connect: old database access is not allowed."
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {
  console.error("Unexpected database pool error:", error.message);
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
