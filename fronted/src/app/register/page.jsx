
"use client";

import { useState } from "react";
import { apiRequest } from "../../services/api";

export default function RegisterPage() {
  const [language, setLanguage] = useState("ar");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const isArabic = language === "ar";

  async function submit(event) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());

    // Convert numeric fields
    payload.age = payload.age
      ? Number(payload.age)
      : undefined;

    payload.memorizedJuz = payload.memorizedJuz
      ? Number(payload.memorizedJuz)
      : 0;

    // Convert the form's string value to a boolean
    payload.hasReadQuranLooking =
      payload.hasReadQuranLooking === "true";

    // Match the backend registration schema
    payload.language = language;

    // The form uses one programCode, while the API expects an array
    payload.programCodes = payload.programCode
      ? [payload.programCode]
      : [];

    delete payload.programCode;
    delete payload.preferredLanguage;

    setMessage("");
    setError(false);
    setBusy(true);

    try {
      const result = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setMessage(
        result.message ||
          (isArabic
            ? "تم إرسال طلب التسجيل. انتظر مراجعة الإدارة."
            : "የምዝገባ ጥያቄዎ ተልኳል። የአስተዳደሩን ምላሽ ይጠብቁ።")
      );

      formElement.reset();
    } catch (err) {
      setError(true);
      setMessage(
        err.message ||
          (isArabic
            ? "تعذر إرسال الطلب. تحقق من اتصال الخادم."
            : "ጥያቄውን መላክ አልተቻለም። የአገልጋዩን ግንኙነት ያረጋግጡ።")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="form-wrap">
      <section className="form-card">
        <a href="/" className="muted">
          ← {isArabic ? "العودة إلى الرئيسية" : "ወደ ዋናው ገጽ"}
        </a>

        <h1>
          {isArabic
            ? "طلب الالتحاق بالمقرأة"
            : "የመቅራው ምዝገባ"}
        </h1>

        <p>
          {isArabic
            ? "أدخل بياناتك بدقة. إرسال الطلب لا يعني القبول النهائي."
            : "መረጃዎን በትክክል ያስገቡ። ማመልከቻ ማስገባት መቀበልን አያረጋግጥም።"}
        </p>

        <div className="field">
          <label htmlFor="language">
            لغة الواجهة / የቋንቋ ምርጫ
          </label>
          <select
            id="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="ar">العربية</option>
            <option value="am">አማርኛ — الأمهرية</option>
          </select>
        </div>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="fullName">الاسم الكامل *</label>
            <input
              id="fullName"
              name="fullName"
              required
              minLength={3}
              autoComplete="name"
            />
          </div>

          <div className="field">
            <label htmlFor="phone">رقم الهاتف *</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              inputMode="tel"
            />
          </div>

          <div className="field">
            <label htmlFor="password">
              كلمة المرور — 10 أحرف على الأقل *
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
            />
          </div>

          <div className="field">
            <label htmlFor="gender">الجنس *</label>
            <select
              id="gender"
              name="gender"
              required
              defaultValue=""
            >
              <option value="" disabled>اختر</option>
              <option value="MALE">ذكر</option>
              <option value="FEMALE">أنثى</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="age">العمر</label>
            <input
              id="age"
              name="age"
              type="number"
              min="3"
              max="120"
            />
          </div>

          <div className="field">
            <label htmlFor="country">الدولة</label>
            <input
              id="country"
              name="country"
              defaultValue="إثيوبيا"
            />
          </div>

          <div className="field">
            <label htmlFor="city">المدينة</label>
            <input id="city" name="city" />
          </div>

          <div className="field">
            <label htmlFor="previousSchool">
              المدرسة أو المركز السابق
            </label>
            <input id="previousSchool" name="previousSchool" />
          </div>

          <div className="field">
            <label htmlFor="previousCity">مدينة الدراسة السابقة</label>
            <input id="previousCity" name="previousCity" />
          </div>

          <div className="field">
            <label htmlFor="previousTeacher">اسم المعلم السابق</label>
            <input id="previousTeacher" name="previousTeacher" />
          </div>

          <div className="field">
            <label htmlFor="readingLevel">مستوى القراءة</label>
            <select
              id="readingLevel"
              name="readingLevel"
              defaultValue="BEGINNER"
            >
              <option value="BEGINNER">مبتدئ</option>
              <option value="INTERMEDIATE">متوسط</option>
              <option value="VERY_GOOD">جيد جدًا</option>
              <option value="ADVANCED">متقدم</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="hasReadQuranLooking">
              هل قرأت القرآن كاملًا نظرًا من المصحف؟
            </label>
            <select
              id="hasReadQuranLooking"
              name="hasReadQuranLooking"
              defaultValue="false"
            >
              <option value="false">لا</option>
              <option value="true">نعم</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="memorizedJuz">
              عدد الأجزاء المحفوظة (0–30)
            </label>
            <input
              id="memorizedJuz"
              name="memorizedJuz"
              type="number"
              min="0"
              max="30"
              defaultValue="0"
            />
          </div>

          <div className="field">
            <label htmlFor="programCode">البرنامج المطلوب *</label>
            <select
              id="programCode"
              name="programCode"
              required
              defaultValue=""
            >
              <option value="" disabled>اختر البرنامج</option>
              <option value="TALQEEN_CORRECTION">
                التلقين وتصحيح الأداء
              </option>
              <option value="QURAN_HIFZ">
                حفظ القرآن الكريم
              </option>
              <option value="HAFS_IJAZAH">
                الإعداد لإجازة حفص عن عاصم
              </option>
              <option value="SEVEN_QIRAAT">
                القراءات السبع
              </option>
            </select>
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy}
            style={{ width: "100%", marginTop: 8 }}
          >
            {busy
              ? "جارٍ الإرسال..."
              : "إرسال طلب التسجيل"}
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
          تنبيه: نجاح إرسال الطلب يعتمد أيضًا على إعدادات
          الخادم وقاعدة البيانات.
        </p>
      </section>
    </main>
  );
}
