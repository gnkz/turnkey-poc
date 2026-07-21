# Turnkey USDC <-> sUSDS Batch PoC

A Next.js proof of concept for creating an embedded Turnkey wallet and moving
between USDC and Savings USDS on Ethereum mainnet. Each conversion is submitted
through Turnkey transaction management as one
`ACTIVITY_TYPE_ETH_SEND_TRANSACTION_V2` batch.

## Important Route Correction

The USDS address from the original flow is the USDS token:

```text
0xdC035D45d973E3EC169d2276DDab16f1e407384F
```

Its `mint(address,uint256)` function is restricted to Sky governance wards.
An ordinary wallet cannot approve USDC to that contract and call `mint`; the
transaction will revert with `Usds/not-authorized`.

This PoC uses Sky's canonical, permissionless USDS LitePSM wrapper instead:

```text
0xA188EEC8F81263234dA3622A406892F3D630f98c
```

The user-facing result remains USDC <-> sUSDS, but the conversion leg uses the
supported Sky route.

## Batched Calls

USDC -> sUSDS is one four-call batch:

1. `USDC.approve(USDS_PSM_WRAPPER, usdcAmount)`
2. `USDS_PSM_WRAPPER.sellGem(wallet, usdcAmount)`
3. `USDS.approve(sUSDS, quotedUsdsAmount)`
4. `sUSDS.deposit(quotedUsdsAmount, wallet)`

sUSDS -> USDC is one four-call batch:

1. `sUSDS.redeem(shares, wallet, wallet)`
2. `USDS.approve(USDS_PSM_WRAPPER, requiredUsdsAmount)`
3. `USDS_PSM_WRAPPER.buyGem(wallet, usdcAmount)`
4. `USDS.approve(USDS_PSM_WRAPPER, 0)`

The final reverse call clears any allowance that could remain if Sky's outgoing
fee decreases between quote and execution. Turnkey executes every call in order
through EIP-7702. A failed call reverts the whole batch.

## Contracts

| Contract | Ethereum mainnet address |
| --- | --- |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| USDS | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` |
| sUSDS | `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD` |
| USDS LitePSM wrapper | `0xA188EEC8F81263234dA3622A406892F3D630f98c` |

The addresses are fixed mainnet deployments. There is intentionally no network
selector.

## Turnkey Setup

1. Create or open an organization in the
   [Turnkey dashboard](https://app.turnkey.com).
2. Open **Embedded Wallets -> Configuration** and enable **Auth Proxy**.
3. Enable at least one authentication method. Email OTP and passkeys are the
   simplest options for this PoC.
4. Replace the default `*` allowed origin with the exact application origin,
   such as `http://localhost:3000`.
5. Copy the organization ID and Auth Proxy config ID.
6. Optionally enable Gas Sponsorship and configure organization and
   sub-organization spend limits. Sponsorship is currently an Enterprise
   feature.

The application uses `@turnkey/react-wallet-kit` in the browser. New users get
a sub-organization and one Ethereum account during signup. Existing users with
no Ethereum account are offered a create-wallet action.

No parent-organization API private key is required or accepted by this app.
The two `NEXT_PUBLIC_TURNKEY_*` values are public identifiers. Never put a
Turnkey API private key in a `NEXT_PUBLIC_*` variable.

## Environment

Create `.env` from `.env.example` and set:

```dotenv
NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID=<organization-id>
NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID=<auth-proxy-config-id>

# Optional browser-visible mainnet RPC used for balances and previews.
NEXT_PUBLIC_ETHEREUM_RPC_URL=

# Set true only when Turnkey Gas Sponsorship is enabled for the organization.
NEXT_PUBLIC_TURNKEY_SPONSOR_TRANSACTIONS=false

# Explicit outer EIP-7702 gas ceiling required by Turnkey for an unsponsored
# multi-call batch. See the gas-limit note below before changing it.
NEXT_PUBLIC_NON_SPONSORED_BATCH_GAS_LIMIT=750000

# Keep false while configuring and quoting. Set true to permit real mainnet
# submissions from the UI.
NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS=false
```

`NEXT_PUBLIC_ETHEREUM_RPC_URL` is bundled into browser JavaScript. Use a public
or domain-restricted endpoint, not an unrestricted secret RPC credential. If it
is blank, viem uses its default Ethereum mainnet public RPC.

## Reproducible Development

The repository pins Node.js 24 through `devenv.nix`, pnpm through
`packageManager`, and all JavaScript dependencies through `pnpm-lock.yaml`.

