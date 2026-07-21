import { describe, expect, it } from "vitest";

import {
  DEFAULT_NON_SPONSORED_BATCH_GAS_LIMIT,
  maximumGasCost,
  resolveNonSponsoredBatchGasLimit,
} from "@/lib/gas";

describe("non-sponsored batch gas", () => {
  it("uses the conservative PoC ceiling by default", () => {
    expect(resolveNonSponsoredBatchGasLimit(undefined)).toBe(
      DEFAULT_NON_SPONSORED_BATCH_GAS_LIMIT,
    );
  });

  it("accepts a configured decimal gas limit", () => {
    expect(resolveNonSponsoredBatchGasLimit("900000")).toBe(900_000n);
  });

  it("rejects malformed and unsafe limits", () => {
    expect(() => resolveNonSponsoredBatchGasLimit("0x100000")).toThrow();
    expect(() => resolveNonSponsoredBatchGasLimit("20000")).toThrow();
  });

  it("calculates the wallet's maximum fee reservation", () => {
    expect(maximumGasCost(750_000n, 2_000_000_000n)).toBe(
      1_500_000_000_000_000n,
    );
  });
});
