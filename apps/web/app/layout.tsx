import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dukaspot Kenya",
  description:
    "Dukaspot turns social-commerce orders and M-PESA payments into reconciled merchant records.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
