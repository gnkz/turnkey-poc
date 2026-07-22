import { parseAbi, type Address } from "viem";

export const SKY_CONTRACTS = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  usds: "0xdC035D45d973E3EC169d2276DDab16f1e407384F",
  susds: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
  usdsPsmWrapper: "0xA188EEC8F81263234dA3622A406892F3D630f98c",
} as const satisfies Record<string, Address>;

export const balanceAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export const approvalAbi = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
]);

export const routeStateAbi = parseAbi([
  "function tin() view returns (uint256)",
  "function tout() view returns (uint256)",
  "function live() view returns (uint256)",
  "function sellGem(address receiver, uint256 gemAmount) returns (uint256 usdsOut)",
]);

export const susdsVaultAbi = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256 shares)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
]);
