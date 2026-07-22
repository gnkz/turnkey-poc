import {
  decodeFunctionData,
  encodeAbiParameters,
  maxUint256,
  parseAbi,
} from "viem";
import { describe, expect, it } from "vitest";

import { RecordingEthereumReader } from "./recording-ethereum-reader";
import { SkyConversionFailure } from "./index";
import { createSkyConversion } from "./sky-conversion";

const uint256 = (value: bigint) =>
  encodeAbiParameters([{ type: "uint256" }], [value]);

const approveAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
]);
const sellGemAbi = parseAbi([
  "function sellGem(address receiver, uint256 gemAmount) returns (uint256 usdsOut)",
]);
const depositAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
]);
const previewDepositAbi = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256 shares)",
]);

describe("USDC-to-sUSDS Conversion Plan preparation", () => {
  it("prepares one review-ready plan with its exact four-call batch", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [uint256(250_000_000n), uint256(10n ** 16n), uint256(1n)],
          [uint256(98_500_000_000_000_000_000n)],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
      direction: "usdc-to-susds",
      amount: "100.0",
    });

    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;

    const { plan } = preparation;
    expect(plan).toMatchObject({
      walletAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
      direction: "usdc-to-susds",
      quote: {
        send: {
          asset: "USDC",
          amountText: "100",
          displayText: "100 USDC",
        },
        estimatedReceipt: {
          asset: "sUSDS",
          amountText: "98.5",
          displayText: "98.5 sUSDS",
        },
        skyFee: {
          asset: "USDS",
          amountText: "1",
          rateText: "1.00%",
          displayText: "1 USDS (1.00%)",
        },
      },
      execution: {
        network: {
          chainId: 1,
          caip2: "eip155:1",
          displayText: "Ethereum mainnet",
        },
      },
      review: {
        atomicityText:
          "All four calls execute atomically; if any call fails, the entire batch reverts.",
      },
    });

    expect(plan.execution.calls).toHaveLength(4);
    expect(
      plan.execution.calls.map(({ to, value, data }) => ({
        to,
        value,
        selector: data.slice(0, 10),
      })),
    ).toEqual([
      {
        to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        value: "0",
        selector: "0x095ea7b3",
      },
      {
        to: "0xA188EEC8F81263234dA3622A406892F3D630f98c",
        value: "0",
        selector: "0x95991276",
      },
      {
        to: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
        value: "0",
        selector: "0x095ea7b3",
      },
      {
        to: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
        value: "0",
        selector: "0x6e553f65",
      },
    ]);
    expect(
      decodeFunctionData({ abi: approveAbi, data: plan.execution.calls[0].data }),
    ).toMatchObject({
      functionName: "approve",
      args: ["0xA188EEC8F81263234dA3622A406892F3D630f98c", 100_000_000n],
    });
    expect(
      decodeFunctionData({ abi: sellGemAbi, data: plan.execution.calls[1].data }),
    ).toMatchObject({
      functionName: "sellGem",
      args: ["0x52908400098527886E0F7030069857D2E4169EE7", 100_000_000n],
    });
    expect(
      decodeFunctionData({ abi: approveAbi, data: plan.execution.calls[2].data }),
    ).toMatchObject({
      functionName: "approve",
      args: ["0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD", 99n * 10n ** 18n],
    });
    expect(
      decodeFunctionData({ abi: depositAbi, data: plan.execution.calls[3].data }),
    ).toMatchObject({
      functionName: "deposit",
      args: [
        99n * 10n ** 18n,
        "0x52908400098527886E0F7030069857D2E4169EE7",
      ],
    });

    expect(plan.review.calls).toEqual([
      {
        title: "Authorize USDC",
        targetName: "USDC",
        targetAddress: plan.execution.calls[0].to,
        selector: "0x095ea7b3",
      },
      {
        title: "Route USDC to USDS",
        targetName: "Sky LitePSM wrapper",
        targetAddress: plan.execution.calls[1].to,
        selector: "0x95991276",
      },
      {
        title: "Authorize USDS for sUSDS",
        targetName: "USDS",
        targetAddress: plan.execution.calls[2].to,
        selector: "0x095ea7b3",
      },
      {
        title: "Deposit USDS for the wallet",
        targetName: "Savings USDS",
        targetAddress: plan.execution.calls[3].to,
        selector: "0x6e553f65",
      },
    ]);
    expect(reader.recordedReads).toEqual([
      {
        blockNumber: 21_234_567n,
        roundBlockNumbers: [21_234_567n, 21_234_567n],
        callCounts: [3, 1],
      },
    ]);
    const previewCall = reader.recordedCalls[0][1][0];
    expect(previewCall.to).toBe(
      "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
    );
    expect(
      decodeFunctionData({ abi: previewDepositAbi, data: previewCall.data }),
    ).toMatchObject({
      functionName: "previewDeposit",
      args: [99n * 10n ** 18n],
    });
  });

  it("preserves an exact sub-basis-point Sky fee in plan text", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [uint256(100_000_000n), uint256(150_000_000_000_000n), uint256(1n)],
          [uint256(99_985_000_000_000_000_000n)],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x1111111111111111111111111111111111111111",
      direction: "usdc-to-susds",
      amount: "100",
    });

    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;
    expect(preparation.plan.quote.skyFee).toEqual({
      asset: "USDS",
      amountText: "0.015",
      rateText: "0.015%",
      displayText: "0.015 USDS (0.015%)",
    });
  });

  it.each([
    ["empty input", "   ", "empty-input", "Enter an amount."],
    [
      "malformed input",
      "1.2.3",
      "malformed-input",
      "Enter a valid decimal amount.",
    ],
    [
      "zero before precision",
      "0.0000000",
      "zero-input",
      "Enter an amount greater than zero.",
    ],
    [
      "excessive precision",
      "1.0000001",
      "excessive-precision",
      "USDC supports at most 6 decimal places.",
    ],
    [
      "an amount outside the executable range",
      (maxUint256 / 10n ** 12n + 1n).toString(),
      "out-of-range",
      "Amount is out of range.",
    ],
  ])(
    "returns %s without reading Ethereum",
    async (_scenario, amount, reason, message) => {
      const reader = new RecordingEthereumReader([]);
      const skyConversion = createSkyConversion(reader);

      const preparation = await skyConversion.prepareConversionPlan({
        walletAddress: "0x1111111111111111111111111111111111111111",
        direction: "usdc-to-susds",
        amount,
      });

      expect(preparation).toEqual({ status: "ineligible", reason, message });
      expect(reader.recordedReads).toEqual([]);
    },
  );

  it("reports a halted route before balance eligibility or vault preview", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [[uint256(0n), uint256(maxUint256), uint256(1n)]],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x1111111111111111111111111111111111111111",
      direction: "usdc-to-susds",
      amount: "1",
    });

    expect(preparation).toEqual({
      status: "ineligible",
      reason: "halted-route",
      message: "Sky Conversion is halted.",
    });
    expect(reader.recordedReads).toEqual([
      {
        blockNumber: 21_234_567n,
        roundBlockNumbers: [21_234_567n],
        callCounts: [3],
      },
    ]);
  });

  it("reports an insufficient USDC balance without requesting a preview", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [[uint256(999_999n), uint256(0n), uint256(1n)]],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x1111111111111111111111111111111111111111",
      direction: "usdc-to-susds",
      amount: "1",
    });

    expect(preparation).toEqual({
      status: "ineligible",
      reason: "insufficient-balance",
      message: "Insufficient USDC.",
    });
    expect(reader.recordedReads[0]).toMatchObject({ callCounts: [3] });
  });

  it("reports an amount whose live vault preview is below one sUSDS unit", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [uint256(1n), uint256(0n), uint256(1n)],
          [uint256(0n)],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x1111111111111111111111111111111111111111",
      direction: "usdc-to-susds",
      amount: "0.000001",
    });

    expect(preparation).toEqual({
      status: "ineligible",
      reason: "output-too-small",
      message: "Amount is too small.",
    });
    expect(reader.recordedReads[0]).toMatchObject({ callCounts: [3, 1] });
  });

  it("reports output too small when the incoming fee consumes the route amount", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [[uint256(1_000_000n), uint256(10n ** 18n), uint256(1n)]],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x1111111111111111111111111111111111111111",
      direction: "usdc-to-susds",
      amount: "1",
    });

    expect(preparation).toMatchObject({
      status: "ineligible",
      reason: "output-too-small",
    });
    expect(reader.recordedReads[0]).toMatchObject({ callCounts: [3] });
  });

  it("translates malformed preparation facts to invalid chain data", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [["0x12", uint256(0n), uint256(1n)]],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    await expect(
      skyConversion.prepareConversionPlan({
        walletAddress: "0x1111111111111111111111111111111111111111",
        direction: "usdc-to-susds",
        amount: "1",
      }),
    ).rejects.toMatchObject({
      name: "SkyConversionFailure",
      code: "invalid-chain-data",
      message: "Ethereum returned invalid Sky Conversion data.",
    });
  });

  it.each([
    ["an out-of-range incoming fee", 10n ** 18n + 1n, 1n],
    ["an unknown operational state", 0n, 2n],
  ])("rejects %s during preparation", async (_scenario, tin, live) => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [[uint256(1_000_000n), uint256(tin), uint256(live)]],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    await expect(
      skyConversion.prepareConversionPlan({
        walletAddress: "0x1111111111111111111111111111111111111111",
        direction: "usdc-to-susds",
        amount: "1",
      }),
    ).rejects.toMatchObject({
      code: "invalid-chain-data",
      message: "Ethereum returned invalid Sky Conversion data.",
    });
  });

  it("returns a deeply frozen branded plan without raw provenance", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [uint256(1_000_000n), uint256(0n), uint256(1n)],
          [uint256(1n * 10n ** 18n)],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const preparation = await skyConversion.prepareConversionPlan({
      walletAddress: "0x1111111111111111111111111111111111111111",
      direction: "usdc-to-susds",
      amount: "1",
    });
    expect(preparation.status).toBe("ready");
    if (preparation.status !== "ready") return;

    const { plan } = preparation;
    const nestedObjects = [
      plan,
      plan.quote,
      plan.quote.send,
      plan.quote.estimatedReceipt,
      plan.quote.skyFee,
      plan.execution,
      plan.execution.network,
      plan.execution.calls,
      ...plan.execution.calls,
      plan.review,
      plan.review.calls,
      ...plan.review.calls,
    ];
    expect(nestedObjects.every(Object.isFrozen)).toBe(true);
    expect(Object.getOwnPropertySymbols(plan)).toHaveLength(1);
    expect(Object.getOwnPropertySymbols({ ...plan })).toEqual([]);
    expect(JSON.stringify(plan)).not.toMatch(/block|\d+n/);
  });

  it("rejects an invalid wallet address before reading Ethereum", async () => {
    const reader = new RecordingEthereumReader([]);
    const skyConversion = createSkyConversion(reader);

    await expect(
      skyConversion.prepareConversionPlan({
        walletAddress: "not-an-address",
        direction: "usdc-to-susds",
        amount: "1",
      }),
    ).rejects.toMatchObject({
      code: "invalid-address",
      message: "Enter a valid Ethereum wallet address.",
    });
    expect(reader.recordedReads).toEqual([]);
  });

  it.each(["wrong-chain", "unavailable-read"] as const)(
    "preserves %s failures while preparing a plan",
    async (code) => {
      const failure = new SkyConversionFailure(code, `Expected ${code} failure.`);
      const reader = new RecordingEthereumReader([{ failure }]);
      const skyConversion = createSkyConversion(reader);

      await expect(
        skyConversion.prepareConversionPlan({
          walletAddress: "0x1111111111111111111111111111111111111111",
          direction: "usdc-to-susds",
          amount: "1",
        }),
      ).rejects.toBe(failure);
    },
  );

  it("preserves optional cancellation without reading Ethereum", async () => {
    const reader = new RecordingEthereumReader([
      { blockNumber: 21_234_567n, rounds: [] },
    ]);
    const skyConversion = createSkyConversion(reader);
    const controller = new AbortController();
    controller.abort();

    await expect(
      skyConversion.prepareConversionPlan(
        {
          walletAddress: "0x1111111111111111111111111111111111111111",
          direction: "usdc-to-susds",
          amount: "1",
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.recordedReads).toEqual([]);
  });
});

