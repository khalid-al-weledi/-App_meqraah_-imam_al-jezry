import "./globals.css";

export const metadata = {
  title: "مقرأة الإمام الجزري للإقراء والإجازة بالسند",
  description:
    "منصة تعليم القرآن الكريم والقراءات والإجازة بالسند"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}