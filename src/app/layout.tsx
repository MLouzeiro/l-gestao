import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "L Gestão",
  description: "Sistema multi-empresa de estoque, vendas e financeiro",
};

// Dark é o padrão; "lg-theme" (localStorage) permite alternar sem flash ao carregar.
const themeScript = `(function(){try{var t=localStorage.getItem("lg-theme");document.documentElement.classList.toggle("dark",t!=="light")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
