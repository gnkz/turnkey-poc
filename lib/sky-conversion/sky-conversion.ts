import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  maxUint256,
} from "viem";

import { balanceAbi, routeStateAbi, SKY_CONTRACTS } from "./contracts";
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

export type SkyConversion = Readonly<{
  getOverview(
    walletAddress: string,
    options?: { signal?: AbortSignal },
  ): Promise<SkyConversionOverview>;
}>;

const WAD = 10n ** 18n;

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
  const basisPoints = (rate * 10_000n) / WAD;
  return `${(Number(basisPoints) / 100).toFixed(2)}%`;
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
  };
}
