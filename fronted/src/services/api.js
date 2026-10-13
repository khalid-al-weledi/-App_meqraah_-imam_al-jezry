const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000/api"
).replace(/\/$/, "");

export async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (typeof window !== "undefined") {
    const token = localStorage.getItem("meqraa_access_token");

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });

  const raw = await response.text();

  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      message: raw || "استجابة غير مفهومة من الخادم."
    };
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `فشل الطلب (${response.status})`
    );
  }

  return data;
}

export function saveAccessToken(token) {
  if (typeof window !== "undefined") {
    localStorage.setItem("meqraa_access_token", token);
  }
}

export function clearAccessToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("meqraa_access_token");
  }
}