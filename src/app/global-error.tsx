"use client";

import { AppErrorScreen } from "@/components/app-error-screen";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <AppErrorScreen error={error} reset={reset} source="global" />
      </body>
    </html>
  );
}
