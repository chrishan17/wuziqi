import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LangProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Gomoku vs Jev · 五子棋",
  description: "Play five-in-a-row against Jev, a judgment model that picks from every empty point and shows its probabilities in ink.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#e9dfca",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-lang="en" suppressHydrationWarning>
      <head>
        {/* Set the font set before first paint for someone who chose 中文. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var l=localStorage.getItem('wuziqi-lang');if(l==='zh'){document.documentElement.dataset.lang='zh';document.documentElement.lang='zh-Hans'}}catch(e){}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@300;400;600;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
