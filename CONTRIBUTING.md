# Contributing to AutoPilot 🚀

Thank you for your interest in contributing to **AutoPilot** — AI-powered financial automation on the Stellar Network! We welcome contributions from everyone, whether it's a bug fix, a new feature, documentation improvement, or a Soroban contract enhancement.

Please read this guide carefully before you start.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Project Architecture](#project-architecture)
- [Getting Started — Local Dev Setup](#getting-started--local-dev-setup)
  - [Prerequisites](#prerequisites)
  - [1. Clone & Install](#1-clone--install)
  - [2. Set Up Environment Variables](#2-set-up-environment-variables)
  - [3. Run the Backend](#3-run-the-backend)
  - [4. Run the Frontend](#4-run-the-frontend)
  - [5. Build & Test the Soroban Contract](#5-build--test-the-soroban-contract)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

This project adheres to our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it. Please report unacceptable behavior to the maintainers.

---

## Project Architecture

```
autopilot/
├── frontend/         # Next.js 14 app (Freighter wallet, Tailwind CSS)
├── backend/          # Fastify API + BullMQ engine + Stellar SDK
│   └── src/
│       ├── engine/   # Rule processor, Horizon stream, scheduler, queue
│       ├── stellar/  # Transaction builder, vault manager, keypair utils
│       ├── routes/   # REST API route handlers
│       ├── lib/      # DB client, engine helpers
│       └── middleware/
├── contracts/        # Soroban smart contract (Rust, soroban-sdk)
└── .github/          # CI workflows, issue & PR templates
```

**Tech Stack:**
- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, Freighter Wallet API
- **Backend:** Fastify, TypeScript, PostgreSQL (via `postgres` driver), BullMQ + Redis, Groq AI
- **Blockchain:** Stellar Network, Soroban Smart Contracts (Rust), Stellar SDK
- **Infra:** Docker, Render (backend), Vercel (frontend)

---

## Getting Started — Local Dev Setup

### Prerequisites

Make sure you have the following installed:

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >= 18 | `node --version` |
| pnpm / npm | Latest | `npm install -g pnpm` |
| Rust | Stable | `rustup install stable` |
| stellar-cli | Latest | `cargo install --locked stellar-cli` |
| Docker | Latest | For PostgreSQL + Redis |

### 1. Clone & Install

```bash
git clone https://github.com/thisisouvik/autopilot.git
cd autopilot

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2. Set Up Environment Variables

**Backend** — copy and fill in `.env`:
```bash
cd backend
cp .env.example .env
```

Key variables to configure:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/autopilot
REDIS_URL=redis://localhost:6379
AUTOPILOT_SECRET_KEY=<your-testnet-engine-keypair-secret>
AUTOPILOT_PUBLIC_KEY=<your-testnet-engine-keypair-public>
VAULT_ENCRYPTION_KEY=<32-byte-hex-string>
GROQ_API_KEY=<your-groq-api-key>
STELLAR_NETWORK=testnet
```

> **Tip:** Fund your testnet engine account for free via [Stellar Friendbot](https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY).

**Frontend** — copy and fill in `.env`:
```bash
cd frontend
cp .env.example .env
```

### 3. Run the Backend

```bash
# Start PostgreSQL and Redis via Docker
docker compose up -d postgres redis

# Run DB migrations
cd backend
npm run migrate

# Start the development server
npm run dev
```

The backend API will be available at `http://localhost:3001`.

### 4. Run the Frontend

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:3000`.

> **Note:** Install the [Freighter Wallet](https://www.freighter.app/) browser extension and switch it to **Testnet** mode.

### 5. Build & Test the Soroban Contract

```bash
# Build the contract to WASM
cd contracts
stellar contract build

# Run contract unit tests
cargo test

# Deploy to Stellar testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/contracts.wasm \
  --source <your-secret-key> \
  --network testnet
```

---

## Development Workflow

1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-number-short-description
   ```

2. **Make your changes** — keep commits small and focused.

3. **Test your changes** locally before pushing.

4. **Push** your branch and open a Pull Request.

---

## Code Style

We use the following formatters — please run them before committing:

**TypeScript (frontend & backend):**
```bash
npm run lint      # ESLint
npm run format    # Prettier
```

**Rust (contracts):**
```bash
cargo fmt
cargo clippy -- -D warnings
```

**Commit Messages:** Use [Conventional Commits](https://www.conventionalcommits.org/) format:
```
feat: add USDC payment rule support
fix: resolve race condition in deduplication check
docs: update CONTRIBUTING.md with contract build steps
contract: add engine_execute function to AutopilotVault
```

---

## Submitting a Pull Request

1. Ensure your branch is up to date with `main`.
2. Fill out the [PR template](.github/pull_request_template.md) completely.
3. Link the related issue (e.g., `Closes #12`).
4. Add screenshots or test output where relevant.
5. Request a review from a maintainer.

PRs that fail CI checks (lint, build, contract tests) will not be merged.

---

## Reporting Bugs

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md). Please include:
- A clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, Node version, network: testnet/mainnet)

---

## Requesting Features

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md). Please describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

---

Thank you for making AutoPilot better! 🌟
