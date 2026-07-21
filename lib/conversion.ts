import {
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import {
  CONTRACTS,
  erc20Abi,
  psmWrapperAbi,
  susdsAbi,
  USDC_TO_WAD,
  WAD,
} from "@/lib/contracts";

export type Direction = "deposit" | "redeem";

export type TurnkeyCall = {
  to: Address;
  value: string;
  data: Hex;
};

export type DepositQuote = {
  direction: "deposit";
  inputAmount: bigint;
  usdsAmount: bigint;
  outputAmount: bigint;
  feeAmount: bigint;
};

export type RedeemQuote = {
  direction: "redeem";
  inputAmount: bigint;
  usdsAmount: bigint;
  usdsRequired: bigint;
  outputAmount: bigint;
  dustAmount: bigint;
};

export type ConversionQuote = DepositQuote | RedeemQuote;

export function parseTokenAmount(value: string, decimals: number): bigint {
  const normalized = value.trim();

  if (!normalized || normalized === ".") return 0n;
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) {
    throw new Error("Enter a valid decimal amount.");
  }

  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  }

  return parseUnits(normalized, decimals);
}

export function quoteUsdcToUsds(
  usdcAmount: bigint,
  tin: bigint,
): Pick<DepositQuote, "usdsAmount" | "feeAmount"> {
  const grossUsds = usdcAmount * USDC_TO_WAD;
  const feeAmount = (grossUsds * tin) / WAD;

  return {
    usdsAmount: grossUsds - feeAmount,
    feeAmount,
  };
}

export function usdsRequiredForUsdc(
  usdcAmount: bigint,
  tout: bigint,
): bigint {
  const baseUsds = usdcAmount * USDC_TO_WAD;
  return baseUsds + (baseUsds * tout) / WAD;
}

export function maxUsdcForUsds(
  availableUsds: bigint,
  tout: bigint,
): bigint {
  let low = 0n;
  let high = availableUsds / USDC_TO_WAD;

  while (low < high) {
    const midpoint = (low + high + 1n) / 2n;
    if (usdsRequiredForUsdc(midpoint, tout) <= availableUsds) {
      low = midpoint;
    } else {
      high = midpoint - 1n;
    }
  }

  return low;
}

export function buildDepositCalls(params: {
  owner: Address;
  usdcAmount: bigint;
  usdsAmount: bigint;
}): TurnkeyCall[] {
  const { owner, usdcAmount, usdsAmount } = params;

  return [
    {
      to: CONTRACTS.usdc,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.usdsPsmWrapper, usdcAmount],
      }),
    },
    {
      to: CONTRACTS.usdsPsmWrapper,
      value: "0",
      data: encodeFunctionData({
        abi: psmWrapperAbi,
        functionName: "sellGem",
        args: [owner, usdcAmount],
      }),
    },
    {
      to: CONTRACTS.usds,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.susds, usdsAmount],
      }),
    },
    {
      to: CONTRACTS.susds,
      value: "0",
      data: encodeFunctionData({
        abi: susdsAbi,
        functionName: "deposit",
        args: [usdsAmount, owner],
      }),
    },
  ];
}

export function buildRedeemCalls(params: {
  owner: Address;
  susdsAmount: bigint;
  usdsRequired: bigint;
  usdcAmount: bigint;
}): TurnkeyCall[] {
  const { owner, susdsAmount, usdsRequired, usdcAmount } = params;

  return [
    {
      to: CONTRACTS.susds,
      value: "0",
      data: encodeFunctionData({
        abi: susdsAbi,
        functionName: "redeem",
        args: [susdsAmount, owner, owner],
      }),
    },
    {
      to: CONTRACTS.usds,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.usdsPsmWrapper, usdsRequired],
      }),
    },
    {
      to: CONTRACTS.usdsPsmWrapper,
      value: "0",
      data: encodeFunctionData({
        abi: psmWrapperAbi,
        functionName: "buyGem",
        args: [owner, usdcAmount],
      }),
    },
    {
      to: CONTRACTS.usds,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.usdsPsmWrapper, 0n],
      }),
    },
  ];
}

export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  maximumFractionDigits = 6,
): string {
  const raw = formatUnits(amount, decimals);
  const [whole, fraction = ""] = raw.split(".");
  const trimmedFraction = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "");

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}
