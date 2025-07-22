// test/utils/testHelpers.js
// Comprehensive test utilities for WejePresale testing

const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { expect } = require("chai");

/**
 * Time management utilities for consistent test timing
 */
class TimeManager {
  constructor() {
    this.baseTime = null;
    this.presaleStart = null;
    this.presaleEnd = null;
  }
  
  async initialize() {
    this.baseTime = await time.latest();
    return this.baseTime;
  }
  
  async setPresaleTiming(startHoursFromNow = 1, durationDays = 30) {
    if (!this.baseTime) await this.initialize();
    
    this.presaleStart = this.baseTime + (startHoursFromNow * 3600);
    this.presaleEnd = this.presaleStart + (durationDays * 24 * 3600);
    
    return {
      start: this.presaleStart,
      end: this.presaleEnd,
      current: this.baseTime
    };
  }
  
  async moveToPresaleStart() {
    if (!this.presaleStart) throw new Error("Presale timing not set");
    await time.increaseTo(this.presaleStart);
    return await time.latest();
  }
  
  async moveToPresaleEnd() {
    if (!this.presaleEnd) throw new Error("Presale timing not set");
    await time.increaseTo(this.presaleEnd + 1);
    return await time.latest();
  }
  
  async skipCooldown(cooldownSeconds = 3600) {
    await time.increase(cooldownSeconds + 1);
    return await time.latest();
  }
  
  async moveTimeForward(seconds) {
    await time.increase(seconds);
    return await time.latest();
  }
  
  async getCurrentTime() {
    return await time.latest();
  }
  
  async isPresaleActive() {
    const current = await time.latest();
    return current >= this.presaleStart && current <= this.presaleEnd;
  }
}

/**
 * Test data provider with common values and calculations
 */
class TestDataProvider {
  static getPurchaseAmounts() {
    return {
      TINY: ethers.parseUnits("5", 6),       // $5 (below minimum)
      SMALL: ethers.parseUnits("50", 6),     // $50
      MEDIUM: ethers.parseUnits("500", 6),   // $500
      LARGE: ethers.parseUnits("5000", 6),   // $5,000
      HUGE: ethers.parseUnits("50000", 6),   // $50,000 (above maximum)
      WHALE: ethers.parseUnits("500000", 6), // $500,000 (hard cap test)
      MIN_VALID: ethers.parseUnits("10", 6), // $10 (minimum valid)
      MAX_TIER1: ethers.parseUnits("10000", 6) // $10,000 (max for tier 1)
    };
  }
  
  static getCryptoPrices() {
    return {
      ETH: {
        LOW: ethers.parseUnits("1500", 8),    // $1,500
        CURRENT: ethers.parseUnits("2000", 8), // $2,000
        HIGH: ethers.parseUnits("3000", 8)     // $3,000
      },
      MATIC: {
        LOW: ethers.parseUnits("0.5", 8),     // $0.50
        CURRENT: ethers.parseUnits("1", 8),   // $1.00
        HIGH: ethers.parseUnits("2", 8)       // $2.00
      }
    };
  }
  
  static getCryptoAmounts() {
    return {
      ETH: {
        SMALL: ethers.parseEther("0.05"),     // 0.05 ETH
        MEDIUM: ethers.parseEther("0.25"),    // 0.25 ETH
        LARGE: ethers.parseEther("2.5")       // 2.5 ETH
      },
      MATIC: {
        SMALL: ethers.parseEther("50"),       // 50 MATIC
        MEDIUM: ethers.parseEther("250"),     // 250 MATIC
        LARGE: ethers.parseEther("2500")      // 2500 MATIC
      }
    };
  }
  
  static getTokenSupplies() {
    return {
      WEJE_TOTAL: ethers.parseUnits("100000000", 18), // 100M tokens
      WEJE_PRESALE: ethers.parseUnits("10000000", 18), // 10M for presale
      PAYMENT_TOKENS: ethers.parseUnits("1000000", 6)  // 1M USDC/USDT per user
    };
  }
  
  static getContractConfig() {
    return {
      COOLDOWN_PERIOD: 3600,                    // 1 hour
      MIN_PURCHASE_USD: ethers.parseUnits("10", 6), // $10
      HARD_CAP: ethers.parseUnits("1000000", 6),    // $1M
      PRICE_VALIDITY: 300                       // 5 minutes
    };
  }
}

/**
 * Contract interaction helper for common operations
 */
