<div align="center">
  <img src="frontend/public/logo.png" alt="AutoPilot Logo" width="150" />
  <h1>AutoPilot</h1>
  <p><strong>AI-Powered Financial Automation on the Stellar Network</strong></p>

  <p>
    <a href="https://github.com/thisisouvik/autopilot/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat" alt="MIT License" /></a>
    <a href="https://github.com/thisisouvik/autopilot/actions/workflows/ci.yml"><img src="https://github.com/thisisouvik/autopilot/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/thisisouvik/autopilot/actions/workflows/security-audit.yml"><img src="https://github.com/thisisouvik/autopilot/actions/workflows/security-audit.yml/badge.svg" alt="Security Audit" /></a>
    <a href="https://github.com/thisisouvik/autopilot/issues"><img src="https://img.shields.io/github/issues/thisisouvik/autopilot?color=orange" alt="Open Issues" /></a>
    <a href="https://github.com/thisisouvik/autopilot/pulls"><img src="https://img.shields.io/github/issues-pr/thisisouvik/autopilot?color=blueviolet" alt="Open PRs" /></a>
    <a href="https://github.com/thisisouvik/autopilot/stargazers"><img src="https://img.shields.io/github/stars/thisisouvik/autopilot?style=flat&color=yellow" alt="Stars" /></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-black?style=flat&logo=next.js&logoColor=white" alt="Next.js" />
    <img src="https://img.shields.io/badge/Fastify-000000?style=flat&logo=fastify&logoColor=white" alt="Fastify" />
    <img src="https://img.shields.io/badge/Stellar-000000?style=flat&logo=stellar&logoColor=white" alt="Stellar" />
    <img src="https://img.shields.io/badge/Soroban-5200FF?style=flat" alt="Soroban" />
    <img src="https://img.shields.io/badge/PostgreSQL-316192?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white" alt="Tailwind" />
    <img src="https://img.shields.io/badge/Rust-000000?style=flat&logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/Groq-black?style=flat" alt="Groq AI" />
  </p>

  <h3>
    <a href="https://autopilot-stellar-mauve.vercel.app/">🚀 Live Demo</a> &nbsp;|&nbsp;
    <a href="https://youtu.be/OG6kS41sLGg">▶️ Demo Video</a> &nbsp;|&nbsp;
    <a href="https://github.com/thisisouvik/autopilot/issues">🐛 Report a Bug</a> &nbsp;|&nbsp;
    <a href="https://github.com/thisisouvik/autopilot/discussions">💬 Discussions</a>
  </h3>
</div>

---

> **⚠️ This project currently runs on the Stellar Testnet only.**
> All transactions use test XLM with no real monetary value. See [Contributing](CONTRIBUTING.md) to run it locally.

---

## 📖 Table of Contents

