require('dotenv').config();
let HDWalletProvider;
try {
  HDWalletProvider = require('@truffle/hdwallet-provider');
} catch (e) {}

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*",
    },
    sepolia: {
      provider: () => {
        const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
        const rpcUrl = process.env.SEPOLIA_RPC_URL;
        if (!privateKey || !rpcUrl) {
          throw new Error("Missing DEPLOYER_PRIVATE_KEY or SEPOLIA_RPC_URL in .env file!");
        }
        const formattedKey = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
        return new HDWalletProvider({
          privateKeys: [formattedKey],
          providerOrUrl: rpcUrl,
          numberOfAddresses: 1,
          pollingInterval: 15000
        });
      },
      networkCheckTimeout: 100000,
      network_id: 11155111,
      gas: 5500000,
      confirmations: 1,
      timeoutBlocks: 200,
      skipDryRun: true
    }
  },
  compilers: {
    solc: {
      version: "0.8.20",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: "paris"
      }
    }
  }
};