class ContractHelper {
  static async setupTokenBalances(tokens, users, customAmounts = {}) {
    const { weje, usdc, usdt } = tokens;
    const supplies = TestDataProvider.getTokenSupplies();
    
    const defaultAmounts = {
      usdc: customAmounts.usdc || supplies.PAYMENT_TOKENS,
      usdt: customAmounts.usdt || supplies.PAYMENT_TOKENS,
      eth: customAmounts.eth || ethers.parseEther("100") // 100 ETH
    };
    
    for (const user of users) {
      // Mint payment tokens
      await usdc.mint(user.address, defaultAmounts.usdc);
      await usdt.mint(user.address, defaultAmounts.usdt);
      
      // Send ETH if needed (for local testing)
      if (defaultAmounts.eth > 0) {
        const balance = await ethers.provider.getBalance(user.address);
        if (balance < defaultAmounts.eth) {
          // In tests, accounts usually have plenty of ETH, but this is for safety
          console.log(`User ${user.address} has sufficient ETH balance`);
        }
      }
    }
  }
  
  static async setupApprovals(tokens, users, spenderAddress, customAmounts = {}) {
    const { usdc, usdt } = tokens;
    const supplies = TestDataProvider.getTokenSupplies();
    
    const approvalAmount = customAmounts.approval || supplies.PAYMENT_TOKENS;
    
    for (const user of users) {
      await usdc.connect(user).approve(spenderAddress, approvalAmount);
      await usdt.connect(user).approve(spenderAddress, approvalAmount);
    }
  }
  
  static async makeValidReferrer(presale, referrer, amount = null) {
    const purchaseAmount = amount || TestDataProvider.getPurchaseAmounts().SMALL;
    await presale.connect(referrer).buyWithUSDC(purchaseAmount, ethers.ZeroAddress);
    return referrer;
  }
  
  static async getContractBalances(presale, tokens) {
    const { weje, usdc, usdt } = tokens;
    const presaleAddress = await presale.getAddress();
    
    return {
      weje: await weje.balanceOf(presaleAddress),
      usdc: await usdc.balanceOf(presaleAddress),
      usdt: await usdt.balanceOf(presaleAddress),
      eth: await ethers.provider.getBalance(presaleAddress)
    };
  }
  
  static async getUserBalances(user, tokens) {
    const { weje, usdc, usdt } = tokens;
    
    return {
      weje: await weje.balanceOf(user.address),
      usdc: await usdc.balanceOf(user.address),
      usdt: await usdt.balanceOf(user.address),
      eth: await ethers.provider.getBalance(user.address)
    };
  }
}

/**
 * Purchase flow testing utilities
 */
class PurchaseFlowHelper {
  static async executePurchaseWithUSDC(presale, buyer, amount, referrer = ethers.ZeroAddress) {
    const tx = await presale.connect(buyer).buyWithUSDC(amount, referrer);
    const receipt = await tx.wait();
    return { tx, receipt };
  }
  
  static async executePurchaseWithUSDT(presale, buyer, amount, referrer = ethers.ZeroAddress) {
    const tx = await presale.connect(buyer).buyWithUSDT(amount, referrer);
    const receipt = await tx.wait();
    return { tx, receipt };
  }
  
  static async executePurchaseWithETH(presale, buyer, ethAmount, ethPrice, referrer = ethers.ZeroAddress) {
    const currentTime = await time.latest();
    const priceExpiry = currentTime + 300; // 5 minutes from now
    
    const tx = await presale.connect(buyer).buyWithETH(
      ethPrice,
      priceExpiry,
      referrer,
      { value: ethAmount }
    );
    const receipt = await tx.wait();
    return { tx, receipt };
  }
  
  static async executePurchaseWithMATIC(presale, buyer, maticAmount, maticPrice, referrer = ethers.ZeroAddress) {
    const currentTime = await time.latest();
    const priceExpiry = currentTime + 300; // 5 minutes from now
    
    const tx = await presale.connect(buyer).buyWithMATIC(
      maticPrice,
      priceExpiry,
      referrer,
      { value: maticAmount }
    );
    const receipt = await tx.wait();
    return { tx, receipt };
  }
  
