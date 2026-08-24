require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("hardhat-contract-sizer");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24", // Matches your Weje contracts
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.8.30", // Matches your Weje contracts
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true, // Enable intermediate representation for better optimization
    },
  },

  networks: {
    // Polygon Mainnet
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com/",
      accounts: process.env.POLYGON_PRIVATE_KEY ? [process.env.POLYGON_PRIVATE_KEY] : [],
      chainId: 137,
      timeout: 60000,
    },

    // Polygon Mumbai Testnet
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-mumbai.maticvigil.com/",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 80002,
      timeout: 60000,
    }
  },
  
  // Etherscan verification
  etherscan: {
    apiKey: process.env.POLYGONSCAN_API_KEY, // your single V2 key here
  },

  // Contract size reporting
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
    only: ["WejeToken", "WejePresale", "WejeVesting", "WejeStaking","SportsBetting", "PredictionTickets"],
  },

  // Code coverage
  solcover: {
    skipFiles: [
      "contracts/mocks/",
      "contracts/test/",
    ],
  },

  // Mocha test configuration
  mocha: {
    timeout: 300000, // 5 minutes
    reporter: "spec",
    slow: 10000, // 10 seconds
    bail: false, // Don't stop on first failure
  },

  // Path configurations
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./scripts",
  },

  // Compiler warnings
  warnings: {
    "*": {
      "unused-param": "off",
      "unused-var": "off",
    },
  },

  // External deployments (for testing with already deployed contracts)
  external: {
    contracts: [
      {
        artifacts: "node_modules/@openzeppelin/contracts/build/contracts",
      },
    ],
  },

  // Custom tasks
  task: {
    "accounts": "Prints the list of accounts",
    "balance": "Prints an account's balance",
    "deploy-ecosystem": "Deploy complete WEJE ecosystem",
    "verify-ecosystem": "Verify all deployed contracts",
    "setup-testnet": "Setup testnet environment with mock data",
  },
};



// Additional helper functions
function getNetworkConfig(networkName) {
  const configs = {
    mainnet: {
      gasPrice: 20000000000, // 20 gwei
      gasLimit: 8000000,
      confirmations: 2,
    },
    polygon: {
      gasPrice: 35000000000, // 35 gwei
      gasLimit: 20000000,
      confirmations: 3,
    },
    mumbai: {
      gasPrice: 20000000000, // 20 gwei
      gasLimit: 20000000,
      confirmations: 2,
    },
    bsc: {
      gasPrice: 5000000000, // 5 gwei
      gasLimit: 8000000,
      confirmations: 3,
    },
  };
  
  return configs[networkName] || configs.mumbai;
}

module.exports.getNetworkConfig = getNetworkConfig;