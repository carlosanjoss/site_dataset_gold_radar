import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar Ódio — Revisão Humana",
  description:
    "Sistema de validação especializada das classificações de discurso de ódio.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
