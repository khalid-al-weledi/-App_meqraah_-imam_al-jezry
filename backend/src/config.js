
require("dotenv").config();

const { z } = require("zod");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(4000),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required"),

  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must contain at least 32 characters"),

  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000"),

  APP_NAME: z
    .string()
    .default("مقرأة الإمام الجزري للإقراء والإجازة بالسند"),

  APP_TIMEZONE: z
    .string()
    .default("Africa/Addis_Ababa"),

  PRICE_PER_MINUTE_ETB: z.coerce
    .number()
    .positive()
    .default(5),

  WELCOME_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .default(30),

  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false"),

  BOT_TOKEN: z
    .string()
    .optional(),

  ADMIN_GROUP_ID: z
    .string()
    .optional()
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Environment configuration is invalid:\n${problems}`
    );
  }

  return Object.freeze(result.data);
}

module.exports = { loadConfig };
