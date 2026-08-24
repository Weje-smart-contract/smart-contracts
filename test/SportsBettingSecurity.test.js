const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SportsBetting Security, OpenZeppelin Relayer Gas-Sponsorship & ERC-1271 / EOA Suite", function () {
    let sportsBetting, mockToken, mockForwarder;
    let deployer, relayer1, relayer2, relayer3, user1, user2, user3, attacker, smartAccountOwner;
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

    async function getOpenBetSignature(signer, sportsBettingContract, betInfo, user, nonce, deadline) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const domain = {
            name: "SportsBetting",
            version: "1",
            chainId,
            verifyingContract: await sportsBettingContract.getAddress(),
        };

        const types = {
            OpenBet: [
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
            betId: betInfo.betId,
            amount: betInfo.amount,
            startDate: betInfo.startDate,
            endDate: betInfo.endDate,
            uid: user.uid,
            affiliateId: user.affiliateId,
            walletAddress: user.walletAddress,
            nonce,
            deadline,
        };

        return await signer.signTypedData(domain, types, message);
    }

    async function getJoinBetSignature(signer, sportsBettingContract, betId, user, nonce, deadline) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        const domain = {
            name: "SportsBetting",
            version: "1",
            chainId,
            verifyingContract: await sportsBettingContract.getAddress(),
        };

        const types = {
            JoinBet: [
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
        [deployer, relayer1, relayer2, relayer3, user1, user2, user3, attacker, smartAccountOwner] = await ethers.getSigners();

        const MockToken = await ethers.getContractFactory("MockToken");
        mockToken = await MockToken.deploy();
        await mockToken.waitForDeployment();

        const MockForwarder = await ethers.getContractFactory("MockForwarder");
        mockForwarder = await MockForwarder.deploy();
        await mockForwarder.waitForDeployment();

        const SportsBetting = await ethers.getContractFactory("contracts/SportsBetting.sol:SportsBetting");
        sportsBetting = await SportsBetting.deploy(await mockToken.getAddress(), await mockForwarder.getAddress());
        await sportsBetting.waitForDeployment();

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

    describe("1. Gas-Sponsored Meta-Transactions across Multiple Relayers (OpenZeppelin Relayer Pattern)", function () {
        it("Relayer 1 executes openBet on behalf of user with direct permit signature (zero prior approval)", async function () {
            const betId = 10;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("sponsored_user")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            // User has 0 allowance initially
            expect(await mockToken.allowance(user1.address, await sportsBetting.getAddress())).to.equal(0n);
            const userInitialBalance = await mockToken.balanceOf(user1.address);
            const contractInitialBalance = await mockToken.balanceOf(await sportsBetting.getAddress());

            // User signs permit & EIP-712 openBet
            const permit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const nonce = await sportsBetting.nonces(user1.address);
            const signature = await getOpenBetSignature(user1, sportsBetting, betInfo, user, nonce, deadline);

            // Relayer 1 sends transaction and sponsors gas
            await expect(
                sportsBetting.connect(relayer1).openBet(
                    betInfo,
                    user,
                    { deadline, v: permit.v, r: permit.r, s: permit.s },
                    { nonce, deadline, signature }
                )
            ).to.emit(sportsBetting, "BetOpened");

            // Check balances and pool before/after
            expect(await mockToken.balanceOf(user1.address)).to.equal(userInitialBalance - BET_AMOUNT);
            expect(await mockToken.balanceOf(await sportsBetting.getAddress())).to.equal(contractInitialBalance + BET_AMOUNT);
            expect(await sportsBetting.nonces(user1.address)).to.equal(nonce + 1n);

            const info = await sportsBetting.getBetInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
            expect(info.pool).to.equal(BET_AMOUNT);
        });

        it("Relayer 2 executes joinBet on behalf of user with gas sponsorship and direct permit", async function () {
            const betId = 11;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            // Host opens via relayer 1
            const hostPermit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await sportsBetting.nonces(user1.address);
            const hostSig = await getOpenBetSignature(user1, sportsBetting, betInfo, host, hostNonce, deadline);
            await sportsBetting.connect(relayer1).openBet(
                betInfo,
                host,
                { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s },
                { nonce: hostNonce, deadline, signature: hostSig }
            );

            // Joiner signs permit & EIP-712 JoinBet
            const joinerPermit = await getPermitSignature(user2, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await sportsBetting.nonces(user2.address);
            const joinerSig = await getJoinBetSignature(user2, sportsBetting, betId, joiner, joinerNonce, deadline);

            const joinerInitialBalance = await mockToken.balanceOf(user2.address);
            const contractBalanceBeforeJoin = await mockToken.balanceOf(await sportsBetting.getAddress());

            // Relayer 2 joins on behalf of joiner
            await expect(
                sportsBetting.connect(relayer2).joinBet(
                    betId,
                    joiner,
                    { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s },
                    { nonce: joinerNonce, deadline, signature: joinerSig }
                )
            ).to.emit(sportsBetting, "BetJoined");

            expect(await mockToken.balanceOf(user2.address)).to.equal(joinerInitialBalance - BET_AMOUNT);
            expect(await mockToken.balanceOf(await sportsBetting.getAddress())).to.equal(contractBalanceBeforeJoin + BET_AMOUNT);

            const info = await sportsBetting.getBetInfo(betId);
            expect(info.pool).to.equal(BET_AMOUNT * 2n);
        });

        it("Relayer 3 executes joinBet for a 3rd participant", async function () {
            const betId = 12;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner3")), affiliateId: ethers.ZeroHash, walletAddress: user3.address };

            // Host opens via relayer 1
            const hostPermit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await sportsBetting.nonces(user1.address);
            const hostSig = await getOpenBetSignature(user1, sportsBetting, betInfo, host, hostNonce, deadline);
            await sportsBetting.connect(relayer1).openBet(
                betInfo,
                host,
                { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s },
                { nonce: hostNonce, deadline, signature: hostSig }
            );

            // Joiner 3 via relayer 3
            const joinerPermit = await getPermitSignature(user3, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await sportsBetting.nonces(user3.address);
            const joinerSig = await getJoinBetSignature(user3, sportsBetting, betId, joiner, joinerNonce, deadline);

            await expect(
                sportsBetting.connect(relayer3).joinBet(
                    betId,
                    joiner,
                    { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s },
                    { nonce: joinerNonce, deadline, signature: joinerSig }
                )
            ).to.emit(sportsBetting, "BetJoined");
        });
    });

    describe("2. Smart Account Wallet (ERC-1271) Direct & Gas-Sponsored Support", function () {
        it("Gas-sponsored openBet using Smart Account Wallet with ERC-1271 signature and token balance checks", async function () {
            const betId = 20;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const smartAccountAddress = await smartAccount.getAddress();
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("smart_account_user")), affiliateId: ethers.ZeroHash, walletAddress: smartAccountAddress };

            // Smart account approves token
            await smartAccount.connect(smartAccountOwner).approveToken(await mockToken.getAddress(), await sportsBetting.getAddress(), BET_AMOUNT);

            const smartAccountBalanceBefore = await mockToken.balanceOf(smartAccountAddress);
            const contractBalanceBefore = await mockToken.balanceOf(await sportsBetting.getAddress());

            // Smart account owner signs the EIP-712 digest
            const nonce = await sportsBetting.nonces(smartAccountAddress);
            const signature = await getOpenBetSignature(smartAccountOwner, sportsBetting, betInfo, user, nonce, deadline);

            // Relayer 1 submits gas-sponsored transaction
            await expect(
                sportsBetting.connect(relayer1).openBet(
                    betInfo,
                    user,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature }
                )
            ).to.emit(sportsBetting, "BetOpened");

            const info = await sportsBetting.getBetInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
            expect(info.pool).to.equal(BET_AMOUNT);
            expect(await mockToken.balanceOf(smartAccountAddress)).to.equal(smartAccountBalanceBefore - BET_AMOUNT);
            expect(await mockToken.balanceOf(await sportsBetting.getAddress())).to.equal(contractBalanceBefore + BET_AMOUNT);
        });

        it("Gas-sponsored joinBet using Smart Account Wallet with ERC-1271 signature and token balance checks", async function () {
            const betId = 21;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const smartAccountAddress = await smartAccount.getAddress();
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const smartJoiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("smart_joiner")), affiliateId: ethers.ZeroHash, walletAddress: smartAccountAddress };

            // Host opens
            const hostPermit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await sportsBetting.nonces(user1.address);
            const hostSig = await getOpenBetSignature(user1, sportsBetting, betInfo, host, hostNonce, deadline);
            await sportsBetting.connect(relayer1).openBet(betInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            // Smart account approves token
            await smartAccount.connect(smartAccountOwner).approveToken(await mockToken.getAddress(), await sportsBetting.getAddress(), BET_AMOUNT);

            const smartAccountBalanceBefore = await mockToken.balanceOf(smartAccountAddress);
            const contractBalanceBefore = await mockToken.balanceOf(await sportsBetting.getAddress());

            // Smart account owner signs EIP-712 join authorization
            const nonce = await sportsBetting.nonces(smartAccountAddress);
            const signature = await getJoinBetSignature(smartAccountOwner, sportsBetting, betId, smartJoiner, nonce, deadline);

            // Relayer 2 executes
            await expect(
                sportsBetting.connect(relayer2).joinBet(
                    betId,
                    smartJoiner,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature }
                )
            ).to.emit(sportsBetting, "BetJoined");

            expect(await sportsBetting.isJoined(betId, smartJoiner.uid)).to.be.true;
            expect(await mockToken.balanceOf(smartAccountAddress)).to.equal(smartAccountBalanceBefore - BET_AMOUNT);
            expect(await mockToken.balanceOf(await sportsBetting.getAddress())).to.equal(contractBalanceBefore + BET_AMOUNT);

            const info = await sportsBetting.getBetInfo(betId);
            expect(info.pool).to.equal(BET_AMOUNT * 2n);
        });

        it("Rejects Smart Account transaction if ERC-1271 signature is invalid", async function () {
            const betId = 22;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const smartAccountAddress = await smartAccount.getAddress();
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("smart_account_user")), affiliateId: ethers.ZeroHash, walletAddress: smartAccountAddress };

            await smartAccount.connect(smartAccountOwner).approveToken(await mockToken.getAddress(), await sportsBetting.getAddress(), BET_AMOUNT);

            // Attacker signs instead of smartAccountOwner
            const nonce = await sportsBetting.nonces(smartAccountAddress);
            const invalidSignature = await getOpenBetSignature(attacker, sportsBetting, betInfo, user, nonce, deadline);

            await expect(
                sportsBetting.connect(relayer1).openBet(
                    betInfo,
                    user,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature: invalidSignature }
                )
            ).to.be.revertedWith("Invalid signer signature");
        });
    });

    describe("3. Permit Front-Running Resistance (Anti-Pull Griefing Protection)", function () {
        it("Should succeed even if permit signature was front-run / already submitted", async function () {
            const betId = 30;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            // Generate permit
            const { v, r, s } = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);

            // Attacker front-runs and calls permit directly
            await mockToken.permit(user1.address, await sportsBetting.getAddress(), BET_AMOUNT, deadline, v, r, s);

            // Relayer openBet transaction is processed afterward (try-catch prevents revert, allowance is active)
            const nonce = await sportsBetting.nonces(user1.address);
            const signature = await getOpenBetSignature(user1, sportsBetting, betInfo, user, nonce, deadline);

            await expect(
                sportsBetting.connect(relayer1).openBet(
                    betInfo,
                    user,
                    { deadline, v, r, s },
                    { nonce, deadline, signature }
                )
            ).to.not.be.reverted;

            const info = await sportsBetting.getBetInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
        });

        it("Reverts with Insufficient allowance if permit signature is invalid and no prior allowance", async function () {
            const betId = 31;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            // User has 0 allowance and provides invalid permit parameters
            const nonce = await sportsBetting.nonces(user1.address);
            const signature = await getOpenBetSignature(user1, sportsBetting, betInfo, user, nonce, deadline);

            await expect(
                sportsBetting.connect(relayer1).openBet(
                    betInfo,
                    user,
                    { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash },
                    { nonce, deadline, signature }
                )
            ).to.be.revertedWith("Insufficient allowance");
        });
    });

    describe("4. Signature Replay & Security Validations", function () {
        it("Rejects signature replay with already used nonce", async function () {
            const betId = 40;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            await mockToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT * 2n);

            const nonce = await sportsBetting.nonces(user1.address);
            const signature = await getOpenBetSignature(user1, sportsBetting, betInfo, user, nonce, deadline);

            // First call succeeds
            await sportsBetting.connect(relayer1).openBet(betInfo, user, { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash }, { nonce, deadline, signature });

            // Replay with different betId but old nonce fails
            const betInfo2 = { betId: 41, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            await expect(
                sportsBetting.connect(relayer1).openBet(betInfo2, user, { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash }, { nonce, deadline, signature })
            ).to.be.revertedWith("Invalid nonce");
        });

        it("Rejects expired signature", async function () {
            const betId = 42;
            const now = Math.floor(Date.now() / 1000);
            const expiredDeadline = now - 100;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            const nonce = await sportsBetting.nonces(user1.address);
            const signature = await getOpenBetSignature(user1, sportsBetting, betInfo, user, nonce, expiredDeadline);

            await expect(
                sportsBetting.connect(relayer1).openBet(betInfo, user, { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash }, { nonce, deadline: expiredDeadline, signature })
            ).to.be.revertedWith("Signature expired");
        });

        it("Rejects unauthenticated sender when signature is omitted", async function () {
            const betId = 43;
            const now = Math.floor(Date.now() / 1000);
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            // Attacker tries to open bet for user1 without signature
            await expect(
                sportsBetting.connect(attacker).openBet(betInfo, user, { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash }, { nonce: 0, deadline: 0, signature: "0x" })
            ).to.be.revertedWith("Sender must match user wallet");
        });
    });

    describe("5. Lifecycle, Status Transitions & Commission Distribution", function () {
        it("Refunds single participant when ticket status is updated with 1 user", async function () {
            const betId = 50;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("u1")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            const permit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const nonce = await sportsBetting.nonces(user1.address);
            const signature = await getOpenBetSignature(user1, sportsBetting, betInfo, user, nonce, deadline);

            await sportsBetting.connect(relayer1).openBet(betInfo, user, { deadline, v: permit.v, r: permit.r, s: permit.s }, { nonce, deadline, signature });

            const userBalanceBefore = await mockToken.balanceOf(user1.address);

            // Owner updates status (only 1 user -> refund)
            await expect(sportsBetting.connect(deployer).updateBetTicketStatus(betId))
                .to.emit(sportsBetting, "BetDeleted")
                .withArgs(betId);

            expect(await mockToken.balanceOf(user1.address)).to.equal(userBalanceBefore + BET_AMOUNT);
        });

        it("Transitions to running with 2+ participants and distributes winners", async function () {
            const betId = 51;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            // Host opens via relayer 1
            const hostPermit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await sportsBetting.nonces(user1.address);
            const hostSig = await getOpenBetSignature(user1, sportsBetting, betInfo, host, hostNonce, deadline);
            await sportsBetting.connect(relayer1).openBet(betInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            // Joiner joins via relayer 2
            const joinerPermit = await getPermitSignature(user2, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await sportsBetting.nonces(user2.address);
            const joinerSig = await getJoinBetSignature(user2, sportsBetting, betId, joiner, joinerNonce, deadline);
            await sportsBetting.connect(relayer2).joinBet(betId, joiner, { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s }, { nonce: joinerNonce, deadline, signature: joinerSig });

            // Move to Running
            await expect(sportsBetting.connect(deployer).updateBetTicketStatus(betId))
                .to.emit(sportsBetting, "BetRunning")
                .withArgs(betId);

            const user1BalanceBefore = await mockToken.balanceOf(user1.address);
            const totalPrize = BET_AMOUNT * 2n;

            // Distribute winners (host wins entire pool)
            await expect(
                sportsBetting.connect(deployer).distributeWinners(
                    betId,
                    [{ uid: host.uid, amount: totalPrize }],
                    true
                )
            ).to.emit(sportsBetting, "BetFinished").withArgs(betId);

            expect(await mockToken.balanceOf(user1.address)).to.equal(user1BalanceBefore + totalPrize);
        });

        it("Prevents distributing more than the bet pool", async function () {
            const betId = 52;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            const hostPermit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await sportsBetting.nonces(user1.address);
            const hostSig = await getOpenBetSignature(user1, sportsBetting, betInfo, host, hostNonce, deadline);
            await sportsBetting.connect(relayer1).openBet(betInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            const joinerPermit = await getPermitSignature(user2, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await sportsBetting.nonces(user2.address);
            const joinerSig = await getJoinBetSignature(user2, sportsBetting, betId, joiner, joinerNonce, deadline);
            await sportsBetting.connect(relayer2).joinBet(betId, joiner, { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s }, { nonce: joinerNonce, deadline, signature: joinerSig });

            await sportsBetting.connect(deployer).updateBetTicketStatus(betId);

            // Try to distribute pool + 1 ether
            await expect(
                sportsBetting.connect(deployer).distributeWinners(
                    betId,
                    [{ uid: host.uid, amount: (BET_AMOUNT * 2n) + ethers.parseEther("1") }],
                    true
                )
            ).to.be.revertedWith("Distribution exceeds pool");
        });

        it("Counts commission as (pool - totalDistributed) upon final distribution and allows owner withdrawal", async function () {
            const betId = 53;
            const now = Math.floor(Date.now() / 1000);
            const deadline = now + 3600;
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };
            const joiner = { uid: ethers.keccak256(ethers.toUtf8Bytes("joiner")), affiliateId: ethers.ZeroHash, walletAddress: user2.address };

            // Host opens, joiner joins: Total Pool = 20 WEJE
            const hostPermit = await getPermitSignature(user1, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const hostNonce = await sportsBetting.nonces(user1.address);
            const hostSig = await getOpenBetSignature(user1, sportsBetting, betInfo, host, hostNonce, deadline);
            await sportsBetting.connect(relayer1).openBet(betInfo, host, { deadline, v: hostPermit.v, r: hostPermit.r, s: hostPermit.s }, { nonce: hostNonce, deadline, signature: hostSig });

            const joinerPermit = await getPermitSignature(user2, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
            const joinerNonce = await sportsBetting.nonces(user2.address);
            const joinerSig = await getJoinBetSignature(user2, sportsBetting, betId, joiner, joinerNonce, deadline);
            await sportsBetting.connect(relayer2).joinBet(betId, joiner, { deadline, v: joinerPermit.v, r: joinerPermit.r, s: joinerPermit.s }, { nonce: joinerNonce, deadline, signature: joinerSig });

            await sportsBetting.connect(deployer).updateBetTicketStatus(betId);

            // Total pool = 20 WEJE. Distribute 18 WEJE to host (90%). Remaining 2 WEJE is commission (10%).
            const distributedAmount = ethers.parseEther("18");
            const expectedCommission = ethers.parseEther("2");
            const commissionBefore = await sportsBetting.totalCommission();

            await expect(
                sportsBetting.connect(deployer).distributeWinners(
                    betId,
                    [{ uid: host.uid, amount: distributedAmount }],
                    true
                )
            ).to.emit(sportsBetting, "CommissionCollected")
             .withArgs(betId, expectedCommission);

            expect(await sportsBetting.totalCommission()).to.equal(commissionBefore + expectedCommission);

            // Owner withdraws the commission
            const deployerBalanceBefore = await mockToken.balanceOf(deployer.address);
            await expect(sportsBetting.connect(deployer).withdrawCommission(deployer.address, expectedCommission))
                .to.emit(sportsBetting, "CommissionWithdrawn")
                .withArgs(deployer.address, expectedCommission);

            expect(await mockToken.balanceOf(deployer.address)).to.equal(deployerBalanceBefore + expectedCommission);
            expect(await sportsBetting.totalCommission()).to.equal(commissionBefore);
        });

        it("Rejects commission withdrawal if not owner or exceeds commission balance", async function () {
            await expect(
                sportsBetting.connect(attacker).withdrawCommission(attacker.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(sportsBetting, "OwnableUnauthorizedAccount");

            await expect(
                sportsBetting.connect(deployer).withdrawCommission(deployer.address, ethers.parseEther("999999"))
            ).to.be.revertedWith("Amount exceeds commission");
        });

        it("Queries open and running bets correctly, reverts on invalid status", async function () {
            const status0 = await sportsBetting.getBetsByStatus(0);
            const status1 = await sportsBetting.getBetsByStatus(1);

            expect(Array.isArray(status0)).to.be.true;
            expect(Array.isArray(status1)).to.be.true;
            await expect(sportsBetting.getBetsByStatus(2)).to.be.revertedWith("Invalid status");
        });

        it("Queries participant IDs and user details", async function () {
            const betId = 70;
            const now = Math.floor(Date.now() / 1000);
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const host = { uid: ethers.keccak256(ethers.toUtf8Bytes("host70")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            await mockToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
            await sportsBetting.connect(user1).openBet(betInfo, host, { deadline: 0, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash }, { nonce: 0, deadline: 0, signature: "0x" });

            const pIds = await sportsBetting.getParticipantIds(betId);
            expect(pIds.length).to.equal(1);
            expect(pIds[0]).to.equal(host.uid);
        });
    });

    describe("6. ERC-2771 Forwarder & Direct Support", function () {
        it("Executes openBet via ERC-2771 Forwarder", async function () {
            const betId = 60;
            const now = Math.floor(Date.now() / 1000);
            const betInfo = { betId, amount: BET_AMOUNT, startDate: now + 3600, endDate: now + 7200 };
            const user = { uid: ethers.keccak256(ethers.toUtf8Bytes("forwarder_user")), affiliateId: ethers.ZeroHash, walletAddress: user1.address };

            await mockToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);

            const calldata = sportsBetting.interface.encodeFunctionData("openBet", [
                [betInfo.amount, betInfo.betId, betInfo.startDate, betInfo.endDate],
                [user.uid, user.affiliateId, user.walletAddress],
                [0, 0, ethers.ZeroHash, ethers.ZeroHash],
                [0, 0, "0x"]
            ]);

            // Forwarder executes transaction forwarding user1.address
            await mockForwarder.execute(await sportsBetting.getAddress(), calldata, user1.address);

            const info = await sportsBetting.getBetInfo(betId);
            expect(info.amount).to.equal(BET_AMOUNT);
        });
    });
});
