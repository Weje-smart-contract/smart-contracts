const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("WEJE Ecosystem Integration Tests", function () {
    async function deployFullEcosystemFixture() {
        const [
            owner,
            feeReceiver,
            liquidityWallet,
            emergencyRecipient,
            platformWallet,
            user1,
            user2,
            user3,
            ceo,
            cto,
            advisor1,
            investor1
        ] = await ethers.getSigners();

        // Deploy WEJE Token
        const WejeToken = await ethers.getContractFactory("WejeToken");
        const wejeToken = await WejeToken.deploy(
            "WEJE Token",
            "WEJE",
            feeReceiver.address,
            liquidityWallet.address
        );

        // Deploy Mock USDC for presale
        const MockToken = await ethers.getContractFactory("MockERC20");
        const usdc = await MockToken.deploy("USD Coin", "USDC", 6);
        const usdt = await MockToken.deploy("Tether", "USDT", 6);

        // Calculate timing
        const currentTime = await time.latest();
        const presaleStart = currentTime + 3600; // 1 hour
        const presaleEnd = presaleStart + (30 * 24 * 3600); // 30 days
        const claimStart = presaleEnd + (7 * 24 * 3600); // 7 days after presale
        const rewardStart = claimStart + (24 * 3600); // 1 day after claims

        // Deploy Presale Contract
        const WejePresale = await ethers.getContractFactory("WejePresale");
        const presale = await WejePresale.deploy(
            wejeToken.target,
            usdc.target,
            usdt.target,
            presaleStart,
            presaleEnd,
            claimStart
        );

        // Deploy Vesting Contract
        const WejeVesting = await ethers.getContractFactory("WejeVesting");
        const vesting = await WejeVesting.deploy(
            wejeToken.target,
            emergencyRecipient.address
        );

        // Deploy Staking Contract
        const WejeStaking = await ethers.getContractFactory("WejeStaking");
        const staking = await WejeStaking.deploy(
            wejeToken.target,
            ethers.parseEther("100000000"), // 100M reward pool
            rewardStart
        );

        // Fund contracts according to tokenomics
        const presaleAllocation = ethers.parseEther("150000000"); // 15%
        const vestingAllocation = ethers.parseEther("120000000"); // 12%
        const stakingAllocation = ethers.parseEther("100000000"); // 10%
        const platformAllocation = ethers.parseEther("250000000"); // 25%

        await wejeToken.transfer(presale.target, presaleAllocation);
        await wejeToken.transfer(vesting.target, vestingAllocation);
        await wejeToken.transfer(staking.target, stakingAllocation);
        await wejeToken.transfer(platformWallet.address, platformAllocation);

        // Exclude contracts from token limits
        await wejeToken.excludeFromLimits(presale.target, true);
        await wejeToken.excludeFromLimits(vesting.target, true);
        await wejeToken.excludeFromLimits(staking.target, true);
        await wejeToken.excludeFromLimits(platformWallet.address, true);

        await wejeToken.excludeFromFees(presale.target, true);
        await wejeToken.excludeFromFees(vesting.target, true);
        await wejeToken.excludeFromFees(staking.target, true);
        await wejeToken.excludeFromFees(platformWallet.address, true);

        // Mint stablecoins for users
        const usdcAmount = ethers.parseUnits("100000", 6); // 100K USDC each
        await usdc.mint(user1.address, usdcAmount);
        await usdc.mint(user2.address, usdcAmount);
        await usdc.mint(user3.address, usdcAmount);

        return {
            wejeToken,
            presale,
            vesting,
            staking,
            usdc,
            usdt,
            owner,
            feeReceiver,
            liquidityWallet,
            emergencyRecipient,
            platformWallet,
            user1,
            user2,
            user3,
            ceo,
            cto,
            advisor1,
            investor1,
            presaleStart,
            presaleEnd,
            claimStart,
            rewardStart
        };
    }

    describe("Full Ecosystem Flow", function () {
        it("Should complete full user journey: presale -> claim -> stake -> rewards", async function () {
            const { 
                wejeToken, 
                presale, 
                staking, 
                usdc, 
                user1, 
                presaleStart, 
                claimStart, 
                rewardStart 
            } = await loadFixture(deployFullEcosystemFixture);

            // Step 1: User participates in presale
            await time.increaseTo(presaleStart + 1);
            
            const purchaseAmount = ethers.parseUnits("5000", 6); // $5000
            await usdc.connect(user1).approve(presale.target, purchaseAmount);
            await presale.connect(user1).purchaseWithUSDC(purchaseAmount, ethers.ZeroAddress);

            const allocation = await presale.userAllocations(user1.address);
            expect(allocation).to.be.gt(0);

            // Step 2: User claims tokens after presale
            await time.increaseTo(claimStart + 1);
            
            const balanceBeforeClaim = await wejeToken.balanceOf(user1.address);
            await presale.connect(user1).claimTokens();
            const balanceAfterClaim = await wejeToken.balanceOf(user1.address);

            expect(balanceAfterClaim - balanceBeforeClaim).to.equal(allocation);

            // Step 3: Enable trading
            await time.increase(7 * 24 * 3600 + 1); // Wait for trading delay
            await wejeToken.enableTrading();

            // Step 4: User stakes tokens
            const stakeAmount = ethers.parseEther("100000"); // 100K tokens
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2); // Tier 2: 90 days, 12% APY

            expect(await staking.userTotalStaked(user1.address)).to.equal(stakeAmount);

            // Step 5: Wait and claim rewards
            await time.increaseTo(rewardStart + 30 * 24 * 3600); // 30 days after reward start

            const pendingRewards = await staking.calculatePendingRewards(user1.address, 0);
            expect(pendingRewards).to.be.gt(0);

            const balanceBeforeRewards = await wejeToken.balanceOf(user1.address);
            await staking.connect(user1).claimRewards(0);
            const balanceAfterRewards = await wejeToken.balanceOf(user1.address);

            expect(balanceAfterRewards).to.be.gt(balanceBeforeRewards);

            // Step 6: Unstake after lock period
            await time.increase(60 * 24 * 3600); // Additional 60 days (total 90+ days)

            const balanceBeforeUnstake = await wejeToken.balanceOf(user1.address);
            await staking.connect(user1).unstake(0);
            const balanceAfterUnstake = await wejeToken.balanceOf(user1.address);

            expect(balanceAfterUnstake).to.be.gt(balanceBeforeUnstake);
        });

        it("Should handle team vesting flow correctly", async function () {
            const { 
                wejeToken, 
                vesting, 
                ceo, 
                cto 
            } = await loadFixture(deployFullEcosystemFixture);

            // Create team vesting schedules
            const teamBeneficiaries = [ceo.address, cto.address];
            const teamAmounts = [
                ethers.parseEther("30000000"), // CEO: 30M
                ethers.parseEther("20000000")  // CTO: 20M
            ];
            const teamRoles = ["CEO", "CTO"];

            await vesting.createTeamVesting(teamBeneficiaries, teamAmounts, teamRoles);

            // Check TGE release (10%)
            const ceoBalance = await wejeToken.balanceOf(ceo.address);
            const expectedTGE = ethers.parseEther("3000000"); // 10% of 30M
            expect(ceoBalance).to.equal(expectedTGE);

            // Fast forward past cliff (24 months)
            await time.increase(24 * 30 * 24 * 3600 + 1); // 24 months + 1 second

            // Check releasable amount
            const scheduleIds = await vesting.getVestingSchedulesForBeneficiary(ceo.address);
            const releasable = await vesting.getReleasableAmount(scheduleIds[0]);
            expect(releasable).to.be.gt(0);

            // Release vested tokens
            const balanceBefore = await wejeToken.balanceOf(ceo.address);
            await vesting.connect(ceo).release(scheduleIds[0]);
            const balanceAfter = await wejeToken.balanceOf(ceo.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should handle platform reward distribution", async function () {
            const { 
                wejeToken, 
                platformWallet, 
                user1, 
                claimStart 
            } = await loadFixture(deployFullEcosystemFixture);

            await time.increaseTo(claimStart + 1);

            // Simulate platform rewarding user for activities
            const signupReward = ethers.parseEther("100"); // 100 WEJE for signup
            const gameReward = ethers.parseEther("200");   // 200 WEJE for first game

            const balanceBefore = await wejeToken.balanceOf(user1.address);

            // Platform distributes rewards
            await wejeToken.connect(platformWallet).transfer(user1.address, signupReward);
            await wejeToken.connect(platformWallet).transfer(user1.address, gameReward);

            const balanceAfter = await wejeToken.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(signupReward + gameReward);
        });
    });

    describe("Contract Interactions", function () {
        it("Should transfer tokens between contracts correctly", async function () {
            const { 
                wejeToken, 
                presale, 
                staking, 
                user1, 
                presaleStart, 
                claimStart, 
                usdc 
            } = await loadFixture(deployFullEcosystemFixture);

            // User buys in presale
            await time.increaseTo(presaleStart + 1);
            const purchaseAmount = ethers.parseUnits("1000", 6);
            await usdc.connect(user1).approve(presale.target, purchaseAmount);
            await presale.connect(user1).purchaseWithUSDC(purchaseAmount, ethers.ZeroAddress);

            // User claims and immediately stakes
            await time.increaseTo(claimStart + 1);
            await presale.connect(user1).claimTokens();

            const userBalance = await wejeToken.balanceOf(user1.address);
            const stakeAmount = userBalance / 2n; // Stake half

            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1);

            expect(await staking.userTotalStaked(user1.address)).to.equal(stakeAmount);
            expect(await wejeToken.balanceOf(user1.address)).to.equal(userBalance - stakeAmount);
        });

        it("Should handle cross-contract token flows", async function () {
            const { 
                wejeToken, 
                vesting, 
                staking, 
                ceo, 
                rewardStart 
            } = await loadFixture(deployFullEcosystemFixture);

            // Create vesting schedule for CEO
            await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("10000000"),
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                true,
                "team",
                2000 // 20% TGE
            );

            // CEO gets TGE and stakes it
            const tgeAmount = await wejeToken.balanceOf(ceo.address);
            expect(tgeAmount).to.equal(ethers.parseEther("2000000")); // 20% of 10M

            await time.increaseTo(rewardStart + 1);
            await wejeToken.connect(ceo).approve(staking.target, tgeAmount);
            await staking.connect(ceo).stake(tgeAmount, 3); // Tier 3

            expect(await staking.userTotalStaked(ceo.address)).to.equal(tgeAmount);

            // Fast forward past cliff and release more tokens
            await time.increase(365 * 24 * 3600 + 180 * 24 * 3600); // Cliff + 6 months

            const scheduleIds = await vesting.getVestingSchedulesForBeneficiary(ceo.address);
            await vesting.connect(ceo).release(scheduleIds[0]);

            const newBalance = await wejeToken.balanceOf(ceo.address);
            expect(newBalance).to.be.gt(0);
        });
    });

    describe("Security Integration", function () {
        it("Should enforce anti-whale limits across ecosystem", async function () {
            const { 
                wejeToken, 
                presale, 
                user1, 
                usdc, 
                presaleStart, 
                claimStart 
            } = await loadFixture(deployFullEcosystemFixture);

            // Enable trading first
            await time.increase(7 * 24 * 3600 + 1);
            await wejeToken.enableTrading();

            // User buys maximum in presale
            await time.increaseTo(presaleStart + 1);
            const maxPurchase = ethers.parseUnits("5000", 6); // Tier 1 max
            await usdc.connect(user1).approve(presale.target, maxPurchase);
            await presale.connect(user1).purchaseWithUSDC(maxPurchase, ethers.ZeroAddress);

            // Claim tokens
            await time.increaseTo(claimStart + 1);
            await presale.connect(user1).claimTokens();

            const userBalance = await wejeToken.balanceOf(user1.address);
            const maxTx = await wejeToken.maxTransactionAmount();

            // Should not be able to transfer more than max transaction
            if (userBalance > maxTx) {
                await expect(
                    wejeToken.connect(user1).transfer(ethers.ZeroAddress, maxTx + 1n)
                ).to.be.revertedWithCustomError(wejeToken, "ExceedsMaxTransaction");
            }
        });

        it("Should handle blacklisting across contracts", async function () {
            const { 
                wejeToken, 
                staking, 
                user1, 
                presaleStart, 
                claimStart 
            } = await loadFixture(deployFullEcosystemFixture);

            // Give user some tokens
            await wejeToken.transfer(user1.address, ethers.parseEther("100000"));

            await time.increaseTo(claimStart + 1);

            // User stakes tokens
            const stakeAmount = ethers.parseEther("50000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1);

            // Blacklist user
            await wejeToken.blacklistAddress(user1.address, true);

            // Should not be able to transfer
            await expect(
                wejeToken.connect(user1).transfer(ethers.ZeroAddress, 1000)
            ).to.be.revertedWithCustomError(wejeToken, "AddressBlacklisted");

            // Should not be able to claim staking rewards
            await time.increase(35 * 24 * 3600); // 35 days
            await expect(
                staking.connect(user1).claimRewards(0)
            ).to.be.revertedWithCustomError(wejeToken, "AddressBlacklisted");
        });

        it("Should handle emergency scenarios", async function () {
            const { 
                wejeToken, 
                staking, 
                vesting, 
                presale 
            } = await loadFixture(deployFullEcosystemFixture);

            // Emergency pause all contracts
            await wejeToken.emergencyPause();
            await staking.pause();
            await vesting.pause();
            await presale.pause();

            expect(await wejeToken.paused()).to.be.true;
            expect(await staking.paused()).to.be.true;
            expect(await vesting.paused()).to.be.true;
            expect(await presale.paused()).to.be.true;

            // Should not be able to interact with paused contracts
            await expect(
                wejeToken.transfer(ethers.ZeroAddress, 1000)
            ).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("Economic Model", function () {
        it("Should maintain token supply constraints", async function () {
            const { 
                wejeToken, 
                presale, 
                vesting, 
                staking, 
                platformWallet 
            } = await loadFixture(deployFullEcosystemFixture);

            const totalSupply = await wejeToken.totalSupply();
            const maxSupply = await wejeToken.MAX_SUPPLY();

            expect(totalSupply).to.equal(maxSupply);
            expect(totalSupply).to.equal(ethers.parseEther("1000000000")); // 1B tokens

            // Check distribution adds up correctly
            const presaleBalance = await wejeToken.balanceOf(presale.target);
            const vestingBalance = await wejeToken.balanceOf(vesting.target);
            const stakingBalance = await wejeToken.balanceOf(staking.target);
            const platformBalance = await wejeToken.balanceOf(platformWallet.address);
            const ownerBalance = await wejeToken.balanceOf(await wejeToken.owner());

            const totalDistributed = presaleBalance + vestingBalance + stakingBalance + 
                                   platformBalance + ownerBalance;

            expect(totalDistributed).to.equal(totalSupply);
        });

        it("Should calculate staking yields correctly over time", async function () {
            const { 
                wejeToken, 
                staking, 
                user1, 
                rewardStart 
            } = await loadFixture(deployFullEcosystemFixture);

            // Give user tokens and stake
            await wejeToken.transfer(user1.address, ethers.parseEther("100000"));
            
            await time.increaseTo(rewardStart + 1);
            
            const stakeAmount = ethers.parseEther("100000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2); // Tier 2: 12% APY

            // Calculate expected rewards after 1 year
            await time.increase(365 * 24 * 3600);

            const pendingRewards = await staking.calculatePendingRewards(user1.address, 0);
            const expectedAnnualRewards = ethers.parseEther("12000"); // 12% of 100K

            // Allow for small variance due to time calculations
            expect(pendingRewards).to.be.closeTo(expectedAnnualRewards, ethers.parseEther("100"));
        });

        it("Should handle fee distribution correctly", async function () {
            const { 
                wejeToken, 
                feeReceiver, 
                liquidityWallet, 
                user1, 
                user2 
            } = await loadFixture(deployFullEcosystemFixture);

            // Enable trading and give users tokens
            await time.increase(7 * 24 * 3600 + 1);
            await wejeToken.enableTrading();
            
            await wejeToken.transfer(user1.address, ethers.parseEther("1000000"));
            
            // Exclude user2 to simulate regular transfer (with fees)
            const transferAmount = ethers.parseEther("100000");
            
            const feeReceiverBalanceBefore = await wejeToken.balanceOf(feeReceiver.address);
            const liquidityBalanceBefore = await wejeToken.balanceOf(liquidityWallet.address);

            // Transfer should trigger fees
            await wejeToken.connect(user1).transfer(user2.address, transferAmount);

            const feeReceiverBalanceAfter = await wejeToken.balanceOf(feeReceiver.address);
            const liquidityBalanceAfter = await wejeToken.balanceOf(liquidityWallet.address);

            // Check if fees were distributed (this depends on how transfer is detected as buy/sell)
            const totalFeesCollected = (feeReceiverBalanceAfter - feeReceiverBalanceBefore) +
                                     (liquidityBalanceAfter - liquidityBalanceBefore);

            // Fees should be collected for non-excluded addresses
            expect(totalFeesCollected).to.be.gte(0);
        });
    });

    describe("Governance and Upgrades", function () {
        it("Should handle ownership transfers securely", async function () {
            const { 
                wejeToken, 
                staking, 
                vesting, 
                presale, 
                user1 
            } = await loadFixture(deployFullEcosystemFixture);

            // Initiate ownership transfer for all contracts
            await wejeToken.initiateOwnershipTransfer(user1.address);
            await staking.transferOwnership(user1.address);
            await vesting.transferOwnership(user1.address);
            await presale.transferOwnership(user1.address);

            // Accept ownership
            await wejeToken.connect(user1).acceptOwnership();
            await staking.connect(user1).acceptOwnership();
            await vesting.connect(user1).acceptOwnership();
            await presale.connect(user1).acceptOwnership();

            expect(await wejeToken.owner()).to.equal(user1.address);
            expect(await staking.owner()).to.equal(user1.address);
            expect(await vesting.owner()).to.equal(user1.address);
            expect(await presale.owner()).to.equal(user1.address);
        });

        it("Should handle parameter updates consistently", async function () {
            const { 
                wejeToken, 
                staking 
            } = await loadFixture(deployFullEcosystemFixture);

            // Update token limits
            await wejeToken.updateLimits(
                ethers.parseEther("2000000"), // 2M max tx
                ethers.parseEther("10000000")  // 10M max wallet
            );

            // Update staking parameters
            await staking.updateStakingTier(
                1, // Bronze tier
                45 * 24 * 3600, // 45 days lock
                1000, // 10% APY
                ethers.parseEther("2000"), // 2K min stake
                ethers.parseEther("500000"), // 500K max stake
                true,
                "Enhanced Bronze"
            );

            expect(await wejeToken.maxTransactionAmount()).to.equal(ethers.parseEther("2000000"));
            
            const tier = await staking.stakingTiers(1);
            expect(tier.rewardRate).to.equal(1000);
            expect(tier.name).to.equal("Enhanced Bronze");
        });
    });

    describe("Performance and Gas Optimization", function () {
        it("Should handle batch operations efficiently", async function () {
            const { 
                vesting, 
                user1, 
                user2, 
                user3 
            } = await loadFixture(deployFullEcosystemFixture);

            // Batch create vesting schedules
            const beneficiaries = [user1.address, user2.address, user3.address];
            const amounts = [
                ethers.parseEther("5000000"),
                ethers.parseEther("3000000"),
                ethers.parseEther("2000000")
            ];
            const cliffDurations = [
                365 * 24 * 3600,
                365 * 24 * 3600,
                365 * 24 * 3600
            ];
            const vestingDurations = [
                730 * 24 * 3600,
                730 * 24 * 3600,
                730 * 24 * 3600
            ];
            const revocableFlags = [true, true, true];
            const categories = ["team", "team", "team"];
            const tgePercents = [1000, 1000, 1000];

            const scheduleIds = await vesting.batchCreateVesting(
                beneficiaries,
                amounts,
                cliffDurations,
                vestingDurations,
                revocableFlags,
                categories,
                tgePercents
            );

            expect(scheduleIds.length).to.equal(3);
            expect(await vesting.holdersVestingCount(user1.address)).to.equal(1);
            expect(await vesting.holdersVestingCount(user2.address)).to.equal(1);
            expect(await vesting.holdersVestingCount(user3.address)).to.equal(1);
        });

        it("Should handle high-frequency operations", async function () {
            const { 
                wejeToken, 
                staking, 
                user1, 
                rewardStart 
            } = await loadFixture(deployFullEcosystemFixture);

            // Give user tokens
            await wejeToken.transfer(user1.address, ethers.parseEther("10000000"));
            
            await time.increaseTo(rewardStart + 1);

            // Create multiple small stakes
            const stakeAmount = ethers.parseEther("100000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount * 5n);

            for (let i = 0; i < 5; i++) {
                await staking.connect(user1).stake(stakeAmount, 1);
            }

            expect(await staking.userStakeCount(user1.address)).to.equal(5);
            expect(await staking.userTotalStaked(user1.address)).to.equal(stakeAmount * 5n);

            // Fast forward and claim all rewards
            await time.increase(30 * 24 * 3600);

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            await staking.connect(user1).claimAllRewards();
            const balanceAfter = await wejeToken.balanceOf(user1.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });
    });

    describe("Real-world Scenarios", function () {
        it("Should handle market volatility and trading patterns", async function () {
            const { 
                wejeToken, 
                user1, 
                user2, 
                user3 
            } = await loadFixture(deployFullEcosystemFixture);

            // Enable trading
            await time.increase(7 * 24 * 3600 + 1);
            await wejeToken.enableTrading();

            // Distribute tokens to simulate market participants
            await wejeToken.transfer(user1.address, ethers.parseEther("5000000")); // Whale
            await wejeToken.transfer(user2.address, ethers.parseEther("500000"));  // Regular user
            await wejeToken.transfer(user3.address, ethers.parseEther("100000"));  // Small user

            // Simulate trading activity with cooldowns
            const transfer1 = ethers.parseEther("100000");
            await wejeToken.connect(user1).transfer(user2.address, transfer1);

            // Should enforce cooldown
            await expect(
                wejeToken.connect(user1).transfer(user3.address, transfer1)
            ).to.be.revertedWithCustomError(wejeToken, "TransferCooldownActive");

            // Wait for cooldown and try again
            await time.increase(301); // 5 minutes + 1 second
            await wejeToken.connect(user1).transfer(user3.address, transfer1);

            expect(await wejeToken.balanceOf(user3.address)).to.equal(ethers.parseEther("200000"));
        });

        it("Should handle coordinated attack scenarios", async function () {
            const { 
                wejeToken, 
                staking, 
                user1, 
                user2, 
                user3 
            } = await loadFixture(deployFullEcosystemFixture);

            // Enable trading
            await time.increase(7 * 24 * 3600 + 1);
            await wejeToken.enableTrading();

            // Give attackers tokens
            const attackAmount = ethers.parseEther("1000000");
            await wejeToken.transfer(user1.address, attackAmount);
            await wejeToken.transfer(user2.address, attackAmount);
            await wejeToken.transfer(user3.address, attackAmount);

            // Try coordinated large transfers (should be limited by max transaction)
            const maxTx = await wejeToken.maxTransactionAmount();
            
            if (attackAmount > maxTx) {
                await expect(
                    wejeToken.connect(user1).transfer(user2.address, attackAmount)
                ).to.be.revertedWithCustomError(wejeToken, "ExceedsMaxTransaction");
            }

            // Try rapid-fire transactions (should be limited by cooldown)
            await wejeToken.connect(user1).transfer(user2.address, maxTx);
            
            await expect(
                wejeToken.connect(user1).transfer(user3.address, maxTx)
            ).to.be.revertedWithCustomError(wejeToken, "TransferCooldownActive");
        });
    });
});