const { ethers, network } = require("hardhat");
const { writeFileSync } = require("fs");
require("dotenv").config();

async function main() {
    console.log("==================================================================");
    console.log("🚀 Deploying PredictionTickets Contract");
    console.log("==================================================================\n");

    // 1. Resolve Deployer Signer
    const privateKey = process.env.PREDICTION_BET_PRIVATE_KEY;
    const deployer = privateKey 
        ? new ethers.Wallet(privateKey, ethers.provider)
        : (await ethers.getSigners())[0];

    // Auto-fund for local hardhat dry-run testing
    if (network.name === "hardhat" || network.name === "localhost") {
        const bal = await ethers.provider.getBalance(deployer.address);
        if (bal === 0n) {
            await ethers.provider.send("hardhat_setBalance", [
                deployer.address,
                "0x56BC75E2D63100000" // 100 ETH
            ]);
        }
    }

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("📝 Prediction Deployer Account :", deployer.address);
    console.log("💰 Native Balance              :", ethers.formatEther(balance), "POL / ETH");
    console.log("🌐 Target Network              :", network.name, `(Chain ID: ${(await ethers.provider.getNetwork()).chainId})\n`);

    if (balance === 0n) {
        console.warn("⚠️ Warning: Deployer balance is 0 POL. Please ensure the wallet is funded before mainnet deployment.");
    }

    // 2. Resolve Weje Token Address
    const WEJE_TOKEN_ADDRESS = process.env.WEJE_TOKEN_ADDRESS || "0xB0412e8EcfDF82197f3dC782803a63EF3557404d";
    console.log("🪙 Weje Token Address          :", WEJE_TOKEN_ADDRESS);

    // 3. Resolve or Deploy Trusted Forwarder
    let forwarderAddress = process.env.TRUSTED_FORWARDER_ADDRESS;

    if (!forwarderAddress) {
        console.log("\n1️⃣ Deploying WejeForwarder (OpenZeppelin ERC-2771)...");
        const WejeForwarder = await ethers.getContractFactory("WejeForwarder", deployer);
        const forwarder = await WejeForwarder.deploy();
        await forwarder.waitForDeployment();
        forwarderAddress = await forwarder.getAddress();
        console.log("✅ WejeForwarder deployed to:", forwarderAddress);
    } else {
        console.log("\n1️⃣ Using existing Trusted Forwarder at:", forwarderAddress);
    }

    // 4. Deploy PredictionTickets
    console.log("\n2️⃣ Deploying PredictionTickets Contract with Prediction Deployer...");
    const PredictionTickets = await ethers.getContractFactory("contracts/PredictionContract.sol:PredictionTickets", deployer);
    const predictionTickets = await PredictionTickets.deploy(WEJE_TOKEN_ADDRESS, forwarderAddress);
    await predictionTickets.waitForDeployment();
    const predictionTicketsAddress = await predictionTickets.getAddress();
    console.log("✅ PredictionTickets deployed to:", predictionTicketsAddress);
    console.log("👑 PredictionTickets Contract Owner:", await predictionTickets.owner());

    // 5. Optional: Configure Initial Admins
    const adminAddresses = process.env.ADDITIONAL_ADMINS ? process.env.ADDITIONAL_ADMINS.split(",") : [];
    if (adminAddresses.length > 0) {
        console.log("\n3️⃣ Adding initial admins to PredictionTickets...");
        for (const admin of adminAddresses) {
            const trimmed = admin.trim();
            if (ethers.isAddress(trimmed)) {
                const tx = await predictionTickets.addAdmin(trimmed);
                await tx.wait();
                console.log(`   + Added admin: ${trimmed}`);
            }
        }
    }

    // 6. Summary & Verification Info
    const deploymentData = {
        contract: "PredictionTickets",
        network: network.name,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        deployer: deployer.address,
        owner: await predictionTickets.owner(),
        deploymentTimestamp: new Date().toISOString(),
        addresses: {
            wejeToken: WEJE_TOKEN_ADDRESS,
            trustedForwarder: forwarderAddress,
            predictionTickets: predictionTicketsAddress,
        },
        verificationCommands: [
            `npx hardhat verify --network ${network.name} ${predictionTicketsAddress} ${WEJE_TOKEN_ADDRESS} ${forwarderAddress}`
        ]
    };

    const fileName = `deployment-prediction-${network.name}-${Date.now()}.json`;
    writeFileSync(fileName, JSON.stringify(deploymentData, null, 2));

    console.log("\n==================================================================");
    console.log("🎉 PREDICTION TICKETS DEPLOYMENT SUCCESSFUL!");
    console.log("==================================================================");
    console.log("📍 Contract Address :", predictionTicketsAddress);
    console.log("📍 Owner Address    :", await predictionTickets.owner());
    console.log(`\n📄 Deployment artifact saved to: ${fileName}`);
    console.log("\n🔍 Verification command:");
    console.log(`   ${deploymentData.verificationCommands[0]}`);
    console.log("==================================================================\n");
}

main().catch((error) => {
    console.error("❌ PredictionTickets deployment failed:", error);
    process.exitCode = 1;
});
