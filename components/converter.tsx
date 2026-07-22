"use client";

import {
  AuthState,
  ClientState,
  WalletSource,
  useTurnkey,
} from "@turnkey/react-wallet-kit";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from "react";
import {
  getAddress,
  isAddress,
  maxUint256,
  type Address,
} from "viem";

import {
  CONTRACTS,
  ETHEREUM_CAIP2,
  ETHEREUM_CHAIN_ID,
  psmWrapperAbi,
  susdsAbi,
} from "@/lib/contracts";
import {
  buildDepositCalls,
  buildRedeemCalls,
  formatTokenAmount,
  maxUsdcForUsds,
  parseTokenAmount,
  quoteUsdcToUsds,
  usdsRequiredForUsdc,
  type ConversionQuote,
  type Direction,
  type TurnkeyCall,
} from "@/lib/conversion";
import { ethereumClient } from "@/lib/ethereum";
import {
  maximumGasCost,
  resolveNonSponsoredBatchGasLimit,
} from "@/lib/gas";
import {
  skyConversion,
  type SkyConversionOverview,
} from "@/lib/sky-conversion";

const SPONSOR_TRANSACTIONS =
  process.env.NEXT_PUBLIC_TURNKEY_SPONSOR_TRANSACTIONS === "true";
const MAINNET_TRANSACTIONS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS === "true";
const NON_SPONSORED_BATCH_GAS_LIMIT = resolveNonSponsoredBatchGasLimit(
  process.env.NEXT_PUBLIC_NON_SPONSORED_BATCH_GAS_LIMIT,
);

type ProtocolSnapshot = {
  owner: Address;
  ethBalance: bigint;
  tin: bigint;
  tout: bigint;
  live: bigint;
};

type QuoteState = {
  direction: Direction;
  input: string;
  quote: ConversionQuote;
};

type Submission =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "polling"; statusId: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

const DEPOSIT_STEPS = [
  "Approve USDC",
  "Convert to USDS",
  "Approve USDS",
  "Deposit into sUSDS",
];

const REDEEM_STEPS = [
  "Redeem sUSDS",
  "Approve USDS",
  "Convert to USDC",
  "Clear allowance",
];

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong while preparing the transaction.";
}

function shortenAddress(address: string, size = 5): string {
  return `${address.slice(0, size + 2)}...${address.slice(-size)}`;
}

function TokenMark({ token }: { token: "USDC" | "USDS" | "sUSDS" }) {
  return (
    <span className={`token-mark token-mark-${token.toLowerCase()}`}>
      {token === "sUSDS" ? "S" : token.slice(0, 1)}
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="5.5" width="7" height="7" rx="1" />
      <path d="M3.5 10.5h-1v-7a1 1 0 0 1 1-1h7v1" />
    </svg>
  );
}

function BatchReview({
  calls,
  direction,
  inputLabel,
  outputLabel,
  onCancel,
  onConfirm,
  submission,
}: {
  calls: TurnkeyCall[];
  direction: Direction;
  inputLabel: string;
  outputLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  submission: Submission;
}) {
  const steps = direction === "deposit" ? DEPOSIT_STEPS : REDEEM_STEPS;
  const pending =
    submission.phase === "submitting" || submission.phase === "polling";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        aria-labelledby="review-title"
        aria-modal="true"
        className="review-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="review-heading">
          <div>
            <p className="eyebrow">Turnkey V2 batch</p>
            <h2 id="review-title">Review atomic conversion</h2>
          </div>
          <button
            aria-label="Close review"
            className="close-button"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            x
          </button>
        </div>

        <div className="review-amounts">
          <div>
            <span>You send</span>
            <strong>{inputLabel}</strong>
          </div>
          <span className="review-arrow">-&gt;</span>
          <div>
            <span>Estimated receipt</span>
            <strong>{outputLabel}</strong>
          </div>
        </div>

        <div className="review-call-list">
          {calls.map((_, index) => (
            <div className="review-call" key={steps[index]}>
              <span className="step-index">{index + 1}</span>
              <strong>{steps[index]}</strong>
            </div>
          ))}
        </div>

        <div className="review-network">
          <span>Network</span>
          <strong>Ethereum mainnet</strong>
          <span>Gas</span>
          <strong>
            {SPONSOR_TRANSACTIONS ? "Sponsored by Turnkey" : "Paid by wallet"}
          </strong>
          <span>Outer gas limit</span>
          <strong>
            {SPONSOR_TRANSACTIONS
              ? "Turnkey managed"
              : NON_SPONSORED_BATCH_GAS_LIMIT.toString()}
          </strong>
        </div>

        {submission.phase === "error" ? (
          <p className="inline-error" role="alert">
            {submission.message}
          </p>
        ) : null}

        <button
          className="primary-button confirm-button"
          disabled={pending}
          onClick={onConfirm}
          type="button"
        >
          {submission.phase === "submitting"
            ? "Authorizing batch..."
            : submission.phase === "polling"
              ? "Waiting for inclusion..."
              : `Confirm ${calls.length} calls`}
        </button>
        <p className="review-footnote">
          Calls execute in order. If any call fails, the entire EIP-7702 batch
          reverts.
        </p>
      </section>
    </div>
  );
}

