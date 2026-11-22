# Tuvyy contract re-review

**Review date: 22 November 2026 (UTC)**

**AI-assisted internal review - NOT an external or third-party audit.**

Performed by Devin with AI assistance for Tuvyy. This report is not an independent auditor's opinion, certification, or guarantee that the contract is safe.

Fresh static re-read and local test execution performed on 22 November 2026. Baseline: `d104f4a3472ffdd9fb5ad896db0426f37559e22c`. Scope: all of `contracts/TuvyyDAO.sol`, its Foundry tests, bridge assumptions and deployment metadata; limited follow-up of the PR #2 wallet finding. The deployed Solidity contract was **not changed or redeployed**. No signing or chain writes were performed.

**Result:** 22 Foundry tests pass. No new critical/high contract issue was identified by this bounded review. This does not establish absence of vulnerabilities. Accepted design constraints and unverified cross-VM behavior are listed explicitly below; H-06 remains open.

---

## 1. Method and threat model

Re-read the constructor, `setMember`, `propose`, `vote`, `execute`, `_callNative`, `_checkQor`, `_decimal`, `_truncate` and `_escape`. Trace authorization and failure propagation against malicious/reverting/reentrant recipients, arbitrary proposal text, double voting/execution, timing boundaries and bridge failure. Cross-check the 22 example-based tests and the prior PR review record. No fuzzing, formal proof, adversarial live bridge test or independent bytecode-equivalence analysis was performed.

The immutable owner is trusted to manage membership. Members authorize treasury spending through votes. Anyone may execute a passed, closed proposal. External dependencies include QoreChain's precompile, CW20/receipt contracts, sender mapping and synchronous cross-VM rollback. Read-only deployment metadata is not a new live-state attestation.

## 2. Fresh code-path assessment

### Access control and voting

`setMember` is owner-only and rejects zero address. `propose` and `vote` require current membership. The constructor deduplicates initial members and requires a nonzero voting period/quorum with quorum no greater than the unique initial member count. Proposal amounts must be positive; notes are capped at 512 bytes. Native zero/self recipients are rejected; CW20 recipient text passes `_checkQor`.

Voting rejects unknown IDs, repeated votes and `block.timestamp >= deadline`. Execution is allowed at the deadline, but only when `yes > no`, `yes >= quorum` and not already executed. Thus ties, early execution and insufficient yes votes fail. Quorum means required yes votes, not total turnout. Existing tallies survive membership changes; this is not snapshot governance.

### Reentrancy and execution ordering

`execute` checks the global `executing` guard, then sets both `executing` and the proposal's `executed` flag before external calls. The guard prevents recursive execution of the same or a different proposal. It is not a blanket guard on every contract function: other governance methods retain their membership/owner gates. The same-ID reentrant-recipient test passes; cross-proposal reentry was assessed from the common guard, not covered by a separate test.

CW20 payout calls WDT through the bridge before recording a receipt. Native payout uses a value-bearing low-level call, verifies its success, and then records a receipt. A reverting recipient or insufficient treasury causes `PayoutFailed`. The guard resets and `Executed` emits only after the receipt call returns successfully. Reverts restore Solidity state and EVM/mock transfers. Native-side rollback under real failure remains a bridge assumption not tested live in this re-review.

### JSON escaping and truncation

Amounts and proposal IDs are decimal encoded. `_checkQor` restricts characters that could escape the CW20 recipient JSON string. `_escape` escapes quotes, backslashes and control bytes as JSON. `_truncate` limits the unescaped receipt summary to 140 bytes and avoids cutting a UTF-8 continuation sequence for well-formed input. Escaped JSON can be longer than 140 bytes on the wire; the decoded note is what is capped.

The contract accepts Solidity strings without full UTF-8 validation. A member can supply malformed UTF-8 that survives `_truncate`/`_escape` and may be rejected by an external JSON decoder. That external rejection was not executed here. This is an availability/validation limitation for an authorized proposal, not a demonstrated theft path.

### Bridge return handling

`_callNative` propagates a failed low-level call as `BridgeFailed` and rejects zero-length raw return data as `BridgeInactive`. For a return of at least 64 bytes whose first word is offset 32, it ABI-decodes `bytes`; otherwise it returns raw bytes. Malformed ABI data can revert (fail closed). A successful ABI-encoded empty `bytes` result is allowed, which is relevant to CW20-style empty responses.

The helper does not semantically verify arbitrary nonempty bridge return data or parse the receipt JSON on-chain. Correct bridge address/behavior remains a trust assumption. The web UI subsequently decodes the event's receipt ID, queries it per ID and checks DAO sender and proposal prefix. No new claim about live WDT return encoding is made.

## 3. Fresh test and coverage results

Commands executed on 22 November 2026 in the repository root, with Foundry 1.10.0, configured Solidity 0.8.24, Paris EVM and optimizer settings from `foundry.toml`:

```text
forge test
22 tests passed, 0 failed, 0 skipped (22 total tests)

forge coverage
22 tests passed, 0 failed, 0 skipped (22 total tests)
contracts/TuvyyDAO.sol:
Lines       96.58% (113/117)
Statements  94.94% (169/178)
Branches    83.33% (30/36)
Functions   92.31% (12/13)
```

