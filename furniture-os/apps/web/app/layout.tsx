import type { Metadata } from "next";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Calyptus — مساحة العمل",
  description: "واتساب الإنتاج وسوق التصاميم",
  manifest: "/manifest.webmanifest",
  themeColor: "#0f1419",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Calyptus",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0f1419" />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}`,
          }}
        />
      </head>
      <body>
        <div className="app">
          <header className="topbar">
            <div className="topbar-brand">Calyptus</div>
            <WorkspaceTabs />
            <div style={{ width: 72 }} />
          </header>
          <div className="workspace">{children}</div>
        </div>
      </body>
    </html>
  );
}
