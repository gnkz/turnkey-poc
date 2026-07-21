"use client";

import {
  TurnkeyProvider,
  type CreateSubOrgParams,
  type TurnkeyProviderConfig,
} from "@turnkey/react-wallet-kit";
import type { ReactNode } from "react";

const organizationId = process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID;
const authProxyConfigId =
  process.env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID;

const suborganization: CreateSubOrgParams = {
  customWallet: {
    walletName: "Sky Savings Wallet",
    walletAccounts: [
      {
        curve: "CURVE_SECP256K1",
        pathFormat: "PATH_FORMAT_BIP32",
        path: "m/44'/60'/0'/0/0",
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
      },
    ],
  },
};

const turnkeyConfig: TurnkeyProviderConfig = {
  organizationId: organizationId ?? "",
  authProxyConfigId: authProxyConfigId ?? "",
  auth: {
    autoRefreshSession: true,
    verifyWalletOnSignup: true,
    createSuborgParams: {
      emailOtpAuth: suborganization,
      smsOtpAuth: suborganization,
      passkeyAuth: {
        ...suborganization,
        passkeyName: "Sky Savings passkey",
      },
      walletAuth: suborganization,
      oauth: suborganization,
    },
  },
  ui: {
    darkMode: true,
    borderRadius: 12,
    preferLargeActionButtons: true,
  },
};

export function Providers({ children }: { children: ReactNode }) {
  if (!organizationId || !authProxyConfigId) {
    return (
      <main className="configuration-page">
        <section className="configuration-card">
          <p className="eyebrow">Configuration required</p>
          <h1>Connect this PoC to Turnkey</h1>
          <p>
            Add the two public identifiers below to <code>.env</code>, then
            restart the development server.
          </p>
          <div className="configuration-values">
            <code>NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID</code>
            <code>NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID</code>
          </div>
          <p className="configuration-hint">
            Find them under Turnkey Dashboard &gt; Embedded Wallets &gt;
            Configuration. See <code>README.md</code> for the complete setup.
          </p>
        </section>
      </main>
    );
  }

  return (
    <TurnkeyProvider
      config={turnkeyConfig}
      callbacks={{
        onError: (error) => console.error("Turnkey error", error),
      }}
    >
      {children}
    </TurnkeyProvider>
  );
}
