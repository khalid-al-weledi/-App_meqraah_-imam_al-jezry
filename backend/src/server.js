
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { checkDatabase } = require("./db");

// API route modules
const authRoutes = require("./auth-routes");
const attendanceRoutes = require("./attendance-routes");
const enrollmentRoutes = require("./enrollment-routes");
const examRoutes = require("./exam-routes");
const financeRoutes = require("./finance-routes");
const minuteRoutes = require("./minute-routes");
const notificationRoutes = require("./notification-routes");
const paymentRoutes = require("./payment-routes");
const programRoutes = require("./program-routes");
const reportRoutes = require("./report-routes");
const sessionRoutes = require("./session-routes");
const teacherRoutes = require("./teacher-routes");

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.disable("x-powered-by");

// Security headers
app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  : [];

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without an Origin header, such as server-to-server calls.
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    }
  })
);

// Request body
app.use(express.json({ limit: "1mb" }));

// Rate limiting
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

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/minutes", minuteRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/programs", programRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/teachers", teacherRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "Imam Al-Jazari Maqraah API",
    message: "خادم مقرأة الإمام الجزري يعمل.",
    version: "1.0.0"
  });
});

// Basic health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok"
  });
});

// Database health check
app.get("/health/database", async (req, res) => {
  try {
    const database = await checkDatabase();

    return res.json({
      success: true,
      status: "ok",
      database: "connected",
      databaseName: database.database_name
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    return res.status(503).json({
      success: false,
      status: "error",
      database: "unavailable",
      message: "تعذر الاتصال بقاعدة البيانات."
    });
  }
});

// Not found
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "المسار المطلوب غير موجود."
  });
});

// Global error handler
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "مصدر الطلب غير مسموح."
    });
  }

  console.error("Unhandled server error:", error.message);

  return res.status(500).json({
    success: false,
    message: "حدث خطأ داخلي في الخادم."
  });
});

// Start server only when executed directly
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Maqraah API listening on port ${PORT}`);

    try {
      await checkDatabase();
      console.log("Database connection verified.");
    } catch (error) {
      console.error("Database connection failed:", error.message);
      console.error(
        "The API is running, but database operations may fail."
      );
    }
  });
}

module.exports = app;
