import { encodeAbiParameters, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";

import { RecordingEthereumReader } from "./recording-ethereum-reader";
import { SkyConversionFailure } from "./index";
import { createSkyConversion } from "./sky-conversion";

const uint256 = (value: bigint) =>
  encodeAbiParameters([{ type: "uint256" }], [value]);

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
