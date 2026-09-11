import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AAELS — свет, который чувствует гостя",
  description:
    "Интерактивная 3D-демонстрация адаптивного освещения премиального гостиничного номера.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
