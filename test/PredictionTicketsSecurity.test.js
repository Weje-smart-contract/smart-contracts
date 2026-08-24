const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PredictionTickets Security, OpenZeppelin Relayer Gas-Sponsorship & ERC-1271 / EOA Suite", function () {
    let predictionTickets, mockToken, mockForwarder;
    let deployer, relayer1, relayer2, relayer3, user1, user2, user3, attacker, smartAccountOwner, admin2;
    let smartAccount;
    const BET_AMOUNT = ethers.parseEther("10");

    async function getPermitSignature(signer, token, spender, value, deadline) {
        const [nonce, name, chainId] = await Promise.all([
            token.nonces(signer.address),
            token.name(),
            (await ethers.provider.getNetwork()).chainId,
        ]);

        const domain = {
            name,
            version: "1",
            chainId,
            verifyingContract: await token.getAddress(),
        };

        const types = {
            Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };

        const message = {
            owner: signer.address,
            spender,
            value,
            nonce,
            deadline,
        };

        const signature = await signer.signTypedData(domain, types, message);
        const { v, r, s } = ethers.Signature.from(signature);
        return { v, r, s, signature };
    }

    async function getOpenTicketSignature(signer, contract, ticketInfo, user, nonce, deadline) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const domain = {
            name: "PredictionTickets",
            version: "1",
            chainId,
            verifyingContract: await contract.getAddress(),
        };

        const types = {
            OpenTicket: [
                { name: "betId", type: "uint256" },
                { name: "amount", type: "uint256" },
                { name: "startDate", type: "uint256" },
                { name: "endDate", type: "uint256" },
                { name: "uid", type: "bytes32" },
                { name: "affiliateId", type: "bytes32" },
                { name: "walletAddress", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };

        const message = {
            betId: ticketInfo.betId,
            amount: ticketInfo.amount,
            startDate: ticketInfo.startDate,
            endDate: ticketInfo.endDate,
            uid: user.uid,
            affiliateId: user.affiliateId,
            walletAddress: user.walletAddress,
            nonce,
            deadline,
        };

        return await signer.signTypedData(domain, types, message);
    }

    async function getJoinTicketSignature(signer, contract, betId, user, nonce, deadline) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const domain = {
            name: "PredictionTickets",
            version: "1",
            chainId,
            verifyingContract: await contract.getAddress(),
        };

        const types = {
            JoinTicket: [
                { name: "betId", type: "uint256" },
                { name: "uid", type: "bytes32" },
                { name: "affiliateId", type: "bytes32" },
                { name: "walletAddress", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };

        const message = {
            betId,
            uid: user.uid,
            affiliateId: user.affiliateId,
            walletAddress: user.walletAddress,
            nonce,
            deadline,
        };

        return await signer.signTypedData(domain, types, message);
    }

    beforeEach(async function () {
        [deployer, relayer1, relayer2, relayer3, user1, user2, user3, attacker, smartAccountOwner, admin2] = await ethers.getSigners();

        const MockToken = await ethers.getContractFactory("MockToken");
        mockToken = await MockToken.deploy();
        await mockToken.waitForDeployment();

        const MockForwarder = await ethers.getContractFactory("MockForwarder");
        mockForwarder = await MockForwarder.deploy();
        await mockForwarder.waitForDeployment();

        const PredictionTickets = await ethers.getContractFactory("contracts/PredictionContract.sol:PredictionTickets");
        predictionTickets = await PredictionTickets.deploy(await mockToken.getAddress(), await mockForwarder.getAddress());
        await predictionTickets.waitForDeployment();

        // Deploy Smart Account Wallet
        const MockSmartAccount = await ethers.getContractFactory("MockSmartAccount");
        smartAccount = await MockSmartAccount.deploy(smartAccountOwner.address);
        await smartAccount.waitForDeployment();

        // Fund users with tokens
        await mockToken.mint(user1.address, ethers.parseEther("1000"));
        await mockToken.mint(user2.address, ethers.parseEther("1000"));
        await mockToken.mint(user3.address, ethers.parseEther("1000"));
        await mockToken.mint(await smartAccount.getAddress(), ethers.parseEther("1000"));
    });

    describe("1. Gas-Sponsored Meta-Transactions across Relayers (OpenZeppelin Relayer Pattern)", function () {
        it("Relayer 1 executes openBet on behalf of user with gas sponsorship and direct permit (zero prior approval)", async function () {
            const betId = 10;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("sponsored_user")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            // Check initial balances and allowance
            expect(await mockToken.allowance(user1.address, await predictionTickets.getAddress())).to.equal(0n);
            const userInitialBalance = await mockToken.balanceOf(user1.address);
            const contractInitialBalance = await mockToken.balanceOf(await predictionTickets.getAddress());

            const permit = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const nonce = await predictionTickets.nonces(user1.address);
            const signature = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, user, nonce, deadline);

            await expect(
                predictionTickets.connect(relayer1).openBet(
                    ticketInfo,
                    user,
                    { deadline, v: permit.v, r: permit.r, s: permit.s },
                    { nonce, deadline, signature }
                )
            ).to.emit(predictionTickets, "TicketOpened");

            // Verify balances and ticket info
            expect(await mockToken.balanceOf(user1.address)).to.equal(userInitialBalance - BET_AMOUNT);
            expect(await mockToken.balanceOf(await predictionTickets.getAddress())).to.equal(contractInitialBalance + BET_AMOUNT);
            expect(await predictionTickets.nonces(user1.address)).to.equal(nonce + 1n);

            const info = await predictionTickets.getTicketInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
            expect(info.pool).to.equal(BET_AMOUNT);
        });

        it("Relayer 2 executes joinBet on behalf of user with gas sponsorship and direct permit", async function () {
            const betId = 11;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            const hostPermit = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await predictionTickets.nonces(user1.address);
            const hostSig = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, host, hostNonce, deadline);
            await predictionTickets.connect(relayer1).openBet(
                ticketInfo,
                host,
                { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s },
                { nonce: hostNonce, deadline, signature: hostSig }
            );

            const joinerPermit = await getPermitSignature(user2, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await predictionTickets.nonces(user2.address);
            const joinerSig = await getJoinTicketSignature(user2, predictionTickets, betId, joiner, joinerNonce, deadline);

            const joinerInitialBalance = await mockToken.balanceOf(user2.address);
            const contractBalanceBeforeJoin = await mockToken.balanceOf(await predictionTickets.getAddress());

            await expect(
                predictionTickets.connect(relayer2).joinBet(
                    betId,
                    joiner,
                    { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s },
                    { nonce: joinerNonce, deadline, signature: joinerSig }
                )
            ).to.emit(predictionTickets, "TicketJoined");

            expect(await mockToken.balanceOf(user2.address)).to.equal(joinerInitialBalance - BET_AMOUNT);
            expect(await mockToken.balanceOf(await predictionTickets.getAddress())).to.equal(contractBalanceBeforeJoin + BET_AMOUNT);

            const info = await predictionTickets.getTicketInfo(betId);
            expect(info.pool).to.equal(BET_AMOUNT * 2n);
        });
    });

    describe("2. Smart Account Wallet (ERC-1271) Direct & Gas-Sponsored Support", function () {
        it("Gas-sponsored openBet using Smart Account Wallet with ERC-1271 signature and token balance checks", async function () {
            const betId = 20;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const smartAccountAddress = await smartAccount.getAddress();
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("smart_account_user")), affiliateId: ethers.ZeroHash, walletAddress: smartAccountAddress };

            await smartAccount.connect(smartAccountOwner).approveToken(await mockToken.getAddress(), await predictionTickets.getAddress(), BET_AMOUNT);

            const smartAccountBalanceBefore = await mockToken.balanceOf(smartAccountAddress);
            const contractBalanceBefore = await mockToken.balanceOf(await predictionTickets.getAddress());

            const nonce = await predictionTickets.nonces(smartAccountAddress);
            const signature = await getOpenTicketSignature(smartAccountOwner, predictionTickets, ticketInfo, user, nonce, deadline);

            await expect(
                predictionTickets.connect(relayer1).openBet(
                    ticketInfo,
                    user,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature }
                )
            ).to.emit(predictionTickets, "TicketOpened");

            const info = await predictionTickets.getTicketInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
            expect(info.pool).to.equal(BET_AMOUNT);
            expect(await mockToken.balanceOf(smartAccountAddress)).to.equal(smartAccountBalanceBefore - BET_AMOUNT);
            expect(await mockToken.balanceOf(await predictionTickets.getAddress())).to.equal(contractBalanceBefore + BET_AMOUNT);
        });

        it("Gas-sponsored joinBet using Smart Account Wallet with ERC-1271 signature and token balance checks", async function () {
            const betId = 21;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const smartAccountAddress = await smartAccount.getAddress();
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const smartJoiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("smart_joiner")), affiliateId: ethers.ZeroHash, walletAddress: smartAccountAddress };

            const hostPermit = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await predictionTickets.nonces(user1.address);
            const hostSig = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, host, hostNonce, deadline);
            await predictionTickets.connect(relayer1).openBet(ticketInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            await smartAccount.connect(smartAccountOwner).approveToken(await mockToken.getAddress(), await predictionTickets.getAddress(), BET_AMOUNT);

            const smartAccountBalanceBefore = await mockToken.balanceOf(smartAccountAddress);
            const contractBalanceBefore = await mockToken.balanceOf(await predictionTickets.getAddress());

            const nonce = await predictionTickets.nonces(smartAccountAddress);
            const signature = await getJoinTicketSignature(smartAccountOwner, predictionTickets, betId, smartJoiner, nonce, deadline);

            await expect(
                predictionTickets.connect(relayer2).joinBet(
                    betId,
                    smartJoiner,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature }
                )
            ).to.emit(predictionTickets, "TicketJoined");

            expect(await predictionTickets.isJoined(betId, smartJoiner.uid)).to.be.true;
            expect(await mockToken.balanceOf(smartAccountAddress)).to.equal(smartAccountBalanceBefore - BET_AMOUNT);
            expect(await mockToken.balanceOf(await predictionTickets.getAddress())).to.equal(contractBalanceBefore + BET_AMOUNT);

            const info = await predictionTickets.getTicketInfo(betId);
            expect(info.pool).to.equal(BET_AMOUNT * 2n);
        });

        it("Rejects Smart Account transaction if ERC-1271 signature fails", async function () {
            const betId = 22;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const smartAccountAddress = await smartAccount.getAddress();
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("smart_account_user")), affiliateId: ethers.ZeroHash, walletAddress: smartAccountAddress };

            await smartAccount.connect(smartAccountOwner).approveToken(await mockToken.getAddress(), await predictionTickets.getAddress(), BET_AMOUNT);

            const nonce = await predictionTickets.nonces(smartAccountAddress);
            const invalidSignature = await getOpenTicketSignature(attacker, predictionTickets, ticketInfo, user, nonce, deadline);

            await expect(
                predictionTickets.connect(relayer1).openBet(
                    ticketInfo,
                    user,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature: invalidSignature }
                )
            ).to.be.revertedWith("Invalid signer signature");
        });
    });

    describe("3. Permit Front-Running Resistance (Anti-Pull Griefing Protection)", function () {
        it("Should succeed even if permit signature was front-run", async function () {
            const betId = 30;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            const { v, r, s } = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            await mockToken.permit(user1.address, await predictionTickets.getAddress(), BET_AMOUNT, deadline, v, r, s);

            const nonce = await predictionTickets.nonces(user1.address);
            const signature = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, user, nonce, deadline);

            await expect(
                predictionTickets.connect(relayer1).openBet(
                    ticketInfo,
                    user,
                    { deadline, v, r, s },
                    { nonce, deadline, signature }
                )
            ).to.not.be.reverted;

            const info = await predictionTickets.getTicketInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
        });

        it("Reverts with Insufficient allowance if permit signature is invalid and no prior allowance", async function () {
            const betId = 31;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            const nonce = await predictionTickets.nonces(user1.address);
            const signature = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, user, nonce, deadline);

            await expect(
                predictionTickets.connect(relayer1).openBet(
                    ticketInfo,
                    user,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature }
                )
            ).to.be.revertedWith("Insufficient allowance");
        });
    });

    describe("4. Lifecycle, Status Transitions, Admin & Distribution", function () {
        it("Refunds single participant when ticket status is updated with 1 user", async function () {
            const betId = 50;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            const permit = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const nonce = await predictionTickets.nonces(user1.address);
            const signature = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, user, nonce, deadline);

            await predictionTickets.connect(relayer1).openBet(ticketInfo, user, { deadline, v: permit.v, r: permit.r, s: permit.s }, { nonce, deadline, signature });

            const userBalanceBefore = await mockToken.balanceOf(user1.address);

            await expect(predictionTickets.connect(deployer).updateBetTicketStatus(betId))
                .to.emit(predictionTickets, "TicketDeleted")
                .withArgs(betId);

            expect(await mockToken.balanceOf(user1.address)).to.equal(userBalanceBefore + BET_AMOUNT);
        });

        it("Admin management and distribution to winners", async function () {
            const betId = 51;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            // Add admin2
            await predictionTickets.connect(deployer).addAdmin(admin2.address);
            expect(await predictionTickets.admins(admin2.address)).to.be.true;

            const hostPermit = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await predictionTickets.nonces(user1.address);
            const hostSig = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, host, hostNonce, deadline);
            await predictionTickets.connect(relayer1).openBet(ticketInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            const joinerPermit = await getPermitSignature(user2, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await predictionTickets.nonces(user2.address);
            const joinerSig = await getJoinTicketSignature(user2, predictionTickets, betId, joiner, joinerNonce, deadline);
            await predictionTickets.connect(relayer2).joinBet(betId, joiner, { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s }, { nonce: joinerNonce, deadline, signature: joinerSig });

            // Admin2 updates status
            await expect(predictionTickets.connect(admin2).updateBetTicketStatus(betId))
                .to.emit(predictionTickets, "TicketRunning")
                .withArgs(betId);

            const user1BalanceBefore = await mockToken.balanceOf(user1.address);
            const totalPrize = BET_AMOUNT * 2n;

            await expect(
                predictionTickets.connect(admin2).distributeWinners(
                    betId,
                    [{ uid: host.uid, amount: totalPrize }],
                    true
                )
            ).to.emit(predictionTickets, "TicketFinished").withArgs(betId);

            expect(await mockToken.balanceOf(user1.address)).to.equal(user1BalanceBefore + totalPrize);

            // Test removeAdmin
            await predictionTickets.connect(deployer).removeAdmin(admin2.address);
            expect(await predictionTickets.admins(admin2.address)).to.be.false;
        });

        it("Counts commission as (pool - totalDistributed) upon final distribution and allows owner withdrawal", async function () {
            const betId = 53;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            // Host opens, joiner joins: Total Pool = 20 WEJE
            const hostPermit = await getPermitSignature(user1, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await predictionTickets.nonces(user1.address);
            const hostSig = await getOpenTicketSignature(user1, predictionTickets, ticketInfo, host, hostNonce, deadline);
            await predictionTickets.connect(relayer1).openBet(ticketInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            const joinerPermit = await getPermitSignature(user2, mockToken, await predictionTickets.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await predictionTickets.nonces(user2.address);
            const joinerSig = await getJoinTicketSignature(user2, predictionTickets, betId, joiner, joinerNonce, deadline);
            await predictionTickets.connect(relayer2).joinBet(betId, joiner, { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s }, { nonce: joinerNonce, deadline, signature: joinerSig });

            await predictionTickets.connect(deployer).updateBetTicketStatus(betId);

            // Total pool = 20 WEJE. Distribute 17 WEJE to host. Remaining 3 WEJE is commission.
            const distributedAmount = ethers.parseEther("17");
            const expectedCommission = ethers.parseEther("3");
            const commissionBefore = await predictionTickets.totalCommission();

            await expect(
                predictionTickets.connect(deployer).distributeWinners(
                    betId,
                    [{ uid: host.uid, amount: distributedAmount }],
                    true
                )
            ).to.emit(predictionTickets, "CommissionCollected")
             .withArgs(betId, expectedCommission);

            expect(await predictionTickets.totalCommission()).to.equal(commissionBefore + expectedCommission);

            // Owner withdraws commission
            const deployerBalanceBefore = await mockToken.balanceOf(deployer.address);
            await expect(predictionTickets.connect(deployer).withdrawCommission(deployer.address, expectedCommission))
                .to.emit(predictionTickets, "CommissionWithdrawn")
                .withArgs(deployer.address, expectedCommission);

            expect(await mockToken.balanceOf(deployer.address)).to.equal(deployerBalanceBefore + expectedCommission);
            expect(await predictionTickets.totalCommission()).to.equal(commissionBefore);
        });

        it("Rejects commission withdrawal if not owner or exceeds commission balance", async function () {
            await expect(
                predictionTickets.connect(attacker).withdrawCommission(attacker.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(predictionTickets, "OwnableUnauthorizedAccount");

            await expect(
                predictionTickets.connect(deployer).withdrawCommission(deployer.address, ethers.parseEther("999999"))
            ).to.be.revertedWith("Amount exceeds commission");
        });

        it("Queries open and running tickets correctly, reverts on invalid status", async function () {
            const status0 = await predictionTickets.getTicketsByStatus(0);
            const status1 = await predictionTickets.getTicketsByStatus(1);

            expect(Array.isArray(status0)).to.be.true;
            expect(Array.isArray(status1)).to.be.true;
            await expect(predictionTickets.getTicketsByStatus(2)).to.be.revertedWith("Invalid status");
        });

        it("Queries ticket by ID, participant IDs and user details", async function () {
            const betId = 70;
            const now = Math.floor(Date.now() / 1000);
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host70")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            await mockToken.connect(user1).approve(await predictionTickets.getAddress(), BET_AMOUNT);
            await predictionTickets.connect(user1).openBet(ticketInfo, host, { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash }, { nonce: 0, deadline: 0, signature: "0x" });

            const [info, pool, status, pCount] = await predictionTickets.getTicketById(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
            expect(pCount).to.equal(1);

            const pIds = await predictionTickets.getParticipantIds(betId);
            expect(pIds.length).to.equal(1);
            expect(pIds[0]).to.equal(host.uid);
        });
    });

    describe("5. ERC-2771 Forwarder & Direct Support", function () {
        it("Executes openBet via ERC-2771 Forwarder", async function () {
            const betId = 60;
            const now = Math.floor(Date.now() / 1000);
            const ticketInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("forwarder_user")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            await mockToken.connect(user1).approve(await predictionTickets.getAddress(), BET_AMOUNT);

            const calldata = predictionTickets.interface.encodeFunctionData("openBet", [
                [ticketInfo.amount, ticketInfo.betId, ticketInfo.startDate, ticketInfo.endDate],
                [user.uid, user.affiliateId, user.walletAddress],
                [0, 0, ethers.ZeroHash, ethers.ZeroHash],
                [0, 0, "0x"]
            ]);

            await mockForwarder.execute(await predictionTickets.getAddress(), calldata, user1.address);

            const info = await predictionTickets.getTicketInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
        });
    });
});
