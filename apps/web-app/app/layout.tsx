import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concordia",
  description: "Chat app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased font-sans"
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
