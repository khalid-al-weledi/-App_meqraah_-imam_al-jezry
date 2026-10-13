
require("dotenv").config();

const { pool, checkDatabase } = require("./db");

async function main() {
  try {
    const result = await checkDatabase();

    console.log("Database connection successful.");
    console.log("Connected database:", result.database_name);

    if (
      result.database_name === "postgres" ||
      result.database_name === "template0" ||
      result.database_name === "template1"
    ) {
      console.error(
        "Warning: this appears to be a default PostgreSQL database."
      );

      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Database check failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
