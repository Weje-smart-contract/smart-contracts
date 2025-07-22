const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("WejeVesting", function () {
    async function deployVestingFixture() {
        const [owner, emergencyRecipient, ceo, cto, dev1, advisor1, investor1, unauthorized] = await ethers.getSigners();

        // Deploy WEJE Token
        const WejeToken = await ethers.getContractFactory("WejeToken");
        const wejeToken = await WejeToken.deploy(
            "WEJE Token",
            "WEJE"
        );

        // Deploy Vesting Contract
        const WejeVesting = await ethers.getContractFactory("WejeVesting");
        const vesting = await WejeVesting.deploy(
            wejeToken.target,
            emergencyRecipient.address
        );

        // Fund vesting contract with tokens
        const vestingAllocation = ethers.parseEther("120000000"); // 120M tokens
        await wejeToken.transfer(vesting.target, vestingAllocation);

        return {
            wejeToken,
            vesting,
            owner,
            emergencyRecipient,
            ceo,
            cto,
            dev1,
            advisor1,
            investor1,
            unauthorized
        };
    }

    describe("Deployment", function () {
        it("Should deploy with correct parameters", async function () {
            const { vesting, wejeToken, emergencyRecipient, owner } = await loadFixture(deployVestingFixture);

            expect(await vesting.wejeToken()).to.equal(wejeToken.target);
            expect(await vesting.emergencyRecipient()).to.equal(emergencyRecipient.address);
            expect(await vesting.owner()).to.equal(owner.address);
        });

        it("Should initialize categories correctly", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            expect(await vesting.categoryMaxAllocation("team")).to.equal(ethers.parseEther("80000000"));
            expect(await vesting.categoryMaxAllocation("advisor")).to.equal(ethers.parseEther("25000000"));
            expect(await vesting.categoryMaxAllocation("investor")).to.equal(ethers.parseEther("15000000"));
        });

        it("Should set owner as authorized creator", async function () {
            const { vesting, owner } = await loadFixture(deployVestingFixture);

            expect(await vesting.authorizedCreators(owner.address)).to.be.true;
        });
    });

    describe("Category Management", function () {
        it("Should create new category", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.createCategory("marketing", ethers.parseEther("10000000")))
                .to.emit(vesting, "CategoryCreated")
                .withArgs("marketing", ethers.parseEther("10000000"));

            expect(await vesting.categoryMaxAllocation("marketing")).to.equal(ethers.parseEther("10000000"));
        });

        it("Should not create duplicate category", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.createCategory("team", ethers.parseEther("10000000")))
                .to.be.revertedWith("Category already exists");
        });

        it("Should update category limit", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await vesting.updateCategoryLimit("team", ethers.parseEther("90000000"));
            expect(await vesting.categoryMaxAllocation("team")).to.equal(ethers.parseEther("90000000"));
        });

        it("Should not update category limit below allocated", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            // Create a vesting schedule first
            await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("30000000"),
                730 * 24 * 3600, // 24 months
                1095 * 24 * 3600, // 36 months
                true,
                "team",
                1000 // 10% TGE
            );

            await expect(vesting.updateCategoryLimit("team", ethers.parseEther("20000000")))
                .to.be.revertedWith("Limit below allocated");
        });
    });

    describe("Authorization", function () {
        it("Should set authorized creator", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            await expect(vesting.setAuthorizedCreator(ceo.address, true))
                .to.emit(vesting, "AuthorizedCreatorUpdated")
                .withArgs(ceo.address, true);

            expect(await vesting.authorizedCreators(ceo.address)).to.be.true;
        });

        it("Should remove authorized creator", async function () {
            const { vesting, owner } = await loadFixture(deployVestingFixture);

            await vesting.setAuthorizedCreator(owner.address, false);
            expect(await vesting.authorizedCreators(owner.address)).to.be.false;
        });
    });

    describe("Vesting Schedule Creation", function () {
        it("Should create basic vesting schedule", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const amount = ethers.parseEther("30000000");
            const cliffDuration = 730 * 24 * 3600; // 24 months
            const vestingDuration = 1095 * 24 * 3600; // 36 months
            const tgePercent = 1000; // 10%

            await expect(vesting.createVestingSchedule(
                ceo.address,
                amount,
                cliffDuration,
                vestingDuration,
                true,
                "team",
                tgePercent
            )).to.emit(vesting, "VestingScheduleCreated");

            expect(await vesting.holdersVestingCount(ceo.address)).to.equal(1);
            expect(await vesting.categoryTotalAllocated("team")).to.equal(amount);
        });

        it("Should handle TGE release immediately", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            const amount = ethers.parseEther("10000000");
            const tgePercent = 1000; // 10%
            const tgeAmount = amount * BigInt(tgePercent) / 10000n;

            const balanceBefore = await wejeToken.balanceOf(ceo.address);

            await vesting.createVestingSchedule(
                ceo.address,
                amount,
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                true,
                "team",
                tgePercent
            );

            const balanceAfter = await wejeToken.balanceOf(ceo.address);
            expect(balanceAfter - balanceBefore).to.equal(tgeAmount);
        });

        it("Should reject invalid parameters", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            // Invalid beneficiary
            await expect(vesting.createVestingSchedule(
                ethers.ZeroAddress,
                ethers.parseEther("1000000"),
                0,
                365 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "InvalidBeneficiary");

            // Invalid amount
            await expect(vesting.createVestingSchedule(
                ceo.address,
                0,
                0,
                365 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "InvalidAmount");

            // Invalid vesting duration
            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                0,
                0,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "InvalidDuration");

            // Invalid category
            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                0,
                365 * 24 * 3600,
                true,
                "nonexistent",
                0
            )).to.be.revertedWithCustomError(vesting, "CategoryNotExists");

            // Invalid TGE percent
            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                0,
                365 * 24 * 3600,
                true,
                "team",
                6000 // 60% - too high
            )).to.be.revertedWithCustomError(vesting, "InvalidTGEPercent");
        });

        it("Should enforce category limits", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const exceedsLimit = ethers.parseEther("90000000"); // Exceeds 80M team limit

            await expect(vesting.createVestingSchedule(
                ceo.address,
                exceedsLimit,
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "ExceedsCategoryLimit");
        });

        it("Should check sufficient contract balance", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            // Withdraw most tokens from contract
            await vesting.withdrawNonVestedTokens();

            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("50000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "InsufficientBalance");
        });

        it("Should only allow authorized creators", async function () {
            const { vesting, unauthorized, ceo } = await loadFixture(deployVestingFixture);

            await expect(vesting.connect(unauthorized).createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "UnauthorizedCreator");
        });
    });

    describe("Batch Creation Functions", function () {
        it("Should create team vesting batch", async function () {
            const { vesting, ceo, cto, dev1 } = await loadFixture(deployVestingFixture);

            const beneficiaries = [ceo.address, cto.address, dev1.address];
            const amounts = [
                ethers.parseEther("30000000"),
                ethers.parseEther("20000000"),
                ethers.parseEther("15000000")
            ];
            const roles = ["CEO", "CTO", "Developer"];

            await vesting.createTeamVesting(beneficiaries, amounts, roles);

            expect(await vesting.holdersVestingCount(ceo.address)).to.equal(1);
            expect(await vesting.holdersVestingCount(cto.address)).to.equal(1);
            expect(await vesting.holdersVestingCount(dev1.address)).to.equal(1);
        });

        it("Should create advisor vesting batch", async function () {
            const { vesting, advisor1, ceo } = await loadFixture(deployVestingFixture);

            const beneficiaries = [advisor1.address, ceo.address];
            const amounts = [
                ethers.parseEther("5000000"),
                ethers.parseEther("10000000")
            ];

            await vesting.createAdvisorVesting(beneficiaries, amounts);

            expect(await vesting.holdersVestingCount(advisor1.address)).to.equal(1);
            expect(await vesting.categoryTotalAllocated("advisor")).to.equal(ethers.parseEther("15000000"));
        });

        it("Should create investor vesting batch", async function () {
            const { vesting, investor1, ceo } = await loadFixture(deployVestingFixture);

            const beneficiaries = [investor1.address, ceo.address];
            const amounts = [
                ethers.parseEther("8000000"),
                ethers.parseEther("7000000")
            ];

            await vesting.createInvestorVesting(
                beneficiaries,
                amounts,
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                "angel"
            );

            expect(await vesting.holdersVestingCount(investor1.address)).to.equal(1);
        });

        it("Should handle batch creation array length mismatch", async function () {
            const { vesting, ceo, cto } = await loadFixture(deployVestingFixture);

            const beneficiaries = [ceo.address, cto.address];
            const amounts = [ethers.parseEther("30000000")]; // Mismatched length
            const roles = ["CEO", "CTO"];

            await expect(vesting.createTeamVesting(beneficiaries, amounts, roles))
                .to.be.revertedWith("Array length mismatch");
        });
    });

    describe("Token Release", function () {
        let scheduleId;
        
        beforeEach(async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);
            
            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"), // 12M tokens
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                true,
                "team",
                1000 // 10% TGE
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            if (event) {
                scheduleId = vesting.interface.parseLog(event).args[0];
            }
        });

        it("Should not release tokens before cliff", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            // Create schedule and get ID
            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                true,
                "team",
                0 // No TGE for this test
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let testScheduleId;
            if (event) {
                testScheduleId = vesting.interface.parseLog(event).args[0];
            }

            // Try to release before cliff
            await expect(vesting.connect(ceo).release(testScheduleId))
                .to.be.revertedWithCustomError(vesting, "NoTokensToRelease");
        });

        it("Should release tokens after cliff", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            // Create schedule
            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                true,
                "team",
                0 // No TGE
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let testScheduleId;
            if (event) {
                testScheduleId = vesting.interface.parseLog(event).args[0];
            }

            // Fast forward past cliff
            await time.increase(365 * 24 * 3600 + 30 * 24 * 3600); // Cliff + 1 month

            const balanceBefore = await wejeToken.balanceOf(ceo.address);
            
            await expect(vesting.connect(ceo).release(testScheduleId))
                .to.emit(vesting, "TokensReleased");

            const balanceAfter = await wejeToken.balanceOf(ceo.address);
            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should release all tokens after full vesting", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            const amount = ethers.parseEther("12000000");
            
            // Create schedule
            const tx = await vesting.createVestingSchedule(
                ceo.address,
                amount,
                365 * 24 * 3600, // 12 months cliff
                730 * 24 * 3600, // 24 months vesting
                true,
                "team",
                0 // No TGE
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let testScheduleId;
            if (event) {
                testScheduleId = vesting.interface.parseLog(event).args[0];
            }

            // Fast forward past full vesting period
            await time.increase((365 + 730) * 24 * 3600 + 1);

            const balanceBefore = await wejeToken.balanceOf(ceo.address);
            await vesting.connect(ceo).release(testScheduleId);
            const balanceAfter = await wejeToken.balanceOf(ceo.address);

            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("Should enforce claim cooldown", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            // Create schedule
            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let testScheduleId;
            if (event) {
                testScheduleId = vesting.interface.parseLog(event).args[0];
            }

            // Fast forward past cliff
            await time.increase(365 * 24 * 3600 + 30 * 24 * 3600);

            // First release should work
            await vesting.connect(ceo).release(testScheduleId);

            // Second release within cooldown should fail
            await expect(vesting.connect(ceo).release(testScheduleId))
                .to.be.revertedWithCustomError(vesting, "ClaimCooldownActive");
        });

        it("Should only allow beneficiary to release", async function () {
            const { vesting, ceo, cto } = await loadFixture(deployVestingFixture);

            // Create schedule for CEO
            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let testScheduleId;
            if (event) {
                testScheduleId = vesting.interface.parseLog(event).args[0];
            }

            await time.increase(365 * 24 * 3600 + 30 * 24 * 3600);

            // CTO trying to release CEO's tokens should fail
            await expect(vesting.connect(cto).release(testScheduleId))
                .to.be.revertedWithCustomError(vesting, "NotBeneficiary");
        });

        it("Should release all available tokens for beneficiary", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            // Create multiple schedules
            await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("6000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            );

            await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("6000000"),
                730 * 24 * 3600, // Different cliff
                365 * 24 * 3600, // Different vesting
                true,
                "team",
                0
            );

            // Fast forward
            await time.increase(1095 * 24 * 3600); // 3 years

            const balanceBefore = await wejeToken.balanceOf(ceo.address);
            await vesting.connect(ceo).releaseAll(ceo.address);
            const balanceAfter = await wejeToken.balanceOf(ceo.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });
    });

    describe("Revocation", function () {
        let revocableScheduleId;
        let nonRevocableScheduleId;

        beforeEach(async function () {
            const { vesting, ceo, investor1 } = await loadFixture(deployVestingFixture);

            // Create revocable schedule (team)
            const tx1 = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true, // revocable
                "team",
                1000
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            if (event1) {
                revocableScheduleId = vesting.interface.parseLog(event1).args[0];
            }

            // Create non-revocable schedule (investor)
            const tx2 = await vesting.createVestingSchedule(
                investor1.address,
                ethers.parseEther("8000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                false, // non-revocable
                "investor",
                2000
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            if (event2) {
                nonRevocableScheduleId = vesting.interface.parseLog(event2).args[0];
            }
        });

        it("Should revoke revocable schedule", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.revoke(revocableScheduleId))
                .to.emit(vesting, "VestingRevoked");

            const schedule = await vesting.vestingSchedules(revocableScheduleId);
            expect(schedule.revoked).to.be.true;
        });

        it("Should not revoke non-revocable schedule", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.revoke(nonRevocableScheduleId))
                .to.be.revertedWithCustomError(vesting, "NotRevocable");
        });

        it("Should not revoke already revoked schedule", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await vesting.revoke(revocableScheduleId);

            await expect(vesting.revoke(revocableScheduleId))
                .to.be.revertedWithCustomError(vesting, "AlreadyRevoked");
        });

        it("Should release vested tokens before revoking", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            // Fast forward to make some tokens vested
            await time.increase(365 * 24 * 3600 + 180 * 24 * 3600); // Cliff + 6 months

            const balanceBefore = await wejeToken.balanceOf(ceo.address);
            await vesting.revoke(revocableScheduleId);
            const balanceAfter = await wejeToken.balanceOf(ceo.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should handle batch revocation", async function () {
            const { vesting, cto } = await loadFixture(deployVestingFixture);

            // Create another revocable schedule
            const tx = await vesting.createVestingSchedule(
                cto.address,
                ethers.parseEther("10000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                1000
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let anotherScheduleId;
            if (event) {
                anotherScheduleId = vesting.interface.parseLog(event).args[0];
            }

            await vesting.batchRevoke([revocableScheduleId, anotherScheduleId]);

            const schedule1 = await vesting.vestingSchedules(revocableScheduleId);
            const schedule2 = await vesting.vestingSchedules(anotherScheduleId);

            expect(schedule1.revoked).to.be.true;
            expect(schedule2.revoked).to.be.true;
        });
    });

    describe("View Functions", function () {
        let testScheduleId;

        beforeEach(async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                1000
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            if (event) {
                testScheduleId = vesting.interface.parseLog(event).args[0];
            }
        });

        it("Should return releasable amount", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            // Before cliff
            expect(await vesting.getReleasableAmount(testScheduleId)).to.equal(0);

            // After cliff
            await time.increase(365 * 24 * 3600 + 180 * 24 * 3600); // Cliff + 6 months
            const releasable = await vesting.getReleasableAmount(testScheduleId);
            expect(releasable).to.be.gt(0);
        });

        it("Should return vesting schedule", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const schedule = await vesting.getVestingSchedule(testScheduleId);
            expect(schedule.beneficiary).to.equal(ceo.address);
            expect(schedule.totalAmount).to.equal(ethers.parseEther("12000000"));
            expect(schedule.category).to.equal("team");
            expect(schedule.tgePercent).to.equal(1000);
        });

        it("Should return schedules for beneficiary", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const scheduleIds = await vesting.getVestingSchedulesForBeneficiary(ceo.address);
            expect(scheduleIds.length).to.equal(1);
            expect(scheduleIds[0]).to.equal(testScheduleId);
        });

        it("Should return total releasable for beneficiary", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            await time.increase(365 * 24 * 3600 + 180 * 24 * 3600);
            const totalReleasable = await vesting.getTotalReleasableForBeneficiary(ceo.address);
            expect(totalReleasable).to.be.gt(0);
        });

        it("Should return beneficiary info", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const info = await vesting.getBeneficiaryInfo(ceo.address);
            expect(info.totalAllocated).to.equal(ethers.parseEther("12000000"));
            expect(info.scheduleCount).to.equal(1);
            expect(info.totalReleased).to.equal(ethers.parseEther("1200000")); // 10% TGE
        });

        it("Should return vesting stats", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            const stats = await vesting.getVestingStats();
            expect(stats.totalSchedules).to.equal(1);
            expect(stats.totalVested).to.equal(ethers.parseEther("12000000"));
            expect(stats.totalBeneficiaries_).to.equal(1);
        });

        it("Should return category stats", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            const stats = await vesting.getCategoryStats("team");
            expect(stats.totalAllocated).to.equal(ethers.parseEther("12000000"));
            expect(stats.maxAllocation).to.equal(ethers.parseEther("80000000"));
            expect(stats.vestingCount).to.equal(1);
        });

        it("Should return vesting progress", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await time.increase(365 * 24 * 3600 + 365 * 24 * 3600); // Cliff + 1 year of vesting

            const progress = await vesting.getVestingProgress(testScheduleId);
            expect(progress.percentageVested).to.be.gt(0);
            expect(progress.percentageVested).to.be.lte(10000); // Max 100%
        });

        it("Should check if can claim", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            const canClaimBefore = await vesting.canClaim(ceo.address);
            expect(canClaimBefore.canClaimNow).to.be.true; // No cooldown yet

            await time.increase(365 * 24 * 3600 + 180 * 24 * 3600);

            const canClaimAfter = await vesting.canClaim(ceo.address);
            expect(canClaimAfter.claimableAmount).to.be.gt(0);
        });
    });

    describe("Admin Functions", function () {
        it("Should update claim cooldown", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.setClaimCooldown(2 * 24 * 3600)) // 2 days
                .to.emit(vesting, "ClaimCooldownUpdated")
                .withArgs(2 * 24 * 3600);

            expect(await vesting.claimCooldown()).to.equal(2 * 24 * 3600);
        });

        it("Should not allow cooldown too long", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.setClaimCooldown(8 * 24 * 3600)) // 8 days
                .to.be.revertedWith("Cooldown too long");
        });
    });

    describe("Emergency Functions", function () {
        it("Should toggle emergency mode", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.toggleEmergencyMode())
                .to.emit(vesting, "EmergencyModeToggled")
                .withArgs(true);

            expect(await vesting.emergencyMode()).to.be.true;
        });

        it("Should not allow vesting creation in emergency mode", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            await vesting.toggleEmergencyMode();

            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWithCustomError(vesting, "EmergencyModeActive");
        });

        it("Should emergency withdraw in emergency mode", async function () {
            const { vesting, wejeToken, emergencyRecipient } = await loadFixture(deployVestingFixture);

            await vesting.toggleEmergencyMode();

            const balanceBefore = await wejeToken.balanceOf(emergencyRecipient.address);
            await vesting.emergencyWithdraw();
            const balanceAfter = await wejeToken.balanceOf(emergencyRecipient.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });

        it("Should not emergency withdraw when not in emergency mode", async function () {
            const { vesting } = await loadFixture(deployVestingFixture);

            await expect(vesting.emergencyWithdraw())
                .to.be.revertedWith("Emergency mode not active");
        });

        it("Should pause and unpause", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            await vesting.pause();

            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.be.revertedWith("Pausable: paused");

            await vesting.unpause();

            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.not.be.reverted;
        });

        it("Should withdraw non-vested tokens", async function () {
            const { vesting, wejeToken, owner } = await loadFixture(deployVestingFixture);

            const balanceBefore = await wejeToken.balanceOf(owner.address);
            await vesting.withdrawNonVestedTokens();
            const balanceAfter = await wejeToken.balanceOf(owner.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });
    });

    describe("Access Control", function () {
        it("Should only allow owner to call admin functions", async function () {
            const { vesting, unauthorized } = await loadFixture(deployVestingFixture);

            await expect(vesting.connect(unauthorized).createCategory("test", ethers.parseEther("1000000")))
                .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");

            await expect(vesting.connect(unauthorized).setAuthorizedCreator(unauthorized.address, true))
                .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");

            await expect(vesting.connect(unauthorized).pause())
                .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
        });

        it("Should only allow owner to revoke", async function () {
            const { vesting, unauthorized, ceo } = await loadFixture(deployVestingFixture);

            const tx = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let scheduleId;
            if (event) {
                scheduleId = vesting.interface.parseLog(event).args[0];
            }

            await expect(vesting.connect(unauthorized).revoke(scheduleId))
                .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount");
        });
    });

    describe("Batch Operations", function () {
        it("Should create batch vesting schedules", async function () {
            const { vesting, ceo, cto, dev1 } = await loadFixture(deployVestingFixture);

            const beneficiaries = [ceo.address, cto.address, dev1.address];
            const amounts = [
                ethers.parseEther("10000000"),
                ethers.parseEther("8000000"),
                ethers.parseEther("6000000")
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
            expect(await vesting.holdersVestingCount(ceo.address)).to.equal(1);
            expect(await vesting.holdersVestingCount(cto.address)).to.equal(1);
            expect(await vesting.holdersVestingCount(dev1.address)).to.equal(1);
        });

        it("Should handle batch release", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            // Create multiple schedules
            const tx1 = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("6000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let scheduleId1;
            if (event1) {
                scheduleId1 = vesting.interface.parseLog(event1).args[0];
            }

            const tx2 = await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("6000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.logs.find(log => {
                try {
                    return vesting.interface.parseLog(log)?.name === "VestingScheduleCreated";
                } catch {
                    return false;
                }
            });
            let scheduleId2;
            if (event2) {
                scheduleId2 = vesting.interface.parseLog(event2).args[0];
            }

            // Fast forward past cliff
            await time.increase(365 * 24 * 3600 + 180 * 24 * 3600);

            const balanceBefore = await wejeToken.balanceOf(ceo.address);
            await vesting.connect(ceo).batchRelease([scheduleId1, scheduleId2]);
            const balanceAfter = await wejeToken.balanceOf(ceo.address);

            expect(balanceAfter).to.be.gt(balanceBefore);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle zero TGE percent", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            const balanceBefore = await wejeToken.balanceOf(ceo.address);

            await vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("12000000"),
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                0 // 0% TGE
            );

            const balanceAfter = await wejeToken.balanceOf(ceo.address);
            expect(balanceAfter).to.equal(balanceBefore); // No immediate release
        });

        it("Should handle maximum TGE percent", async function () {
            const { vesting, wejeToken, ceo } = await loadFixture(deployVestingFixture);

            const amount = ethers.parseEther("12000000");
            const tgePercent = 5000; // 50% (maximum allowed)

            const balanceBefore = await wejeToken.balanceOf(ceo.address);

            await vesting.createVestingSchedule(
                ceo.address,
                amount,
                365 * 24 * 3600,
                730 * 24 * 3600,
                true,
                "team",
                tgePercent
            );

            const balanceAfter = await wejeToken.balanceOf(ceo.address);
            const expectedTGE = amount * BigInt(tgePercent) / 10000n;
            expect(balanceAfter - balanceBefore).to.equal(expectedTGE);
        });

        it("Should handle vesting with zero cliff", async function () {
            const { vesting, ceo } = await loadFixture(deployVestingFixture);

            await expect(vesting.createVestingSchedule(
                ceo.address,
                ethers.parseEther("1000000"),
                0, // No cliff
                730 * 24 * 3600,
                true,
                "team",
                0
            )).to.not.be.reverted;
        });
    });
});