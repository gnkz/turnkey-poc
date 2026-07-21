import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { CONTRACTS, erc20Abi, psmWrapperAbi, USDC_TO_WAD } from "@/lib/contracts";
import {
  buildDepositCalls,
  buildRedeemCalls,
  maxUsdcForUsds,
  quoteUsdcToUsds,
  usdsRequiredForUsdc,
} from "@/lib/conversion";

const owner = "0x1111111111111111111111111111111111111111";

describe("Sky conversion batches", () => {
  it("builds the four ordered USDC to sUSDS calls", () => {
    const usdcAmount = 100_000_000n;
    const usdsAmount = 100n * 10n ** 18n;
    const calls = buildDepositCalls({ owner, usdcAmount, usdsAmount });

    expect(calls.map((call) => call.to)).toEqual([
      CONTRACTS.usdc,
      CONTRACTS.usdsPsmWrapper,
      CONTRACTS.usds,
      CONTRACTS.susds,
    ]);

    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data })).toMatchObject({
      functionName: "approve",
      args: [CONTRACTS.usdsPsmWrapper, usdcAmount],
    });
    expect(
      decodeFunctionData({ abi: psmWrapperAbi, data: calls[1].data }),
    ).toMatchObject({ functionName: "sellGem", args: [owner, usdcAmount] });
  });

  it("applies the LitePSM incoming fee in 18-decimal units", () => {
    const onePercent = 10n ** 16n;
    const quote = quoteUsdcToUsds(100_000_000n, onePercent);

    expect(quote.feeAmount).toBe(1n * 10n ** 18n);
    expect(quote.usdsAmount).toBe(99n * 10n ** 18n);
  });

  it("finds the largest representable reverse USDC amount", () => {
    const availableUsds = 100n * 10n ** 18n - 1n;
    const usdcAmount = maxUsdcForUsds(availableUsds, 0n);

    expect(usdcAmount).toBe(99_999_999n);
    expect(usdsRequiredForUsdc(usdcAmount, 0n)).toBe(
      usdcAmount * USDC_TO_WAD,
    );
  });

  it("builds the reverse calls and clears the converter allowance", () => {
    const susdsAmount = 90n * 10n ** 18n;
    const usdcAmount = 99_000_000n;
    const usdsRequired = 99n * 10n ** 18n;
    const calls = buildRedeemCalls({
      owner,
      susdsAmount,
      usdsRequired,
      usdcAmount,
    });

    expect(calls.map((call) => call.to)).toEqual([
      CONTRACTS.susds,
      CONTRACTS.usds,
      CONTRACTS.usdsPsmWrapper,
      CONTRACTS.usds,
    ]);
    expect(
      decodeFunctionData({ abi: psmWrapperAbi, data: calls[2].data }),
    ).toMatchObject({ functionName: "buyGem", args: [owner, usdcAmount] });
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[3].data })).toMatchObject({
      functionName: "approve",
      args: [CONTRACTS.usdsPsmWrapper, 0n],
    });
  });
});
