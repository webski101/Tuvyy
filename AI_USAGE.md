# AI usage

Tuvyy was researched and implemented with Devin (an AI software-engineering assistant), following Chisom (webski101)'s requirements and design decisions.

Devin used official QoreChain documentation, live read-only Diana RPC/REST queries and the official Build Before Q-Day workshop to research cross-VM behavior. The human explicitly selected one atomic transaction with a CW20 transfer and separate receipt bridge call, or a native-QOR transfer and receipt call. This avoids misrepresenting an unavailable single-call router.

AI assistance produced the Solidity DAO, mock-based Foundry regression tests, TypeScript account/deployment/demo tooling, React interface and documentation. Account/window setup and bridge handling were adapted from the credited Apache-2.0 workshop; attribution is in README and NOTICE. No external application was copied as a finished project.

Local checks are Foundry build/tests, scripts TypeScript checking and Vite production build. Tests do not establish live chain behavior or constitute a security audit. No deployment, funded payout, PQC registration or EVM window transaction was run during implementation. UI visual verification has not been performed.

Secrets remain outside the repository. Key material is never deliberately printed by application tooling. Recovery codes are written to private files, not terminal output. Humans remain responsible for code review, funding, authorization-window policy, actual deployment, evaluating testnet results and hackathon submission.
