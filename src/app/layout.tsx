import type { Metadata } from "next";
import { JetBrains_Mono, Manrope, Sora } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "L Gestão",
  description: "Sistema multi-empresa de estoque, vendas e financeiro",
};

// Identidade visual (mockup docs/mockup-l-gestao.html): Sora nos títulos e
// números, Manrope no texto corrido, JetBrains Mono em códigos/valores.
const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["300", "400", "500", "600", "700", "800"],
});
const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600", "700", "800"],
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600", "700"],
});

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
      <body
        className={`${display.variable} ${body.variable} ${mono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
