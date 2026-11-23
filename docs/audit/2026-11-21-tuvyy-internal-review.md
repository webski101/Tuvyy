# Tuvyy internal review

**Review period: 21 November 2026 (UTC)**

**AI-assisted internal review - NOT an external or third-party audit.**

Prepared by Devin with AI assistance for the Tuvyy project. No independent auditor, certification, or security guarantee is implied.

This is a retrospective report compiled on **22 November 2026** from repository history and PR records for 21 November. It is not a claim that this PDF existed on 21 November. Historical claims below are attributed to their records; fresh tests belong to the separate 22 November re-review.

Scope: `contracts/TuvyyDAO.sol`, `test/TuvyyDAO.t.sol`, `web/`, deployment/account/demo scripts in `scripts/`, and their configuration. Snapshot: main commit `d104f4a3472ffdd9fb5ad896db0426f37559e22c` (PR #3 merge, 21 November 21:49:04 UTC).

**Overall status: several web findings fixed; one wallet-restoration finding remains open. Contract and cross-VM limitations remain.** This is a bounded internal review, not approval for production funds.

**Update, 23 November 2026:** H-06 was fixed after this review in [PR #5](https://github.com/webski101/Tuvyy/pull/5); see the dated note under H-06. The rest of this report is unchanged.

---

## 1. Method and evidence boundaries

- Read the current source and verified historical commit metadata/diffs and PR descriptions. Read PRs #1-#3 with `git_view_pr`, and their issue-comment, review-comment, review and commit streams with `git_pr_events`; all streams reported a last page.
- PR #1 records 22 mock-bridge Foundry tests covering exact payloads, rollback, voting and receipt text. Its original description still says deployment was pending; later deployment commit `9c8b747` and checked-in deployment metadata supersede that stale description. This report does not treat the original PR description as current live state.
- PR #3 records 22/22 Foundry tests, 8/8 web tests, a web build and live-testnet browser verification of execution proof. These are historical recorded results, not newly executed tests dated 21 November by this report's author.
- Devin Review is an AI reviewer, not a third-party human audit. Its comments are evidence of review activity, not proof that all bugs were found. Severity labels below are this internal report's qualitative assessments, not CVSS scores or externally assigned ratings.
- No deployment/account/demo scripts were executed for this report. Static inspection verifies private-file/environment key loading, network checks, deployment refusal when already configured, receipt confirmation and CW20-balance checking; it does not establish all operational failure modes.

## 2. PR review trail

- [PR #1](https://github.com/webski101/Tuvyy/pull/1): Devin Review initially reported no issues at 07:19:02 UTC, then at 08:33:08 UTC recorded one fixed finding, "Development source exposed through DNS rebinding." There were no inline review comments in the fetched stream. Fix `1d93d95` restricts dev/preview hostnames.
- [PR #2](https://github.com/webski101/Tuvyy/pull/2): Devin Review at 08:49:17 UTC reported one finding left for triage. The [inline finding](https://github.com/webski101/Tuvyy/pull/2#discussion_r4651667571), "Wallet actions stay disabled after unlocking," is still present in the reviewed source; it must not be counted as fixed.
- [PR #3](https://github.com/webski101/Tuvyy/pull/3): Devin Review at 21:44:25 UTC reported no issues. Its inline-review stream was empty. The PR itself documents the RPC range bug and fix; the bug is not attributed to a Devin Review finding.

## 3. Findings and dispositions

### H-01: Broad Vite host access / DNS-rebinding exposure

Severity: **Medium**, development-server exposure. Status: **Fixed** in `1d93d95094f553d3a3257bdea5d784ef58122580` (PR #1).

The recorded AI review identified development source exposure through DNS rebinding. `web/vite.config.ts` now supplies an explicit allowed-host list to both dev and preview, defaulting to `.preview.devinapps.com`, with `TUVYY_ALLOWED_HOSTS` configuration. This is not authentication; operators must keep the list restricted. The historical review says arbitrary Host requests returned 403. No new attack simulation is claimed here.

### H-02: Browser Native REST requests failed because of CORS

Severity: **Low**, UI availability. Status: **Fixed** in `a223154057c8bd9faeb382f1a71e5c4ae47ba5fe`, with Vercel rewrite in `53e723d188f0ca632010a110286de999fae2161d` (PR #1).

Browser requests use the same-origin `/qore-api` base. Dev and preview proxy upstream REST requests; `web/vercel.json` provides a static-host rewrite. A different static host still needs an equivalent rewrite. The fix is recorded in commits; it is not presented as a separate inline reviewer finding.

### H-03: Receipts and execution proof were difficult to verify

Severity: **Low**, presentation/provenance. Status: **Fixed** in `88f10e8361645bbb9db4d4b36a94d80307927849` (PR #1).

Human-unit QOR/WDT display retains raw notes. Executed-event bytes supply receipt IDs for per-ID queries. Association requires the DAO Native sender and exact proposal-note prefix. Explorer links use an indexed Cosmos transaction, with block fallback. Inline receipts and accessible disabled-action reasons are included. Receipt text alone remains insufficient evidence of payment.

### H-04: Unbounded Executed-log range rejected by RPC

Severity: **Low**, proof availability. Status: **Fixed** in `bf06ecbdf5c884e2a2fdaebc9c68447c44cbe38b`, merged in PR #3 as `d104f4a`.

PR #3 records "Missing or invalid parameters" when the deployment-to-latest query exceeded QoreChain's 10,000-block RPC limit. `web/src/logs.ts` now searches inclusive windows of at most 10,000 blocks, stopping at the first non-removed matching event. Tests cover more than 100,000 blocks, chunk boundaries, empty ranges and RPC errors. No maximum total history is hard-coded.

### H-05: Wallet disconnect and empty-account UX

Severity: **Low**, usability. Status: **Implemented** in `20a1f54`, with passive-empty correction in `56f6629`; PR #2 merge `6f7d779`.

Explicit disconnect clears app wallet state, persists an opt-out, skips passive reconnect while opted out and attempts permission revocation best-effort. An empty explicit account request is announced. A first-time visitor's passive empty account result stays quiet. The PR records mock-provider browser checks, not live signing. This does not resolve H-06.

### H-06: Same-network wallet unlock leaves actions disabled

Severity: **Low**, UI availability. Status: **Open**, reported in PR #2; no fix commit identified in main snapshot `d104f4a`.

`updateAccounts([])` clears `chainId`; `accountsChanged([account])` restores only accounts and does not request the current chain. If unlocking emits no `chainChanged`, `canAct` stays false. Clicking the connected-account / Connect control re-queries the network as a workaround. The 22 November re-review reproduces this sequence with a mock provider. It is not a contract authorization bypass. Remediation should re-query chain ID on restored accounts with stale-response/disconnect guards and a regression test.

**Update, 23 November 2026:** Fixed after this review in [PR #5](https://github.com/webski101/Tuvyy/pull/5) (`7580f91`). When `accountsChanged` delivers a non-empty account list, the UI now re-queries `eth_chainId`; a reply is discarded if a newer `chainChanged` event or query superseded it, or if the user disconnected. `web/wallet.test.ts` covers the reported sequence, the wrong-network case and the stale/disconnect guards, and the sequence was re-run in headless Chrome with a mock provider: actions re-enable without reconnecting. Not exercised with a real wallet or live signing. The text above is left as written on the review date.

### H-07: Leftover test proposal was indistinguishable from demo history

Severity: **Informational**, presentation. Status: **Fixed** in `ce2b0b1` (PR #3).

Deployment config lists test proposal IDs; proposal #2 remains visible with a Test badge and closed-test description. No on-chain history was removed or changed.

## 4. Contract and operational limits

The immutable owner controls current membership; votes are not based on a membership snapshot. Fixed quorum can become unreachable after removals. The bridge and allowlisted Native contracts are trusted dependencies. Address checks restrict prefix/length/alphabet, not Bech32 checksum. Solidity receipt text truncation is byte-aware but is not arbitrary UTF-8 validation. Bridge success data is not a full semantic receipt validation inside Solidity.

Repository deployment records document a native-QOR payout and receipt #3 from the DAO Native identity. They do not establish a live funded WDT payout or live bridge-failure rollback. Mock tests establish EVM/mock rollback only. No independent audit, formal verification or production-security certification is claimed.

## 5. Source references

- Main merges: `a66a406` (PR #1), `6f7d779` (PR #2), `d104f4a` (PR #3); historical component commits are listed above and in PR commit streams.
- `contracts/TuvyyDAO.sol`; `test/TuvyyDAO.t.sol`; `scripts/common.ts`, `account.ts`, `deploy.ts`, `demo.ts`.
- `web/vite.config.ts`, `web/vercel.json`, `web/src/main.tsx`, `presentation.ts`, `logs.ts` and web tests.
- `config/deployments.json`, repository README and `docs/audit/README.md`.

**AI-assisted internal review only - NOT an external or third-party audit.**