- [What is AutoPilot?](#-what-is-autopilot)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Blockchain Details](#️-blockchain-details)
- [Screenshots](#-screenshots)
- [Quick Start](#-quick-start)
- [File Structure](#-file-structure)
- [Testing](#-testing)
- [Error Handling](#-error-handling)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [Security](#-security)
- [License](#-license)
- [Contributors](#-contributors)

---

## 💡 What is AutoPilot?

Managing personal finances — specifically, consistently saving and investing — is a manual, emotional, and often forgotten task. Traditional banking apps offer basic "auto-transfers" but lack dynamic intelligence (e.g., *"save 10% only if I receive a payment over $50"*).

**AutoPilot** bridges natural language AI with the speed and low cost of the Stellar blockchain. Users simply tell the AI what they want:

> *"Save 15% of every incoming XLM payment into my savings vault."*

…and the AutoPilot engine constantly monitors their Stellar wallet, executing those rules autonomously and instantly — no manual steps needed.

### Real-World Example
A freelancer gets paid sporadically in XLM on Stellar. Instead of manually moving money every time they get paid, AutoPilot automatically calculates 15% of each payment and instantly sweeps it into a secure, on-chain Vault account. Zero effort. Every time.

---

## ✨ Features

| Feature | Description |
| :--- | :--- |
| 🗣️ **Natural Language Rules** | Type rules in plain English — the AI translates them into executable financial logic. |
| 🏦 **Automated On-Chain Vaults** | Instantly create isolated Stellar accounts for savings and investments. |
| 📡 **Live Blockchain Monitoring** | The engine watches your account via Horizon API and triggers rules the moment a payment occurs. |
| 🔒 **AES-256-GCM Encryption** | Vault private keys are encrypted at rest using bank-grade encryption. |
| 🎯 **Goal Tracking** | Set financial goals (e.g., "Emergency Fund") and link them to automation rules for automatic progress. |
| 🤖 **AI Financial Coach** | Chat with an AI coach to get rule suggestions based on your financial situation. |
| 📊 **Dynamic Dashboard** | Real-time Stellar balances and automated transaction history. |
| 🛡️ **Spending Limits** | Daily and weekly limits prevent automation from over-spending. |

---

## 🏗️ Architecture

```mermaid
flowchart LR
    UI[Next.js Frontend] <-->|REST API / JWT| API[Fastify Backend]

    subgraph AutoPilot Backend
    API <--> AI[Groq AI Engine]
    API <--> DB[(PostgreSQL)]
    DB --> Engine[Rule Engine / Horizon Stream]
    end

    Engine <-->|Stellar SDK| Horizon[Stellar Horizon API]
    Horizon <--> Blockchain[(Stellar Testnet)]
```

### User Flow

```mermaid
sequenceDiagram
    participant User
    participant AI Coach
    participant Engine
    participant Stellar Network

    User->>AI Coach: "Save 10% of incoming payments"
    AI Coach-->>Engine: JSON Rule (Trigger: Incoming, Action: Save, 10%)
    Engine->>Engine: Persist Rule to Database

    Note over Stellar Network, Engine: Sometime later...
    Stellar Network-->>Engine: Event: User received 100 XLM
    Engine->>Engine: Match Rule → Calculate 10 XLM
    Engine->>Stellar Network: Sign & Submit Tx → Vault
    Stellar Network-->>User: Vault Balance +10 XLM ✅
```

---

## 🛠️ Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | Next.js 14, Tailwind CSS, TypeScript | Fast, responsive UI with Freighter wallet integration |
| **Backend** | Fastify, Node.js, TypeScript | High-performance API + background rule engine |
| **Database** | PostgreSQL (Neon) | Stores users, encrypted vault keys, rules, goals |
| **Blockchain** | Stellar SDK, Horizon API | Account creation, payments, trustlines on Stellar |
| **Smart Contract** | Soroban (Rust, `soroban-sdk`) | On-chain `AutopilotVault` contract for fund custody |
| **AI Engine** | Groq (Llama-3.3-70b / Qwen3) | Parses natural language rules into structured JSON |
| **Queue** | BullMQ + Redis (Upstash) | Reliable background job processing for rule execution |
| **Security** | AES-256-GCM, JWT | Encrypted vault keys; secure session management |

---

## ⛓️ Blockchain Details

AutoPilot leverages Stellar's native capabilities **and** a Soroban smart contract for on-chain transparency.

### Engine Architecture
- **Engine Account:** The backend maintains a funded "Engine" Stellar keypair (`AUTOPILOT_PUBLIC_KEY`). This account orchestrates all automated transactions.
- **Vault Creation:** When a user creates a Vault, a brand-new Stellar keypair is generated. The Engine funds it with the minimum XLM reserve (2.5 XLM) via a `createAccount` operation.
- **Key Security:** The Vault's private key is encrypted using `AES-256-GCM` before being stored in PostgreSQL. It is only decrypted in-memory when a transaction needs to be signed.
- **Transaction Execution:** The Horizon API SSE stream monitors the user's wallet. When a payment matches a rule, the engine signs and submits a transaction to the user's Vault.

### Testnet Deployment
| Component | Value | Explorer |
| :--- | :--- | :--- |
| **Soroban Contract ID** | `CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP` | [Stellar Lab](https://lab.stellar.org/r/testnet/contract/CACYX7GWKABSUFUF5MV5UVRH62F6A2D2SUSAHVC4FTIIKARTIBVUW6BP) |
| **Contract Deploy Tx** | `d3ad5ecb5401e327...` | [Stellar Expert](https://stellar.expert/explorer/testnet/tx/d3ad5ecb5401e3270c2fba9af35e04c2efd85f567bc6de87b362b2bbc4d06973) |
| **Engine Account** | `GBUQJORY2GBXU2Z3...` | [Stellar Expert](https://stellar.expert/explorer/testnet/account/GBUQJORY2GBXU2Z3HUJJJEYO5SQCKCVM5YWTHIKNV7URUAPTOPFKKHLQ) |

---

## 📸 Screenshots

<details>
<summary><strong>Click to view all screenshots</strong></summary>

### 1. Onboarding Screen
![Onboarding](assets/screenshots/onboarding.png)
*A seamless Web3 onboarding experience — connect your Freighter wallet to get started.*

### 2. Main Dashboard
![Home](assets/screenshots/home.png)
*Track your total automated wealth, active rules, and recent on-chain activity.*

### 3. AI Financial Coach
![AI Coach](assets/screenshots/autopilot.coach.png)
*Chat with the AI to build complex savings rules in plain English.*

### 4. Chat Interface
![Chat](assets/screenshots/autopilot.chat.png)
*Conversational automation rule creation powered by Groq and Qwen3.*

### 5. Automation Rules
![Rules](assets/screenshots/rules.png)
*View, pause, and manage all your active financial automation triggers.*

### 6. Goal Tracking
![Goals](assets/screenshots/goals.png)
*Set financial milestones and link them to rules for automatic progress tracking.*

### 7. On-Chain Vaults
![Vault](assets/screenshots/vault.png)
*Funds are autonomously routed to your vaults when rules execute.*

### 8. Account Settings
![Account](assets/screenshots/account.png)
*Set daily/weekly spending limits and manage your automation settings.*

### 9. Mobile View
![Mobile Onboarding](assets/screenshots/mobile-onboarding.png)
*Fully responsive — works seamlessly on mobile.*

### 10. Mobile Dashboard
![Mobile Home](assets/screenshots/mobile-home.png)
*All your data accessible in a clean, single-column mobile layout.*

</details>

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 18 |
| npm | >= 9 |
| Rust | stable |
| [Freighter Wallet](https://www.freighter.app/) | Browser extension (Testnet mode) |

### 1. Clone

```bash
git clone https://github.com/thisisouvik/autopilot.git
cd autopilot
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env   # Fill in your values
npm run dev            # Starts on http://localhost:3001
```

<details>
<summary><strong>Required backend environment variables</strong></summary>

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/autopilot
JWT_SECRET=a-very-long-random-string
VAULT_ENCRYPTION_KEY=<64-char hex — see below>
GROQ_API_KEY=your-groq-api-key
AUTOPILOT_PUBLIC_KEY=your-stellar-testnet-engine-public-key
AUTOPILOT_SECRET_KEY=your-stellar-testnet-engine-secret-key
STELLAR_NETWORK=testnet
REDIS_URL=redis://localhost:6379
```

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Fund your testnet engine account for free:
```bash
npm run friendbot
```

</details>

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # Fill in your values
npm run dev                   # Starts on http://localhost:3000
```

<details>
<summary><strong>Required frontend environment variables</strong></summary>

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_STELLAR_NETWORK=testnet
```

</details>

### 4. Soroban Contract (optional)

```bash
cd contracts
cargo test           # Run unit tests
stellar contract build   # Build to WASM
```

> See [CONTRIBUTING.md](CONTRIBUTING.md) for full contract deploy instructions.

---

## 📂 File Structure

```text
autopilot/
├── .github/
│   ├── workflows/          # CI, security audit
│   ├── ISSUE_TEMPLATE/     # Bug report, feature request, contract bug
│   ├── CODEOWNERS          # Auto-review assignments
│   ├── dependabot.yml      # Automated dependency updates
│   └── pull_request_template.md
├── backend/
│   └── src/
│       ├── engine/         # Horizon stream, rule processor, BullMQ queue
│       ├── stellar/        # Transaction builder, vault manager, keypair utils
│       ├── routes/         # REST API endpoints
│       ├── lib/            # DB client, engine helpers
│       ├── middleware/      # JWT auth
│       └── migrations/     # PostgreSQL schema
├── contracts/              # AutopilotVault (Soroban / Rust)
│   └── src/
│       ├── lib.rs          # Contract implementation
│       └── test.rs         # Contract unit tests
├── frontend/
│   └── src/
│       ├── app/            # Next.js App Router pages
│       └── components/     # Reusable UI components
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── LICENSE
```

---

## 🧪 Testing

### Backend E2E Tests

```bash
cd backend
npx tsx src/scripts/e2e.ts
```

The E2E suite simulates a full user lifecycle:
1. Creates a mock user in PostgreSQL
2. Creates a rule and a goal
3. Calls Groq API to verify AI parsing
4. Creates and funds a real Vault on Stellar Testnet
5. Verifies DB state and cleans up mock data

### Soroban Contract Tests

```bash
cd contracts
cargo test
```

---

## 🛑 Error Handling

| Scenario | How AutoPilot Handles It |
| :--- | :--- |
| **AI Misunderstanding** | Schema validation catches bad AI output; user is prompted to rephrase |
| **Duplicate Payment Event** | `txHash` deduplication check before processing (see [#8](https://github.com/thisisouvik/autopilot/issues/8) for DB-level fix) |
| **Horizon Stream Disconnect** | Fallback to BullMQ queue; reconnect logic tracked in [#11](https://github.com/thisisouvik/autopilot/issues/11) |
| **Insufficient Engine Funds** | API returns a clear 500 with a descriptive message |
| **Stellar Tx Timeout** | 30-second timeout + catch block prevents retry loops |
| **Spending Limit Hit** | Rule is blocked gracefully; result logged as `blocked` |

---

## 🗺️ Roadmap

| Status | Feature |
|--------|---------|
| ✅ Done | AI rule creation via natural language |
| ✅ Done | XLM automated savings/investment vaults |
| ✅ Done | Soroban smart contract deployment (testnet) |
| ✅ Done | Goal tracking with linked rules |
| ✅ Done | Daily/weekly spending limits |
| 🔄 In Progress | USDC payment event support ([#9](https://github.com/thisisouvik/autopilot/issues/9)) |
| 🔄 In Progress | Horizon stream reconnection logic ([#11](https://github.com/thisisouvik/autopilot/issues/11)) |
| 📋 Planned | Multi-sig vault security |
| 📋 Planned | On-chain engine authorization via Soroban ([#5](https://github.com/thisisouvik/autopilot/issues/5)) |
| 📋 Planned | Mobile app (React Native) |
| 📋 Planned | Mainnet deployment (post security audit) |

---

## 🤝 Contributing

We welcome all contributions — bug fixes, features, documentation, and Soroban contract improvements!

1. Read the [Contributing Guide](CONTRIBUTING.md)
2. Check [open issues](https://github.com/thisisouvik/autopilot/issues) — especially ones tagged [`good first issue`](https://github.com/thisisouvik/autopilot/issues?q=is%3Aissue+label%3A%22good+first+issue%22)
3. Fork → branch → PR

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🔐 Security

AutoPilot handles Stellar keypairs and user funds. If you find a security vulnerability, **please do not open a public issue.** Instead, use [GitHub Security Advisories](https://github.com/thisisouvik/autopilot/security/advisories/new).

See [SECURITY.md](SECURITY.md) for the full responsible disclosure policy.

---

## 📝 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

---

## 👥 Contributors

Thanks to everyone who has contributed to AutoPilot! 🌟

<a href="https://github.com/thisisouvik/autopilot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=thisisouvik/autopilot" alt="Contributors" />
</a>

<sub>Contributor avatars powered by <a href="https://contrib.rocks">contrib.rocks</a></sub>

---

<div align="center">
  <p>If you find AutoPilot useful, please consider giving it a ⭐ — it helps others discover the project!</p>
  <a href="https://github.com/thisisouvik/autopilot/stargazers">
    <img src="https://img.shields.io/github/stars/thisisouvik/autopilot?style=social" alt="Star on GitHub" />
  </a>
</div>
