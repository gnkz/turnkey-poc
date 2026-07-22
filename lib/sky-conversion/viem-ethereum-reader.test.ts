import { describe, expect, it } from "vitest";

import { createViemEthereumReader } from "./viem-ethereum-reader";

const blockHash = `0x${"ab".repeat(32)}`;

describe("viem Ethereum reader", () => {
  it("pins ordered raw calls to mainnet and verifies the canonical block", async () => {
    const requests: unknown[] = [];
    const responses: unknown[] = [
      "0x1",
      { number: "0x1437c47", hash: blockHash },
      "0x01",
      "0x02",
      "0x03",
      { number: "0x1437c47", hash: blockHash },
    ];
    const reader = createViemEthereumReader(async (request) => {
      requests.push(request);
      return responses.shift();
    });
    const firstCall = {
      to: "0x1111111111111111111111111111111111111111" as const,
      data: "0xaaaa" as const,
    };
    const secondCall = {
      to: "0x2222222222222222222222222222222222222222" as const,
      data: "0xbbbb" as const,
    };
    const dependentCall = {
      to: "0x3333333333333333333333333333333333333333" as const,
      data: "0xcccc" as const,
    };

    const results = await reader.readAtPinnedBlock(async (executor) => {
      const firstRound = await executor.execute([firstCall, secondCall]);
      const secondRound = await executor.execute([dependentCall]);
      return [...firstRound, ...secondRound];
    });

    expect(results).toEqual(["0x01", "0x02", "0x03"]);
    expect(requests).toEqual([
      { method: "eth_chainId" },
      {
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      },
      {
        method: "eth_call",
        params: [firstCall, { blockHash, requireCanonical: true }],
      },
      {
        method: "eth_call",
        params: [secondCall, { blockHash, requireCanonical: true }],
      },
      {
        method: "eth_call",
        params: [dependentCall, { blockHash, requireCanonical: true }],
      },
      {
        method: "eth_getBlockByNumber",
        params: ["0x1437c47", false],
      },
    ]);
  });

  it("rejects a non-mainnet RPC before pinning a block", async () => {
    const requests: unknown[] = [];
    const reader = createViemEthereumReader(async (request) => {
      requests.push(request);
      return "0xaa36a7";
    });

    await expect(
      reader.readAtPinnedBlock(async () => "unreachable"),
    ).rejects.toMatchObject({
      name: "SkyConversionFailure",
      code: "wrong-chain",
      message:
        "The configured RPC returned chain 11155111; Ethereum mainnet (1) is required.",
    });
    expect(requests).toEqual([{ method: "eth_chainId" }]);
  });

  it("rejects a result when the pinned block is no longer canonical", async () => {
    const replacementHash = `0x${"cd".repeat(32)}`;
    const responses: unknown[] = [
      "0x1",
      { number: "0x1437c47", hash: blockHash },
      "0x01",
      { number: "0x1437c47", hash: replacementHash },
    ];
    const reader = createViemEthereumReader(async () => responses.shift());

    await expect(
      reader.readAtPinnedBlock((executor) =>
        executor.execute([
          {
            to: "0x1111111111111111111111111111111111111111",
            data: "0xaaaa",
          },
        ]),
      ),
    ).rejects.toMatchObject({
      name: "SkyConversionFailure",
      code: "unavailable-read",
      message: "Ethereum reorganized during the pinned read. Try again.",
    });
  });

  it("translates RPC failures before they cross the reader seam", async () => {
    const responses: unknown[] = [
      "0x1",
      { number: "0x1437c47", hash: blockHash },
    ];
    const reader = createViemEthereumReader(async (request) => {
      if (request.method === "eth_call") throw new Error("socket closed");
      return responses.shift();
    });

    await expect(
      reader.readAtPinnedBlock((executor) =>
        executor.execute([
          {
            to: "0x1111111111111111111111111111111111111111",
            data: "0xaaaa",
          },
        ]),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SkyConversionFailure",
        code: "unavailable-read",
        message: "Ethereum data is temporarily unavailable. Try again.",
      }),
    );
  });

  it.each([
    ["chain ID", ["mainnet"]],
    ["pinned block", ["0x1", { number: "latest", hash: blockHash }]],
    [
      "call result",
      ["0x1", { number: "0x1437c47", hash: blockHash }, "result"],
    ],
    [
      "canonical block",
      [
        "0x1",
        { number: "0x1437c47", hash: blockHash },
        "0x01",
        { number: "0x1437c47", hash: "not-a-hash" },
      ],
    ],
    [
      "canonical block identity",
      [
        "0x1",
        { number: "0x1437c47", hash: blockHash },
        "0x01",
        { number: "0x1437c48", hash: blockHash },
      ],
    ],
  ])("translates malformed %s data", async (_field, scriptedResponses) => {
    const responses = [...scriptedResponses];
    const reader = createViemEthereumReader(async () => responses.shift());

    await expect(
      reader.readAtPinnedBlock((executor) =>
        executor.execute([
          {
            to: "0x1111111111111111111111111111111111111111",
            data: "0xaaaa",
          },
        ]),
      ),
    ).rejects.toMatchObject({
      name: "SkyConversionFailure",
      code: "invalid-chain-data",
      message: "Ethereum returned invalid chain data.",
    });
  });

  it("does not start a request when cancellation already occurred", async () => {
    const requests: unknown[] = [];
    const reader = createViemEthereumReader(async (request) => {
      requests.push(request);
      return "0x1";
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      reader.readAtPinnedBlock(async () => "unreachable", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toEqual([]);
  });

  it("forwards and preserves in-flight cancellation", async () => {
    let receivedSignal: AbortSignal | undefined;
    const reader = createViemEthereumReader(
      (_request, options) =>
        new Promise<unknown>((_resolve, reject) => {
          receivedSignal = options?.signal;
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();

    const read = reader.readAtPinnedBlock(async () => "unreachable", {
      signal: controller.signal,
    });
    expect(receivedSignal).toBe(controller.signal);
    controller.abort();

    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });
});