```bash
devenv shell
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Without `devenv`, Node.js 24 and pnpm 11 are required.

## Funding a Wallet

After login, the wallet address appears in the top bar and can be copied.

- Fund it with USDC to test the forward route.
- Fund it with ETH when `NEXT_PUBLIC_TURNKEY_SPONSOR_TRANSACTIONS=false`.
- The reverse route becomes available after the wallet receives sUSDS.
- Start with a small amount. This PoC interacts with real Ethereum mainnet
  contracts and real assets.

For a non-sponsored batch, the app fetches current EIP-1559 fees and checks that
the wallet can reserve `gasLimit * maxFeePerGas` before requesting a signature.

### Non-Sponsored Batch Gas Limit

Turnkey's hosted V2 validator currently requires `gasLimit` for a
non-sponsored multi-call request, even though the API reference says omitting it
will trigger automatic estimation. Turnkey does not expose the constructed
outer EIP-7702 transaction before submission, so a normal RPC cannot exactly
estimate this stateful batch from its four inner calls.

The default `750000` value is a conservative PoC ceiling, not an official
Turnkey estimate. Unused gas is not charged, but the wallet must be able to
reserve the maximum fee. After successful tests in both directions, calibrate
the value from transaction receipts, for example by rounding up the largest
observed `gasUsed` with a 30% margin.

## What the App Checks

- The configured RPC reports Ethereum chain ID `1`.
- USDC, USDS, sUSDS, and ETH balances are loaded from mainnet.
- LitePSM `tin`, `tout`, and `live` values are read for each refreshed quote.
- The Sky directional-halt sentinel disables that conversion direction.
- `previewDeposit` or `previewRedeem` supplies the live ERC-4626 quote.
- Input precision and balance are validated before review.
- Unsponsored requests include an explicit outer gas limit and live EIP-1559
  fee fields.
- A review dialog exposes the target and selector for every call.
- `ethSendTransaction({ transaction: { calls } })` selects Turnkey's V2
  activity.
- `pollTransactionStatus` waits for inclusion and shows the completed state.

## Security and PoC Limitations

- The explicit `NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS=true` switch is a
  safety gate, not an authorization boundary.
- Auth Proxy origins should be exact. Do not leave `*` enabled beyond an
  isolated experiment.
- Wallet creation enables Turnkey App Proof verification. Session credentials
  remain client-side; wallet private keys remain in Turnkey's secure enclave
  infrastructure.
- Sky's wrapper has no minimum-output, maximum-input, or deadline parameter.
  A fee increase after the quote causes the exact-allowance batch to revert.
  A vault rate update can slightly change the number of shares received.
- Reverse quotes round down to USDC's six-decimal precision. Unrepresentable
  USDS dust remains in the wallet.
- The app reads balances and previews but cannot simulate the complete stateful
  EIP-7702 batch because Turnkey does not expose its constructed outer
  transaction. The configured gas ceiling must be calibrated from receipts.
- Turnkey Core currently polls for up to one minute. A timeout does not prove a
  transaction will never be included; inspect the Turnkey activity before
  retrying.
- USDC transfers remain subject to Circle pause and blacklist controls. Sky
  fees, operational state, and available liquidity are mutable.
- This is an end-user embedded-wallet flow. It deliberately does not implement
  an unauthenticated server route controlled by a parent organization API key.

For production, add narrowly scoped Turnkey policies, monitoring/webhooks,
rate limits, durable transaction status, stronger RPC infrastructure, and a
formal review of EIP-7702 delegation and recovery behavior.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Or run all checks with:

```bash
pnpm check
```

Unit tests cover call ordering, fee arithmetic, reverse precision, allowance
cleanup, gas-limit validation, and maximum gas-cost arithmetic.

The GitHub Actions workflow at `.github/workflows/ci.yml` runs the same check on
pushes to `main` and on pull requests. It does not require application
credentials because the production build renders the configuration state when
Turnkey identifiers are absent.

## Primary Documentation

- [Turnkey API overview](https://docs.turnkey.com/api-reference/overview/intro)
- [Broadcast EVM transaction V2](https://docs.turnkey.com/api-reference/activities/broadcast-evm-transaction)
- [Turnkey transaction management](https://docs.turnkey.com/features/transaction-management)
- [Turnkey React wallet kit setup](https://docs.turnkey.com/solutions/embedded-wallets/integration-guide/react/getting-started)
- [Turnkey Auth Proxy](https://docs.turnkey.com/features/authentication/auth-proxy)
- [Sky protocol token routes](https://developers.sky.money/quick-start/protocol-token-routes/)
- [Sky LitePSM](https://developers.sky.money/protocol/liquidity/litepsm/)
- [Sky USDS](https://developers.sky.money/protocol/tokens/usds/)
- [Sky sUSDS](https://developers.sky.money/protocol/tokens/susds/)
- [Sky mainnet Chainlog](https://chainlog.sky.money/api/mainnet/active.json)
