# 🚢 LogisticsEscrow dApp — Decentralized Logistics Escrow & Milestone Platform

[![Ethereum](https://img.shields.io/badge/Blockchain-Ethereum%20Sepolia-3c3c3d?style=for-the-badge&logo=ethereum)](https://sepolia.etherscan.io)
[![Solidity](https://img.shields.io/badge/Solidity-v0.8.20-363636?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![Truffle](https://img.shields.io/badge/Framework-Truffle%20Suite-5e464d?style=for-the-badge&logo=truffle)](https://trufflesuite.com/)
[![Web3.js](https://img.shields.io/badge/Web3-EIP--1193%20%2F%20Web3.js-f16822?style=for-the-badge)](https://web3js.readthedocs.io/)
[![IPFS / Pinata](https://img.shields.io/badge/Storage-IPFS%20%2F%20Pinata%20Cloud-65C9CA?style=for-the-badge&logo=ipfs)](https://pinata.cloud)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

An enterprise-grade decentralized logistics escrow and milestone-based settlement dApp built on the Ethereum blockchain. This platform eliminates predatory centralized freight brokers and payment delays by leveraging self-executing smart contracts, automated milestone payouts, deterministic timeout refunds, IPFS cryptographic proof storage, and an on-chain carrier reputation economy (ERC-20).

---

## 🌐 Official Repository & Live Block Explorers

- **GitHub Repository**: [https://github.com/DreamingXian/logistics-dapp](https://github.com/DreamingXian/logistics-dapp)
- **Deployment Network**: Ethereum Sepolia Testnet (Chain ID: `11155111`)
- **Contract Deployer**: [`0x180DBe88a7DfF9ff1929EFACd3C0D23c72C38079`](https://sepolia.etherscan.io/address/0x180DBe88a7DfF9ff1929EFACd3C0D23c72C38079)

### 📜 Deployed Smart Contracts

| Smart Contract | Sepolia Contract Address | Etherscan Explorer | Blockscout Explorer | Deployment Tx |
| :--- | :--- | :--- | :--- | :--- |
| **`LogisticsEscrow`** | `0x991502D770c542080826B89b043B4DCebE4A8D89` | [View on Etherscan](https://sepolia.etherscan.io/address/0x991502D770c542080826B89b043B4DCebE4A8D89) | [View on Blockscout](https://eth-sepolia.blockscout.com/address/0x991502D770c542080826B89b043B4DCebE4A8D89) | [`0xddf0c2...`](https://sepolia.etherscan.io/tx/0xddf0c25f62c1bae19fb6b1fc4be205e2564f4c734bd2ec44b2abd650907e00f9) |
| **`CarrierReputationToken` (CRT)** | `0xC4CBD8A0e84c387C499cAbAd6CF1e19889c7CfD4` | [View on Etherscan](https://sepolia.etherscan.io/address/0xC4CBD8A0e84c387C499cAbAd6CF1e19889c7CfD4) | [View on Blockscout](https://eth-sepolia.blockscout.com/address/0xC4CBD8A0e84c387C499cAbAd6CF1e19889c7CfD4) | [`0xf49278...`](https://sepolia.etherscan.io/tx/0xf49278615d5288ff5b7d35b769884063fc53a425980af231c5db447de4d77905) |

---

## 📌 Executive Summary & Motivation

Traditional freight logistics suffers from opaque operations, 60-to-90-day invoice delays, high intermediary fees, and a fundamental trust deficit between shippers and transport operators:
1. **Payment Insecurity**: Carriers risk completing long-distance deliveries without receiving payment on time.
2. **Delivery Default**: Shippers risk prepaying freight to unreliable carriers who miss deadlines or damage cargo.
3. **Subjective Reputation**: Transport performance ratings are siloed, untrusted, or fabricated on proprietary centralized platforms.

### 💡 The Decentralized Solution
**LogisticsEscrow** introduces trustless, multi-phase cargo execution governed entirely by verifiable Ethereum smart contracts:
- **100% Upfront Escrow Deposit**: Shippers lock the full agreed freight fee in the smart contract upon order creation.
- **Bi-Phase Milestone Payouts**: 
  - **Milestone 1 (Cargo Pickup)**: Releasing **30%** of escrowed ETH to the carrier + awarding **+50 CRT** reputation tokens.
  - **Milestone 2 (Final Delivery)**: Releasing the remaining **70%** of escrowed ETH + awarding **+100 CRT** reputation tokens.
- **Deterministic Timeout & Slashing**: If a carrier misses the Unix delivery deadline, the shipper can claim an immediate automated refund while the carrier suffers an on-chain **-300 CRT** reputation deduction.
- **Zero Intermediary Delay**: No banks, arbiters, or centralized brokers are required. The state transitions deterministically based on cryptographic proofs.

---

## 🌟 Key Features

### 1. 🔐 Role-Based Access Control (RBAC)
- Self-sovereign user registration bound to Ethereum wallet addresses.
- Strict roles: **Shippers** (create agreements, fund escrow, verify milestone proofs, approve releases) and **Carriers** (browse available jobs, accept agreements, submit IPFS inspection proofs).
- Role isolation enforced via Solidity function modifiers (`onlyAssignedShipper`, `onlyAssignedCarrier`, `onlyRegisteredUser`).

### 2. 🗺️ Malaysia-Only Geofencing & Route Estimator
- Integrated **Leaflet.js** map with interactive pin-dropping for Origin and Destination addresses.
- **Strict Peninsular Malaysia Geofencing**: Coordinates outside Malaysia or within East Malaysia (Sabah/Sarawak) are automatically detected and rejected with informative error prompts.
- **Dynamic Freight Calculator**: Computes Haversine distance, estimated transit time (ETA), and transparent pricing based on base rate, per-kilometer distance, weight tiers, and carrier priority.

### 3. 📦 Dual-Mode Decentralized IPFS Cargo Proofs
- High-resolution cargo inspection photos are uploaded during agreement creation, cargo pickup, and final delivery.
- **Direct Pinata Cloud Pinning**: Uploads directly to IPFS via Pinata API using JWT authentication, generating immutable `Qm...` CIDv0 multihashes.
- **Local Fallback Gateway**: If offline or running in a sandboxed lab environment, the backend calculates genuine Base58 cryptographic multihashes (`crypto.createHash('sha256')`) and serves them via an integrated local IPFS gateway resolver (`/ipfs/:cid`).

### 4. 🪙 Carrier Reputation Token (CRT — ERC-20)
- On-chain trust metric representing carrier reliability and historical performance.
- Automated minting on successful milestones: **+50 CRT** (Pickup) and **+100 CRT** (Delivery).
- Automated slashing on deadline violations: **-300 CRT** penalty.
- Privileged mint/burn hooks strictly locked to the `LogisticsEscrow` contract address via the `onlyEscrow` modifier.

### 5. 🔍 Privacy-Preserving Public Distributed Audit Ledger
- Immutable, global ledger logging all freight milestones, timestamps, and contract status transitions.
- Status filters: *Pending Acceptance, In Transit, Delivering, Completed, Refunded, Cancelled*.
- **Privacy Preservation**: Cargo photographs are redacted from the public view to safeguard commercial confidentiality, while cryptographic IPFS content identifiers and block numbers remain fully auditable.

### 6. ⚡ Modern Glassmorphic UI/UX
- Real-time deadline countdown timers with automated UI state updates.
- Custom non-blocking modal confirmation dialogs (replacing native browser alerts).
- Full-screen loading overlay during MetaMask signature processing to prevent accidental double-spend submissions.

---

## 🏗️ Architecture & State Machine

```
   [Shipper: Create Agreement]
                │
                ▼ (Locks 100% ETH into Escrow)
        [PendingAcceptance] ────────────── (Shipper Cancels) ──► [Cancelled] (100% Refund)
                │
   [Carrier: Accept Agreement]
                │
                ▼
           [InTransit]
                │
   [Carrier: Submit Pickup Proof] ──► (IPFS Qm... Hash)
                │
   [Shipper: Approve Milestone 1]
                │
                ▼ (Releases 30% ETH + Mints 50 CRT)
           [Delivering]
                │
   [Carrier: Submit Delivery Proof] ─► (IPFS Qm... Hash)
                │
   [Shipper: Approve Milestone 2]
                │
                ▼ (Releases 70% ETH + Mints 100 CRT)
           [Completed]
                
   ────────────────────────────────────────────────────────────
   TIMEOUT & DEADLINE EXCEPTION BRANCHES:
   • Deadline Expired (Before Pickup)   ──► Shipper Cancels & 100% Refund (Carrier -300 CRT)
   • Deadline Expired (During Transit) ──► Shipper Claims 70% Refund (Carrier -300 CRT)
   • Late Delivery Validation          ──► Shipper Validates Delivery (0 ETH released, status closed)
```

---

## 💻 Step-by-Step Installation & Quickstart Guide

> [!IMPORTANT]
> **Smart Contracts are ALREADY Deployed to Sepolia Testnet!**
> You do **not** need to install Truffle, Ganache, or deploy smart contracts to evaluate the application. You can immediately run the web interface locally, connect your MetaMask wallet on Sepolia, and interact with the live blockchain.

---

### 🚀 Method 1: Instant Evaluation on Live Sepolia Testnet (Recommended)

This is the fastest method for tutors, teammates, and evaluators to test the live platform.

#### Step 1: Clone or Extract the Project
```bash
git clone https://github.com/DreamingXian/logistics-dapp.git
cd logistics-dapp
```

#### Step 2: Install Web Server Dependencies
```bash
npm install
```
*(Installs lightweight server libraries: `express`, `multer`, `dotenv`, and `@truffle/hdwallet-provider`)*

#### Step 3: Launch the Web3 Platform Server
```bash
npm start
```
The server will start at: **`http://127.0.0.1:5000`**

#### Step 4: Open in Your Browser
Open your browser (Google Chrome, Brave, or Edge with MetaMask installed) and navigate to:
```
http://localhost:5000
```

#### Step 5: Connect MetaMask on Sepolia
1. Open your **MetaMask** extension.
2. In the top-left network selector, switch to **Sepolia** (Chain ID: `11155111`).
   - *If Sepolia is hidden in MetaMask, go to Settings > Advanced > Toggle "Show test networks" ON.*
3. Ensure your wallet has free Sepolia testnet ETH:
   - [Google Cloud Web3 Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
   - [Alchemy Sepolia Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
   - [Sepolia PoW Faucet](https://sepolia-faucet.pk910.de/)
4. Click **"Connect Wallet"** on the dApp navigation bar.
5. The application will detect the network as **Ethereum Sepolia (11155111)** and automatically bind to our deployed contracts (`0x9915...` and `0xC4CB...`).

#### Step 6: Test the Complete Logistics Workflow
1. **Register as Shipper**: Fill in your company name, select role "Shipper", and click Register.
2. **Create a Freight Agreement**:
   - Open the "Create Agreement" tab.
   - Enter cargo title, weight, and carrier address (or switch to a second MetaMask account to test as Carrier).
   - Use the interactive Malaysia map to select Origin and Destination (e.g., Kuala Lumpur to Penang).
   - Upload a cargo inspection photo.
   - Click **"Lock Escrow & Create Agreement"** and confirm the transaction in MetaMask.
3. **Accept as Carrier**:
   - Switch MetaMask to the Carrier account and register as Carrier.
   - View the agreement card in "Carrier Job Portal" and click **"Accept Shipment"**.
4. **Milestone Progression**:
   - Carrier uploads pickup proof -> Shipper verifies and approves (30% ETH payout released + 50 CRT minted).
   - Carrier uploads delivery proof -> Shipper verifies and approves (remaining 70% ETH payout released + 100 CRT minted).
5. **View Public Audit Ledger**: Click the "Public Audit Ledger" navigation link to inspect the on-chain audit trail.

---

### 🛠️ Method 2: Local Sandbox Development (Ganache GUI)

If you prefer testing completely offline without waiting for testnet block confirmation times:

#### 1. Start Ganache GUI
- Launch **Ganache GUI** and choose **Quickstart (Ethereum)**.
- Ensure the RPC Server is configured to: `HTTP://127.0.0.1:7545` and Network ID `5777` (or `1337`).

#### 2. Compile & Migrate Contracts to Ganache
```bash
# Compile Solidity contracts
npx truffle compile

# Deploy contracts to local Ganache network
npx truffle migrate --reset
```

#### 3. Run Automated Unit Test Suite
Run the comprehensive Truffle test suite (validates all 10 integration and edge cases):
```bash
npx truffle test
```
*Expected Result:* `10 passing (22s)`

#### 4. Configure MetaMask for Local Ganache
1. In MetaMask, add a custom network:
   - **Network Name**: Ganache Local
   - **New RPC URL**: `http://127.0.0.1:7545`
   - **Chain ID**: `1337` (or `5777`)
   - **Currency Symbol**: `ETH`
2. In Ganache GUI, copy the **Private Key** of Account 0 and import it into MetaMask (Shipper).
3. Copy the **Private Key** of Account 1 and import it into MetaMask (Carrier).

#### 5. Start Frontend Server
```bash
npm start
```
Navigate to `http://localhost:5000`. The dApp will detect network ID `5777`/`1337` and interact with your local Ganache deployment.

---

## 📂 Project Directory Structure

```
logistics-dapp/
├── contracts/                               # Solidity smart contracts
│   ├── CarrierReputationToken.sol           # ERC-20 reputation token (CRT) with escrow-locked mint/burn
│   └── LogisticsEscrow.sol                  # Escrow custody, 2-phase milestones, timeouts & audit events
├── migrations/                              # Truffle deployment migration scripts
│   └── 2_deploy_contracts.js                # Atomic deployer linking CRT token with LogisticsEscrow
├── src/                                     # Frontend decentralized application
│   ├── css/
│   │   └── style.css                        # Glassmorphic dark theme, responsive grid & animations
│   ├── js/
│   │   └── app.js                           # Web3 EIP-1193 connector, contract callers & Leaflet map logic
│   └── index.html                           # Single-page responsive dApp interface
├── test/                                    # Automated end-to-end unit test suite
│   └── logistics_escrow_test.js             # 10 comprehensive test scenarios covering all lifecycle states
├── build/                                   # Compiled contract ABIs & deployment addresses (DO NOT DELETE)
│   └── contracts/
│       ├── CarrierReputationToken.json      # CRT ABI + Sepolia (11155111) & Ganache (5777) addresses
│       ├── ICarrierReputationToken.json     # Token Interface ABI
│       └── LogisticsEscrow.json             # Escrow ABI + Sepolia (11155111) & Ganache (5777) addresses
├── ipfs-storage/                            # Dual-mode local IPFS storage & cache gateway resolver
├── .env.example                             # Environment variable template for Sepolia & Pinata credentials
├── .gitignore                               # Git exclusion rules (protects private keys and dependencies)
├── package.json                             # Node.js project manifest & scripts
├── package-lock.json                        # Dependency lockfile
├── server.js                                # Express backend & Pinata IPFS multihash upload API
├── truffle-config.js                        # Truffle compiler (v0.8.20) & network configurations
└── README.md                                # Comprehensive documentation & operational guide
```

---

## 🧪 Automated Test Suite Coverage

The project includes an automated test suite in [`test/logistics_escrow_test.js`](test/logistics_escrow_test.js) executed via Truffle and Web3.js:

| # | Test Scenario | Verified Behavior |
| :-: | :--- | :--- |
| **1** | User Registration | Registers Shipper and Carrier accounts with proper roles in contract storage. |
| **2** | Full Milestone Lifecycle | Agreement creation, carrier acceptance, 30% pickup payout (+50 CRT), and 70% delivery payout (+100 CRT). |
| **3** | Pre-Pickup Cancellation | Shipper cancels unstarted agreement and receives immediate 100% ETH escrow refund. |
| **4** | RBAC Unauthorized Access | Rejects unauthorized accounts attempting to approve payouts or modify agreement states. |
| **5** | Transit Timeout Refund | EVM time shifted past deadline; shipper claims 70% refund while carrier retains 30% pickup fee. |
| **6** | Expired Pickup Validation | Shipper validates pickup milestone after deadline and claims remaining 70% refund. |
| **7** | Missed Pickup Penalty | Carrier accepts agreement but misses deadline before pickup; shipper receives 100% refund, carrier penalized -150 CRT. |
| **8** | Late Pickup Proof Submission | Allows carrier to submit delayed pickup proof for inspection without failing the transaction. |
| **9** | Grace Period Approval | Shipper can approve milestone normally if proof was submitted by carrier before deadline, even if reviewed after deadline. |
| **10** | Milestone Proof Rejection & Resubmission | Shipper rejects inadequate proof with an on-chain reason; milestone resets to pending, carrier resubmits valid proof, and payout is approved (+50 CRT). |
| **11** | Late Submission Zero Payout | Shipper validates late-submitted pickup; carrier receives 0 ETH and 0 CRT, and shipper gets 100% escrow refund. |

**Run tests locally:**
```bash
npx truffle test
```

---

## 🔒 Security & Best Practices

- **Checks-Effects-Interactions Pattern**: State updates occur before external ETH transfers to prevent reentrancy attacks.
- **Pull over Push Payments**: Safe low-level `.call{value: ...}("")` with strict boolean verification.
- **Zero Centralized Intermediaries**: Eliminates single points of failure; escrow releases and refunds are governed strictly by deterministic smart contract conditions.
- **Environment Confidentiality**: Secret deployment keys and provider RPCs are managed via `.env` and kept strictly untracked from version control.

---

## 👥 Authors & Academic Context

- **Course**: BMIS2003 Blockchain Application Development
- **Institution**: Tunku Abdul Rahman University of Management and Technology (TAR UMT)
- **Project**: LogisticsEscrow — Decentralized Milestone Logistics Escrow Platform