  static async testPurchaseFlow(presale, buyer, amount, paymentMethod, tokens, referrer = ethers.ZeroAddress) {
    const { weje } = tokens;
    
    // Record initial balances
    const initialBuyerBalance = await weje.balanceOf(buyer.address);
    const initialContractBalances = await ContractHelper.getContractBalances(presale, tokens);
    
    let result;
    switch (paymentMethod.toUpperCase()) {
      case 'USDC':
        result = await this.executePurchaseWithUSDC(presale, buyer, amount, referrer);
        break;
      case 'USDT':
        result = await this.executePurchaseWithUSDT(presale, buyer, amount, referrer);
        break;
      case 'ETH':
        const ethPrice = TestDataProvider.getCryptoPrices().ETH.CURRENT;
        result = await this.executePurchaseWithETH(presale, buyer, amount, ethPrice, referrer);
        break;
      case 'MATIC':
        const maticPrice = TestDataProvider.getCryptoPrices().MATIC.CURRENT;
        result = await this.executePurchaseWithMATIC(presale, buyer, amount, maticPrice, referrer);
        break;
      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
    
    // Record final balances
    const finalBuyerBalance = await weje.balanceOf(buyer.address);
    const finalContractBalances = await ContractHelper.getContractBalances(presale, tokens);
    
    const tokensReceived = finalBuyerBalance - initialBuyerBalance;
    
    return {
      ...result,
      tokensReceived,
      initialBuyerBalance,
      finalBuyerBalance,
      initialContractBalances,
      finalContractBalances
    };
  }
}

/**
 * Advanced test patterns for complex scenarios
 */
class TestPatterns {
  static async testReferralSystem(presale, buyer, referrer, amount, tokens) {
    const { weje } = tokens;
    
    // Setup referrer as valid
    await ContractHelper.makeValidReferrer(presale, referrer);
    
    // Record initial balances
    const initialReferrerBalance = await weje.balanceOf(referrer.address);
    const initialBuyerBalance = await weje.balanceOf(buyer.address);
    
    // Execute purchase with referral
    await PurchaseFlowHelper.executePurchaseWithUSDC(presale, buyer, amount, referrer.address);
    
    // Record final balances
    const finalReferrerBalance = await weje.balanceOf(referrer.address);
    const finalBuyerBalance = await weje.balanceOf(buyer.address);
    
    const referrerReward = finalReferrerBalance - initialReferrerBalance;
    const buyerTokens = finalBuyerBalance - initialBuyerBalance;
    
    return {
      referrerReward,
      buyerTokens,
      initialReferrerBalance,
      finalReferrerBalance,
      initialBuyerBalance,
      finalBuyerBalance
    };
  }
  
  static async testCooldownMechanism(presale, buyer, amount) {
    // First purchase
    await PurchaseFlowHelper.executePurchaseWithUSDC(presale, buyer, amount);
    
    // Check cooldown is active
    const cooldownRemaining = await presale.getRemainingCooldown(buyer.address);
    expect(cooldownRemaining).to.be.gt(0);
    
    // Try immediate second purchase (should fail)
    await expect(
      PurchaseFlowHelper.executePurchaseWithUSDC(presale, buyer, amount)
    ).to.be.revertedWithCustomError(presale, "CooldownActive");
    
    // Wait for cooldown
    const timeManager = new TimeManager();
    await timeManager.skipCooldown();
    
    // Second purchase should work
    await expect(
      PurchaseFlowHelper.executePurchaseWithUSDC(presale, buyer, amount)
    ).to.not.be.reverted;
    
    return { cooldownRemaining };
  }
  
  static async testTierProgression(presale, buyers, amounts) {
    const results = [];
    
    for (let i = 0; i < buyers.length; i++) {
      const buyer = buyers[i];
      const amount = amounts[i] || TestDataProvider.getPurchaseAmounts().LARGE;
      
      const currentTier = await presale.getCurrentTier();
      const tierTokensRemaining = await presale.getCurrentTierTokensRemaining();
      
      const result = await PurchaseFlowHelper.testPurchaseFlow(
        presale, buyer, amount, 'USDC', { weje: presale.weje }
      );
      
      const newTier = await presale.getCurrentTier();
      
      results.push({
        buyerIndex: i,
        tierBefore: currentTier,
        tierAfter: newTier,
        tierTokensRemaining,
        tokensReceived: result.tokensReceived,
        tierChanged: newTier !== currentTier
      });
      
      // Wait for cooldown between purchases
      if (i < buyers.length - 1) {
        const timeManager = new TimeManager();
        await timeManager.skipCooldown();
      }
    }
    
    return results;
  }
  
