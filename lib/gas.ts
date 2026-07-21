export const DEFAULT_NON_SPONSORED_BATCH_GAS_LIMIT = 750_000n;

const MINIMUM_GAS_LIMIT = 21_000n;
const MAXIMUM_GAS_LIMIT = 30_000_000n;

export function resolveNonSponsoredBatchGasLimit(
  configuredValue: string | undefined,
): bigint {
  const value = configuredValue?.trim();
  if (!value) return DEFAULT_NON_SPONSORED_BATCH_GAS_LIMIT;

  if (!/^\d+$/.test(value)) {
    throw new Error(
      "NEXT_PUBLIC_NON_SPONSORED_BATCH_GAS_LIMIT must be a base-10 integer.",
    );
  }

  const gasLimit = BigInt(value);
  if (gasLimit < MINIMUM_GAS_LIMIT || gasLimit > MAXIMUM_GAS_LIMIT) {
    throw new Error(
      `NEXT_PUBLIC_NON_SPONSORED_BATCH_GAS_LIMIT must be between ${MINIMUM_GAS_LIMIT} and ${MAXIMUM_GAS_LIMIT}.`,
    );
  }

  return gasLimit;
}

export function maximumGasCost(
  gasLimit: bigint,
  maxFeePerGas: bigint,
): bigint {
  return gasLimit * maxFeePerGas;
}
