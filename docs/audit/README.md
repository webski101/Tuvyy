# Tuvyy security review notes

## Scope and threat model

Scope: [`contracts/TuvyyDAO.sol`](../../contracts/TuvyyDAO.sol), with regression evidence in [`test/TuvyyDAO.t.sol`](../../test/TuvyyDAO.t.sol). These are project review notes, **not an external audit** or a production-readiness claim.

Assume untrusted callers, malicious payout recipients (including reverting/reentrant contracts), arbitrary proposal text, and bridge failures. Members can propose/vote; only the immutable owner can change membership; anyone can execute an eligible proposal. The owner and members are governance trust assumptions: membership changes are not snapshotted per proposal, and removing members can make the fixed quorum unreachable. The bridge and allowlisted Native contracts are external dependencies; their correctness, chain-level rollback and sender mapping are not implemented by this Solidity contract. RPC/REST availability and the web UI are not consensus security boundaries.

## Invariants and implementation evidence

- `execute` requires a valid, unexecuted proposal, elapsed deadline, `yes > no`, and `yes >= quorum`. `vote` requires current membership and rejects repeat/late votes.
- `executing = true` and `p.executed = true` are set **before** payout/bridge calls. The `executing` guard rejects recursive execution, including attempts to execute another proposal.
- Native payout failure, bridge failure, or an empty bridge return reverts. Payout precedes the receipt call in the same transaction; failures revert the executed flag and EVM payout/mock CW20 state in tests. Actual cross-VM rollback relies on QoreChain's synchronous bridge; a live failing transaction has not been exercised (see repository README).
- The receipt summary includes proposal ID, asset kind and raw amount. `_truncate` caps the decoded summary at 140 bytes without cutting a UTF-8 continuation sequence; `_escape` escapes quotes, backslashes and control bytes for JSON. Proposal notes are limited to 512 bytes. This is not general UTF-8 validation of arbitrary Solidity strings.
- `_checkQor` restricts Native address prefix, length and alphabet, preventing JSON string injection; it does not verify Bech32 checksums. The UI also checks the checksum, but callers can bypass it.
- Native calls originate from the DAO contract, so the bridge represents the sender as the DAO's Native address, not the executor's wallet. This mapping is a chain dependency, not a Solidity-enforced invariant. [`config/deployments.json`](../../config/deployments.json) and the [live receipt evidence](../../README.md#network-and-addresses) record DAO `qor1525xaz9fqpzauna9ah6amh9yku3vh8hs72ag5s` as receipt #3's sender. The UI additionally checks receipt sender, exact proposal-note prefix and event-derived receipt ID before association.

## Foundry regression coverage (22 tests)

Run `forge test` from the repository root. `MockBridge` is installed at `0x901` with `vm.etch`; these are deterministic unit tests, not live bridge tests.

| Tests | Coverage |
| --- | --- |
| `testCW20HappyExactPayloads`, `testNativeHappyExactPayload` | Exact transfer/record JSON, targets, native balances, successful execution; CW20 execution by a non-member |
| `testReceiptFailureRevertsNativePayout`, `testReceiptFailureRevertsCW20Payout`, `testPayoutBridgeFailure` | Rollback on receipt/payout failure, executed flag reset, native retry after failure |
| `testDoubleExecute`, `testNonMemberVoteAndPropose`, `testDoubleVote` | No double execution/voting; membership authorization |
| `testEarlyExecute`, `testTiedVoteCannotExecute`, `testNoVotesFailsQuorum`, `testYesMajorityBelowQuorum`, `testLateVote` | Deadline, majority and quorum gates |
| `testInsufficientTreasury`, `testRejectedNativePayment`, `testReentrantExecutionRejected` | Insufficient funds, reverting recipient, rejected reentrant execution |
| `testEscaping`, `testTruncation`, `testUnicodeTruncation`, `testEmptyNote` | JSON escaping, 140-byte truncation, multibyte boundary and empty text |
| `testMembershipAndInvalidInputs`, `testInactiveBridge` | Owner-only membership updates, malformed/zero inputs, invalid proposal ID, inactive bridge rejection |

## Previously addressed web review findings

- **REST CORS:** browser calls use same-origin `/qore-api`; [`web/vite.config.ts`](../../web/vite.config.ts) proxies dev and preview requests. [`web/vercel.json`](../../web/vercel.json) provides the production rewrite. Other static hosts need an equivalent rewrite; configuring a direct REST origin still requires that origin to support CORS.
- **Vite allowedHosts / DNS rebinding:** dev and preview use an explicit hostname allowlist, not `allowedHosts: true`. The default is `.preview.devinapps.com`; `TUVYY_ALLOWED_HOSTS` can supply a comma-separated list. Keep this list restricted and do not expose a dev server as a production service. This limits host-based access; it is not authentication or a comprehensive DNS-rebinding audit.

## Known limitations

- The documented live demo covers a native-QOR payout and receipt only. A funded WDT payout and live failure rollback remain unverified; CW20 tests use a mock bridge.
- No independent external audit, formal verification or fuzz/invariant test suite is claimed. The current Foundry suite contains the 22 example-based tests above.
- Receipt notes alone are not proof of payment: verify the successful DAO execution and Native sender identity. External bridge/Native contracts, RPC services, wallet authorization windows and governance remain trust/availability dependencies.
