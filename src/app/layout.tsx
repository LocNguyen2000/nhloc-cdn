import type { Metadata } from "next";
import { Roboto_Mono } from "next/font/google";
import "./globals.css";

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tai gau CDN",
  description: "Quản lý tệp CDN.",
  icons: {
    icon: "/avatar.jpg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={robotoMono.variable}>
      <body>{children}</body>
    </html>
  );
}
