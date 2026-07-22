import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  maxUint256,
  parseUnits,
} from "viem";

import {
  approvalAbi,
  balanceAbi,
  routeStateAbi,
  SKY_CONTRACTS,
  susdsVaultAbi,
} from "./contracts";
import type { PinnedEthereumReader } from "./ethereum-reader";
import { SkyConversionFailure } from "./failure";

export type SkyConversionDirection = "usdc-to-susds" | "susds-to-usdc";
export type SkyConversionAsset = "USDC" | "sUSDS";

export type SkyConversionDirectionOverview = Readonly<{
  direction: SkyConversionDirection;
  inputAsset: SkyConversionAsset;
  outputAsset: SkyConversionAsset;
  inputBalance: Readonly<{
    displayText: string;
    useMaxText: string;
    canUseMax: boolean;
  }>;
  availability:
    | Readonly<{ status: "available" }>
    | Readonly<{ status: "halted"; message: string }>;
  fee: Readonly<{ displayText: string }>;
}>;

export type SkyConversionOverview = Readonly<{
  walletAddress: string;
  directions: Readonly<{
    usdcToSusds: SkyConversionDirectionOverview;
    susdsToUsdc: SkyConversionDirectionOverview;
  }>;
}>;

const conversionPlanBrand: unique symbol = Symbol("ConversionPlan");

export type ConversionPlanCall = Readonly<{
  to: `0x${string}`;
  value: "0";
  data: `0x${string}`;
}>;

export type ConversionPlanCallMeaning = Readonly<{
  title: string;
  targetName: string;
  targetAddress: `0x${string}`;
  selector: `0x${string}`;
}>;

export type ConversionPlan = Readonly<{
  [conversionPlanBrand]: true;
  walletAddress: `0x${string}`;
  direction: "usdc-to-susds";
  quote: Readonly<{
    send: Readonly<{
      asset: "USDC";
      amountText: string;
      displayText: string;
    }>;
    estimatedReceipt: Readonly<{
      asset: "sUSDS";
      amountText: string;
      displayText: string;
    }>;
    skyFee: Readonly<{
      asset: "USDS";
      amountText: string;
      rateText: string;
      displayText: string;
    }>;
  }>;
  execution: Readonly<{
    network: Readonly<{
      chainId: 1;
      caip2: "eip155:1";
      displayText: "Ethereum mainnet";
    }>;
    calls: readonly ConversionPlanCall[];
  }>;
  review: Readonly<{
    calls: readonly ConversionPlanCallMeaning[];
    atomicityText: string;
  }>;
}>;

type ConversionPlanData = Omit<ConversionPlan, typeof conversionPlanBrand>;

export type ConversionPlanIneligibilityReason =
  | "empty-input"
  | "malformed-input"
  | "zero-input"
  | "excessive-precision"
  | "out-of-range"
  | "halted-route"
  | "insufficient-balance"
  | "output-too-small";

export type ConversionPlanPreparation =
  | Readonly<{ status: "ready"; plan: ConversionPlan }>
  | Readonly<{
      status: "ineligible";
      reason: ConversionPlanIneligibilityReason;
      message: string;
    }>;

type IneligiblePreparation = Extract<
  ConversionPlanPreparation,
  { status: "ineligible" }
>;

export type SkyConversion = Readonly<{
  getOverview(
    walletAddress: string,
    options?: { signal?: AbortSignal },
  ): Promise<SkyConversionOverview>;
  prepareConversionPlan(
    request: Readonly<{
      walletAddress: string;
      direction: "usdc-to-susds";
      amount: string;
    }>,
    options?: { signal?: AbortSignal },
  ): Promise<ConversionPlanPreparation>;
}>;

const WAD = 10n ** 18n;
const USDC_TO_WAD = 10n ** 12n;

function decodeBalance(result: `0x${string}`): bigint {
  return decodeFunctionResult({
    abi: balanceAbi,
    functionName: "balanceOf",
    data: result,
  });
}

function decodeRouteValue(
  functionName: "tin" | "tout" | "live",
  result: `0x${string}`,
): bigint {
  return decodeFunctionResult({
    abi: routeStateAbi,
    functionName,
    data: result,
  });
}

