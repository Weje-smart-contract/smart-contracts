const { ethers, network } = require("hardhat");
const { writeFileSync } = require("fs");
require("dotenv").config();

async function main() {
    console.log("==================================================================");
    console.log("🚀 Starting Deployment of SportsBetting & PredictionTickets contracts");
    console.log("==================================================================\n");

    const [deployer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("📝 Deployer Account :", deployer.address);
    console.log("💰 Native Balance   :", ethers.formatEther(balance), "POL / ETH");
    console.log("🌐 Target Network   :", network.name, `(Chain ID: ${(await ethers.provider.getNetwork()).chainId})\n`);

    // 1. Configure Weje Token Address
    // Actual Polygon Mainnet Weje Token: 0xB0412e8EcfDF82197f3dC782803a63EF3557404d
    const WEJE_TOKEN_ADDRESS = process.env.WEJE_TOKEN_ADDRESS || "0xB0412e8EcfDF82197f3dC782803a63EF3557404d";
    console.log("🪙 Weje Token Address:", WEJE_TOKEN_ADDRESS);

    // 2. Deploy or specify ERC2771 Trusted Forwarder
    let forwarderAddress = process.env.TRUSTED_FORWARDER_ADDRESS;

    if (!forwarderAddress) {
        console.log("\n1️⃣ Deploying WejeForwarder (OpenZeppelin ERC-2771)...");
        const WejeForwarder = await ethers.getContractFactory("WejeForwarder");
        const forwarder = await WejeForwarder.deploy();
        await forwarder.waitForDeployment();
        forwarderAddress = await forwarder.getAddress();
        console.log("✅ WejeForwarder deployed to:", forwarderAddress);
    } else {
        console.log("\n1️⃣ Using existing Trusted Forwarder at:", forwarderAddress);
    }

    // 3. Deploy SportsBetting Contract
    console.log("\n2️⃣ Deploying SportsBetting Contract...");
    const SportsBetting = await ethers.getContractFactory("contracts/SportsBetting.sol:SportsBetting");
    const sportsBetting = await SportsBetting.deploy(WEJE_TOKEN_ADDRESS, forwarderAddress);
    await sportsBetting.waitForDeployment();
    const sportsBettingAddress = await sportsBetting.getAddress();
    console.log("✅ SportsBetting deployed to:", sportsBettingAddress);

    // 4. Deploy PredictionTickets Contract
    console.log("\n3️⃣ Deploying PredictionTickets Contract...");
    const PredictionTickets = await ethers.getContractFactory("contracts/PredictionContract.sol:PredictionTickets");
    const predictionTickets = await PredictionTickets.deploy(WEJE_TOKEN_ADDRESS, forwarderAddress);
    await predictionTickets.waitForDeployment();
    const predictionTicketsAddress = await predictionTickets.getAddress();
    console.log("✅ PredictionTickets deployed to:", predictionTicketsAddress);

    // 5. Optional: Configure Additional Admins / Relayers
    const adminAddresses = process.env.ADDITIONAL_ADMINS ? process.env.ADDITIONAL_ADMINS.split(",") : [];
    if (adminAddresses.length > 0) {
        console.log("\n4️⃣ Adding initial admins to PredictionTickets...");
        for (const admin of adminAddresses) {
            const trimmed = admin.trim();
            if (ethers.isAddress(trimmed)) {
                const tx = await predictionTickets.addAdmin(trimmed);
                await tx.wait();
                console.log(`   + Added admin: ${trimmed}`);
            }
        }
    }

    // 6. Summary & Export Deployment Report
    const deploymentData = {
        network: network.name,
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        deployer: deployer.address,
        deploymentTimestamp: new Date().toISOString(),
        contracts: {
            wejeToken: WEJE_TOKEN_ADDRESS,
            trustedForwarder: forwarderAddress,
            sportsBetting: sportsBettingAddress,
            predictionTickets: predictionTicketsAddress,
        },
        verificationCommands: [
            `npx hardhat verify --network ${network.name} ${forwarderAddress}`,
            `npx hardhat verify --network ${network.name} ${sportsBettingAddress} ${WEJE_TOKEN_ADDRESS} ${forwarderAddress}`,
            `npx hardhat verify --network ${network.name} ${predictionTicketsAddress} ${WEJE_TOKEN_ADDRESS} ${forwarderAddress}`
        ]
    };

    const fileName = `deployment-${network.name}-${Date.now()}.json`;
    writeFileSync(fileName, JSON.stringify(deploymentData, null, 2));

    console.log("\n==================================================================");
    console.log("🎉 DEPLOYMENT SUCCESSFUL!");
    console.log("==================================================================");
    console.log("📍 Weje Token Address        :", WEJE_TOKEN_ADDRESS);
    console.log("📍 Trusted Forwarder Address :", forwarderAddress);
    console.log("📍 SportsBetting Address     :", sportsBettingAddress);
    console.log("📍 PredictionTickets Address :", predictionTicketsAddress);
    console.log(`\n📄 Deployment artifact saved to: ${fileName}`);
    console.log("\n🔍 Verification commands:");
    deploymentData.verificationCommands.forEach(cmd => console.log(`   ${cmd}`));
    console.log("==================================================================\n");
}

main().catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exitCode = 1;
});
