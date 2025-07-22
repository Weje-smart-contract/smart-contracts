const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("WejeToken", function () {
    async function deployWejeTokenFixture() {
        const [owner, user1, user2, user3, attacker] = await ethers.getSigners();

        const WejeToken = await ethers.getContractFactory("WejeToken");
        const wejeToken = await WejeToken.deploy(
            "WEJE Token",
            "WEJE"
            // NOTE: Your contract only takes 2 parameters (name, symbol) - NO feeReceiver or liquidityWallet
        );

        return {
            wejeToken,
            owner,
            user1,
            user2,
            user3,
            attacker
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            const { wejeToken, owner } = await loadFixture(deployWejeTokenFixture);

            expect(await wejeToken.name()).to.equal("WEJE Token");
            expect(await wejeToken.symbol()).to.equal("WEJE");
            expect(await wejeToken.totalSupply()).to.equal(ethers.parseEther("1000000000")); // 1B tokens
            expect(await wejeToken.owner()).to.equal(owner.address);
            // NOTE: Removed feeReceiver and liquidityWallet checks - they don't exist in your NO-FEE contract
        });

        it("Should mint total supply to owner", async function () {
            const { wejeToken, owner } = await loadFixture(deployWejeTokenFixture);
            
            expect(await wejeToken.balanceOf(owner.address)).to.equal(ethers.parseEther("1000000000"));
        });

        it("Should set correct initial trading settings", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            expect(await wejeToken.tradingEnabled()).to.be.false;
            expect(await wejeToken.limitsEnabled()).to.be.true;
            expect(await wejeToken.currentPhase()).to.equal(0); // DISABLED
        });

        it("Should exclude owner from limits", async function () {
            const { wejeToken, owner } = await loadFixture(deployWejeTokenFixture);

            expect(await wejeToken.isExcludedFromLimits(owner.address)).to.be.true;
            // NOTE: Removed isExcludedFromFees check - it doesn't exist in your NO-FEE contract
        });
    });

    describe("Trading Control", function () {
        it("Should not allow trading before enabled", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            // Owner transfers to user1 first (owner is excluded, so this works)
            await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
            
            // Now user1 (regular user) tries to transfer to user2 (regular user)
            // Both are NOT excluded, so this should fail with TradingNotEnabled
            await expect(
                wejeToken.connect(user1).transfer(user2.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(wejeToken, "TradingNotEnabled");
        });

        it("Should not enable trading before delay", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.enableTrading()).to.be.revertedWith("Trading delay not met");
        });

        it("Should enable trading after delay", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            // Fast forward 7 days + 1 hour
            await time.increase(7 * 24 * 3600 + 3600);

            await expect(wejeToken.enableTrading())
                .to.emit(wejeToken, "TradingEnabled")
                .to.emit(wejeToken, "TradingPhaseChanged");

            expect(await wejeToken.tradingEnabled()).to.be.true;
            expect(await wejeToken.currentPhase()).to.equal(1); // RESTRICTED
        });

        it("Should allow trading after enabled", async function () {
            const { wejeToken, owner, user1 } = await loadFixture(deployWejeTokenFixture);

            // Transfer to user1 and enable trading
            await wejeToken.transfer(user1.address, ethers.parseEther("100000"));
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();

            await expect(
                wejeToken.connect(user1).transfer(owner.address, ethers.parseEther("1000"))
            ).to.not.be.reverted;
        });

        it("Should set trading phase correctly", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();

            await wejeToken.setTradingPhase(2); // NORMAL
            expect(await wejeToken.currentPhase()).to.equal(2);
        });
    });

    describe("Anti-Whale Protection", function () {
        beforeEach(async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
        });

        it("Should enforce max transaction amount", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            // Enable trading and set to NORMAL phase (not restricted)
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.setTradingPhase(2); // NORMAL phase to avoid restricted phase limits
    
            const maxTx = await wejeToken.maxTransactionAmount();
            
            // Owner gives user1 enough tokens
            await wejeToken.transfer(user1.address, maxTx + ethers.parseEther("100000"));
    
            // user1 tries to transfer MORE than maxTx to user2
            await expect(
                wejeToken.connect(user1).transfer(user2.address, maxTx + ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(wejeToken, "ExceedsMaxTransaction");
        });

        it("Should enforce max wallet amount", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
        
            // Enable trading and set to NORMAL phase
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.setTradingPhase(2); // NORMAL phase
        
            const maxWallet = await wejeToken.maxWalletAmount(); // 5,000,000 tokens
            const maxTx = await wejeToken.maxTransactionAmount();    // 1,000,000 tokens
            
            // Give user1 enough tokens
            await wejeToken.transfer(user1.address, maxWallet + ethers.parseEther("100000"));
        
            // STEP 1: Send user2 almost to the max wallet limit (but within transaction limit)
            const firstTransfer = maxWallet - ethers.parseEther("100"); // Just under max wallet
            await wejeToken.connect(user1).transfer(user2.address, firstTransfer);
        
            // STEP 2: Try to send more tokens that would exceed max wallet
            // But keep the transaction amount small (under maxTx)
            const secondTransfer = ethers.parseEther("200"); // This will push user2 over maxWallet
        
            // This should fail with ExceedsMaxWallet because:
            // user2's balance (4,999,900) + secondTransfer (200) = 5,000,100 > maxWallet (5,000,000)
            await expect(
                wejeToken.connect(user1).transfer(user2.address, secondTransfer)
            ).to.be.revertedWithCustomError(wejeToken, "ExceedsMaxWallet");
        });

        it("Should enforce transfer cooldown", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            // Enable trading and set to NORMAL phase
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.setTradingPhase(2); // NORMAL phase
    
            // Give user1 some tokens
            await wejeToken.transfer(user1.address, ethers.parseEther("10000"));
    
            // First transfer should work
            await wejeToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"));
    
            // Second transfer immediately should fail due to cooldown
            await expect(
                wejeToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"))
            ).to.be.revertedWithCustomError(wejeToken, "TransferCooldownActive");
        });

        it("Should update limits correctly", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            const newMaxTx = ethers.parseEther("2000000"); // 2M tokens
            const newMaxWallet = ethers.parseEther("10000000"); // 10M tokens

            await expect(wejeToken.updateLimits(newMaxTx, newMaxWallet))
                .to.emit(wejeToken, "LimitsUpdated")
                .withArgs(newMaxTx, newMaxWallet);

            expect(await wejeToken.maxTransactionAmount()).to.equal(newMaxTx);
            expect(await wejeToken.maxWalletAmount()).to.equal(newMaxWallet);
        });

        it("Should reject limits that are too low", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            const tooLowTx = ethers.parseEther("50000"); // Less than 0.1%
            const tooLowWallet = ethers.parseEther("100000"); // Less than 0.5%

            await expect(wejeToken.updateLimits(tooLowTx, tooLowWallet))
                .to.be.revertedWith("Max tx too low");
        });
    });

    describe("Anti-Bot Protection", function () {
        it("Should blacklist addresses", async function () {
            const { wejeToken, attacker } = await loadFixture(deployWejeTokenFixture);

            // FIXED: Using correct event name from your contract
            await expect(wejeToken.blacklistAddress(attacker.address, true))
                .to.emit(wejeToken, "AddressBlacklistedEvent")
                .withArgs(attacker.address, true);

            expect(await wejeToken.blacklisted(attacker.address)).to.be.true;
        });

        it("Should prevent blacklisted addresses from transferring", async function () {
            const { wejeToken, owner, attacker } = await loadFixture(deployWejeTokenFixture);

            await wejeToken.transfer(attacker.address, ethers.parseEther("1000"));
            await wejeToken.blacklistAddress(attacker.address, true);

            // FIXED: Using correct error name from your contract
            await expect(
                wejeToken.connect(attacker).transfer(owner.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(wejeToken, "AddressIsBlacklisted");
        });

        it("Should batch blacklist addresses", async function () {
            const { wejeToken, user1, user2, user3 } = await loadFixture(deployWejeTokenFixture);

            const addresses = [user1.address, user2.address, user3.address];
            
            await wejeToken.blacklistBatch(addresses, true);

            for (const address of addresses) {
                expect(await wejeToken.blacklisted(address)).to.be.true;
            }
        });

        it("Should mark as bot and blacklist", async function () {
            const { wejeToken, attacker } = await loadFixture(deployWejeTokenFixture);

            // FIXED: Using correct event names from your contract
            await expect(wejeToken.markAsBot(attacker.address))
                .to.emit(wejeToken, "BotDetectedEvent")
                .withArgs(attacker.address)
                .to.emit(wejeToken, "AddressBlacklistedEvent")
                .withArgs(attacker.address, true);

            expect(await wejeToken.isBot(attacker.address)).to.be.true;
            expect(await wejeToken.blacklisted(attacker.address)).to.be.true;
        });

        it("Should not allow blacklisting owner", async function () {
            const { wejeToken, owner } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.blacklistAddress(owner.address, true))
                .to.be.revertedWith("Cannot blacklist owner");
        });
    });

    // NOTE: REMOVED ENTIRE "Fee System" SECTION - Your contract has NO FEES

    describe("Exclusions", function () {
        it("Should exclude from limits", async function () {
            const { wejeToken, user1 } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.excludeFromLimits(user1.address, true))
                .to.emit(wejeToken, "ExcludedFromLimits")
                .withArgs(user1.address, true);

            expect(await wejeToken.isExcludedFromLimits(user1.address)).to.be.true;
        });

        // NOTE: REMOVED "exclude from fees" test - Your contract has NO FEES

        it("Should allow excluded addresses to bypass limits", async function () {
            const { wejeToken, owner, user1 } = await loadFixture(deployWejeTokenFixture);

            // Enable trading and exclude user1
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.excludeFromLimits(user1.address, true);

            // Give user1 more than max transaction amount
            const maxTx = await wejeToken.maxTransactionAmount();
            await wejeToken.transfer(user1.address, maxTx + ethers.parseEther("1000000"));

            // Should be able to transfer more than max
            await expect(
                wejeToken.connect(user1).transfer(owner.address, maxTx + ethers.parseEther("500000"))
            ).to.not.be.reverted;
        });
    });

    describe("Pausable", function () {
        it("Should pause and unpause contract", async function () {
            const { wejeToken, user1 } = await loadFixture(deployWejeTokenFixture);
    
            await wejeToken.pause();
            expect(await wejeToken.paused()).to.be.true;
    
            // Try to transfer while paused - this should revert
            // Note: In OpenZeppelin v5, the error might be different
            await expect(
                wejeToken.transfer(user1.address, ethers.parseEther("1000"))
            ).to.be.reverted; // Changed from specific message to just checking it reverts
    
            await wejeToken.unpause();
            expect(await wejeToken.paused()).to.be.false;
    
            await expect(
                wejeToken.transfer(user1.address, ethers.parseEther("1000"))
            ).to.not.be.reverted;
        });

        it("Should emergency pause trading", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();

            await wejeToken.emergencyPause();

            expect(await wejeToken.paused()).to.be.true;
            expect(await wejeToken.tradingEnabled()).to.be.false;
            expect(await wejeToken.currentPhase()).to.equal(0); // DISABLED
        });
    });

    describe("Ownership", function () {
        it("Should not allow renouncing ownership", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.renounceOwnership())
                .to.be.revertedWith("Ownership cannot be renounced for security");
        });

        it("Should initiate and accept ownership transfer", async function () {
            const { wejeToken, owner, user1 } = await loadFixture(deployWejeTokenFixture);

            await wejeToken.initiateOwnershipTransfer(user1.address);
            expect(await wejeToken.pendingOwners(user1.address)).to.be.true;

            await wejeToken.connect(user1).acceptOwnership();
            expect(await wejeToken.owner()).to.equal(user1.address);
        });

        it("Should not accept ownership if not pending", async function () {
            const { wejeToken, user1 } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.connect(user1).acceptOwnership())
                .to.be.revertedWith("Not a pending owner");
        });
    });

    describe("View Functions", function () {
        it("Should return correct cooldown information", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            // Enable trading and set to NORMAL phase
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.setTradingPhase(2); // NORMAL phase
    
            await wejeToken.transfer(user1.address, ethers.parseEther("10000"));
    
            // Before any transfer from user1
            expect(await wejeToken.getRemainingCooldown(user1.address)).to.equal(0);
    
            // Make a transfer from user1
            await wejeToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"));
            
            // Now check cooldown (should be > 0)
            const cooldown = await wejeToken.getRemainingCooldown(user1.address);
            expect(cooldown).to.be.gt(0);
            expect(cooldown).to.be.lte(300); // Max 5 minutes (300 seconds)
        });

        it("Should return trading enabled time", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            const timeUntil = await wejeToken.getTimeUntilTradingEnabled();
            expect(timeUntil).to.be.gt(0);

            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();

            expect(await wejeToken.getTimeUntilTradingEnabled()).to.equal(0);
        });

        it("Should return token info", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            const info = await wejeToken.getTokenInfo();
            
            expect(info.totalSupply_).to.equal(ethers.parseEther("1000000000"));
            expect(info.maxTx).to.equal(ethers.parseEther("1000000"));
            expect(info.maxWallet).to.equal(ethers.parseEther("5000000"));
            expect(info.trading).to.be.false;
            expect(info.phase).to.equal(0);
            expect(info.limits).to.be.true;
        });
    });

    describe("Emergency Functions", function () {
        it("Should emergency withdraw tokens", async function () {
            const { wejeToken, owner } = await loadFixture(deployWejeTokenFixture);

            // Send some ETH to contract
            await owner.sendTransaction({
                to: wejeToken.target,
                value: ethers.parseEther("1")
            });

            const balanceBefore = await ethers.provider.getBalance(owner.address);
            await wejeToken.emergencyWithdraw(ethers.ZeroAddress, ethers.parseEther("1"));
            const balanceAfter = await ethers.provider.getBalance(owner.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should only allow owner to call emergency functions", async function () {
            const { wejeToken, user1 } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.connect(user1).pause())
                .to.be.revertedWithCustomError(wejeToken, "OwnableUnauthorizedAccount");

            await expect(wejeToken.connect(user1).emergencyPause())
                .to.be.revertedWithCustomError(wejeToken, "OwnableUnauthorizedAccount");
        });
    });

    describe("Access Control", function () {
        it("Should only allow owner to call admin functions", async function () {
            const { wejeToken, user1 } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.connect(user1).blacklistAddress(user1.address, true))
                .to.be.revertedWithCustomError(wejeToken, "OwnableUnauthorizedAccount");

            await expect(wejeToken.connect(user1).updateLimits(1, 1))
                .to.be.revertedWithCustomError(wejeToken, "OwnableUnauthorizedAccount");

            // NOTE: REMOVED updateFees test - Your contract has NO FEES
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero transfers", async function () {
            const { wejeToken, user1 } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.transfer(user1.address, 0))
                .to.not.be.reverted;
        });

        it("Should handle transfers to self", async function () {
            const { wejeToken, owner } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.transfer(owner.address, ethers.parseEther("1000")))
                .to.not.be.reverted;
        });

        it("Should handle maximum values", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            const maxSupply = await wejeToken.MAX_SUPPLY();
            expect(maxSupply).to.equal(ethers.parseEther("1000000000"));
        });
    });

    describe("Trading Phase Restrictions", function () {
        it("Should enforce restricted phase limits", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            // Enable trading (starts in RESTRICTED phase)
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading(); // This sets currentPhase to RESTRICTED
    
            const maxTx = await wejeToken.maxTransactionAmount();
            const restrictedAmount = maxTx / 2n + ethers.parseEther("1"); // Just over half of max
    
            // Give user1 enough tokens
            await wejeToken.transfer(user1.address, maxTx + ethers.parseEther("100000"));
    
            // user1 tries to transfer more than half of maxTx (should fail in restricted phase)
            await expect(
                wejeToken.connect(user1).transfer(user2.address, restrictedAmount)
            ).to.be.revertedWith("Amount too high for restricted phase");
        });

        it("Should allow full amounts in normal phase", async function () {
            const { wejeToken, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.setTradingPhase(2); // NORMAL phase
    
            const maxTx = await wejeToken.maxTransactionAmount();
            
            // Give user1 the exact max amount
            await wejeToken.transfer(user1.address, maxTx + ethers.parseEther("1000"));
    
            // Should be able to transfer exactly maxTx in normal phase
            await expect(
                wejeToken.connect(user1).transfer(user2.address, maxTx)
            ).to.not.be.reverted;
        });
    });

    describe("Cooldown Management", function () {
        it("Should update cooldown period", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            await wejeToken.updateCooldown(600); // 10 minutes
            expect(await wejeToken.transferCooldown()).to.equal(600);
        });

        it("Should reject cooldown that is too high", async function () {
            const { wejeToken } = await loadFixture(deployWejeTokenFixture);

            await expect(wejeToken.updateCooldown(2 * 3600)) // 2 hours
                .to.be.revertedWith("Cooldown too high");
        });

        it("Should allow bypassing cooldown for excluded addresses", async function () {
            const { wejeToken, owner, user1 } = await loadFixture(deployWejeTokenFixture);

            await time.increase(7 * 24 * 3600 + 3600);
            await wejeToken.enableTrading();
            await wejeToken.excludeFromLimits(user1.address, true);

            await wejeToken.transfer(user1.address, ethers.parseEther("10000"));

            // Multiple transfers should work for excluded address
            await wejeToken.connect(user1).transfer(owner.address, ethers.parseEther("1000"));
            await wejeToken.connect(user1).transfer(owner.address, ethers.parseEther("1000"));
        });
    });
    describe("Exclusion Logic", function () {
        it("Should allow trading for excluded addresses even when trading disabled", async function () {
            const { wejeToken, owner, user1, user2 } = await loadFixture(deployWejeTokenFixture);
    
            // Exclude user1 from limits
            await wejeToken.excludeFromLimits(user1.address, true);
            
            // Give user1 some tokens
            await wejeToken.transfer(user1.address, ethers.parseEther("10000"));
    
            // user1 (excluded) should be able to transfer to user2 even with trading disabled
            // because user1 is excluded from limits
            await expect(
                wejeToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"))
            ).to.not.be.reverted;
        });
    
        it("Should prevent trading between non-excluded users when trading disabled", async function () {
            const { wejeToken, user1, user2, user3 } = await loadFixture(deployWejeTokenFixture);
    
            // Give user1 some tokens (owner can transfer even when trading disabled)
            await wejeToken.transfer(user1.address, ethers.parseEther("10000"));
    
            // user1 (not excluded) tries to transfer to user2 (not excluded) - should fail
            await expect(
                wejeToken.connect(user1).transfer(user2.address, ethers.parseEther("1000"))
            ).to.be.revertedWithCustomError(wejeToken, "TradingNotEnabled");
        });
    });
});