import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Белкур — интерактивный концепт номера",
  description:
    "Демонстрационный 3D-концепт для Белкур: откройте шторы и выберите атмосферу номера.",
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
