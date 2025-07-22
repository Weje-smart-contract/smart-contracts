const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("WejePresale - Direct Transfer Presale", function () {
  // Test configuration constants
  const PRESALE_DURATION = 30 * 24 * 60 * 60; // 30 days
  const COOLDOWN_PERIOD = 3600; // 1 hour
  const MIN_PURCHASE_USD = ethers.parseUnits("10", 6); // $10 USDC
  const MAX_PURCHASE_TIER1 = ethers.parseUnits("10000", 6); // $10,000 USDC
  const HARD_CAP = ethers.parseUnits("1000000", 6); // $1M USDC
  
  // Token amounts for testing
  const PURCHASE_AMOUNTS = {
    SMALL: ethers.parseUnits("50", 6),     // $50
    MEDIUM: ethers.parseUnits("500", 6),   // $500
    LARGE: ethers.parseUnits("5000", 6),   // $5,000
    TOO_SMALL: ethers.parseUnits("5", 6),  // $5 (below minimum)
    TOO_LARGE: ethers.parseUnits("50000", 6), // $50,000 (above maximum)
    HARD_CAP_BREACH: ethers.parseUnits("500000", 6) // $500,000
  };

  async function deployPresaleFixture() {
    const [owner, buyer1, buyer2, buyer3, referrer, nonBuyer] = await ethers.getSigners();
    
    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const weje = await MockERC20.deploy("WEJE Token", "WEJE", 18);
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
    
    await weje.waitForDeployment();
    await usdc.waitForDeployment();
    await usdt.waitForDeployment();
    
    // Get current timestamp and setup presale timing
    const currentTime = await time.latest();
    const presaleStart = currentTime + 3600; // Start 1 hour from now
    const presaleEnd = presaleStart + PRESALE_DURATION;
    
    // Deploy presale contract
    const WejePresale = await ethers.getContractFactory("WejePresale");
    const presale = await WejePresale.deploy(
      await weje.getAddress(),
      await usdc.getAddress(),
      await usdt.getAddress(),
      presaleStart,
      presaleEnd
    );
    
    await presale.waitForDeployment();
    
    // Setup initial token supply and transfer to presale
    const initialSupply = ethers.parseUnits("10000000", 18); // 10M tokens
    await weje.mint(owner.address, initialSupply);
    await weje.connect(owner).transfer(await presale.getAddress(), initialSupply);
    
    // Setup payment token balances for buyers
    const paymentAmount = ethers.parseUnits("100000", 6); // $100,000 each
    const buyers = [buyer1, buyer2, buyer3, referrer];
    
    for (const buyer of buyers) {
      await usdc.mint(buyer.address, paymentAmount);
      await usdt.mint(buyer.address, paymentAmount);
      
      // Approve presale contract
      await usdc.connect(buyer).approve(await presale.getAddress(), paymentAmount);
      await usdt.connect(buyer).approve(await presale.getAddress(), paymentAmount);
    }
    
    return {
      owner,
      buyer1,
      buyer2, 
      buyer3,
      referrer,
      nonBuyer,
      weje,
      usdc,
      usdt,
      presale,
      presaleStart,
      presaleEnd,
      currentTime
    };
  }

  describe("Presale Timing", function () {
    it("Should not allow purchases before start", async function () {
      const { presale, buyer1 } = await loadFixture(deployPresaleFixture);
      
      // We're still before presale start time
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "PresaleNotActive");
    });

    it("Should allow purchases during presale", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      // Move time to presale start
      await time.increaseTo(presaleStart);
      
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.not.be.reverted;
    });
  });

  describe("Direct Token Transfer - USDC Purchases", function () {
    it("Should transfer tokens immediately to buyer", async function () {
      const { presale, buyer1, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const initialBalance = await weje.balanceOf(buyer1.address);
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      const finalBalance = await weje.balanceOf(buyer1.address);
      
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should calculate tokens with bonus correctly for different tiers", async function () {
      const { presale, buyer1, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const initialBalance = await weje.balanceOf(buyer1.address);
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.LARGE, ethers.ZeroAddress);
      const finalBalance = await weje.balanceOf(buyer1.address);
      
      const tokensReceived = finalBalance - initialBalance;
      expect(tokensReceived).to.be.gt(0);
      
      // Should receive bonus for large purchase
      const baseTokens = PURCHASE_AMOUNTS.LARGE * BigInt(1000); // Assuming 1000 tokens per USD
      expect(tokensReceived).to.be.gte(baseTokens);
    });

    it("Should enforce minimum purchase amount", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.TOO_SMALL, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "InsufficientAmount");
    });

    it("Should enforce maximum purchase amount per tier", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.TOO_LARGE, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "ExceedsMaxPurchase");
    });

    it("Should transfer USDC to contract", async function () {
      const { presale, buyer1, usdc, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const initialContractBalance = await usdc.balanceOf(await presale.getAddress());
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      const finalContractBalance = await usdc.balanceOf(await presale.getAddress());
      
      expect(finalContractBalance - initialContractBalance).to.equal(PURCHASE_AMOUNTS.MEDIUM);
    });

    it("Should update user purchase tracking correctly", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      
      const userInfo = await presale.getUserInfo(buyer1.address);
      expect(userInfo.totalPurchased).to.equal(PURCHASE_AMOUNTS.MEDIUM);
    });
  });

  describe("USDT Purchases", function () {
    it("Should process USDT purchase with immediate token transfer", async function () {
      const { presale, buyer1, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const initialBalance = await weje.balanceOf(buyer1.address);
      await presale.connect(buyer1).purchaseWithUSDT(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      const finalBalance = await weje.balanceOf(buyer1.address);
      
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("ETH/MATIC Purchases", function () {
    it("Should process ETH purchase with immediate token transfer", async function () {
      const { presale, buyer1, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const ethPrice = ethers.parseUnits("2000", 8); // $2000 per ETH
      const currentTime = await time.latest();
      const ethAmount = ethers.parseEther("0.1"); // 0.1 ETH
      
      const initialBalance = await weje.balanceOf(buyer1.address);
      
      await presale.connect(buyer1).purchaseWithETH(
        ethPrice,
        currentTime + 300, // 5 minutes from now
        ethers.ZeroAddress,
        { value: ethAmount }
      );
      
      const finalBalance = await weje.balanceOf(buyer1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should reject ETH purchase with outdated price", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const ethPrice = ethers.parseUnits("2000", 8);
      const pastTimestamp = (await time.latest()) - 3600; // 1 hour ago
      const ethAmount = ethers.parseEther("0.1");
      
      await expect(
        presale.connect(buyer1).purchaseWithETH(
          ethPrice,
          pastTimestamp,
          ethers.ZeroAddress,
          { value: ethAmount }
        )
      ).to.be.revertedWithCustomError(presale, "PriceExpired");
    });

    it("Should process MATIC purchase correctly", async function () {
      const { presale, buyer1, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const maticPrice = ethers.parseUnits("1", 8); // $1 per MATIC
      const currentTime = await time.latest();
      const maticAmount = ethers.parseEther("100"); // 100 MATIC
      
      const initialBalance = await weje.balanceOf(buyer1.address);
      
      await presale.connect(buyer1).purchaseWithMATIC(
        maticPrice,
        currentTime + 300,
        ethers.ZeroAddress,
        { value: maticAmount }
      );
      
      const finalBalance = await weje.balanceOf(buyer1.address);
      expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("Referral System with Direct Transfers", function () {
    it("Should process referral with immediate token rewards", async function () {
      const { presale, buyer1, referrer, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Make referrer valid by having them purchase first
      await presale.connect(referrer).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress);
      
      const initialReferrerBalance = await weje.balanceOf(referrer.address);
      
      // Buyer makes purchase with referral
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, referrer.address);
      
      const finalReferrerBalance = await weje.balanceOf(referrer.address);
      expect(finalReferrerBalance).to.be.gt(initialReferrerBalance);
    });

    it("Should not accept invalid referrer", async function () {
      const { presale, buyer1, nonBuyer, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // nonBuyer hasn't made any purchases, so should be invalid referrer
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, nonBuyer.address)
      ).to.be.revertedWithCustomError(presale, "InvalidReferrer");
    });

    it("Should not allow self-referral", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, buyer1.address)
      ).to.be.revertedWithCustomError(presale, "InvalidReferrer");
    });
  });

  describe("Anti-Bot Protection", function () {
    it("Should enforce cooldown between purchases", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // First purchase
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress);
      
      // Try immediate second purchase - should fail
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "CooldownActive");
      
      // Wait for cooldown to pass
      await time.increase(COOLDOWN_PERIOD + 1);
      
      // Should work now
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.not.be.reverted;
    });

    it("Should return correct remaining cooldown", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Make purchase
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress);
      
      // Check cooldown immediately after purchase
      const remaining = await presale.getRemainingCooldown(buyer1.address);
      expect(remaining).to.be.gt(0);
      expect(remaining).to.be.lte(COOLDOWN_PERIOD);
      
      // Wait some time and check again
      await time.increase(1800); // 30 minutes
      const remainingAfter = await presale.getRemainingCooldown(buyer1.address);
      expect(remainingAfter).to.be.lt(remaining);
    });
  });

  describe("Caps and Milestones", function () {
    it("Should prevent purchases after hard cap", async function () {
      const { presale, buyer1, buyer2, buyer3, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Make large purchases to approach hard cap
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.HARD_CAP_BREACH, ethers.ZeroAddress);
      
      // Wait for cooldown
      await time.increase(COOLDOWN_PERIOD + 1);
      
      // Try another large purchase that would exceed hard cap
      await expect(
        presale.connect(buyer2).purchaseWithUSDC(PURCHASE_AMOUNTS.HARD_CAP_BREACH, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "HardCapExceeded");
    });
  });

  describe("View Functions", function () {
    it("Should return user info after purchase", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Initially should have no purchases
      let userInfo = await presale.getUserInfo(buyer1.address);
      expect(userInfo.totalPurchased).to.equal(0);
      
      // Make purchase
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      
      // Should now show purchase
      userInfo = await presale.getUserInfo(buyer1.address);
      expect(userInfo.totalPurchased).to.equal(PURCHASE_AMOUNTS.MEDIUM);
      expect(userInfo.tokensReceived).to.be.gt(0);
    });

    it("Should return presale progress", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Initially no progress
      let progress = await presale.getPresaleProgress();
      expect(progress.totalRaised).to.equal(0);
      
      // Make purchase
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      
      // Should show progress
      progress = await presale.getPresaleProgress();
      expect(progress.totalRaised).to.equal(PURCHASE_AMOUNTS.MEDIUM);
      expect(progress.totalParticipants).to.equal(1);
    });

    it("Should return contract stats", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const stats = await presale.getContractStats();
      expect(stats.presaleStart).to.be.gt(0);
      expect(stats.presaleEnd).to.be.gt(stats.presaleStart);
      expect(stats.hardCap).to.be.gt(0);
      expect(stats.minPurchase).to.equal(MIN_PURCHASE_USD);
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause and unpause presale", async function () {
      const { presale, owner, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Pause presale
      await presale.connect(owner).pausePresale();
      
      // Should not allow purchases when paused
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "PresalePaused");
      
      // Unpause
      await presale.connect(owner).unpausePresale();
      
      // Should work again
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.not.be.reverted;
    });

    it("Should emergency withdraw funds", async function () {
      const { presale, owner, buyer1, usdc, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Make some purchases first
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.MEDIUM, ethers.ZeroAddress);
      
      const contractBalance = await usdc.balanceOf(await presale.getAddress());
      const initialOwnerBalance = await usdc.balanceOf(owner.address);
      
      // Emergency withdraw
      await presale.connect(owner).emergencyWithdraw();
      
      const finalOwnerBalance = await usdc.balanceOf(owner.address);
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(contractBalance);
    });

    it("Should emergency withdraw specific tokens", async function () {
      const { presale, owner, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      const withdrawAmount = ethers.parseUnits("1000", 18);
      const initialOwnerBalance = await weje.balanceOf(owner.address);
      
      // Emergency withdraw tokens
      await presale.connect(owner).emergencyWithdrawToken(
        await weje.getAddress(), 
        withdrawAmount
      );
      
      const finalOwnerBalance = await weje.balanceOf(owner.address);
      expect(finalOwnerBalance - initialOwnerBalance).to.equal(withdrawAmount);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle insufficient tier tokens", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // This test assumes tier has limited tokens
      // Make multiple large purchases to exhaust tier
      await presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.LARGE, ethers.ZeroAddress);
      
      await time.increase(COOLDOWN_PERIOD + 1);
      
      // Try to buy more than remaining in tier
      const remainingInTier = await presale.getCurrentTierTokensRemaining();
      if (remainingInTier > 0 && remainingInTier < PURCHASE_AMOUNTS.LARGE * BigInt(1000)) {
        await expect(
          presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.LARGE, ethers.ZeroAddress)
        ).to.be.revertedWithCustomError(presale, "InsufficientTierTokens");
      }
    });

    it("Should handle insufficient contract token balance", async function () {
      const { presale, owner, buyer1, weje, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      // Withdraw most tokens from contract
      const contractBalance = await weje.balanceOf(await presale.getAddress());
      const withdrawAmount = contractBalance - ethers.parseUnits("100", 18); // Leave only 100 tokens
      
      await presale.connect(owner).emergencyWithdrawToken(
        await weje.getAddress(),
        withdrawAmount
      );
      
      // Try to make large purchase
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.LARGE, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "InsufficientContractBalance");
    });

    it("Should handle zero purchase attempts", async function () {
      const { presale, buyer1, presaleStart } = await loadFixture(deployPresaleFixture);
      
      await time.increaseTo(presaleStart);
      
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(0, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "InsufficientAmount");
    });
  });

  // Additional test for presale end
  describe("Presale End", function () {
    it("Should not allow purchases after presale ends", async function () {
      const { presale, buyer1, presaleEnd } = await loadFixture(deployPresaleFixture);
      
      // Move time to after presale end
      await time.increaseTo(presaleEnd + 1);
      
      await expect(
        presale.connect(buyer1).purchaseWithUSDC(PURCHASE_AMOUNTS.SMALL, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(presale, "PresaleNotActive");
    });
  });
});