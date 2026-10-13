
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

app.use(helmet());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((item) => item.trim())
  : [];

app.use(
  cors({
    origin(origin, callback) {
      // السماح بالطلبات التي لا تحمل Origin، مثل أدوات فحص API.
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

app.use(express.json({ limit: "1mb" }));

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

app.use("/api/auth", authRoutes);
app.use("/api/programs", programRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/minutes", minuteRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "Imam Al-Jazari Maqraah API",
    message: "خادم مقرأة الإمام الجزري يعمل.",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "ok"
  });
});

app.get("/health/database", async (req, res) => {
  try {
    await checkDatabase();

    return res.json({
      success: true,
      status: "ok",
      database: "connected"
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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "المسار المطلوب غير موجود."
  });
});

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

if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`Maqraah API listening on port ${PORT}`);

    try {
      await checkDatabase();
      console.log("Database connection verified.");
    } catch (error) {
      console.error("Database connection failed:", error.message);
      console.error("The API is running, but database operations may fail.");
    }
  });
}

module.exports = app;
