const { ethers } = require("hardhat");
const { writeFileSync } = require("fs");

async function main() {
    console.log("🚀 Starting WEJE Ecosystem Deployment...\n");

    // Get signers
    const [deployer] = await ethers.getSigners();
    console.log("📝 Deploying with account:", deployer.address);
    console.log("💰 Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

    // Configuration
    const config = {
        // Token configuration
        tokenName: "WEJE Token",
        tokenSymbol: "WEJE",
        
        // Wallet addresses (replace with actual addresses)
        feeReceiver: "0x742d35Cc6461C0532c2D4f4d71f8dbF08a0Fd9B7", // Marketing wallet
        liquidityWallet: "0x8ba1f109551bD432803012645Hac136c22C10e1F", // Liquidity management
        emergencyRecipient: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", // Emergency wallet
        platformWallet: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", // Platform rewards
        
        // Timing configuration
        presaleDuration: 30 * 24 * 3600, // 30 days
        claimDelay: 7 * 24 * 3600, // 7 days after presale
        rewardStartDelay: 24 * 3600, // 1 day after claims
        
        // Allocation configuration (based on tokenomics)
        allocations: {
            presale: ethers.parseEther("150000000"), // 150M (15%)
            vesting: ethers.parseEther("120000000"), // 120M (12%)
            staking: ethers.parseEther("100000000"), // 100M (10%)
            platform: ethers.parseEther("250000000"), // 250M (25%)
            marketing: ethers.parseEther("80000000"),  // 80M (8%)
            liquidity: ethers.parseEther("100000000"), // 100M (10%)
            // Owner keeps remainder: 200M (20%)
        }
    };

    // Calculate deployment timing
    const currentTime = Math.floor(Date.now() / 1000);
    const presaleStart = currentTime + 3600; // 1 hour from now
    const presaleEnd = presaleStart + config.presaleDuration;
    const claimStart = presaleEnd + config.claimDelay;
    const rewardStart = claimStart + config.rewardStartDelay;

    console.log("⏰ Deployment Timeline:");
    console.log(`Current Time: ${new Date(currentTime * 1000).toISOString()}`);
    console.log(`Presale Start: ${new Date(presaleStart * 1000).toISOString()}`);
    console.log(`Presale End: ${new Date(presaleEnd * 1000).toISOString()}`);
    console.log(`Claim Start: ${new Date(claimStart * 1000).toISOString()}`);
    console.log(`Reward Start: ${new Date(rewardStart * 1000).toISOString()}\n`);

    let deployedContracts = {};

    try {
        // 1. Deploy WEJE Token
        console.log("1️⃣ Deploying WEJE Token...");
        const WejeToken = await ethers.getContractFactory("WejeToken");
        const wejeToken = await WejeToken.deploy(
            config.tokenName,
            config.tokenSymbol
        );
        await wejeToken.waitForDeployment();
        
        deployedContracts.wejeToken = {
            address: wejeToken.target,
            name: "WEJE Token"
        };
        console.log("✅ WEJE Token deployed to:", wejeToken.target);

        // 2. Deploy Mock USDC/USDT for testing (skip on mainnet)
        let usdcAddress, usdtAddress;
        
        if (network.name !== "mainnet") {
            console.log("\n2️⃣ Deploying Mock Stablecoins (Testnet Only)...");
            
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            
            const mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
            await mockUSDC.waitForDeployment();
            usdcAddress = mockUSDC.target;
            
            const mockUSDT = await MockERC20.deploy("Tether", "USDT", 6);
            await mockUSDT.waitForDeployment();
            usdtAddress = mockUSDT.target;
            
            deployedContracts.mockUSDC = { address: usdcAddress, name: "Mock USDC" };
            deployedContracts.mockUSDT = { address: usdtAddress, name: "Mock USDT" };
            
            console.log("✅ Mock USDC deployed to:", usdcAddress);
            console.log("✅ Mock USDT deployed to:", usdtAddress);
        } else {
            // Mainnet stablecoin addresses
            usdcAddress = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // Polygon USDC
            usdtAddress = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // Polygon USDT
            console.log("2️⃣ Using mainnet stablecoins:");
            console.log("USDC:", usdcAddress);
            console.log("USDT:", usdtAddress);
        }

        // 3. Deploy Presale Contract
        console.log("\n3️⃣ Deploying Presale Contract...");
        const WejePresale = await ethers.getContractFactory("WejePresale");
        const presale = await WejePresale.deploy(
            wejeToken.target,
            usdcAddress,
            usdtAddress,
            presaleStart,
            presaleEnd
        );
        await presale.waitForDeployment();
        
        deployedContracts.presale = {
            address: presale.target,
            name: "WEJE Presale"
        };
        console.log("✅ Presale Contract deployed to:", presale.target);

        // 4. Deploy Vesting Contract
        console.log("\n4️⃣ Deploying Vesting Contract...");
        const WejeVesting = await ethers.getContractFactory("WejeVesting");
        const vesting = await WejeVesting.deploy(
            wejeToken.target,
            config.emergencyRecipient
        );
        await vesting.waitForDeployment();
        
        deployedContracts.vesting = {
            address: vesting.target,
            name: "WEJE Vesting"
        };
        console.log("✅ Vesting Contract deployed to:", vesting.target);

        // 5. Deploy Staking Contract
        console.log("\n5️⃣ Deploying Staking Contract...");
        const WejeStaking = await ethers.getContractFactory("WejeStaking");
        const staking = await WejeStaking.deploy(
            wejeToken.target,
            config.allocations.staking,
            rewardStart
        );
        await staking.waitForDeployment();
        
        deployedContracts.staking = {
            address: staking.target,
            name: "WEJE Staking"
        };
        console.log("✅ Staking Contract deployed to:", staking.target);

        // 6. Configure Token Contract
        console.log("\n6️⃣ Configuring Token Contract...");
        
        // Exclude contracts from limits only (no fees to exclude from)
        console.log("Excluding contracts from limits...");
        await wejeToken.excludeFromLimits(presale.target, true);
        await wejeToken.excludeFromLimits(vesting.target, true);
        await wejeToken.excludeFromLimits(staking.target, true);
        await wejeToken.excludeFromLimits(config.platformWallet, true);
        
        console.log("✅ Token configuration completed");

        // 7. Distribute Tokens
        console.log("\n7️⃣ Distributing Tokens...");
        
        console.log("Transferring to Presale Contract:", ethers.formatEther(config.allocations.presale), "WEJE");
        await wejeToken.transfer(presale.target, config.allocations.presale);
        
        console.log("Transferring to Vesting Contract:", ethers.formatEther(config.allocations.vesting), "WEJE");
        await wejeToken.transfer(vesting.target, config.allocations.vesting);
        
        console.log("Transferring to Staking Contract:", ethers.formatEther(config.allocations.staking), "WEJE");
        await wejeToken.transfer(staking.target, config.allocations.staking);
        
        console.log("Transferring to Platform Wallet:", ethers.formatEther(config.allocations.platform), "WEJE");
        await wejeToken.transfer(config.platformWallet, config.allocations.platform);
        
        console.log("Keeping for Marketing:", ethers.formatEther(config.allocations.marketing), "WEJE");
        // Marketing tokens stay with deployer
        
        console.log("Keeping for Liquidity:", ethers.formatEther(config.allocations.liquidity), "WEJE");
        // Liquidity tokens stay with deployer for DEX listing
        
        console.log("✅ Token distribution completed");

        // 8. Verify Contract Balances
        console.log("\n8️⃣ Verifying Contract Balances...");
        
        const presaleBalance = await wejeToken.balanceOf(presale.target);
        const vestingBalance = await wejeToken.balanceOf(vesting.target);
        const stakingBalance = await wejeToken.balanceOf(staking.target);
        const platformBalance = await wejeToken.balanceOf(config.platformWallet);
        const deployerBalance = await wejeToken.balanceOf(deployer.address);
        
        console.log("Contract Balances:");
        console.log(`Presale: ${ethers.formatEther(presaleBalance)} WEJE`);
        console.log(`Vesting: ${ethers.formatEther(vestingBalance)} WEJE`);
        console.log(`Staking: ${ethers.formatEther(stakingBalance)} WEJE`);
        console.log(`Platform: ${ethers.formatEther(platformBalance)} WEJE`);
        console.log(`Deployer: ${ethers.formatEther(deployerBalance)} WEJE (includes Marketing + Liquidity)`);
        
        const totalDistributed = presaleBalance + vestingBalance + stakingBalance + 
                               platformBalance + deployerBalance;
        const totalSupply = await wejeToken.totalSupply();
        
        console.log(`Total Distributed: ${ethers.formatEther(totalDistributed)} WEJE`);
        console.log(`Total Supply: ${ethers.formatEther(totalSupply)} WEJE`);
        console.log(`Match: ${totalDistributed === totalSupply ? '✅' : '❌'}`);

        // 9. Create Team Vesting Schedules (Example)
        console.log("\n9️⃣ Creating Initial Vesting Schedules...");
        
        // Example team allocation (replace with actual addresses)
        const teamMembers = [
            { address: "0x742d35Cc6461C0532c2D4f4d71f8dbF08a0Fd9B7", amount: ethers.parseEther("30000000"), role: "CEO" },
            { address: "0x8ba1f109551bD432803012645Hac136c22C10e1F", amount: ethers.parseEther("20000000"), role: "CTO" },
            { address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", amount: ethers.parseEther("15000000"), role: "Lead_Developer" }
        ];
        
        if (teamMembers.every(member => ethers.isAddress(member.address))) {
            const addresses = teamMembers.map(m => m.address);
            const amounts = teamMembers.map(m => m.amount);
            const roles = teamMembers.map(m => m.role);
            
            await vesting.createTeamVesting(addresses, amounts, roles);
            console.log("✅ Team vesting schedules created");
        } else {
            console.log("⚠️ Skipping team vesting - update addresses in deployment script");
        }

        // 10. Generate Deployment Report
        console.log("\n🔟 Generating Deployment Report...");
        
        const deploymentReport = {
            network: network.name,
            deployer: deployer.address,
            deploymentTime: new Date().toISOString(),
            gasUsed: "Calculated after deployment",
            
            contracts: deployedContracts,
            
            configuration: {
                presaleStart: presaleStart,
                presaleEnd: presaleEnd,
                claimStart: claimStart,
                rewardStart: rewardStart,
                allocations: {
                    presale: ethers.formatEther(config.allocations.presale),
                    vesting: ethers.formatEther(config.allocations.vesting),
                    staking: ethers.formatEther(config.allocations.staking),
                    platform: ethers.formatEther(config.allocations.platform),
                    marketing: ethers.formatEther(config.allocations.marketing),
                    liquidity: ethers.formatEther(config.allocations.liquidity)
                }
            },
            
            wallets: {
                emergencyRecipient: config.emergencyRecipient,
                platformWallet: config.platformWallet
            },
            
            nextSteps: [
                "1. Verify contracts on block explorer",
                "2. Set up liquidity on DEX",
                "3. Configure frontend with contract addresses",
                "4. Set up monitoring and alerts",
                "5. Prepare marketing materials",
                "6. Schedule security audit",
                "7. Enable trading after delay"
            ]
        };

        // Save deployment report
        const reportFileName = `deployment-report-${network.name}-${Date.now()}.json`;
        writeFileSync(reportFileName, JSON.stringify(deploymentReport, null, 2));
        
        console.log("✅ Deployment completed successfully!");
        console.log(`📄 Deployment report saved to: ${reportFileName}`);
        
        // 11. Display Summary
        console.log("\n📋 DEPLOYMENT SUMMARY");
        console.log("=".repeat(50));
        console.log(`Network: ${network.name}`);
        console.log(`Deployer: ${deployer.address}`);
        console.log("\n📍 Contract Addresses:");
        
        Object.entries(deployedContracts).forEach(([key, contract]) => {
            console.log(`${contract.name}: ${contract.address}`);
        });
        
        console.log("\n⏰ Important Dates:");
        console.log(`Presale Start: ${new Date(presaleStart * 1000).toLocaleString()}`);
        console.log(`Presale End: ${new Date(presaleEnd * 1000).toLocaleString()}`);
        console.log(`Claims Start: ${new Date(claimStart * 1000).toLocaleString()}`);
        console.log(`Rewards Start: ${new Date(rewardStart * 1000).toLocaleString()}`);
        
        console.log("\n🔧 Next Steps:");
        deploymentReport.nextSteps.forEach((step, index) => {
            console.log(`${index + 1}. ${step}`);
        });

        // 12. Security Reminders
        console.log("\n🔒 SECURITY REMINDERS:");
        console.log("- Set up multi-signature wallets for all admin functions");
        console.log("- Schedule professional security audit before mainnet");
        console.log("- Test all functions thoroughly on testnet");
        console.log("- Prepare emergency response procedures");
        console.log("- Document all wallet addresses and recovery methods");
        
        return deployedContracts;

    } catch (error) {
        console.error("\n❌ Deployment failed:");
        console.error(error);
        
        // Save partial deployment info for debugging
        if (Object.keys(deployedContracts).length > 0) {
            const errorReport = {
                error: error.message,
                deployedContracts: deployedContracts,
                timestamp: new Date().toISOString()
            };
            writeFileSync(`deployment-error-${Date.now()}.json`, JSON.stringify(errorReport, null, 2));
        }
        
        throw error;
    }
}

// Handle promise rejections
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });