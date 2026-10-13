
const { z } = require("zod");

const phoneSchema = z
  .string()
  .trim()
  .min(7, "رقم الهاتف قصير جدًا.")
  .max(40, "رقم الهاتف طويل جدًا.")
  .regex(/^[+\d\s()-]+$/, "صيغة رقم الهاتف غير صحيحة.");

const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(3, "يرجى إدخال الاسم الكامل.")
    .max(200),

  phone: phoneSchema,

  password: z
    .string()
    .min(10, "كلمة المرور يجب ألا تقل عن 10 أحرف.")
    .max(128),

  language: z
    .enum(["ar", "am", "en", "om"])
    .default("ar"),

  gender: z.enum(["MALE", "FEMALE"]),

  age: z.coerce
    .number()
    .int()
    .min(3)
    .max(120)
    .optional(),

  country: z.string().trim().max(100).optional(),

  city: z.string().trim().max(100).optional(),

  previousSchool: z.string().trim().max(200).optional(),

  previousTeacher: z.string().trim().max(200).optional(),

  readingLevel: z
    .enum(["BEGINNER", "INTERMEDIATE", "VERY_GOOD", "ADVANCED"])
    .optional(),

  hasReadQuranLooking: z.boolean().default(false),

  memorizedJuz: z.coerce
    .number()
    .min(0)
    .max(30)
    .default(0),

  programCodes: z
    .array(
      z.enum([
        "TALQEEN_CORRECTION",
        "QURAN_HIFZ",
        "HAFS_IJAZAH",
        "SEVEN_QIRAAT"
      ])
    )
    .min(1, "يرجى اختيار برنامج واحد على الأقل.")
    .max(4)
}).strict();

const loginSchema = z.object({
  phone: phoneSchema,

  password: z
    .string()
    .min(1, "يرجى إدخال كلمة المرور.")
    .max(128)
}).strict();

const enrollmentSchema = z.object({
  programCode: z.enum([
    "TALQEEN_CORRECTION",
    "QURAN_HIFZ",
    "HAFS_IJAZAH",
    "SEVEN_QIRAAT"
  ])
}).strict();

function validate(schema, data) {
  const result = schema.safeParse(data);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  return {
    success: true,
    data: result.data
  };
}

module.exports = {
  registerSchema,
  loginSchema,
  enrollmentSchema,
  validate
};