  static async testHardCapEnforcement(presale, buyers, amounts, tokens) {
    let totalRaised = BigInt(0);
    const purchases = [];
    
    for (let i = 0; i < buyers.length; i++) {
      const buyer = buyers[i];
      const amount = amounts[i];
      
      try {
        const result = await PurchaseFlowHelper.testPurchaseFlow(
          presale, buyer, amount, 'USDC', tokens
        );
        
        totalRaised += BigInt(amount);
        purchases.push({
          buyerIndex: i,
          amount,
          success: true,
          tokensReceived: result.tokensReceived
        });
        
        // Wait for cooldown
        const timeManager = new TimeManager();
        await timeManager.skipCooldown();
        
      } catch (error) {
        purchases.push({
          buyerIndex: i,
          amount,
          success: false,
          error: error.message
        });
        
        // If hard cap reached, break
        if (error.message.includes("HardCapExceeded")) {
          break;
        }
      }
    }
    
    return { totalRaised, purchases };
  }
}

/**
 * Assertion helpers for common test validations
 */
class AssertionHelpers {
  static async expectCustomError(transaction, errorName, contract = null) {
    if (contract) {
      await expect(transaction).to.be.revertedWithCustomError(contract, errorName);
    } else {
      await expect(transaction).to.be.reverted;
    }
  }
  
  static expectTokenTransfer(balanceBefore, balanceAfter, expectedAmount = null) {
    if (expectedAmount) {
      expect(balanceAfter - balanceBefore).to.equal(expectedAmount);
    } else {
      expect(balanceAfter).to.be.gt(balanceBefore);
    }
  }
  
  static expectBalanceIncrease(balanceBefore, balanceAfter, minIncrease = BigInt(1)) {
    expect(balanceAfter - balanceBefore).to.be.gte(minIncrease);
  }
  
  static expectBalanceDecrease(balanceBefore, balanceAfter, expectedDecrease = null) {
    if (expectedDecrease) {
      expect(balanceBefore - balanceAfter).to.equal(expectedDecrease);
    } else {
      expect(balanceAfter).to.be.lt(balanceBefore);
    }
  }
  
  static expectReferralReward(referrerBalanceBefore, referrerBalanceAfter, purchaseAmount, expectedRate = 0.05) {
    const reward = referrerBalanceAfter - referrerBalanceBefore;
    const expectedReward = BigInt(Math.floor(Number(purchaseAmount) * expectedRate));
    
    // Allow some tolerance for rounding
    expect(reward).to.be.gte(expectedReward * BigInt(95) / BigInt(100)); // 95% of expected
    expect(reward).to.be.lte(expectedReward * BigInt(105) / BigInt(100)); // 105% of expected
  }
  
  static expectEventEmission(receipt, eventName, expectedArgs = null) {
    const event = receipt.logs.find(log => log.eventName === eventName);
    expect(event).to.not.be.undefined;
    
    if (expectedArgs) {
      Object.keys(expectedArgs).forEach(key => {
        expect(event.args[key]).to.equal(expectedArgs[key]);
      });
    }
    
    return event;
  }
}

/**
 * Mock contract factory for testing edge cases
 */
class MockContractHelper {
  static async deployMockTokens() {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const weje = await MockERC20.deploy("WEJE Token", "WEJE", 18);
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
    
    await weje.waitForDeployment();
    await usdc.waitForDeployment();
    await usdt.waitForDeployment();
    
    return { weje, usdc, usdt };
  }
  
  static async setupPresaleContract(tokens, timing) {
    const WejePresale = await ethers.getContractFactory("WejePresale");
    
    const presale = await WejePresale.deploy(
      await tokens.weje.getAddress(),
      await tokens.usdc.getAddress(),
      await tokens.usdt.getAddress(),
      timing.start,
      timing.end
    );
    
    await presale.waitForDeployment();
    
    // Transfer tokens to presale contract
    const supplies = TestDataProvider.getTokenSupplies();
    const [owner] = await ethers.getSigners();
    
    await tokens.weje.mint(owner.address, supplies.WEJE_TOTAL);
    await tokens.weje.connect(owner).transfer(
      await presale.getAddress(), 
      supplies.WEJE_PRESALE
    );
    
    return presale;
  }
}

module.exports = {
  TimeManager,
  TestDataProvider,
  ContractHelper,
  PurchaseFlowHelper,
  TestPatterns,
  AssertionHelpers,
  MockContractHelper
};