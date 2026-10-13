
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters."
    );
  }

  return secret;
}

function createToken(user) {
  if (!user || !user.id || !user.role) {
    throw new Error("A valid user ID and role are required.");
  }

  const allowedRoles = [
    "SUPER_ADMIN",
    "ACADEMIC_SUPERVISOR",
    "ACCOUNTANT",
    "TEACHER",
    "STUDENT"
  ];

  if (!allowedRoles.includes(user.role)) {
    throw new Error("Invalid user role.");
  }

  return jwt.sign(
    {
      sub: String(user.id),
      role: user.role
    },
    getJwtSecret(),
    {
      expiresIn: "8h",
      issuer: "imam-al-jazari-platform",
      audience: "imam-al-jazari-users"
    }
  );
}

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization || "";
  const parts = authorization.split(" ");

  if (
    parts.length !== 2 ||
    parts[0] !== "Bearer" ||
    !parts[1]
  ) {
    return res.status(401).json({
      success: false,
      message: "يجب تسجيل الدخول أولًا."
    });
  }

  try {
    const payload = jwt.verify(
      parts[1],
      getJwtSecret(),
      {
        issuer: "imam-al-jazari-platform",
        audience: "imam-al-jazari-users"
      }
    );

    if (!payload.sub || !payload.role) {
      return res.status(401).json({
        success: false,
        message: "رمز الدخول غير صالح."
      });
    }

    req.user = {
      id: payload.sub,
      role: payload.role
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "انتهت صلاحية الدخول أو أن الرمز غير صالح."
    });
  }
}

function requireRoles(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "يجب تسجيل الدخول أولًا."
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك إذن لتنفيذ هذه العملية."
      });
    }

    return next();
  };
}

async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 128
  ) {
    throw new Error(
      "Password must contain between 10 and 128 characters."
    );
  }

  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, passwordHash) {
  if (
    typeof password !== "string" ||
    typeof passwordHash !== "string"
  ) {
    return false;
  }

  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  createToken,
  authenticateToken,
  requireRoles,
  hashPassword,
  verifyPassword
};
