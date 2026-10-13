"use client";

import { useState } from "react";
import {
  apiRequest,
  saveAccessToken,
} from "../../services/api";

export default function LoginPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    setBusy(true);
    setMessage("");
    setError(false);

    try {
      const result = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const token =
        result.token ||
        result.accessToken ||
        result.data?.token;

      if (token) {
        saveAccessToken(token);
      }

      if (!token) {
        setMessage(
          "استجاب الخادم، لكن رمز الدخول غير موجود في الاستجابة. راجع عقد API."
        );
        setError(true);
        return;
      }

      const role = result.user?.role;

      if (role === "STUDENT") {
        window.location.href = "/student";
      } else if (role === "TEACHER") {
        window.location.href = "/teacher";
      } else if (
        role === "ADMIN" ||
        role === "SUPER_ADMIN"
      ) {
        window.location.href = "/admin";
      } else {
        setMessage(
          "تم تسجيل الدخول، لكن دور الحساب غير معروف في استجابة الخادم."
        );
      }
    } catch (err) {
      setError(true);
      setMessage(
        err.message ||
          "تعذر تسجيل الدخول. تحقق من بياناتك واتصال الخادم."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="form-wrap">
      <section className="form-card">
        <a href="/" className="muted">
          ← العودة إلى الرئيسية
        </a>

        <h1>تسجيل الدخول</h1>

        <p>
          أدخل بيانات حسابك لمتابعة دراستك في مقرأة الإمام الجزري.
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="phone">رقم الهاتف</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              autoComplete="username"
              inputMode="tel"
            />
          </div>

          <div className="field">
            <label htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy}
            style={{ width: "100%" }}
          >
            {busy ? "جارٍ الدخول..." : "دخول"}
          </button>
        </form>

        {message && (
          <p
            role="status"
            className={`form-message ${error ? "error" : "success"}`}
          >
            {message}
          </p>
        )}

        <p className="muted">
          لا تضع أسرار قاعدة البيانات في ملفات الواجهة أو في GitHub.
        </p>
      </section>
    </main>
  );
}