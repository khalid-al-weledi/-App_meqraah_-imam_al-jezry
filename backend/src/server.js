
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { checkDatabase } = require("./db");
const authRoutes = require("./auth-routes");
const programRoutes = require("./program-routes");

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.disable("x-powered-by");

// الحماية الأساسية
app.use(helmet());

// إعداد الاتصال بالواجهات
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN
          .split(",")
          .map((item) => item.trim())
      : false
  })
);

// قراءة بيانات JSON
app.use(express.json({ limit: "1mb" }));

// الحد من الطلبات المتكررة
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      success: false,
      message: "طلبات كثيرة. يرجى المحاولة لاحقًا."
    }
  })
);

// واجهات التسجيل وتسجيل الدخول والحساب
app.use("/api/auth", authRoutes);

// واجهات البرامج التعليمية
app.use("/api/programs", programRoutes);

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.json({
    success: true,
    name:
      process.env.APP_NAME ||
      "مقرأة الإمام الجزري للإقراء والإجازة بالسند",
    message: "خادم المقرأة يعمل.",
    version: "1.0.0"
  });
});

// فحص حالة الخادم
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok"
  });
});

// فحص اتصال قاعدة البيانات
app.get("/health/database", async (req, res) => {
  try {
    const database = await checkDatabase();

    res.json({
      success: true,
      status: "connected",
      database: database.database_name
    });
  } catch (error) {
    console.error(
      "Database health check failed:",
      error.message
    );

    res.status(503).json({
      success: false,
      status: "unavailable",
      message: "تعذر الاتصال بقاعدة البيانات."
    });
  }
});

// المسارات غير الموجودة
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "المسار المطلوب غير موجود."
  });
});

// معالجة الأخطاء
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    message: "حدث خطأ داخلي في الخادم."
  });
});

// تشغيل الخادم
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Maqraah backend listening on port ${PORT}`
    );
  });
}

module.exports = app;