function decodePreviewDeposit(result: `0x${string}`): bigint {
  return decodeFunctionResult({
    abi: susdsVaultAbi,
    functionName: "previewDeposit",
    data: result,
  });
}

function formatBalance(
  amount: bigint,
  decimals: number,
  maximumFractionDigits: number,
): string {
  const [whole, fraction = ""] = formatUnits(amount, decimals).split(".");
  const visibleFraction = fraction
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "");
  return visibleFraction ? `${whole}.${visibleFraction}` : whole;
}

function formatFee(rate: bigint): string {
  if (rate === maxUint256) return "Halted";
  const [whole, fraction = ""] = formatUnits(rate * 100n, 18).split(".");
  const exactFraction = fraction.replace(/0+$/, "");
  return `${whole}.${exactFraction.padEnd(2, "0")}%`;
}

function ineligible(
  reason: ConversionPlanIneligibilityReason,
  message: string,
): IneligiblePreparation {
  return { status: "ineligible", reason, message };
}

function parseUsdcAmount(
  rawAmount: string,
):
  | Readonly<{ status: "parsed"; amount: bigint }>
  | IneligiblePreparation {
  const amountText = rawAmount.trim();
  if (!amountText) return ineligible("empty-input", "Enter an amount.");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amountText)) {
    return ineligible("malformed-input", "Enter a valid decimal amount.");
  }

  const [whole = "", fraction = ""] = amountText.split(".");
  if (/^0*$/.test(`${whole}${fraction}`)) {
    return ineligible("zero-input", "Enter an amount greater than zero.");
  }
  if (fraction.length > 6) {
    return ineligible(
      "excessive-precision",
      "USDC supports at most 6 decimal places.",
    );
  }

  const parseableAmount = amountText.startsWith(".")
    ? `0${amountText}`
    : amountText.endsWith(".")
      ? amountText.slice(0, -1)
      : amountText;
  const amount = parseUnits(parseableAmount, 6);
  if (amount > maxUint256 / USDC_TO_WAD) {
    return ineligible("out-of-range", "Amount is out of range.");
  }
  return { status: "parsed", amount };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  const objectValue = value as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(objectValue)) {
    deepFreeze(objectValue[key]);
  }
  return Object.freeze(value);
}

