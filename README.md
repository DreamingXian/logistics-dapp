# 🚢 Decentralized Logistics Escrow & Milestone Platform (dApp)

A Web3 decentralized freight management and milestone-based escrow platform built on the Ethereum blockchain.

---

## 📌 Project Overview
This project replaces centralized logistics intermediaries with self-executing Ethereum smart contracts to ensure trustless custody of freight funds, progressive milestone payouts, deterministic timeout refunds, and decentralized reputation tracking for carriers.

### 🌟 Key Features
- **Role-Based Access Control**: Separate, self-sovereign accounts for **Shippers**, **Carriers**, and **Arbiters**.
- **100% Upfront Escrow Lock**: Shippers deposit native ETH when creating a freight agreement.
- **Progressive Milestone Payouts**:
  - **Milestone 1 (Cargo Pickup)**: 30% ETH release + 50 CRT reputation token minting.
  - **Milestone 2 (Final Delivery)**: Remaining 70% ETH release + 100 CRT reputation token minting.
- **Deterministic Timeout Refunds**: If a carrier fails to deliver before the Unix timestamp deadline, the shipper can claim an immediate automated refund with zero third-party delay (Carrier slashed -150 CRT).
- **Dispute Mediation Fallback**: Shippers can contest damaged goods with IPFS proofs; a designated Arbiter can mediate custom payout splits.
- **Pre-Pickup Cancellation**: Shippers can cancel unstarted agreements for a 100% refund.
- **Dynamic Freight Estimator**: Frontend calculator calculating freight estimates based on Distance, Weight, and Carrier Tiers.
- **Carrier Reputation Standard (CRT)**: Custom ERC-20 token tracking carrier trust scores on-chain.

---

## 🛠️ Prerequisites
- [Node.js](https://nodejs.org/) (v16+ or v18+)
- [Truffle Suite](https://trufflesuite.com/truffle/) (`npm install -g truffle`)
- [Ganache GUI](https://trufflesuite.com/ganache/) (Port 7545) or Truffle Develop (Port 9545)
- [MetaMask Wallet Extension](https://metamask.io/)

---

## 🚀 Quickstart Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Local Blockchain (Ganache)
1. Open **Ganache GUI** and select **Quickstart (Ethereum)**.
2. Ensure RPC server is set to `HTTP://127.0.0.1:7545` and Network ID `5777` or `1337`.

### 3. Compile & Deploy Smart Contracts
```bash
# Compile contracts
npx truffle compile

# Deploy contracts to Ganache
npx truffle migrate --reset
```

### 4. Run Automated Test Suite
```bash
npx truffle test
```

### 5. Start the Web3 Frontend Server
```bash
node server.js
```
Open your browser and navigate to: **`http://127.0.0.1:5000`**

---

## 🦊 MetaMask Setup
1. Add a Custom RPC Network in MetaMask:
   - **Network Name**: Ganache Local
   - **New RPC URL**: `http://127.0.0.1:7545`
   - **Chain ID**: `1337` (or `5777`, matching your Ganache RPC)
   - **Currency Symbol**: `ETH`
2. In Ganache GUI, copy the **Private Key** of Account 0 and import it to MetaMask as **"Shipper Account"**.
3. Copy the **Private Key** of Account 1 and import it as **"Carrier Account"**.

---

## 📂 Project Structure
```
logistics-dapp/
├── contracts/
│   ├── CarrierReputationToken.sol   # ERC-20 reputation token (CRT)
│   └── LogisticsEscrow.sol          # Core escrow, state machine & payouts
├── migrations/
│   └── 2_deploy_contracts.js        # Truffle deployment & token link script
├── src/
│   ├── css/
│   │   └── style.css                # Glassmorphic dark UI styling
│   ├── js/
│   │   └── app.js                   # Web3 EIP-1193 integration & contract methods
│   └── index.html                   # Responsive dApp user interface
├── test/
│   └── logistics_escrow_test.js     # 5 comprehensive end-to-end unit tests
├── .gitignore                       # Git ignore list
├── package.json                     # Project manifest
├── server.js                        # Node.js Express static server
├── truffle-config.js                # Truffle compiler & network configuration
└── README.md                        # Documentation & setup instructions
```