export function Converter() {
  const {
    authState,
    clientState,
    createWallet,
    ethSendTransaction,
    handleLogin,
    logout,
    pollTransactionStatus,
    wallets,
  } = useTurnkey();

  const [direction, setDirection] = useState<Direction>("deposit");
  const [input, setInput] = useState("");
  const deferredInput = useDeferredValue(input);
  const [loadedOverview, setOverview] = useState<SkyConversionOverview | null>(
    null,
  );
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [loadedSnapshot, setSnapshot] = useState<ProtocolSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ phase: "idle" });
  const [walletError, setWalletError] = useState<string | null>(null);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  const embeddedAccount = wallets
    .filter((wallet) => wallet.source === WalletSource.Embedded)
    .flatMap((wallet) => wallet.accounts)
    .find((account) => account.addressFormat === "ADDRESS_FORMAT_ETHEREUM");
  const accountAddress =
    embeddedAccount && isAddress(embeddedAccount.address)
      ? getAddress(embeddedAccount.address)
      : null;
  const snapshot =
    loadedSnapshot?.owner === accountAddress ? loadedSnapshot : null;
  const overview =
    loadedOverview?.walletAddress === accountAddress ? loadedOverview : null;

  useEffect(() => {
    if (!accountAddress) return;

    const address = accountAddress;
    const controller = new AbortController();
    let cancelled = false;

    async function loadOverview() {
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        const nextOverview = await skyConversion.getOverview(address, {
          signal: controller.signal,
        });
        if (!cancelled) setOverview(nextOverview);
      } catch (error) {
        if (!cancelled) {
          setOverview(null);
          setOverviewError(formatError(error));
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    }

    void loadOverview();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accountAddress, refreshKey]);

  useEffect(() => {
    if (!accountAddress) return;

    const address = accountAddress;
    let cancelled = false;

    async function loadSnapshot() {
      setSnapshotLoading(true);
      setSnapshotError(null);
      try {
        const [
          chainId,
          ethBalance,
          tin,
          tout,
          live,
        ] = await Promise.all([
          ethereumClient.getChainId(),
          ethereumClient.getBalance({ address }),
          ethereumClient.readContract({
            address: CONTRACTS.usdsPsmWrapper,
            abi: psmWrapperAbi,
            functionName: "tin",
          }),
          ethereumClient.readContract({
            address: CONTRACTS.usdsPsmWrapper,
            abi: psmWrapperAbi,
            functionName: "tout",
          }),
          ethereumClient.readContract({
            address: CONTRACTS.usdsPsmWrapper,
            abi: psmWrapperAbi,
            functionName: "live",
          }),
        ]);

        if (chainId !== ETHEREUM_CHAIN_ID) {
          throw new Error(
            `The configured RPC returned chain ${chainId}; Ethereum mainnet (1) is required.`,
          );
        }

        if (!cancelled) {
          setSnapshot({
            owner: address,
            ethBalance,
            tin,
            tout,
            live,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSnapshot(null);
          setSnapshotError(formatError(error));
        }
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [accountAddress, refreshKey]);

  useEffect(() => {
    if (!snapshot || !accountAddress) return;

    const currentSnapshot = snapshot;
    let cancelled = false;

    async function loadQuote() {
      setQuoteError(null);
      try {
        const routeFee =
          direction === "deposit"
            ? currentSnapshot.tin
            : currentSnapshot.tout;
        if (currentSnapshot.live !== 1n || routeFee === maxUint256) {
          setQuoteState(null);
          return;
        }

        const decimals = direction === "deposit" ? 6 : 18;
        const inputAmount = parseTokenAmount(deferredInput, decimals);

        if (inputAmount === 0n) {
          if (!cancelled) {
            setQuoteState(null);
            setQuoteLoading(false);
          }
          return;
        }

        setQuoteLoading(true);

        if (direction === "deposit") {
          const { usdsAmount, feeAmount } = quoteUsdcToUsds(
            inputAmount,
            currentSnapshot.tin,
          );
          const outputAmount = await ethereumClient.readContract({
            address: CONTRACTS.susds,
            abi: susdsAbi,
            functionName: "previewDeposit",
            args: [usdsAmount],
          });

          if (!cancelled) {
            setQuoteState({
              direction,
              input: deferredInput,
              quote: {
                direction,
                inputAmount,
                usdsAmount,
                outputAmount,
                feeAmount,
              },
            });
          }
        } else {
          const usdsAmount = await ethereumClient.readContract({
            address: CONTRACTS.susds,
            abi: susdsAbi,
            functionName: "previewRedeem",
            args: [inputAmount],
          });
          const outputAmount = maxUsdcForUsds(
            usdsAmount,
            currentSnapshot.tout,
          );
          const usdsRequired = usdsRequiredForUsdc(
            outputAmount,
            currentSnapshot.tout,
          );

          if (!cancelled) {
            setQuoteState({
              direction,
              input: deferredInput,
              quote: {
                direction,
                inputAmount,
                usdsAmount,
                usdsRequired,
                outputAmount,
                dustAmount: usdsAmount - usdsRequired,
              },
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          setQuoteState(null);
          setQuoteError(formatError(error));
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }

    void loadQuote();
    return () => {
      cancelled = true;
    };
  }, [accountAddress, deferredInput, direction, snapshot]);

  const quoteIsCurrent =
    quoteState?.input === input && quoteState.direction === direction;
  const quote = snapshot && quoteIsCurrent ? quoteState.quote : null;
  const inputDecimals = direction === "deposit" ? 6 : 18;
  const directionOverview = overview
    ? direction === "deposit"
      ? overview.directions.usdcToSusds
      : overview.directions.susdsToUsdc
    : null;
  const inputToken =
    directionOverview?.inputAsset ??
    (direction === "deposit" ? "USDC" : "sUSDS");
  const outputToken =
    directionOverview?.outputAsset ??
    (direction === "deposit" ? "sUSDS" : "USDC");
  const inputBalance = directionOverview
    ? parseTokenAmount(
        directionOverview.inputBalance.useMaxText,
        inputDecimals,
      )
    : null;
  const calls =
    quote && accountAddress
      ? quote.direction === "deposit"
        ? buildDepositCalls({
            owner: accountAddress,
            usdcAmount: quote.inputAmount,
            usdsAmount: quote.usdsAmount,
          })
        : buildRedeemCalls({
            owner: accountAddress,
            susdsAmount: quote.inputAmount,
            usdsRequired: quote.usdsRequired,
            usdcAmount: quote.outputAmount,
          })
      : [];

  const insufficientBalance =
    quote && inputBalance !== null ? quote.inputAmount > inputBalance : false;
  const outputTooSmall = quote ? quote.outputAmount === 0n : false;
  const psmHalted = directionOverview?.availability.status === "halted";
  const missingGas = snapshot
    ? !SPONSOR_TRANSACTIONS && snapshot.ethBalance === 0n
    : false;

  let actionLabel = "Enter an amount";
  let actionDisabled = true;

  if (psmHalted) {
    actionLabel = directionOverview.availability.message;
  } else if (input && (quoteLoading || !quoteIsCurrent)) {
    actionLabel = "Updating quote...";
  } else if (quoteError) {
    actionLabel = "Quote unavailable";
  } else if (insufficientBalance) {
    actionLabel = `Insufficient ${inputToken}`;
  } else if (outputTooSmall) {
    actionLabel = "Amount is too small";
  } else if (quote && !directionOverview) {
    actionLabel = overviewLoading
      ? "Loading wallet overview..."
      : "Sky Conversion unavailable";
  } else if (missingGas) {
    actionLabel = "Wallet needs ETH for gas";
  } else if (!MAINNET_TRANSACTIONS_ENABLED && quote) {
    actionLabel = "Mainnet submission is locked";
  } else if (quote && calls.length > 0 && directionOverview) {
    actionLabel = `Review ${calls.length}-call batch`;
    actionDisabled = false;
  }

  const outputLabel = quote
    ? `${formatTokenAmount(
        quote.outputAmount,
        direction === "deposit" ? 18 : 6,
        6,
      )} ${outputToken}`
    : `-- ${outputToken}`;
  const inputLabel = quote
    ? `${formatTokenAmount(quote.inputAmount, inputDecimals, inputDecimals)} ${inputToken}`
    : `0 ${inputToken}`;

  function flipDirection() {
    startTransition(() => {
      setDirection((current) =>
        current === "deposit" ? "redeem" : "deposit",
      );
      setInput("");
      setQuoteState(null);
      setSubmission({ phase: "idle" });
    });
  }

  async function makeWallet() {
    setCreatingWallet(true);
    setWalletError(null);
    try {
      await createWallet({
        walletName: "Sky Savings Wallet",
        accounts: ["ADDRESS_FORMAT_ETHEREUM"],
      });
    } catch (error) {
      setWalletError(formatError(error));
    } finally {
      setCreatingWallet(false);
    }
  }

  async function submitBatch() {
    if (!accountAddress || calls.length === 0 || !quote) return;

    try {
      setSubmission({ phase: "submitting" });
      const feeFields = SPONSOR_TRANSACTIONS
        ? {}
        : await (async () => {
            const [fees, currentEthBalance] = await Promise.all([
              ethereumClient.estimateFeesPerGas({ type: "eip1559" }),
              ethereumClient.getBalance({ address: accountAddress }),
            ]);
            const requiredBalance = maximumGasCost(
              NON_SPONSORED_BATCH_GAS_LIMIT,
              fees.maxFeePerGas,
            );

            if (currentEthBalance < requiredBalance) {
              throw new Error(
                `The wallet needs at least ${formatTokenAmount(requiredBalance, 18, 6)} ETH to reserve this batch's maximum gas cost.`,
              );
            }

            return {
              gasLimit: NON_SPONSORED_BATCH_GAS_LIMIT.toString(),
              maxFeePerGas: fees.maxFeePerGas.toString(),
              maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
            };
          })();

      const statusId = await ethSendTransaction({
        transaction: {
          from: accountAddress,
          caip2: ETHEREUM_CAIP2,
          sponsor: SPONSOR_TRANSACTIONS,
          calls,
          ...feeFields,
        },
      });

      setSubmission({ phase: "polling", statusId });
      const result = await pollTransactionStatus({
        sendTransactionStatusId: statusId,
      });

      if (result.txError || result.error) {
        throw new Error(
          result.error?.message ?? result.txError ?? "Transaction failed.",
        );
      }
      if (!result.eth?.txHash || !result.eth.txHash.startsWith("0x")) {
        throw new Error("Turnkey included the transaction without a hash.");
      }

      setSubmission({ phase: "success" });
      setReviewOpen(false);
      setInput("");
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setSubmission({ phase: "error", message: formatError(error) });
    }
  }

  async function copyAddress() {
    if (!accountAddress) return;

    try {
      await navigator.clipboard.writeText(accountAddress);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1500);
    } catch {
      setAddressCopied(false);
    }
  }

  if (clientState === undefined || clientState === ClientState.Loading) {
    return (
      <main className="loading-page">
        <span className="loading-orbit" />
        <p>Opening the secure Turnkey client...</p>
      </main>
    );
  }

  if (clientState === ClientState.Error) {
    return (
      <main className="configuration-page">
        <section className="configuration-card">
          <p className="eyebrow">Client error</p>
          <h1>Turnkey could not initialize</h1>
          <p>
            Confirm the Auth Proxy config ID and add this origin to its allowed
            origins in the Turnkey dashboard.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="header-actions">
          <span className="network-pill">
            <i /> Ethereum
          </span>
          {authState === AuthState.Authenticated && accountAddress ? (
            <button
              aria-label="Copy wallet address"
              className="address-pill"
              onClick={() => void copyAddress()}
              title={accountAddress}
              type="button"
            >
              {addressCopied ? "Copied" : shortenAddress(accountAddress)}
              <CopyIcon />
            </button>
          ) : null}
          {authState === AuthState.Authenticated ? (
            <button
              className="text-button"
              onClick={() => void logout()}
              type="button"
            >
              Log out
            </button>
          ) : null}
        </div>
      </header>

      <section className="workspace">
        {authState !== AuthState.Authenticated ? (
          <section className="converter-card setup-card">
            <div className="card-heading">
              <h2>USDC / sUSDS</h2>
              <span className="batch-chip">Mainnet</span>
            </div>
            <p>Connect a Turnkey wallet to continue.</p>
            <button
              className="primary-button convert-button"
              onClick={() =>
                void handleLogin({ title: "Open your savings wallet" })
              }
              type="button"
            >
              Log in or create wallet
            </button>
          </section>
        ) : !accountAddress ? (
          <section className="converter-card setup-card">
            <div className="card-heading">
              <h2>USDC / sUSDS</h2>
              <span className="batch-chip">Mainnet</span>
            </div>
            <p>Create the Ethereum account used for this Sky Conversion.</p>
            {walletError ? (
              <p className="inline-error" role="alert">
                {walletError}
              </p>
            ) : null}
            <button
              className="primary-button convert-button"
              disabled={creatingWallet}
              onClick={() => void makeWallet()}
              type="button"
            >
              {creatingWallet ? "Creating wallet..." : "Create Ethereum wallet"}
            </button>
          </section>
        ) : (
          <section className="converter-card">
            <div className="card-heading">
              <h2>USDC / sUSDS</h2>
              <span className="batch-chip">Atomic batch</span>
            </div>

            <div className="token-input-card">
              <div className="input-meta">
                <label htmlFor="token-amount">You send</label>
                <span>
                  Balance{" "}
                  {overviewLoading
                    ? "..."
                    : (directionOverview?.inputBalance.displayText ?? "--")}
                </span>
              </div>
              <div className="amount-row">
                <input
                  id="token-amount"
                  autoComplete="off"
                  inputMode="decimal"
                  onChange={(event) => {
                    setInput(event.target.value);
                    setSubmission({ phase: "idle" });
                  }}
                  placeholder="0.00"
                  value={input}
                />
                <div className="token-select">
                  <TokenMark token={inputToken} />
                  <strong>{inputToken}</strong>
                </div>
              </div>
              <button
                className="max-button"
                disabled={
                  overviewLoading || !directionOverview?.inputBalance.canUseMax
                }
                onClick={() => {
                  if (directionOverview) {
                    setInput(directionOverview.inputBalance.useMaxText);
                  }
                }}
                type="button"
              >
                Use max
              </button>
            </div>

            <div className="route-divider">
              <span />
              <button
                aria-label="Reverse conversion direction"
                onClick={flipDirection}
                type="button"
              >
                <ArrowIcon />
              </button>
              <span />
            </div>

            <div className="token-output-card">
              <div className="input-meta">
                <span>You receive</span>
                <span>Live vault preview</span>
              </div>
              <div className="amount-row output-row">
                <strong className={quoteLoading ? "is-loading" : ""}>
                  {quote
                    ? formatTokenAmount(
                        quote.outputAmount,
                        direction === "deposit" ? 18 : 6,
                        6,
                      )
                    : "0.00"}
                </strong>
                <div className="token-select">
                  <TokenMark token={outputToken} />
                  <strong>{outputToken}</strong>
                </div>
              </div>
            </div>

            <div className="quote-details">
              <div>
                <span>Sky Conversion fee</span>
                <strong>
                  {directionOverview?.fee.displayText ?? "--"}
                </strong>
              </div>
              <div>
                <span>Gas payment</span>
                <strong>
                  {SPONSOR_TRANSACTIONS ? "Turnkey sponsored" : "Wallet ETH"}
                </strong>
              </div>
              {quote?.direction === "redeem" && quote.dustAmount > 0n ? (
                <div>
                  <span>USDS precision dust</span>
                  <strong>{formatTokenAmount(quote.dustAmount, 18, 12)}</strong>
                </div>
              ) : null}
            </div>

            {overviewError || snapshotError || quoteError ? (
              <p className="inline-error" role="alert">
                {overviewError ?? snapshotError ?? quoteError}
              </p>
            ) : null}

            {!MAINNET_TRANSACTIONS_ENABLED ? (
              <p className="safety-note">
                Preview mode. Set{" "}
                <code>NEXT_PUBLIC_ENABLE_MAINNET_TRANSACTIONS=true</code> to
                unlock submission.
              </p>
            ) : null}

            <button
              className="primary-button convert-button"
              disabled={actionDisabled || overviewLoading || snapshotLoading}
              onClick={() => {
                setSubmission({ phase: "idle" });
                setReviewOpen(true);
              }}
              type="button"
            >
              {actionLabel}
              {!actionDisabled ? <span>-&gt;</span> : null}
            </button>

            {submission.phase === "success" ? (
              <p className="success-message" role="status">
                Batch included on Ethereum.
              </p>
            ) : null}
          </section>
        )}
      </section>

      {reviewOpen && quote ? (
        <BatchReview
          calls={calls}
          direction={direction}
          inputLabel={inputLabel}
          outputLabel={outputLabel}
          onCancel={() => {
            if (
              submission.phase !== "submitting" &&
              submission.phase !== "polling"
            ) {
              setReviewOpen(false);
            }
          }}
          onConfirm={() => void submitBatch()}
          submission={submission}
        />
      ) : null}
    </main>
  );
}