describe("Sky Conversion overview", () => {
  it("returns both direction states from one block-consistent overview", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [
            uint256(123_456_789n),
            uint256(9_876_543_210_987_654_321n),
            uint256(10n ** 16n),
            uint256(5n * 10n ** 15n),
            uint256(1n),
          ],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    const overview = await skyConversion.getOverview(
      "0x52908400098527886e0f7030069857d2e4169ee7",
    );

    expect(overview).toEqual({
      walletAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
      directions: {
        usdcToSusds: {
          direction: "usdc-to-susds",
          inputAsset: "USDC",
          outputAsset: "sUSDS",
          inputBalance: {
            displayText: "123.456789",
            useMaxText: "123.456789",
            canUseMax: true,
          },
          availability: { status: "available" },
          fee: { displayText: "1.00%" },
        },
        susdsToUsdc: {
          direction: "susds-to-usdc",
          inputAsset: "sUSDS",
          outputAsset: "USDC",
          inputBalance: {
            displayText: "9.876543",
            useMaxText: "9.876543210987654321",
            canUseMax: true,
          },
          availability: { status: "available" },
          fee: { displayText: "0.50%" },
        },
      },
    });
    expect(reader.recordedReads).toHaveLength(1);
    expect(reader.recordedReads[0]).toMatchObject({
      blockNumber: 21_234_567n,
      roundBlockNumbers: [21_234_567n],
      callCounts: [5],
    });
  });

  it("rejects an invalid wallet address before reading Ethereum", async () => {
    const reader = new RecordingEthereumReader([]);
    const skyConversion = createSkyConversion(reader);

    const overview = skyConversion.getOverview("not-an-address");

    await expect(overview).rejects.toBeInstanceOf(SkyConversionFailure);
    await expect(overview).rejects.toMatchObject({
      code: "invalid-address",
      message: "Enter a valid Ethereum wallet address.",
    });
    expect(reader.recordedReads).toEqual([]);
  });

  it("translates malformed contract results to invalid chain data", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [
            "0x12",
            uint256(0n),
            uint256(0n),
            uint256(0n),
            uint256(1n),
          ],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    await expect(
      skyConversion.getOverview("0x1111111111111111111111111111111111111111"),
    ).rejects.toMatchObject({
      name: "SkyConversionFailure",
      code: "invalid-chain-data",
      message: "Ethereum returned invalid Sky Conversion data.",
    });
  });

  it.each([
    ["an unknown operational state", 0n, 0n, 2n],
    ["an out-of-range incoming fee", 10n ** 18n + 1n, 0n, 1n],
    ["an out-of-range outgoing fee", 0n, 10n ** 18n + 1n, 1n],
  ])("rejects %s", async (_scenario, tin, tout, live) => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [uint256(0n), uint256(0n), uint256(tin), uint256(tout), uint256(live)],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);

    await expect(
      skyConversion.getOverview("0x1111111111111111111111111111111111111111"),
    ).rejects.toMatchObject({
      code: "invalid-chain-data",
      message: "Ethereum returned invalid Sky Conversion data.",
    });
  });

  it.each(["wrong-chain", "unavailable-read"] as const)(
    "preserves %s failures from the Ethereum reader",
    async (code) => {
      const failure = new SkyConversionFailure(code, `Expected ${code} failure.`);
      const reader = new RecordingEthereumReader([{ failure }]);
      const skyConversion = createSkyConversion(reader);

      await expect(
        skyConversion.getOverview("0x1111111111111111111111111111111111111111"),
      ).rejects.toBe(failure);
    },
  );

  it("returns directional and global halt meaning", async () => {
    const reader = new RecordingEthereumReader([
      {
        blockNumber: 21_234_567n,
        rounds: [
          [
            uint256(0n),
            uint256(0n),
            uint256(maxUint256),
            uint256(10n ** 16n),
            uint256(1n),
          ],
        ],
      },
      {
        blockNumber: 21_234_568n,
        rounds: [
          [
            uint256(0n),
            uint256(0n),
            uint256(10n ** 16n),
            uint256(2n * 10n ** 16n),
            uint256(0n),
          ],
        ],
      },
    ]);
    const skyConversion = createSkyConversion(reader);
    const walletAddress = "0x1111111111111111111111111111111111111111";

    const directionalHalt = await skyConversion.getOverview(walletAddress);
    const globalHalt = await skyConversion.getOverview(walletAddress);

    expect(directionalHalt.directions.usdcToSusds).toMatchObject({
      availability: {
        status: "halted",
        message: "Sky Conversion is halted",
      },
      fee: { displayText: "Halted" },
      inputBalance: { useMaxText: "0", canUseMax: false },
    });
    expect(directionalHalt.directions.susdsToUsdc).toMatchObject({
      availability: { status: "available" },
      fee: { displayText: "1.00%" },
    });
    expect(globalHalt.directions.usdcToSusds).toMatchObject({
      availability: {
        status: "halted",
        message: "Sky Conversion is halted",
      },
      fee: { displayText: "1.00%" },
    });
    expect(globalHalt.directions.susdsToUsdc).toMatchObject({
      availability: {
        status: "halted",
        message: "Sky Conversion is halted",
      },
      fee: { displayText: "2.00%" },
    });
  });

  it("preserves cancellation as an AbortError", async () => {
    const reader = new RecordingEthereumReader([
      { blockNumber: 21_234_567n, rounds: [] },
    ]);
    const skyConversion = createSkyConversion(reader);
    const controller = new AbortController();
    controller.abort();

    await expect(
      skyConversion.getOverview(
        "0x1111111111111111111111111111111111111111",
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.recordedReads).toEqual([]);
  });
});
