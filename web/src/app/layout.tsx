import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "스톤게이트CC 대시보드",
  description: "스톤게이트CC 대표 현황 대시보드",
};

// viewport-fit: "cover" is required for env(safe-area-inset-bottom) to
// return a real value on iOS - without it the bottom tab bar sits flush
// against the screen edge, behind the home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
