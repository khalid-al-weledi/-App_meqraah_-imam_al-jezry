"use client";

import { useState } from "react";
import { clearAccessToken } from "../../services/api";

const sections = [
  {
    title: "طلابي",
    description: "متابعة الطلاب المسندين إليك ومستوياتهم.",
    icon: "👥",
  },
  {
    title: "الجلسات",
    description: "مراجعة المواعيد والجلسات المسجلة.",
    icon: "🗓️",
  },
  {
    title: "الحضور والغياب",
    description: "تسجيل الحضور وفق الجلسات الفعلية.",
    icon: "✓",
  },
  {
    title: "التقدم العلمي",
    description: "متابعة الحفظ والمراجعة وملاحظات الأداء.",
    icon: "📖",
  },
];

export default function TeacherPage() {
  const [notice, setNotice] = useState("");

  function logout() {
    clearAccessToken();
    window.location.href = "/login";
  }

  return (
    <main className="form-wrap">
      <section className="form-card">
        <a href="/" className="muted">← الرئيسية</a>

        <h1>لوحة المعلم</h1>
        <p>
          إدارة العمل التعليمي ومتابعة الطلاب والجلسات من مكان واحد.
        </p>

        {notice && (
          <p role="status" className="form-message">
            {notice}
          </p>
        )}

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          {sections.map((section) => (
            <article className="card" key={section.title}>
              <div className="card-icon">{section.icon}</div>
              <h3>{section.title}</h3>
              <p>{section.description}</p>
              <button
                className="btn btn-outline"
                onClick={() =>
                  setNotice(
                    `قسم «${section.title}» يحتاج إلى ربطه بمسارات API الخاصة بالمعلم.`
                  )
                }
              >
                فتح القسم
              </button>
            </article>
          ))}
        </div>

        <div className="callout" style={{ marginTop: 24 }}>
          <div>
            <h3>صلاحيات المعلم</h3>
            <p>
              يجب أن تقتصر على الطلاب والجلسات المسندة إليه، دون تعديل
              أرصدة الدقائق أو اعتماد المدفوعات.
            </p>
          </div>
        </div>

        <button
          className="btn btn-outline"
          style={{ marginTop: 20 }}
          onClick={logout}
        >
          تسجيل الخروج
        </button>
      </section>
    </main>
  );
}