**Coverage qualification:** `forge coverage` exited successfully but repeatedly warned `Could not find anchor: No matching instruction in range`. Foundry is installed and the repository tool configuration was inspected; these are coverage source-map/anchor warnings, not missing dependencies. The percentages above are the tool's provisional reported metrics, not independently validated completeness guarantees. No settings were changed to inflate coverage, and test-file coverage is not substituted for contract coverage.

The suite covers exact CW20/native payloads, native balances, receipt-failure rollback for native/mock-CW20 payouts, payout-bridge failure, inactive bridge, double execution/voting, unauthorized member actions, early/late timing, tie/quorum failures, insufficient/rejected native payments, reentrant execution, escaping, truncation including multibyte boundaries, empty notes and membership/invalid inputs. The existing audit README maps all 22 test names. There is no fuzz/invariant suite, malformed-return matrix or live cross-VM failure test in this evidence set.

## 4. Findings, accepted constraints and follow-up

Severity is an internal qualitative judgment, not an external rating. "Accepted" below means retained and disclosed under the instruction not to change the deployed contract; it is not an independent risk sign-off or an assertion of production suitability.

### C-01: Mutable membership with fixed quorum

Severity: **Informational governance constraint**. Status: **Known/retained**. `setMember` can remove enough members to make quorum unreachable. Old votes remain counted and membership is checked at vote time, not snapshotted. Already documented in `docs/audit/README.md`; not a newly discovered exploit. Rationale: owner-managed prototype governance. Operational control: keep enough active members; use a newly reviewed design/deployment if snapshot governance or quorum adjustment is required.

### C-02: Address and UTF-8 validation are partial

Severity: **Low availability / input validation**. Status: **Known/retained**; UTF-8 execution impact is newly detailed here, not reproduced against Native. `_checkQor` does not validate Bech32 checksum, and string handling does not establish arbitrary UTF-8 validity. Bad values may leave a voted proposal unexecutable if Native rejects them. Rationale: downstream validation plus transaction rollback prevents partial payout; this is not a guarantee of proposal liveness. The UI checks address checksum, but direct callers bypass it. Do not submit malformed text or addresses; future remediation requires a separately reviewed contract change.

### C-03: Bridge success and Native rollback are trusted

Severity: **Informational trust boundary / unverified integration**. Status: **Known/retained**. No full semantic return verification is performed on-chain; the fixed bridge is a trust anchor. The local suite exercises an ABI-returning mock, not all raw/ABI/malformed return forms. Real WDT payout and failing cross-VM rollback remain unverified per repository records. Rationale: no deployed-contract change authorized, and existing native demo evidence does not substitute for these missing tests. Prioritize integration and return-format tests before using real treasury funds.

### H-06 follow-up: Wallet restore remains open

Severity: **Low UI availability**. Status: **Open**, originally reported in PR #2 at [the review thread](https://github.com/webski101/Tuvyy/pull/2#discussion_r4651667571).

Reproduced now in Chrome through a pre-mount mock EIP-1193 provider: connect on Diana, emit `accountsChanged([])`, restore the same account without `chainChanged`. The account returns but the UI displays "Switch network" and disables create; code's `canAct` also gates voting/execution on the missing chain ID. This confirms reachability for a provider that emits that sequence, not every real wallet. Clicking Connect/the account control re-queries chain ID. Left unchanged as an existing nontrivial wallet-lifecycle issue outside this documentation/favicon change. No new contract vulnerability was inferred from it.

## 5. Deployment inventory from checked-in config

These values are copied from `config/deployments.json` at baseline `d104f4a`; bytecode, current balances and live liveness were not independently re-attested in this task.

- Network: QoreChain Diana testnet; EVM chain ID `9800`.
- DAO EVM: `0xa2a86e88a90045de4fa5edf5dddca4b722cb9ef0`.
- DAO Native: `qor1525xaz9fqpzauna9ah6amh9yku3vh8hs72ag5s`.
- Bridge: `0x0000000000000000000000000000000000000901`.
- WDT: `qor14hj2tavq8fpesdwxxcu44rty3hh90vhujrvcmstl4zr3txmfvw9s93uuqt`.
- Receipts: `qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8`.
- Deployer EVM: `0x506E07d8Ad1445AeF16Aba109c47652290a64497`.
- Deployer Native: `qor12phq0k9dz3z6aut2hggfc3m9y2g2v3yheaxg4y`.
- Configured demo: native proposal #1, receipt #3, execution block `10483018`; quorum 1 and voting period 60 seconds.

## 6. Conclusion and exclusions

No contract change, redeployment or fund movement was made. This source-level re-review found no new critical/high issue within its limited scope, but does not prove safety. Address/UTF-8 checks, governance liveness, bridge semantics, WDT integration, malformed-return coverage and live atomic failure behavior remain explicit constraints or follow-up work. An independent external audit is still not claimed. See the 21 November retrospective report for fixed web findings and the unresolved review history.

**AI-assisted internal review only - NOT an external or third-party audit.**
