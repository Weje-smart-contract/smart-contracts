const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("WejeStaking", function () {
    async function deployStakingFixture() {
        const [owner, user1, user2, user3, premiumUser, unauthorized] = await ethers.getSigners();

        // Deploy WEJE Token
        const WejeToken = await ethers.getContractFactory("WejeToken");
        const wejeToken = await WejeToken.deploy(
            "WEJE Token",
            "WEJE",
            owner.address,
            owner.address
        );

        // Calculate staking parameters
        const rewardPoolAmount = ethers.parseEther("100000000"); // 100M tokens
        const currentTime = await time.latest();
        const rewardStartTime = currentTime + 3600; // 1 hour from now

        // Deploy Staking Contract
        const WejeStaking = await ethers.getContractFactory("WejeStaking");
        const staking = await WejeStaking.deploy(
            wejeToken.target,
            rewardPoolAmount,
            rewardStartTime
        );

        // Fund staking contract with reward tokens
        await wejeToken.transfer(staking.target, rewardPoolAmount);

        // Give users some tokens to stake
        const userAllocation = ethers.parseEther("10000000"); // 10M tokens each
        await wejeToken.transfer(user1.address, userAllocation);
        await wejeToken.transfer(user2.address, userAllocation);
        await wejeToken.transfer(user3.address, userAllocation);
        await wejeToken.transfer(premiumUser.address, userAllocation);

        return {
            wejeToken,
            staking,
            owner,
            user1,
            user2,
            user3,
            premiumUser,
            unauthorized,
            rewardPoolAmount,
            rewardStartTime,
            userAllocation
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            const { staking, wejeToken, rewardPoolAmount, rewardStartTime } = await loadFixture(deployStakingFixture);

            expect(await staking.wejeToken()).to.equal(wejeToken.target);
            expect(await staking.rewardPool()).to.equal(rewardPoolAmount);
            expect(await staking.rewardStartTime()).to.equal(rewardStartTime);
            expect(await staking.totalTiers()).to.equal(4);
        });

        it("Should initialize staking tiers correctly", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            // Check Tier 1 (Bronze)
            const tier1 = await staking.stakingTiers(1);
            expect(tier1.lockPeriod).to.equal(30 * 24 * 3600); // 30 days
            expect(tier1.rewardRate).to.equal(800); // 8%
            expect(tier1.minStakeAmount).to.equal(ethers.parseEther("1000"));
            expect(tier1.maxStakeAmount).to.equal(ethers.parseEther("1000000"));
            expect(tier1.isActive).to.be.true;
            expect(tier1.name).to.equal("Bronze");

            // Check Tier 4 (Diamond)
            const tier4 = await staking.stakingTiers(4);
            expect(tier4.lockPeriod).to.equal(365 * 24 * 3600); // 365 days
            expect(tier4.rewardRate).to.equal(2500); // 25%
            expect(tier4.minStakeAmount).to.equal(ethers.parseEther("25000"));
            expect(tier4.name).to.equal("Diamond");
        });

        it("Should set correct reward calculation", async function () {
            const { staking, rewardPoolAmount } = await loadFixture(deployStakingFixture);

            const rewardPoolDuration = 5 * 365 * 24 * 3600; // 5 years
            const expectedRewardPerSecond = rewardPoolAmount / BigInt(rewardPoolDuration);
            
            expect(await staking.rewardPerSecond()).to.equal(expectedRewardPerSecond);
        });
    });

    describe("Staking Functions", function () {
        it("Should stake tokens successfully", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("5000");
            const tier = 1;

            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, tier))
                .to.emit(staking, "Staked")
                .withArgs(user1.address, 0, stakeAmount, tier, 30 * 24 * 3600, 800);

            expect(await staking.userStakeCount(user1.address)).to.equal(1);
            expect(await staking.userTotalStaked(user1.address)).to.equal(stakeAmount);
            expect(await staking.totalStaked()).to.equal(stakeAmount);
        });

        it("Should enforce minimum stake amount", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("500"); // Below 1000 minimum for tier 1
            const tier = 1;

            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, tier))
                .to.be.revertedWithCustomError(staking, "InvalidAmount");
        });

        it("Should enforce maximum stake amount", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("2000000"); // Above 1M max for tier 1
            const tier = 1;

            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, tier))
                .to.be.revertedWithCustomError(staking, "InvalidAmount");
        });

        it("Should enforce maximum stakes per user", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("5000");
            const tier = 1;

            await wejeToken.connect(user1).approve(staking.target, stakeAmount * 15n);

            // Stake up to the limit (10 stakes)
            for (let i = 0; i < 10; i++) {
                await staking.connect(user1).stake(stakeAmount, tier);
            }

            // 11th stake should fail
            await expect(staking.connect(user1).stake(stakeAmount, tier))
                .to.be.revertedWithCustomError(staking, "MaxStakesReached");
        });

        it("Should reject invalid tier", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("5000");

            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, 0))
                .to.be.revertedWithCustomError(staking, "InvalidTier");

            await expect(staking.connect(user1).stake(stakeAmount, 5))
                .to.be.revertedWithCustomError(staking, "InvalidTier");
        });

        it("Should handle inactive tier", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Deactivate tier 2
            await staking.updateStakingTier(
                2,
                90 * 24 * 3600,
                1200,
                ethers.parseEther("5000"),
                ethers.parseEther("2000000"),
                false, // inactive
                "Silver"
            );

            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, 2))
                .to.be.revertedWithCustomError(staking, "TierNotActive");
        });

        it("Should apply premium user bonus", async function () {
            const { staking, wejeToken, premiumUser } = await loadFixture(deployStakingFixture);

            // Set user as premium
            await staking.setPremiumUser(premiumUser.address, true);

            const stakeAmount = ethers.parseEther("5000");
            const tier = 1;

            await wejeToken.connect(premiumUser).approve(staking.target, stakeAmount);
            await staking.connect(premiumUser).stake(stakeAmount, tier);

            const userStakes = await staking.getUserStakes(premiumUser.address);
            const stake = userStakes[0];

            // Tier 1 base rate: 800 (8%) + premium bonus: 200 (2%) = 1000 (10%)
            expect(stake.rewardRate).to.equal(1000);
        });
    });

    describe("Unstaking Functions", function () {
        beforeEach(async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);
            
            const stakeAmount = ethers.parseEther("10000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1); // Tier 1: 30 days lock
        });

        it("Should not allow unstaking before lock period", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await expect(staking.connect(user1).unstake(0))
                .to.be.revertedWithCustomError(staking, "StakeLocked");
        });

        it("Should allow unstaking after lock period", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Fast forward past lock period
            await time.increase(31 * 24 * 3600); // 31 days

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            
            await expect(staking.connect(user1).unstake(0))
                .to.emit(staking, "Unstaked");

            const balanceAfter = await wejeToken.balanceOf(user1.address);
            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should calculate and distribute rewards on unstaking", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Fast forward past lock period
            await time.increase(31 * 24 * 3600);

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            await staking.connect(user1).unstake(0);
            const balanceAfter = await wejeToken.balanceOf(user1.address);

            // Should receive original stake plus rewards
            const originalStake = ethers.parseEther("10000");
            expect(balanceAfter - balanceBefore).to.be.gt(originalStake);
        });

        it("Should update contract state on unstaking", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const originalTotalStaked = await staking.totalStaked();
            const originalUserStaked = await staking.userTotalStaked(user1.address);

            await time.increase(31 * 24 * 3600);
            await staking.connect(user1).unstake(0);

            expect(await staking.totalStaked()).to.be.lt(originalTotalStaked);
            expect(await staking.userTotalStaked(user1.address)).to.be.lt(originalUserStaked);

            const userStakes = await staking.getUserStakes(user1.address);
            expect(userStakes[0].isActive).to.be.false;
        });

        it("Should handle invalid stake index", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await expect(staking.connect(user1).unstake(5))
                .to.be.revertedWithCustomError(staking, "InvalidStakeIndex");
        });

        it("Should not allow unstaking inactive stake", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await time.increase(31 * 24 * 3600);
            await staking.connect(user1).unstake(0); // First unstake

            await expect(staking.connect(user1).unstake(0)) // Try to unstake again
                .to.be.revertedWithCustomError(staking, "StakeNotActive");
        });
    });

    describe("Reward Claiming", function () {
        beforeEach(async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);
            
            const stakeAmount = ethers.parseEther("10000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2); // Tier 2: 90 days, 12% APY
        });

        it("Should calculate pending rewards correctly", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            // Fast forward 30 days
            await time.increase(30 * 24 * 3600);

            const pendingRewards = await staking.calculatePendingRewards(user1.address, 0);
            expect(pendingRewards).to.be.gt(0);

            // Approximate calculation: 10,000 * 12% * 30/365 ≈ 98.6 tokens
            const approximateRewards = ethers.parseEther("98");
            expect(pendingRewards).to.be.gte(approximateRewards);
        });

        it("Should claim rewards successfully", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            await time.increase(30 * 24 * 3600);

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            
            await expect(staking.connect(user1).claimRewards(0))
                .to.emit(staking, "RewardsClaimed");

            const balanceAfter = await wejeToken.balanceOf(user1.address);
            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should enforce claim cooldown", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await time.increase(30 * 24 * 3600);

            // First claim should work
            await staking.connect(user1).claimRewards(0);

            // Second claim within cooldown should fail
            await expect(staking.connect(user1).claimRewards(0))
                .to.be.revertedWithCustomError(staking, "ClaimTooEarly");
        });

        it("Should claim all rewards from multiple stakes", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Create second stake
            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1); // Tier 1

            await time.increase(30 * 24 * 3600);

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            await staking.connect(user1).claimAllRewards();
            const balanceAfter = await wejeToken.balanceOf(user1.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should handle auto-compound feature", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            // Enable auto-compound
            await staking.connect(user1).toggleAutoCompound(0);

            await time.increase(30 * 24 * 3600);

            const stakeAmountBefore = (await staking.getUserStakes(user1.address))[0].amount;
            await staking.connect(user1).claimRewards(0);
            const stakeAmountAfter = (await staking.getUserStakes(user1.address))[0].amount;

            expect(stakeAmountAfter).to.be.gt(stakeAmountBefore);
        });

        it("Should apply auto-compound fee", async function () {
            const { staking, wejeToken, user1, owner } = await loadFixture(deployStakingFixture);

            await staking.connect(user1).toggleAutoCompound(0);
            await time.increase(30 * 24 * 3600);

            const ownerBalanceBefore = await wejeToken.balanceOf(owner.address);
            await staking.connect(user1).claimRewards(0);
            const ownerBalanceAfter = await wejeToken.balanceOf(owner.address);

            // Owner should receive the auto-compound fee
            expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);
        });
    });

    describe("Emergency Unstaking", function () {
        beforeEach(async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);
            
            const stakeAmount = ethers.parseEther("10000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2); // Tier 2: 90 days lock
        });

        it("Should allow emergency unstaking with fee", async function () {
            const { staking, wejeToken, user1, owner } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("10000");
            const emergencyFee = await staking.emergencyWithdrawFee(); // 20%
            const expectedFee = stakeAmount * emergencyFee / 10000n;
            const expectedWithdraw = stakeAmount - expectedFee;

            const userBalanceBefore = await wejeToken.balanceOf(user1.address);
            const ownerBalanceBefore = await wejeToken.balanceOf(owner.address);

            await expect(staking.connect(user1).emergencyUnstake(0))
                .to.emit(staking, "EmergencyWithdraw")
                .withArgs(user1.address, 0, expectedWithdraw, expectedFee);

            const userBalanceAfter = await wejeToken.balanceOf(user1.address);
            const ownerBalanceAfter = await wejeToken.balanceOf(owner.address);

            expect(userBalanceAfter - userBalanceBefore).to.equal(expectedWithdraw);
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(expectedFee);
        });

        it("Should update state correctly on emergency unstake", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await staking.connect(user1).emergencyUnstake(0);

            const userStakes = await staking.getUserStakes(user1.address);
            expect(userStakes[0].isActive).to.be.false;
            expect(await staking.userTotalStaked(user1.address)).to.equal(0);
        });
    });

    describe("Tier Management", function () {
        it("Should update staking tier parameters", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await expect(staking.updateStakingTier(
                1, // tier
                60 * 24 * 3600, // 60 days lock
                1500, // 15% APY
                ethers.parseEther("2000"), // min stake
                ethers.parseEther("500000"), // max stake
                true, // active
                "Updated Bronze"
            )).to.emit(staking, "TierUpdated");

            const tier = await staking.stakingTiers(1);
            expect(tier.lockPeriod).to.equal(60 * 24 * 3600);
            expect(tier.rewardRate).to.equal(1500);
            expect(tier.minStakeAmount).to.equal(ethers.parseEther("2000"));
            expect(tier.name).to.equal("Updated Bronze");
        });

        it("Should add new tier", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await staking.addNewTier(
                730 * 24 * 3600, // 2 years lock
                3500, // 35% APY
                ethers.parseEther("100000"), // min stake
                ethers.parseEther("50000000"), // max stake
                "Platinum"
            );

            expect(await staking.totalTiers()).to.equal(5);
            
            const newTier = await staking.stakingTiers(5);
            expect(newTier.name).to.equal("Platinum");
            expect(newTier.rewardRate).to.equal(3500);
        });

        it("Should update premium bonuses", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await staking.updatePremiumBonus(1, 500); // 5% bonus for tier 1
            expect(await staking.tierPremiumBonus(1)).to.equal(500);
        });
    });

    describe("Admin Functions", function () {
        it("Should update reward pool", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            const newAmount = ethers.parseEther("200000000");
            const newDuration = 10 * 365 * 24 * 3600; // 10 years

            await expect(staking.updateRewardPool(newAmount, newDuration))
                .to.emit(staking, "RewardPoolUpdated")
                .withArgs(newAmount, newDuration);

            expect(await staking.rewardPool()).to.equal(newAmount);
            expect(await staking.rewardPoolDuration()).to.equal(newDuration);
        });

        it("Should set premium users", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await expect(staking.setPremiumUser(user1.address, true))
                .to.emit(staking, "PremiumStatusUpdated")
                .withArgs(user1.address, true);

            expect(await staking.isPremiumUser(user1.address)).to.be.true;
        });

        it("Should update emergency withdraw fee", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await staking.updateEmergencyWithdrawFee(1500); // 15%
            expect(await staking.emergencyWithdrawFee()).to.equal(1500);
        });

        it("Should reject fees that are too high", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await expect(staking.updateEmergencyWithdrawFee(6000)) // 60%
                .to.be.revertedWith("Fee too high");
        });

        it("Should update auto-compound fee", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await staking.updateAutoCompoundFee(200); // 2%
            expect(await staking.autoCompoundFee()).to.equal(200);
        });

        it("Should update max stakes per user", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await staking.updateMaxStakesPerUser(20);
            expect(await staking.maxStakesPerUser()).to.equal(20);
        });

        it("Should update minimum claim interval", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            await staking.updateMinClaimInterval(2 * 24 * 3600); // 2 days
            expect(await staking.minClaimInterval()).to.equal(2 * 24 * 3600);
        });
    });

    describe("User Preference Functions", function () {
        beforeEach(async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);
            
            const stakeAmount = ethers.parseEther("10000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1);
        });

        it("Should toggle auto-compound for specific stake", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await expect(staking.connect(user1).toggleAutoCompound(0))
                .to.emit(staking, "AutoCompoundToggled")
                .withArgs(user1.address, 0, true);

            expect(await staking.autoCompoundEnabled(user1.address, 0)).to.be.true;

            // Toggle again
            await staking.connect(user1).toggleAutoCompound(0);
            expect(await staking.autoCompoundEnabled(user1.address, 0)).to.be.false;
        });

        it("Should set auto-compound for all stakes", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Create second stake
            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2);

            await staking.connect(user1).setAutoCompoundForAllStakes(true);

            expect(await staking.autoCompoundEnabled(user1.address, 0)).to.be.true;
            expect(await staking.autoCompoundEnabled(user1.address, 1)).to.be.true;
        });

        it("Should handle invalid stake index in toggle", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            await expect(staking.connect(user1).toggleAutoCompound(5))
                .to.be.revertedWithCustomError(staking, "InvalidStakeIndex");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);
            
            const stakeAmount = ethers.parseEther("10000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2); // Tier 2
        });

        it("Should return all staking tiers", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            const tiers = await staking.getAllStakingTiers();
            expect(tiers.length).to.equal(4);
            expect(tiers[0].name).to.equal("Bronze");
            expect(tiers[3].name).to.equal("Diamond");
        });

        it("Should return user stakes", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const userStakes = await staking.getUserStakes(user1.address);
            expect(userStakes.length).to.equal(1);
            expect(userStakes[0].amount).to.equal(ethers.parseEther("10000"));
            expect(userStakes[0].tier).to.equal(2);
            expect(userStakes[0].isActive).to.be.true;
        });

        it("Should return user active stakes", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const result = await staking.getUserActiveStakes(user1.address);
            expect(result.activeStakes.length).to.equal(1);
            expect(result.stakeIndexes.length).to.equal(1);
            expect(result.stakeIndexes[0]).to.equal(0);
        });

        it("Should return user staking stats", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const stats = await staking.getUserStakingStats(user1.address);
            expect(stats.totalStaked_).to.equal(ethers.parseEther("10000"));
            expect(stats.activeStakesCount).to.equal(1);
            expect(stats.isPremium).to.be.false;
        });

        it("Should return global stats", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            const stats = await staking.getGlobalStats();
            expect(stats.totalStaked_).to.equal(ethers.parseEther("10000"));
            expect(stats.totalStakers_).to.equal(1);
            expect(stats.totalTiers_).to.equal(4);
        });

        it("Should return tier stats", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            const stats = await staking.getTierStats(2);
            expect(stats.name).to.equal("Silver");
            expect(stats.totalStaked_).to.equal(ethers.parseEther("10000"));
            expect(stats.stakersCount_).to.equal(0); // This might be 0 due to how it's calculated
            expect(stats.rewardRate).to.equal(1200);
        });

        it("Should return stake details", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const details = await staking.getStakeDetails(user1.address, 0);
            expect(details.amount).to.equal(ethers.parseEther("10000"));
            expect(details.tier).to.equal(2);
            expect(details.canUnstake).to.be.false; // Still locked
            expect(details.tierName).to.equal("Silver");
        });

        it("Should check if user can stake", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const result = await staking.canUserStake(user1.address, ethers.parseEther("5000"), 1);
            expect(result.canStake).to.be.true;
            expect(result.reason).to.equal("Can stake");
        });

        it("Should return projected rewards", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const projected = await staking.calculateProjectedRewards(
                ethers.parseEther("10000"),
                2, // Tier 2
                365 // 1 year
            );

            // 10,000 * 12% = 1,200 tokens per year
            const expectedRewards = ethers.parseEther("1200");
            expect(projected).to.be.closeTo(expectedRewards, ethers.parseEther("50"));
        });

        it("Should return time until unlock", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const timeUntilUnlock = await staking.getTimeUntilUnlock(user1.address, 0);
            expect(timeUntilUnlock).to.be.gt(0);
            expect(timeUntilUnlock).to.be.lte(90 * 24 * 3600); // Max 90 days
        });

        it("Should return stakes by tier", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Add another stake in same tier
            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 2);

            const result = await staking.getStakesByTier(user1.address, 2);
            expect(result.stakeIndexes.length).to.equal(2);
            expect(result.amounts.length).to.equal(2);
            expect(result.amounts[0]).to.equal(ethers.parseEther("10000"));
            expect(result.amounts[1]).to.equal(ethers.parseEther("5000"));
        });

        it("Should estimate rewards for period", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            const estimatedRewards = await staking.estimateRewardsForPeriod(user1.address, 30);
            
            // 10,000 * 12% * 30/365 ≈ 98.6 tokens
            const expectedRewards = ethers.parseEther("98");
            expect(estimatedRewards).to.be.gte(expectedRewards);
        });
    });

    describe("Emergency Functions", function () {
        it("Should pause and unpause contract", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            await staking.pause();

            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, 1))
                .to.be.revertedWith("Pausable: paused");

            await staking.unpause();

            await expect(staking.connect(user1).stake(stakeAmount, 1))
                .to.not.be.reverted;
        });

        it("Should emergency withdraw rewards", async function () {
            const { staking, wejeToken, owner } = await loadFixture(deployStakingFixture);

            const withdrawAmount = ethers.parseEther("1000000");
            const balanceBefore = await wejeToken.balanceOf(owner.address);

            await staking.emergencyWithdrawRewards(withdrawAmount);

            const balanceAfter = await wejeToken.balanceOf(owner.address);
            expect(balanceAfter - balanceBefore).to.equal(withdrawAmount);
        });

        it("Should not withdraw staked tokens in emergency", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // User stakes tokens
            const stakeAmount = ethers.parseEther("10000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1);

            // Try to withdraw more than available rewards
            const totalBalance = await wejeToken.balanceOf(staking.target);
            
            await expect(staking.emergencyWithdrawRewards(totalBalance))
                .to.be.revertedWith("Cannot withdraw staked tokens");
        });

        it("Should update reward start time", async function () {
            const { staking } = await loadFixture(deployStakingFixture);

            const newStartTime = (await time.latest()) + 7200; // 2 hours from now
            await staking.updateRewardStartTime(newStartTime);

            expect(await staking.rewardStartTime()).to.equal(newStartTime);
        });
    });

    describe("Access Control", function () {
        it("Should only allow owner to call admin functions", async function () {
            const { staking, unauthorized } = await loadFixture(deployStakingFixture);

            await expect(staking.connect(unauthorized).updateStakingTier(1, 1, 1, 1, 1, true, "test"))
                .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");

            await expect(staking.connect(unauthorized).setPremiumUser(unauthorized.address, true))
                .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");

            await expect(staking.connect(unauthorized).pause())
                .to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
        });

        it("Should allow users to call user functions", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);

            await expect(staking.connect(user1).stake(stakeAmount, 1))
                .to.not.be.reverted;
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero rewards correctly", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            const stakeAmount = ethers.parseEther("5000");
            await wejeToken.connect(user1).approve(staking.target, stakeAmount);
            await staking.connect(user1).stake(stakeAmount, 1);

            // Try to claim immediately (should be 0 rewards)
            const pendingRewards = await staking.calculatePendingRewards(user1.address, 0);
            expect(pendingRewards).to.equal(0);
        });

        it("Should handle multiple stakes in different tiers", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Stake in tier 1
            await wejeToken.connect(user1).approve(staking.target, ethers.parseEther("15000"));
            await staking.connect(user1).stake(ethers.parseEther("5000"), 1);
            
            // Stake in tier 2
            await staking.connect(user1).stake(ethers.parseEther("10000"), 2);

            expect(await staking.userStakeCount(user1.address)).to.equal(2);
            expect(await staking.userTotalStaked(user1.address)).to.equal(ethers.parseEther("15000"));
        });

        it("Should handle tier limits correctly", async function () {
            const { staking, wejeToken, user1 } = await loadFixture(deployStakingFixture);

            // Try to stake in tier 4 without meeting minimum
            const belowMin = ethers.parseEther("10000"); // Tier 4 min is 25,000
            await wejeToken.connect(user1).approve(staking.target, belowMin);

            await expect(staking.connect(user1).stake(belowMin, 4))
                .to.be.revertedWithCustomError(staking, "InvalidAmount");
        });

        it("Should handle calculation edge cases", async function () {
            const { staking, user1 } = await loadFixture(deployStakingFixture);

            // Test with non-existent stake
            const pendingRewards = await staking.calculatePendingRewards(user1.address, 0);
            expect(pendingRewards).to.equal(0);

            // Test with invalid stake index
            const totalPending = await staking.calculateTotalPendingRewards(user1.address);
            expect(totalPending).to.equal(0);
        });
    });
});