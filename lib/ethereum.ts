import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

const rpcUrl = process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || undefined;

export const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl),
  batch: {
    multicall: true,
  },
});
