import type {
  PinnedEthereumReader,
  PinnedRawCallExecutor,
} from "./ethereum-reader";

type RecordingReadScript =
  | Readonly<{
      blockNumber: bigint;
      rounds: readonly (readonly `0x${string}`[])[];
    }>
  | Readonly<{ failure: Error }>;

export type RecordedEthereumRead = Readonly<{
  blockNumber: bigint;
  roundBlockNumbers: readonly bigint[];
  callCounts: readonly number[];
}>;

export class RecordingEthereumReader implements PinnedEthereumReader {
  readonly recordedReads: RecordedEthereumRead[] = [];
  readonly #scripts: RecordingReadScript[];

  constructor(scripts: readonly RecordingReadScript[]) {
    this.#scripts = [...scripts];
  }

  async readAtPinnedBlock<T>(
    read: (executor: PinnedRawCallExecutor) => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    options?.signal?.throwIfAborted();
    const script = this.#scripts.shift();
    if (!script) throw new Error("No recording read was scripted.");
    if ("failure" in script) throw script.failure;

    const roundBlockNumbers: bigint[] = [];
    const callCounts: number[] = [];
    let nextRound = 0;
    const executor: PinnedRawCallExecutor = {
      execute: async (calls) => {
        options?.signal?.throwIfAborted();
        const results = script.rounds[nextRound];
        if (!results) throw new Error("No recording round was scripted.");
        if (results.length !== calls.length) {
          throw new Error(
            `Recording round returned ${results.length} results for ${calls.length} calls.`,
          );
        }

        nextRound += 1;
        roundBlockNumbers.push(script.blockNumber);
        callCounts.push(calls.length);
        return results;
      },
    };

    const result = await read(executor);
    this.recordedReads.push({
      blockNumber: script.blockNumber,
      roundBlockNumbers,
      callCounts,
    });
    return result;
  }
}