function brandConversionPlan(data: ConversionPlanData): ConversionPlan {
  Object.defineProperty(data, conversionPlanBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(data as ConversionPlan);
}

function directionOverview(params: {
  direction: SkyConversionDirection;
  inputAsset: SkyConversionAsset;
  outputAsset: SkyConversionAsset;
  balance: bigint;
  decimals: number;
  fee: bigint;
  live: bigint;
}): SkyConversionDirectionOverview {
  const halted = params.live !== 1n || params.fee === maxUint256;
  return {
    direction: params.direction,
    inputAsset: params.inputAsset,
    outputAsset: params.outputAsset,
    inputBalance: {
      displayText: formatBalance(params.balance, params.decimals, 6),
      useMaxText: formatUnits(params.balance, params.decimals),
      canUseMax: params.balance > 0n,
    },
    availability: halted
      ? { status: "halted", message: "Sky Conversion is halted" }
      : { status: "available" },
    fee: { displayText: formatFee(params.fee) },
  };
}

export function createSkyConversion(
  ethereum: PinnedEthereumReader,
): SkyConversion {
  return {
    async getOverview(walletAddress, options) {
      if (!isAddress(walletAddress, { strict: true })) {
        throw new SkyConversionFailure(
          "invalid-address",
          "Enter a valid Ethereum wallet address.",
        );
      }
      const canonicalAddress = getAddress(walletAddress);

      return ethereum.readAtPinnedBlock(async (reader) => {
        const [usdcBalanceResult, susdsBalanceResult, tinResult, toutResult, liveResult] =
          await reader.execute([
            {
              to: SKY_CONTRACTS.usdc,
              data: encodeFunctionData({
                abi: balanceAbi,
                functionName: "balanceOf",
                args: [canonicalAddress],
              }),
            },
            {
              to: SKY_CONTRACTS.susds,
              data: encodeFunctionData({
                abi: balanceAbi,
                functionName: "balanceOf",
                args: [canonicalAddress],
              }),
            },
            {
              to: SKY_CONTRACTS.usdsPsmWrapper,
              data: encodeFunctionData({
                abi: routeStateAbi,
                functionName: "tin",
              }),
            },
            {
              to: SKY_CONTRACTS.usdsPsmWrapper,
              data: encodeFunctionData({
                abi: routeStateAbi,
                functionName: "tout",
              }),
            },
            {
              to: SKY_CONTRACTS.usdsPsmWrapper,
              data: encodeFunctionData({
                abi: routeStateAbi,
                functionName: "live",
              }),
            },
          ]);

        let usdcBalance: bigint;
        let susdsBalance: bigint;
        let tin: bigint;
        let tout: bigint;
        let live: bigint;
        try {
          usdcBalance = decodeBalance(usdcBalanceResult);
          susdsBalance = decodeBalance(susdsBalanceResult);
          tin = decodeRouteValue("tin", tinResult);
          tout = decodeRouteValue("tout", toutResult);
          live = decodeRouteValue("live", liveResult);
        } catch {
          throw new SkyConversionFailure(
            "invalid-chain-data",
            "Ethereum returned invalid Sky Conversion data.",
          );
        }
        const validFee = (fee: bigint) => fee <= WAD || fee === maxUint256;
        if ((live !== 0n && live !== 1n) || !validFee(tin) || !validFee(tout)) {
          throw new SkyConversionFailure(
            "invalid-chain-data",
            "Ethereum returned invalid Sky Conversion data.",
          );
        }

        return {
          walletAddress: canonicalAddress,
          directions: {
            usdcToSusds: directionOverview({
              direction: "usdc-to-susds",
              inputAsset: "USDC",
              outputAsset: "sUSDS",
              balance: usdcBalance,
              decimals: 6,
              fee: tin,
              live,
            }),
            susdsToUsdc: directionOverview({
              direction: "susds-to-usdc",
              inputAsset: "sUSDS",
              outputAsset: "USDC",
              balance: susdsBalance,
              decimals: 18,
              fee: tout,
              live,
            }),
          },
        };
      }, options);
    },
    async prepareConversionPlan(request, options) {
      const parsedAmount = parseUsdcAmount(request.amount);
      if (parsedAmount.status === "ineligible") return parsedAmount;
      if (!isAddress(request.walletAddress, { strict: true })) {
        throw new SkyConversionFailure(
          "invalid-address",
          "Enter a valid Ethereum wallet address.",
        );
      }
      const walletAddress = getAddress(request.walletAddress);
      const usdcAmount = parsedAmount.amount;

      return ethereum.readAtPinnedBlock(async (reader) => {
        const [balanceResult, tinResult, liveResult] = await reader.execute([
          {
            to: SKY_CONTRACTS.usdc,
            data: encodeFunctionData({
              abi: balanceAbi,
              functionName: "balanceOf",
              args: [walletAddress],
            }),
          },
          {
            to: SKY_CONTRACTS.usdsPsmWrapper,
            data: encodeFunctionData({
              abi: routeStateAbi,
              functionName: "tin",
            }),
          },
          {
            to: SKY_CONTRACTS.usdsPsmWrapper,
            data: encodeFunctionData({
              abi: routeStateAbi,
              functionName: "live",
            }),
          },
        ]);

        let usdcBalance: bigint;
        let tin: bigint;
        let live: bigint;
        try {
          usdcBalance = decodeBalance(balanceResult);
          tin = decodeRouteValue("tin", tinResult);
          live = decodeRouteValue("live", liveResult);
        } catch {
          throw new SkyConversionFailure(
            "invalid-chain-data",
            "Ethereum returned invalid Sky Conversion data.",
          );
        }
        if (
          (live !== 0n && live !== 1n) ||
          (tin > WAD && tin !== maxUint256)
        ) {
          throw new SkyConversionFailure(
            "invalid-chain-data",
            "Ethereum returned invalid Sky Conversion data.",
          );
        }
        if (live === 0n || tin === maxUint256) {
          return ineligible("halted-route", "Sky Conversion is halted.");
        }
        if (usdcAmount > usdcBalance) {
          return ineligible("insufficient-balance", "Insufficient USDC.");
        }
        const grossUsds = usdcAmount * USDC_TO_WAD;
        const feeAmount = (grossUsds * tin) / WAD;
        const usdsAmount = grossUsds - feeAmount;
        if (usdsAmount === 0n) {
          return ineligible("output-too-small", "Amount is too small.");
        }
        const [previewResult] = await reader.execute([
          {
            to: SKY_CONTRACTS.susds,
            data: encodeFunctionData({
              abi: susdsVaultAbi,
              functionName: "previewDeposit",
              args: [usdsAmount],
            }),
          },
        ]);
        let susdsAmount: bigint;
        try {
          susdsAmount = decodePreviewDeposit(previewResult);
        } catch {
          throw new SkyConversionFailure(
            "invalid-chain-data",
            "Ethereum returned invalid Sky Conversion data.",
          );
        }
        if (susdsAmount === 0n) {
          return ineligible("output-too-small", "Amount is too small.");
        }

        const calls: ConversionPlanCall[] = [
          {
            to: SKY_CONTRACTS.usdc,
            value: "0",
            data: encodeFunctionData({
              abi: approvalAbi,
              functionName: "approve",
              args: [SKY_CONTRACTS.usdsPsmWrapper, usdcAmount],
            }),
          },
          {
            to: SKY_CONTRACTS.usdsPsmWrapper,
            value: "0",
            data: encodeFunctionData({
              abi: routeStateAbi,
              functionName: "sellGem",
              args: [walletAddress, usdcAmount],
            }),
          },
          {
            to: SKY_CONTRACTS.usds,
            value: "0",
            data: encodeFunctionData({
              abi: approvalAbi,
              functionName: "approve",
              args: [SKY_CONTRACTS.susds, usdsAmount],
            }),
          },
          {
            to: SKY_CONTRACTS.susds,
            value: "0",
            data: encodeFunctionData({
              abi: susdsVaultAbi,
              functionName: "deposit",
              args: [usdsAmount, walletAddress],
            }),
          },
        ];
        const reviewDetails = [
          ["Authorize USDC", "USDC"],
          ["Route USDC to USDS", "Sky LitePSM wrapper"],
          ["Authorize USDS for sUSDS", "USDS"],
          ["Deposit USDS for the wallet", "Savings USDS"],
        ] as const;
        const reviewCalls = calls.map((call, index) => ({
          title: reviewDetails[index][0],
          targetName: reviewDetails[index][1],
          targetAddress: call.to,
          selector: call.data.slice(0, 10) as `0x${string}`,
        }));
        const sendAmountText = formatUnits(usdcAmount, 6);
        const receiptAmountText = formatUnits(susdsAmount, 18);
        const feeAmountText = formatUnits(feeAmount, 18);
        const rateText = formatFee(tin);

        return {
          status: "ready",
          plan: brandConversionPlan({
            walletAddress,
            direction: request.direction,
            quote: {
              send: {
                asset: "USDC",
                amountText: sendAmountText,
                displayText: `${sendAmountText} USDC`,
              },
              estimatedReceipt: {
                asset: "sUSDS",
                amountText: receiptAmountText,
                displayText: `${receiptAmountText} sUSDS`,
              },
              skyFee: {
                asset: "USDS",
                amountText: feeAmountText,
                rateText,
                displayText: `${feeAmountText} USDS (${rateText})`,
              },
            },
            execution: {
              network: {
                chainId: 1,
                caip2: "eip155:1",
                displayText: "Ethereum mainnet",
              },
              calls,
            },
            review: {
              calls: reviewCalls,
              atomicityText:
                "All four calls execute atomically; if any call fails, the entire batch reverts.",
            },
          }),
        };
      }, options);
    },
  };
}
