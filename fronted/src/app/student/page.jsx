"use client";

import { useEffect, useState } from "react";
import {
  apiRequest,
  clearAccessToken,
} from "../../services/api";

export default function StudentPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("جارٍ تحميل بيانات الحساب...");
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    apiRequest("/minutes/my-balance")
      .then((result) => {
        if (!active) return;
        setData(result);
        setMessage("");
      })
      .catch((err) => {
        if (!active) return;
        setError(true);
        setMessage(err.message || "تعذر تحميل الرصيد.");
      });

    return () => {
      active = false;
    };
  }, []);

  const balance = Number(
    data?.balanceMinutes ??
    data?.balance_minutes ??
    data?.balance ??
    0
  );

  const history = Array.isArray(data?.history)
    ? data.history
    : Array.isArray(data?.transactions)
      ? data.transactions
      : [];

  function logout() {
    clearAccessToken();
    window.location.href = "/login";
  }

  return (
    <main className="form-wrap">
      <section className="form-card">
        <a href="/" className="muted">← الرئيسية</a>

        <h1>حساب الطالب</h1>
        <p>تابع رصيدك وحركات الدقائق في مقرأة الإمام الجزري.</p>

        {message && (
          <p
            role="status"
            className={`form-message ${error ? "error" : ""}`}
          >
            {message}
          </p>
        )}

        {data && (
          <>
            <article className="card">
              <span className="muted">رصيد الدقائق الحالي</span>
              <div
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  color: "var(--navy)",
                }}
              >
                {balance}
                <span style={{ fontSize: 16, marginRight: 8 }}>
                  دقيقة
                </span>
              </div>
              <p>يُحدّث الرصيد بحسب الحركات المعتمدة في النظام.</p>
            </article>

            <h2>سجل الحركات</h2>

            {history.length === 0 ? (
              <p className="muted">لا توجد حركات مسجلة في الاستجابة.</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>نوع الحركة</th>
                      <th>التغيير</th>
                      <th>الرصيد بعدها</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.map((item, index) => (
                      <tr key={item.id ?? `${item.created_at}-${index}`}>
                        <td>
                          {item.transaction_type ??
                            item.type ??
                            "حركة رصيد"}
                        </td>
                        <td>
                          {item.minutes_delta ??
                            item.delta_minutes ??
                            item.amount_minutes ??
                            "—"}
                        </td>
                        <td>
                          {item.balance_after ?? "—"}
                        </td>
                        <td>
                          {item.created_at
                            ? new Date(item.created_at).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 24 }}>
          <button className="btn btn-outline" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      </section>
    </main>
  );
}