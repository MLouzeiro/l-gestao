import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "L Gestão",
  description: "Sistema multi-empresa de estoque, vendas e financeiro",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
