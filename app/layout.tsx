import type { Metadata } from "next";
import "./globals.css";
import "./generation.css";

export const metadata: Metadata = {
  title: { default: "Creative Director AI", template: "%s · Creative Director AI" },
  description: "Turn a product brief into a considered, reviewed short-form video advertisement.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
