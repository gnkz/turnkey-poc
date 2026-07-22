import type {
  PinnedEthereumReader,
  PinnedRawCallExecutor,
  RawEthereumCall,
} from "./ethereum-reader";
import { SkyConversionFailure } from "./failure";

type PinnedBlockIdentifier = Readonly<{
  blockHash: `0x${string}`;
  requireCanonical: true;
}>;

type ViemRpcRequest =
  | Readonly<{ method: "eth_chainId" }>
  | Readonly<{
      method: "eth_getBlockByNumber";
      params: ["latest" | `0x${string}`, false];
    }>
  | Readonly<{
      method: "eth_call";
      params: [RawEthereumCall, PinnedBlockIdentifier];
    }>;

export type ViemRpcRequester = (
  request: ViemRpcRequest,
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

type RpcBlock = Readonly<{
  number: `0x${string}`;
  hash: `0x${string}`;
}>;

function invalidChainData(): SkyConversionFailure {
  return new SkyConversionFailure(
    "invalid-chain-data",
    "Ethereum returned invalid chain data.",
  );
}

function isQuantity(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
}

function isData(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value);
}

function isBlockHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}

function readBlock(value: unknown): RpcBlock {
  if (
    typeof value !== "object" ||
    value === null ||
    !("number" in value) ||
    !("hash" in value) ||
    !isQuantity(value.number) ||
    !isBlockHash(value.hash)
  ) {
    throw invalidChainData();
  }
  return { number: value.number, hash: value.hash };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function createViemEthereumReader(
  request: ViemRpcRequester,
): PinnedEthereumReader {
  return {
    async readAtPinnedBlock<T>(
      read: (executor: PinnedRawCallExecutor) => Promise<T>,
      options?: { signal?: AbortSignal },
    ): Promise<T> {
      const requestOptions = { signal: options?.signal };
      const rpc = async (rpcRequest: ViemRpcRequest) => {
        options?.signal?.throwIfAborted();
        try {
          return await request(rpcRequest, requestOptions);
        } catch (error) {
          if (isAbortError(error)) throw error;
          options?.signal?.throwIfAborted();
          if (error instanceof SkyConversionFailure) throw error;
          throw new SkyConversionFailure(
            "unavailable-read",
            "Ethereum data is temporarily unavailable. Try again.",
          );
        }
      };

      const chainId = await rpc({ method: "eth_chainId" });
      if (!isQuantity(chainId)) throw invalidChainData();
      const chainNumber = BigInt(chainId);
      if (chainNumber !== 1n) {
        throw new SkyConversionFailure(
          "wrong-chain",
          `The configured RPC returned chain ${chainNumber}; Ethereum mainnet (1) is required.`,
        );
      }

      const pinnedBlock = readBlock(
        await rpc({
          method: "eth_getBlockByNumber",
          params: ["latest", false],
        }),
      );
      const pinnedBlockIdentifier = {
        blockHash: pinnedBlock.hash,
        requireCanonical: true,
      } as const;
      const executor: PinnedRawCallExecutor = {
        execute: async (calls) => {
          const results: `0x${string}`[] = [];
          for (const call of calls) {
            const result = await rpc({
              method: "eth_call",
              params: [call, pinnedBlockIdentifier],
            });
            if (!isData(result)) throw invalidChainData();
            results.push(result);
          }
          return results;
        },
      };

      const result = await read(executor);
      const canonicalBlock = readBlock(
        await rpc({
          method: "eth_getBlockByNumber",
          params: [pinnedBlock.number, false],
        }),
      );
      if (canonicalBlock.number.toLowerCase() !== pinnedBlock.number.toLowerCase()) {
        throw invalidChainData();
      }
      if (canonicalBlock.hash.toLowerCase() !== pinnedBlock.hash.toLowerCase()) {
        throw new SkyConversionFailure(
          "unavailable-read",
          "Ethereum reorganized during the pinned read. Try again.",
        );
      }
      return result;
    },
  };
}
