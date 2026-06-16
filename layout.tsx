import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Распознавание мусора v2.9",
  description: "AI-распознавание товаров и этикеток с камерой",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
