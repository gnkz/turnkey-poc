export type RawEthereumCall = Readonly<{
  to: `0x${string}`;
  data: `0x${string}`;
}>;

export type PinnedRawCallExecutor = Readonly<{
  execute(calls: readonly RawEthereumCall[]): Promise<readonly `0x${string}`[]>;
}>;

export interface PinnedEthereumReader {
  readAtPinnedBlock<T>(
    read: (executor: PinnedRawCallExecutor) => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
}
