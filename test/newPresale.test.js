const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("WejePresale - Direct Transfer Presale with WejeToken", function () {
    async function deployPresaleFixture() {
        const [owner, user1, user2, user3, referrer, attacker] = await ethers.getSigners();

        // Deploy WEJE Token with your contract
        const WejeToken = await ethers.getContractFactory("WejeToken");
        const wejeToken = await WejeToken.deploy("WEJE Token", "WEJE");
        await wejeToken.waitForDeployment();

        // Deploy mock USDC and USDT
        const MockToken = await ethers.getContractFactory("MockERC20");
        const usdc = await MockToken.deploy("USD Coin", "USDC", 6); // 6 decimals
        await usdc.waitForDeployment();
        const usdt = await MockToken.deploy("Tether", "USDT", 6);
        await usdt.waitForDeployment();

        // Calculate presale times
        const currentTime = await time.latest();
        const presaleStart = currentTime + 3600; // 1 hour from now
        const presaleEnd = presaleStart + (30 * 24 * 3600); // 30 days duration

        // Deploy Presale
        const WejePresale = await ethers.getContractFactory("WejePresale");
        const presale = await WejePresale.deploy(
            await wejeToken.getAddress(),
            await usdc.getAddress(),
            await usdt.getAddress(),
            presaleStart,
            presaleEnd
        );
        await presale.waitForDeployment();

        // Configure WejeToken for presale
        // 1. Enable trading to allow transfers
        await time.increaseTo(Number(await wejeToken.tradingStartTime()) + 1);
        await wejeToken.enableTrading();
        await wejeToken.setTradingPhase(2); // Normal trading phase
        
        // 2. Exclude presale contract from limits and restrictions
        await wejeToken.excludeFromLimits(await presale.getAddress(), true);
        await wejeToken.excludeFromLimits(owner.address, true);
        
        // 3. Set limits to be disabled for easier testing
        await wejeToken.setLimitsEnabled(false);

        // Fund presale with tokens (150M tokens for all tiers)
        const presaleAllocation = ethers.parseEther("150000000"); // 150M tokens
        await wejeToken.transfer(await presale.getAddress(), presaleAllocation);

        // Mint stablecoins to users
        const usdcAmount = ethers.parseUnits("100000", 6); // 100K USDC
        await usdc.mint(user1.address, usdcAmount);
        await usdc.mint(user2.address, usdcAmount);
        await usdc.mint(user3.address, usdcAmount);
        await usdc.mint(referrer.address, usdcAmount);
        await usdc.mint(owner.address, usdcAmount);

        await usdt.mint(user1.address, usdcAmount);
        await usdt.mint(user2.address, usdcAmount);

        return {
            wejeToken,
            presale,
            usdc,
            usdt,
            owner,
            user1,
            user2,
            user3,
            referrer,
            attacker,
            presaleStart,
            presaleEnd
        };
    }

    describe("Deployment and Initialization", function () {
        it("Should deploy with correct parameters", async function () {
            const { presale, wejeToken, usdc, usdt, presaleStart, presaleEnd } = await loadFixture(deployPresaleFixture);

            expect(await presale.wejeToken()).to.equal(await wejeToken.getAddress());
            expect(await presale.usdcToken()).to.equal(await usdc.getAddress());
            expect(await presale.usdtToken()).to.equal(await usdt.getAddress());
            expect(await presale.presaleStartTime()).to.equal(presaleStart);
            expect(await presale.presaleEndTime()).to.equal(presaleEnd);
        });

        it("Should initialize tiers correctly", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const tier1 = await presale.tiers(1);
            expect(tier1.price).to.equal(8000); // $0.008
            expect(tier1.tokensAvailable).to.equal(ethers.parseEther("30000000"));
            expect(tier1.bonusPercent).to.equal(2500); // 25%
            expect(tier1.isActive).to.be.true;
            expect(tier1.name).to.equal("Early Bird");

            const tier2 = await presale.tiers(2);
            expect(tier2.price).to.equal(10000); // $0.010
            expect(tier2.isActive).to.be.false;
            expect(tier2.name).to.equal("Standard");

            const tier4 = await presale.tiers(4);
            expect(tier4.price).to.equal(15000); // $0.015
            expect(tier4.bonusPercent).to.equal(1000); // 10%
            expect(tier4.isActive).to.be.false;
            expect(tier4.name).to.equal("Final");
        });

        it("Should have correct current tier", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            expect(await presale.currentTier()).to.equal(1);
        });

        it("Should fund presale contract with tokens", async function () {
            const { presale, wejeToken } = await loadFixture(deployPresaleFixture);
            const balance = await wejeToken.balanceOf(await presale.getAddress());
            expect(balance).to.equal(ethers.parseEther("150000000"));
        });

        it("Should configure WejeToken correctly for presale", async function () {
            const { wejeToken, presale } = await loadFixture(deployPresaleFixture);
            
            expect(await wejeToken.tradingEnabled()).to.be.true;
            expect(await wejeToken.isExcludedFromLimits(await presale.getAddress())).to.be.true;
            expect(await wejeToken.limitsEnabled()).to.be.false;
        });
    });

    describe("Presale Timing", function () {
        it("Should not allow purchases before start", async function () {
            const { presale, usdc, user1 } = await loadFixture(deployPresaleFixture);

            const amount = ethers.parseUnits("500", 6); // $500 (below KYC threshold)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "PresaleNotActive");
        });

        it("Should allow purchases during presale", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6); // $500 (below KYC threshold)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.not.be.reverted;
        });

        it("Should not allow purchases after end", async function () {
            const { presale, usdc, user1, presaleEnd } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleEnd + 1);

            const amount = ethers.parseUnits("500", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "PresaleEnded");
        });
    });

    describe("Direct Token Transfer - USDC Purchases", function () {
        beforeEach(async function () {
            const { presaleStart } = await loadFixture(deployPresaleFixture);
            await time.increaseTo(presaleStart + 1);
        });

        it("Should transfer tokens immediately to buyer (small amount)", async function () {
            const { presale, usdc, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6); // $500 (below KYC threshold)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            expect(balanceBefore).to.equal(0);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.emit(presale, "TokensPurchased");

            // Check user received tokens immediately
            const balanceAfter = await wejeToken.balanceOf(user1.address);
            const expectedTokens = ethers.parseEther("78125"); // $500 / $0.008 * 1.25 (with bonus)
            expect(balanceAfter).to.equal(expectedTokens);
        });

        it("Should transfer tokens immediately to buyer (large amount with whitelist)", async function () {
            const { presale, usdc, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Whitelist user for large purchase
            await presale.setWhitelist([user1.address], true);

            const amount = ethers.parseUnits("2000", 6); // $2000 (above KYC threshold)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            const balanceBefore = await wejeToken.balanceOf(user1.address);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.emit(presale, "TokensPurchased");

            // Check user received tokens immediately
            const balanceAfter = await wejeToken.balanceOf(user1.address);
            const expectedTokens = ethers.parseEther("312500"); // $2000 / $0.008 * 1.25 (with bonus)
            expect(balanceAfter).to.equal(expectedTokens);
        });

        it("Should calculate tokens with bonus correctly for different tiers", async function () {
            const { presale, usdc, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Test Tier 1: $0.008 per token + 25% bonus
            const amount1 = ethers.parseUnits("500", 6); // $500
            await usdc.connect(user1).approve(await presale.getAddress(), amount1);

            await presale.connect(user1).purchaseWithUSDC(amount1, ethers.ZeroAddress);

            // $500 / $0.008 = 62,500 base tokens + 25% bonus = 15,625 = 78,125 total
            const balance1 = await wejeToken.balanceOf(user1.address);
            expect(balance1).to.equal(ethers.parseEther("78125"));

            // Move to Tier 2
            await presale.activateTier(2);

            const amount2 = ethers.parseUnits("500", 6); // $500
            await usdc.connect(user1).approve(await presale.getAddress(), amount2);

            // Need to wait for cooldown
            await time.increase(301); // 5 minutes + 1 second

            const balanceBeforeTier2 = await wejeToken.balanceOf(user1.address);
            await presale.connect(user1).purchaseWithUSDC(amount2, ethers.ZeroAddress);

            // Tier 2: $500 / $0.010 = 50,000 base tokens + 20% bonus = 10,000 = 60,000 total
            const balance2 = await wejeToken.balanceOf(user1.address);
            expect(balance2 - balanceBeforeTier2).to.equal(ethers.parseEther("60000"));
        });

        it("Should enforce minimum purchase amount", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("50", 6); // $50 (below $100 minimum)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "PurchaseAmountTooLow");
        });

        it("Should enforce KYC requirement for large purchases", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("2000", 6); // $2000 (above $1000 KYC threshold)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "KYCRequired");
        });

        it("Should enforce maximum purchase amount per tier", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Whitelist user to bypass KYC
            await presale.setWhitelist([user1.address], true);

            const amount = ethers.parseUnits("10000", 6); // $10,000 (above $5,000 max for tier 1)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "PurchaseAmountTooHigh");
        });

        it("Should transfer USDC to contract", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            const contractBalanceBefore = await usdc.balanceOf(await presale.getAddress());
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);
            const contractBalanceAfter = await usdc.balanceOf(await presale.getAddress());

            expect(contractBalanceAfter - contractBalanceBefore).to.equal(amount);
        });

        it("Should update user purchase tracking correctly", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            expect(await presale.userPurchases(user1.address)).to.equal(amount);
            expect(await presale.userTokensReceived(user1.address)).to.equal(ethers.parseEther("78125"));
            expect(await presale.totalParticipants()).to.equal(1);
        });
    });

    describe("USDT Purchases", function () {
        it("Should process USDT purchase with immediate token transfer", async function () {
            const { presale, usdt, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6); // $500 (below KYC threshold)
            await usdt.connect(user1).approve(await presale.getAddress(), amount);

            const balanceBefore = await wejeToken.balanceOf(user1.address);

            await expect(
                presale.connect(user1).purchaseWithUSDT(amount, ethers.ZeroAddress)
            ).to.emit(presale, "TokensPurchased");

            expect(await presale.userPurchases(user1.address)).to.equal(amount);
            
            // Check immediate token transfer
            const balanceAfter = await wejeToken.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("78125"));
        });
    });

    describe("ETH/MATIC Purchases", function () {
        it("Should process ETH purchase with immediate token transfer", async function () {
            const { presale, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Update price oracle to current time
            await presale.updatePrices(ethers.parseUnits("3000", 6), ethers.parseUnits("1", 6));

            const ethAmount = ethers.parseEther("0.2"); // 0.2 ETH
            // At $3000/ETH = $600 value (below KYC threshold)

            const balanceBefore = await wejeToken.balanceOf(user1.address);

            await expect(
                presale.connect(user1).purchaseWithETH(ethers.ZeroAddress, { value: ethAmount })
            ).to.emit(presale, "TokensPurchased");
            
            // Check immediate token transfer
            const balanceAfter = await wejeToken.balanceOf(user1.address);
            // $600 / $0.008 * 1.25 = 93,750 tokens
            const expectedTokens = ethers.parseEther("93750");
            expect(balanceAfter - balanceBefore).to.equal(expectedTokens);
        });

        it("Should reject ETH purchase with outdated price", async function () {
            const { presale, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);
            await time.increase(2 * 3600); // 2 hours later (price validity is 1 hour)

            const ethAmount = ethers.parseEther("0.2");

            await expect(
                presale.purchaseWithETH(ethers.ZeroAddress, { value: ethAmount })
            ).to.be.revertedWith("ETH price outdated");
        });

        it("Should process MATIC purchase correctly", async function () {
            const { presale, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Update price oracle to current time
            await presale.updatePrices(ethers.parseUnits("3000", 6), ethers.parseUnits("1", 6));

            const maticAmount = ethers.parseEther("600"); // 600 MATIC
            // At $1/MATIC = $600 value (below KYC threshold)

            const balanceBefore = await wejeToken.balanceOf(user1.address);

            await expect(
                presale.connect(user1).purchaseWithMATIC(ethers.ZeroAddress, { value: maticAmount })
            ).to.emit(presale, "TokensPurchased");
            
            // Check immediate token transfer
            const balanceAfter = await wejeToken.balanceOf(user1.address);
            const expectedTokens = ethers.parseEther("93750"); // Same as ETH test above
            expect(balanceAfter - balanceBefore).to.equal(expectedTokens);
        });
    });

    describe("Referral System with Direct Transfers", function () {
        it("Should process referral with immediate token rewards", async function () {
            const { presale, usdc, wejeToken, user1, user2, referrer, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Referrer makes a purchase first
            const referrerAmount = ethers.parseUnits("200", 6); // $200 (below KYC)
            await usdc.connect(referrer).approve(await presale.getAddress(), referrerAmount);
            await presale.connect(referrer).purchaseWithUSDC(referrerAmount, ethers.ZeroAddress);

            // User1 makes purchase with referrer
            const amount = ethers.parseUnits("500", 6); // $500 (below KYC)
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            const referrerBalanceBefore = await wejeToken.balanceOf(referrer.address);
            const user1BalanceBefore = await wejeToken.balanceOf(user1.address);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, referrer.address)
            ).to.emit(presale, "ReferralRewarded");

            expect(await presale.referrers(user1.address)).to.equal(referrer.address);
            expect(await presale.totalReferrals(referrer.address)).to.equal(1);
            
            // Check both user and referrer received tokens immediately
            const referrerBalanceAfter = await wejeToken.balanceOf(referrer.address);
            const user1BalanceAfter = await wejeToken.balanceOf(user1.address);
            
            expect(referrerBalanceAfter).to.be.gt(referrerBalanceBefore);
            expect(user1BalanceAfter).to.be.gt(user1BalanceBefore);
            expect(user1BalanceAfter - user1BalanceBefore).to.equal(ethers.parseEther("78125"));
        });

        it("Should not accept invalid referrer", async function () {
            const { presale, usdc, user1, user2, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6); // Below KYC threshold
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            // user2 hasn't made any purchase, so can't be referrer
            await presale.connect(user1).purchaseWithUSDC(amount, user2.address);

            expect(await presale.referrers(user1.address)).to.equal(ethers.ZeroAddress);
        });

        it("Should not allow self-referral", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("500", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await presale.connect(user1).purchaseWithUSDC(amount, user1.address);

            expect(await presale.referrers(user1.address)).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Tier Management and Progression", function () {
        it("Should allow manual tier activation by owner", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            await expect(presale.activateTier(3))
                .to.emit(presale, "TierActivated")
                .withArgs(3);

            expect(await presale.currentTier()).to.equal(3);
            
            const tier3Info = await presale.tiers(3);
            expect(tier3Info.isActive).to.be.true;
        });

        it("Should update tier parameters correctly", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            await presale.updateTierParams(
                2,
                12000, // new price
                ethers.parseEther("50000000"), // new tokens available
                ethers.parseUnits("200", 6), // new min purchase
                ethers.parseUnits("20000", 6), // new max purchase
                1500 // new bonus percent
            );

            const tier2 = await presale.tiers(2);
            expect(tier2.price).to.equal(12000);
            expect(tier2.tokensAvailable).to.equal(ethers.parseEther("50000000"));
            expect(tier2.bonusPercent).to.equal(1500);
        });

        it("Should return all tiers info correctly", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);
            
            const allTiers = await presale.getAllTiersInfo();
            
            expect(allTiers.tierNumbers.length).to.equal(4);
            expect(allTiers.names[0]).to.equal("Early Bird");
            expect(allTiers.prices[0]).to.equal(8000);
            expect(allTiers.isActive[0]).to.be.true;
            expect(allTiers.isActive[1]).to.be.false;
        });
    });

    describe("Anti-Bot Protection", function () {
        it("Should enforce cooldown between purchases", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("300", 6); // Below KYC threshold
            await usdc.connect(user1).approve(await presale.getAddress(), amount * 2n);

            // First purchase should work
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            // Second purchase within cooldown should fail
            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "CooldownActive");

            // After cooldown, should work
            await time.increase(301); // 5 minutes + 1 second
            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.not.be.reverted;
        });

        it("Should require KYC for large purchases", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("2000", 6); // Above $1000 KYC threshold
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "KYCRequired");
        });

        it("Should allow large purchases for whitelisted users", async function () {
            const { presale, usdc, wejeToken, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Whitelist user1
            await presale.setWhitelist([user1.address], true);

            const amount = ethers.parseUnits("2000", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            const balanceBefore = await wejeToken.balanceOf(user1.address);
            
            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.not.be.reverted;

            // Check tokens were transferred
            const balanceAfter = await wejeToken.balanceOf(user1.address);
            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should return correct remaining cooldown", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            const cooldown = await presale.getRemainingCooldown(user1.address);
            expect(cooldown).to.be.gt(0);
            expect(cooldown).to.be.lte(300); // Should be <= 5 minutes

            // After cooldown expires
            await time.increase(301);
            const cooldownAfter = await presale.getRemainingCooldown(user1.address);
            expect(cooldownAfter).to.equal(0);
        });
    });

    describe("Caps and Milestones", function () {
        it("Should prevent purchases after hard cap", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Set a lower hard cap for testing
            await presale.updateCaps(ethers.parseUnits("1000", 6), ethers.parseUnits("2000", 6));

            // Whitelist user and mint more USDC
            await presale.setWhitelist([user1.address], true);
            await usdc.mint(user1.address, ethers.parseUnits("10000", 6));
            await usdc.connect(user1).approve(await presale.getAddress(), ethers.parseUnits("10000", 6));

            // First purchase should work
            await presale.connect(user1).purchaseWithUSDC(ethers.parseUnits("1500", 6), ethers.ZeroAddress);

            // Second purchase should exceed hard cap
            await expect(
                presale.connect(user1).purchaseWithUSDC(ethers.parseUnits("1000", 6), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "HardCapExceeded");
        });
    });

    describe("Admin Functions", function () {
        it("Should update price oracles", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const newEthPrice = ethers.parseUnits("4000", 6); // $4000
            const newMaticPrice = ethers.parseUnits("2", 6); // $2

            await expect(presale.updatePrices(newEthPrice, newMaticPrice))
                .to.emit(presale, "PriceUpdated")
                .withArgs("ETH", newEthPrice);

            expect(await presale.ethPriceInUSDC()).to.equal(newEthPrice);
            expect(await presale.maticPriceInUSDC()).to.equal(newMaticPrice);
        });

        it("Should update presale times", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const currentTime = await time.latest();
            const newStart = currentTime + 7200; // 2 hours
            const newEnd = newStart + (45 * 24 * 3600); // 45 days

            await presale.updatePresaleTimes(newStart, newEnd);

            expect(await presale.presaleStartTime()).to.equal(newStart);
            expect(await presale.presaleEndTime()).to.equal(newEnd);
        });

        it("Should batch whitelist users", async function () {
            const { presale, user1, user2, user3 } = await loadFixture(deployPresaleFixture);

            const users = [user1.address, user2.address, user3.address];
            
            await expect(presale.setWhitelist(users, true))
                .to.emit(presale, "WhitelistUpdated");

            for (const user of users) {
                expect(await presale.whitelisted(user)).to.be.true;
            }

            // Test removing from whitelist
            await presale.setWhitelist([user1.address], false);
            expect(await presale.whitelisted(user1.address)).to.be.false;
        });

        it("Should update max contribution limit", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const newMax = ethers.parseUnits("100000", 6); // $100K
            await presale.updateMaxContribution(newMax);
            
            expect(await presale.maxContribution()).to.equal(newMax);
        });

        it("Should update referral bonus", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            await presale.updateReferralBonus(1000); // 10%
            expect(await presale.referralBonus()).to.equal(1000);

            // Should reject bonus > 10%
            await expect(
                presale.updateReferralBonus(1500)
            ).to.be.revertedWith("Bonus too high");
        });
    });

    describe("View Functions", function () {
        it("Should return current tier info", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const tierInfo = await presale.getCurrentTierInfo();
            
            expect(tierInfo.tierNumber).to.equal(1);
            expect(tierInfo.name).to.equal("Early Bird");
            expect(tierInfo.price).to.equal(8000);
            expect(tierInfo.tokensAvailable).to.equal(ethers.parseEther("30000000"));
            expect(tierInfo.bonusPercent).to.equal(2500);
            expect(tierInfo.isActive).to.be.true;
        });

        it("Should return user info after purchase", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            const userInfo = await presale.getUserInfo(user1.address);
            
            expect(userInfo.totalPurchased).to.equal(amount);
            expect(userInfo.totalTokensReceived).to.equal(ethers.parseEther("46875")); // $300 / $0.008 * 1.25
            expect(userInfo.isWhitelisted).to.be.false;
        });

        it("Should calculate tokens for USDC correctly", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const amount = ethers.parseUnits("1000", 6);
            const calculation = await presale.calculateTokensForUSDC(amount);

            // $1000 / $0.008 = 125,000 base tokens
            // 25% bonus = 31,250 tokens
            // Total = 156,250 tokens
            expect(calculation.baseTokens).to.equal(ethers.parseEther("125000"));
            expect(calculation.bonusTokens).to.equal(ethers.parseEther("31250"));
            expect(calculation.totalTokens).to.equal(ethers.parseEther("156250"));
            expect(calculation.tierNumber).to.equal(1);
            expect(calculation.tierName).to.equal("Early Bird");
        });

        it("Should return presale progress", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            const progress = await presale.getPresaleProgress();
            
            expect(progress.totalRaisedAmount).to.equal(amount);
            expect(progress.totalTokensSoldAmount).to.equal(ethers.parseEther("46875"));
            expect(progress.totalParticipants_).to.equal(1);
            expect(progress.isPresaleActive).to.be.true;
        });

        it("Should return contract stats", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            const stats = await presale.getContractStats();
            
            expect(stats.totalRaised_).to.equal(amount);
            expect(stats.totalTokensSold_).to.equal(ethers.parseEther("46875"));
            expect(stats.contractUSDCBalance).to.equal(amount);
            expect(stats.contractTokenBalance).to.be.lt(ethers.parseEther("150000000")); // Should be less after sale
        });
    });

    describe("Emergency Functions", function () {
        it("Should pause and unpause presale", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            await presale.pause();

            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "EnforcedPause");

            await presale.unpause();

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.not.be.reverted;
        });

        it("Should emergency withdraw funds", async function () {
            const { presale, usdc, wejeToken, user1, owner, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Make a purchase
            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            const ownerUSDCBalanceBefore = await usdc.balanceOf(owner.address);
            const ownerTokenBalanceBefore = await wejeToken.balanceOf(owner.address);
            
            await presale.emergencyWithdrawAll();
            
            const ownerUSDCBalanceAfter = await usdc.balanceOf(owner.address);
            const ownerTokenBalanceAfter = await wejeToken.balanceOf(owner.address);
            
            expect(ownerUSDCBalanceAfter - ownerUSDCBalanceBefore).to.be.gte(amount);
            expect(ownerTokenBalanceAfter).to.be.gt(ownerTokenBalanceBefore);
        });

        it("Should emergency withdraw specific tokens", async function () {
            const { presale, usdc, user1, owner, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            const amount = ethers.parseUnits("300", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);
            await presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress);

            const ownerBalanceBefore = await usdc.balanceOf(owner.address);
            
            await expect(presale.emergencyWithdrawTokens(await usdc.getAddress(), amount))
                .to.emit(presale, "EmergencyWithdraw")
                .withArgs(await usdc.getAddress(), amount);
            
            const ownerBalanceAfter = await usdc.balanceOf(owner.address);
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount);
        });
    });

    describe("Access Control", function () {
        it("Should only allow owner to call admin functions", async function () {
            const { presale, user1 } = await loadFixture(deployPresaleFixture);

            await expect(presale.connect(user1).activateTier(2))
                .to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");

            await expect(presale.connect(user1).updatePrices(1, 1))
                .to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");

            await expect(presale.connect(user1).pause())
                .to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");

            await expect(presale.connect(user1).setWhitelist([user1.address], true))
                .to.be.revertedWithCustomError(presale, "OwnableUnauthorizedAccount");
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle insufficient tier tokens", async function () {
            const { presale, usdc, owner, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Whitelist owner for large purchase
            await presale.setWhitelist([owner.address], true);

            // Set tier 1 to have very few tokens
            await presale.updateTierParams(
                1,
                8000,
                ethers.parseEther("1000"), // Only 1000 tokens
                ethers.parseUnits("100", 6),
                ethers.parseUnits("5000", 6),
                2500
            );

            const amount = ethers.parseUnits("1000", 6); // Would need ~156K tokens with bonus
            await usdc.connect(owner).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(owner).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "InsufficientTokensInTier");
        });

        it("Should handle insufficient contract token balance", async function () {
            const { presale, wejeToken, usdc, owner, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            // Withdraw most tokens from contract
            const balance = await wejeToken.balanceOf(await presale.getAddress());
            await presale.emergencyWithdrawTokens(await wejeToken.getAddress(), balance - ethers.parseEther("1000"));

            const amount = ethers.parseUnits("500", 6);
            await usdc.connect(user1).approve(await presale.getAddress(), amount);

            await expect(
                presale.connect(user1).purchaseWithUSDC(amount, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "InsufficientTokenBalance");
        });

        it("Should handle zero purchase attempts", async function () {
            const { presale, usdc, user1, presaleStart } = await loadFixture(deployPresaleFixture);

            await time.increaseTo(presaleStart + 1);

            await usdc.connect(user1).approve(await presale.getAddress(), 0);

            await expect(
                presale.connect(user1).purchaseWithUSDC(0, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(presale, "PurchaseAmountTooLow");
        });

        it("Should reject direct ETH/MATIC transfers", async function () {
            const { presale, owner } = await loadFixture(deployPresaleFixture);

            await expect(
                owner.sendTransaction({
                    to: await presale.getAddress(),
                    value: ethers.parseEther("1")
                })
            ).to.be.revertedWith("Use purchaseWithETH() or purchaseWithMATIC()");
        });

        it("Should handle KYC requirement correctly", async function () {
            const { presale } = await loadFixture(deployPresaleFixture);

            const amount = ethers.parseUnits("999", 6); // Just below threshold
            expect(await presale.isKYCRequired(amount)).to.be.false;

            const largeAmount = ethers.parseUnits("1000", 6); // At threshold
            expect(await presale.isKYCRequired(largeAmount)).to.be.true;
        });
    });
});