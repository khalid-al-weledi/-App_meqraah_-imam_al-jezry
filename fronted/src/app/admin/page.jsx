"use client";

import { useState } from "react";
import { clearAccessToken } from "../../services/api";

const sections = [
  {
    title: "إدارة الطلاب",
    description: "مراجعة طلبات التسجيل وبيانات الطلاب وحالاتهم.",
    icon: "👥",
  },
  {
    title: "المدفوعات",
    description: "مراجعة إيصالات الدفع وقبول الطلبات أو رفضها.",
    icon: "💳",
  },
  {
    title: "الباقات والأرصدة",
    description: "متابعة الباقات وسجل حركات الدقائق المعتمدة.",
    icon: "◈",
  },
  {
    title: "المعلمون",
    description: "إدارة حسابات المعلمين والطلاب المسندين إليهم.",
    icon: "📚",
  },
  {
    title: "البرامج والجداول",
    description: "إدارة برامج المقرأة ومواعيد الدراسة.",
    icon: "🗓️",
  },
  {
    title: "التقارير",
    description: "متابعة التقارير المالية والأكاديمية.",
    icon: "📊",
  },
];

export default function AdminPage() {
  const [notice, setNotice] = useState("");

  function logout() {
    clearAccessToken();
    window.location.href = "/login";
  }

  return (
    <main className="form-wrap">
      <section className="form-card">
        <a href="/" className="muted">← الرئيسية</a>

        <h1>لوحة إدارة مقرأة الإمام الجزري</h1>
        <p>
          نقطة البداية لإدارة التسجيل والدراسة والمدفوعات والبرامج.
        </p>

        <div className="callout">
          <div>
            <h3>تنبيه أمني</h3>
            <p>
              يجب التحقق من دور ADMIN أو SUPER_ADMIN على الخادم
              قبل السماح بفتح أي بيانات أو تنفيذ أي عملية إدارية.
            </p>
          </div>
        </div>

        {notice && (
          <p role="status" className="form-message">
            {notice}
          </p>
        )}

        <div
          className="grid"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(190px, 1fr))",
            marginTop: 24,
          }}
        >
          {sections.map((section) => (
            <article className="card" key={section.title}>
              <div className="card-icon">{section.icon}</div>
              <h3>{section.title}</h3>
              <p>{section.description}</p>

              <button
                type="button"
                className="btn btn-outline"
                onClick={() =>
                  setNotice(
                    `قسم «${section.title}» لم يُربط بعد بخدمات الإدارة في الخادم.`
                  )
                }
              >
                فتح القسم
              </button>
            </article>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-outline"
          style={{ marginTop: 24 }}
          onClick={logout}
        >
          تسجيل الخروج
        </button>
      </section>
    </main>
  );
}