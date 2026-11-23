# Tuvyy internal review reports

**These are AI-assisted internal reviews, NOT an external or third-party audit.** No independent auditor, certification, formal proof or production-security assurance is claimed. Devin's automated PR reviews are not independent human audits.

## Reports

- [21 November 2026 internal review (PDF)](audit/2026-11-21-tuvyy-internal-review.pdf) - [Markdown source](audit/2026-11-21-tuvyy-internal-review.md). Retrospective of that day's source/PR history, compiled on 22 November; not a backdated assertion that a report existed then.
- [22 November 2026 contract re-review (PDF)](audit/2026-11-22-tuvyy-contract-rereview.pdf) - [Markdown source](audit/2026-11-22-tuvyy-contract-rereview.md). Fresh manual source review, 22 passing Foundry tests, qualified coverage and known limitations.
- [Existing scope, threat model and 22-test inventory](audit/README.md).
- 23 November 2026 update: H-06 fixed in [PR #5](https://github.com/webski101/Tuvyy/pull/5). Both dated reports keep their original findings and carry a dated update note; no new review report was produced for this change.

Baseline reviewed: `d104f4a3472ffdd9fb5ad896db0426f37559e22c`. Contract and deployment are unchanged by these reports and by the 23 November web fix. Deployment addresses are listed in the second report from `config/deployments.json`, not newly attested live.

## Findings/status summary

Severity is an internal qualitative assessment. Retained contract constraints are disclosed under the instruction not to modify the deployed contract, not externally approved risk acceptances.

| ID | Finding / constraint | Severity | Status and evidence |
| --- | --- | --- | --- |
| H-01 | Vite broad hosts / DNS rebinding | Medium, dev-server exposure | Fixed `1d93d95`, PR #1 review records fix |
| H-02 | Native REST CORS failure | Low, UI availability | Fixed `a223154`; Vercel rewrite `53e723d` |
| H-03 | Raw receipt units / weak proof navigation | Low, presentation | Fixed `88f10e8`; event ID, sender and prefix checks |
| H-04 | Executed log range exceeds RPC limit | Low, proof availability | Fixed `bf06ecb`, PR #3 / merge `d104f4a` |
| H-05 | Disconnect / empty-account UX | Low, usability | Implemented `20a1f54`; passive-empty correction `56f6629` |
| H-06 | Account restored without restoring chain ID | Low, UI availability | Fixed `7580f91`, PR #5 (23 November); chain ID re-queried when accounts return; `web/wallet.test.ts` and mock-provider browser check, not a live wallet |
| H-07 | Test proposal not distinguished | Informational | Fixed `ce2b0b1`; proposal #2 remains visible |
| C-01 | Mutable membership / fixed quorum | Governance constraint | Known/retained; owner trust and possible quorum deadlock |
| C-02 | Partial address / UTF-8 validation | Low, availability | Known/retained; malformed UTF-8 Native rejection not live-reproduced |
| C-03 | Bridge semantics / rollback trust | Trust boundary | Known/retained; real WDT payout and failing cross-VM rollback unverified |

The PR #2 finding (H-06) stayed listed as open until PR #5 fixed it on 23 November 2026; the dated reports record it as open on their review dates. Sources: [PR #1](https://github.com/webski101/Tuvyy/pull/1), [PR #2 finding](https://github.com/webski101/Tuvyy/pull/2#discussion_r4651667571), [PR #3](https://github.com/webski101/Tuvyy/pull/3), [PR #5](https://github.com/webski101/Tuvyy/pull/5), repository commits and commands described in the reports. No additional findings were present in the fetched review streams for PRs #1 and #3 beyond those described; AI review "no issues" responses are not completeness guarantees.

## H-06 regression check

From the repository root after `npm ci`:

```sh
node --test web/*.test.ts
```

`web/wallet.test.ts` replays the reported sequence against a mock provider: connect on Diana, `accountsChanged([])`, then the same account restored with no `chainChanged`. It asserts that the chain ID is re-read and actions are allowed again without reconnecting, that a wrong network still blocks actions, and that stale or post-disconnect replies are ignored. The same sequence was run in headless Chrome against the web UI with an injected mock EIP-1193 provider. Neither check uses a real wallet or signs a transaction.

## Reproduce PDF generation

Use an isolated Python environment with `reportlab`, `markdown` and (for page images) `pymupdf` installed. These are documentation tools, not application dependencies. From the repository root:

```sh
python docs/audit/generate_reports.py --image-dir /home/ubuntu/screenshots
```

The generator reads the two dated Markdown sources and writes the adjacent PDFs and optional page-1 PNGs. Cover dates distinguish retrospective review period from compilation date. The covers and footers explicitly identify the reviews as internal and AI-assisted. PDF generation is not a security verification step.
