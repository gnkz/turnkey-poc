import "@turnkey/react-wallet-kit/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "USDC / sUSDS | Turnkey Batch PoC",
  description:
    "An atomic USDC to sUSDS conversion proof of concept powered by Turnkey embedded wallets.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
