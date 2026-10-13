
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { checkDatabase } = require("./db");

const authRoutes = require("./auth-routes");
const programRoutes = require("./program-routes");
const paymentRoutes = require("./payment-routes");
const financeRoutes = require("./finance-routes");
const minuteRoutes = require("./minute-routes");

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.disable("x-powered-by");

// Security headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN
          .split(",")
          .map((item) => item.trim())
      : false
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
app.use("/api/programs", programRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/minutes", minuteRoutes);

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
    await checkDatabase();

    return res.json({
      success: true,
      database: "connected"
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    return res.status(503).json({
      success: false,
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
  console.error("Unhandled server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "حدث خطأ داخلي في الخادم."
  });
});

// Start server only when executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Maqraah API listening on port ${PORT}`);
  });
}

module.exports = app;
