const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Game Contracts", function () {
    let wejeToken;
    let pokerGame;
    let blackjackGame;
    let ludoGame;
    let owner;
    let addr1;
    let addr2;
    let addrs;

    // Helper function to get permit signature
    async function getPermitSignature(signer, token, spender, value, deadline) {
        const [nonce, name, version, chainId] = await Promise.all([
            token.nonces(signer.address),
            token.name(),
            "1",
            signer.getChainId(),
        ]);

        const domain = {
            name,
            version,
            chainId,
            verifyingContract: token.address,
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

        const values = {
            owner: signer.address,
            spender: spender,
            value: value,
            nonce: nonce,
            deadline: deadline,
        };

        const signature = await signer._signTypedData(domain, types, values);
        const { v, r, s } = ethers.utils.splitSignature(signature);
        return { v, r, s };
    }

    beforeEach(async function () {
        // Deploy mock WejeToken
        const WejeToken = await ethers.getContractFactory("WejeToken");
        wejeToken = await WejeToken.deploy();
        await wejeToken.deployed();

        // Deploy game contracts
        const PokerGame = await ethers.getContractFactory("PokerGame");
        const BlackjackGame = await ethers.getContractFactory("BlackjackGame");
        const LudoGame = await ethers.getContractFactory("LudoGame");

        pokerGame = await PokerGame.deploy(wejeToken.address);
        blackjackGame = await BlackjackGame.deploy(wejeToken.address);
        ludoGame = await LudoGame.deploy(wejeToken.address);

        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

        // Mint some tokens for testing
        await wejeToken.mint(addr1.address, ethers.utils.parseEther("1000"));
        await wejeToken.mint(addr2.address, ethers.utils.parseEther("1000"));
    });

    describe("Poker Game Tests", function () {
        it("Should create a poker game", async function () {
            const gameInfo = {
                gameId: "poker1",
                gameType: "poker",
                minBet: ethers.utils.parseEther("10"),
                buyIn: ethers.utils.parseEther("100"),
                autoHandStart: true,
                media: "poker.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            const game = await pokerGame.getGameById("poker1");
            expect(game.gameId).to.equal("poker1");
            expect(game.players.length).to.equal(1);
        });

        it("Should prevent joining if already in a game", async function () {
            const gameInfo = {
                gameId: "poker2",
                gameType: "poker",
                minBet: ethers.utils.parseEther("10"),
                buyIn: ethers.utils.parseEther("100"),
                autoHandStart: true,
                media: "poker.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            // Try to join another game with same player
            const gameInfo2 = {
                ...gameInfo,
                gameId: "poker3"
            };

            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo2.buyIn,
                deadline
            );

            await expect(
                pokerGame.connect(addr1).createGame(
                    gameInfo2,
                    player,
                    [],
                    deadline,
                    v2,
                    r2,
                    s2
                )
            ).to.be.revertedWith("Player already joined in an active game");
        });

        it("Should enforce 10 player limit", async function () {
            const gameInfo = {
                gameId: "poker4",
                gameType: "poker",
                minBet: ethers.utils.parseEther("10"),
                buyIn: ethers.utils.parseEther("100"),
                autoHandStart: true,
                media: "poker.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            // Create initial game
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const host = {
                playerId: "host",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Host"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr1).createGame(
                gameInfo,
                host,
                [],
                deadline,
                v,
                r,
                s
            );

            // Add 9 more players
            for (let i = 0; i < 9; i++) {
                const player = {
                    playerId: `player${i}`,
                    wallet: 0,
                    walletAddress: addrs[i].address,
                    photoUrl: "photo.jpg",
                    name: `Player ${i}`
                };

                await wejeToken.mint(addrs[i].address, gameInfo.buyIn);
                const { v, r, s } = await getPermitSignature(
                    addrs[i],
                    wejeToken,
                    pokerGame.address,
                    gameInfo.buyIn,
                    deadline
                );

                await pokerGame.connect(addrs[i]).joinGame(
                    "poker4",
                    player,
                    gameInfo.buyIn,
                    deadline,
                    v,
                    r,
                    s
                );
            }

            // Try to add 11th player
            const extraPlayer = {
                playerId: "extra",
                wallet: 0,
                walletAddress: addrs[9].address,
                photoUrl: "photo.jpg",
                name: "Extra Player"
            };

            await wejeToken.mint(addrs[9].address, gameInfo.buyIn);
            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addrs[9],
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await expect(
                pokerGame.connect(addrs[9]).joinGame(
                    "poker4",
                    extraPlayer,
                    gameInfo.buyIn,
                    deadline,
                    v2,
                    r2,
                    s2
                )
            ).to.be.revertedWith("No empty Seat");
        });

        it("Should allow buying coins", async function () {
            const gameInfo = {
                gameId: "poker5",
                gameType: "poker",
                minBet: ethers.utils.parseEther("10"),
                buyIn: ethers.utils.parseEther("100"),
                autoHandStart: true,
                media: "poker.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            // Buy additional coins
            const buyAmount = ethers.utils.parseEther("50");
            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                buyAmount,
                deadline
            );

            await pokerGame.connect(addr1).buyCoins(
                "poker5",
                "player1",
                buyAmount,
                Math.floor(Date.now() / 1000),
                deadline,
                v2,
                r2,
                s2
            );

            const game = await pokerGame.getGameById("poker5");
            expect(game.players[0].wallet).to.equal(gameInfo.buyIn.add(buyAmount));
        });

        it("Should handle finish hand and commission", async function () {
            const gameInfo = {
                gameId: "poker6",
                gameType: "poker",
                minBet: ethers.utils.parseEther("10"),
                buyIn: ethers.utils.parseEther("100"),
                autoHandStart: true,
                media: "poker.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            // Create game with two players
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Player 1 creates game
            const player1 = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr1).createGame(
                gameInfo,
                player1,
                [],
                deadline,
                v,
                r,
                s
            );

            // Player 2 joins
            const player2 = {
                playerId: "player2",
                wallet: 0,
                walletAddress: addr2.address,
                photoUrl: "photo.jpg",
                name: "Player Two"
            };

            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addr2,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr2).joinGame(
                "poker6",
                player2,
                gameInfo.buyIn,
                deadline,
                v2,
                r2,
                s2
            );

            // Finish hand with player1 winning
            const players = [
                {
                    playerId: "player1",
                    wallet: ethers.utils.parseEther("150"),
                    walletAddress: addr1.address,
                    isWon: true
                },
                {
                    playerId: "player2",
                    wallet: ethers.utils.parseEther("50"),
                    walletAddress: addr2.address,
                    isWon: false
                }
            ];

            await pokerGame.connect(owner).finishHand(
                "poker6",
                players,
                Math.floor(Date.now() / 1000)
            );

            // Verify commission
            const commission = await pokerGame.commission();
            expect(commission).to.equal(ethers.utils.parseEther("1.5")); // 1% of 150
        });

        it("Should handle leave game", async function () {
            const gameInfo = {
                gameId: "poker7",
                gameType: "poker",
                minBet: ethers.utils.parseEther("10"),
                buyIn: ethers.utils.parseEther("100"),
                autoHandStart: true,
                media: "poker.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create game
            const player1 = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                pokerGame.address,
                gameInfo.buyIn,
                deadline
            );

            await pokerGame.connect(addr1).createGame(
                gameInfo,
                player1,
                [],
                deadline,
                v,
                r,
                s
            );

            // Leave game
            const leavingPlayers = [{
                playerId: "player1",
                wallet: gameInfo.buyIn,
                walletAddress: addr1.address,
                isWon: false
            }];

            await pokerGame.connect(owner).leaveGame(
                "poker7",
                leavingPlayers,
                Math.floor(Date.now() / 1000)
            );

            // Verify game is removed
            await expect(
                pokerGame.getGameById("poker7")
            ).to.be.revertedWith("Game not Found");
        });
    });

    describe("Blackjack Game Tests", function () {
        it("Should create a blackjack game", async function () {
            const gameInfo = {
                gameId: "blackjack1",
                gameType: "blackjack",
                minBet: ethers.utils.parseEther("5"),
                buyIn: ethers.utils.parseEther("50"),
                autoHandStart: true,
                media: "blackjack.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await blackjackGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            const game = await blackjackGame.getGameById("blackjack1");
            expect(game.gameId).to.equal("blackjack1");
            expect(game.players.length).to.equal(1);
        });

        it("Should prevent joining if already in a game", async function () {
            const gameInfo = {
                gameId: "blackjack2",
                gameType: "blackjack",
                minBet: ethers.utils.parseEther("5"),
                buyIn: ethers.utils.parseEther("50"),
                autoHandStart: true,
                media: "blackjack.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await blackjackGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            // Try to join another game with same player
            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addr1,
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await expect(
                blackjackGame.connect(addr1).joinGame(
                    "blackjack2",
                    player,
                    gameInfo.buyIn,
                    deadline,
                    v2,
                    r2,
                    s2
                )
            ).to.be.revertedWith("Player already joined in an active game");
        });

        it("Should enforce 7 player limit", async function () {
            const gameInfo = {
                gameId: "blackjack3",
                gameType: "blackjack",
                minBet: ethers.utils.parseEther("5"),
                buyIn: ethers.utils.parseEther("50"),
                autoHandStart: true,
                media: "blackjack.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            // Create initial game
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const host = {
                playerId: "host",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Host"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await blackjackGame.connect(addr1).createGame(
                gameInfo,
                host,
                [],
                deadline,
                v,
                r,
                s
            );

            // Add 6 more players
            for (let i = 0; i < 6; i++) {
                const player = {
                    playerId: `player${i}`,
                    wallet: 0,
                    walletAddress: addrs[i].address,
                    photoUrl: "photo.jpg",
                    name: `Player ${i}`
                };

                await wejeToken.mint(addrs[i].address, gameInfo.buyIn);
                const { v, r, s } = await getPermitSignature(
                    addrs[i],
                    wejeToken,
                    blackjackGame.address,
                    gameInfo.buyIn,
                    deadline
                );

                await blackjackGame.connect(addrs[i]).joinGame(
                    "blackjack3",
                    player,
                    gameInfo.buyIn,
                    deadline,
                    v,
                    r,
                    s
                );
            }

            // Try to add 8th player
            const extraPlayer = {
                playerId: "extra",
                wallet: 0,
                walletAddress: addrs[6].address,
                photoUrl: "photo.jpg",
                name: "Extra Player"
            };

            await wejeToken.mint(addrs[6].address, gameInfo.buyIn);
            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addrs[6],
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await expect(
                blackjackGame.connect(addrs[6]).joinGame(
                    "blackjack3",
                    extraPlayer,
                    gameInfo.buyIn,
                    deadline,
                    v2,
                    r2,
                    s2
                )
            ).to.be.revertedWith("No empty Seat");
        });

        it("Should revert on finishHand", async function () {
            const gameInfo = {
                gameId: "blackjack4",
                gameType: "blackjack",
                minBet: ethers.utils.parseEther("5"),
                buyIn: ethers.utils.parseEther("50"),
                autoHandStart: true,
                media: "blackjack.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            // Create game
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await blackjackGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            // Try to call finishHand (should revert)
            const players = [{
                playerId: "player1",
                wallet: gameInfo.buyIn,
                walletAddress: addr1.address,
                isWon: true
            }];

            await expect(
                blackjackGame.connect(owner).finishHand(
                    "blackjack4",
                    players,
                    Math.floor(Date.now() / 1000)
                )
            ).to.be.revertedWith("Not implemented for Blackjack");
        });

        it("Should handle leave game", async function () {
            const gameInfo = {
                gameId: "blackjack5",
                gameType: "blackjack",
                minBet: ethers.utils.parseEther("5"),
                buyIn: ethers.utils.parseEther("50"),
                autoHandStart: true,
                media: "blackjack.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 0
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create game
            const player1 = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                blackjackGame.address,
                gameInfo.buyIn,
                deadline
            );

            await blackjackGame.connect(addr1).createGame(
                gameInfo,
                player1,
                [],
                deadline,
                v,
                r,
                s
            );

            // Leave game
            const leavingPlayers = [{
                playerId: "player1",
                wallet: gameInfo.buyIn,
                walletAddress: addr1.address,
                isWon: false
            }];

            await blackjackGame.connect(owner).leaveGame(
                "blackjack5",
                leavingPlayers,
                Math.floor(Date.now() / 1000)
            );

            // Verify game is removed
            await expect(
                blackjackGame.getGameById("blackjack5")
            ).to.be.revertedWith("Game not Found");
        });
    });

    describe("Ludo Game Tests", function () {
        it("Should create a ludo game", async function () {
            const gameInfo = {
                gameId: "ludo1",
                gameType: "ludo",
                minBet: ethers.utils.parseEther("1"),
                buyIn: ethers.utils.parseEther("10"),
                autoHandStart: true,
                media: "ludo.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 1800
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await ludoGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            const game = await ludoGame.getGameById("ludo1");
            expect(game.gameId).to.equal("ludo1");
            expect(game.players.length).to.equal(1);
        });

        it("Should prevent joining if already in a game", async function () {
            const gameInfo = {
                gameId: "ludo2",
                gameType: "ludo",
                minBet: ethers.utils.parseEther("1"),
                buyIn: ethers.utils.parseEther("10"),
                autoHandStart: true,
                media: "ludo.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 1800
            };

            const player = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await ludoGame.connect(addr1).createGame(
                gameInfo,
                player,
                [],
                deadline,
                v,
                r,
                s
            );

            // Try to join another game with same player
            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addr1,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await expect(
                ludoGame.connect(addr1).joinGame(
                    "ludo2",
                    player,
                    gameInfo.minBet,
                    deadline,
                    v2,
                    r2,
                    s2
                )
            ).to.be.revertedWith("Player already joined in an active game");
        });

        it("Should enforce 4 player limit", async function () {
            const gameInfo = {
                gameId: "ludo3",
                gameType: "ludo",
                minBet: ethers.utils.parseEther("1"),
                buyIn: ethers.utils.parseEther("10"),
                autoHandStart: true,
                media: "ludo.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 1800
            };

            // Create initial game
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const host = {
                playerId: "host",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Host"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await ludoGame.connect(addr1).createGame(
                gameInfo,
                host,
                [],
                deadline,
                v,
                r,
                s
            );

            // Add 3 more players
            for (let i = 0; i < 3; i++) {
                const player = {
                    playerId: `player${i}`,
                    wallet: 0,
                    walletAddress: addrs[i].address,
                    photoUrl: "photo.jpg",
                    name: `Player ${i}`
                };

                await wejeToken.mint(addrs[i].address, gameInfo.minBet);
                const { v, r, s } = await getPermitSignature(
                    addrs[i],
                    wejeToken,
                    ludoGame.address,
                    gameInfo.minBet,
                    deadline
                );

                await ludoGame.connect(addrs[i]).joinGame(
                    "ludo3",
                    player,
                    gameInfo.minBet,
                    deadline,
                    v,
                    r,
                    s
                );
            }

            // Try to add 5th player
            const extraPlayer = {
                playerId: "extra",
                wallet: 0,
                walletAddress: addrs[3].address,
                photoUrl: "photo.jpg",
                name: "Extra Player"
            };

            await wejeToken.mint(addrs[3].address, gameInfo.minBet);
            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addrs[3],
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await expect(
                ludoGame.connect(addrs[3]).joinGame(
                    "ludo3",
                    extraPlayer,
                    gameInfo.minBet,
                    deadline,
                    v2,
                    r2,
                    s2
                )
            ).to.be.revertedWith("No empty Seat");
        });

        it("Should handle finish hand and commission", async function () {
            const gameInfo = {
                gameId: "ludo4",
                gameType: "ludo",
                minBet: ethers.utils.parseEther("1"),
                buyIn: ethers.utils.parseEther("10"),
                autoHandStart: true,
                media: "ludo.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 1800
            };

            // Create game with two players
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Player 1 creates game
            const player1 = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await ludoGame.connect(addr1).createGame(
                gameInfo,
                player1,
                [],
                deadline,
                v,
                r,
                s
            );

            // Player 2 joins
            const player2 = {
                playerId: "player2",
                wallet: 0,
                walletAddress: addr2.address,
                photoUrl: "photo.jpg",
                name: "Player Two"
            };

            const { v: v2, r: r2, s: s2 } = await getPermitSignature(
                addr2,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await ludoGame.connect(addr2).joinGame(
                "ludo4",
                player2,
                gameInfo.minBet,
                deadline,
                v2,
                r2,
                s2
            );

            // Finish hand with player1 winning
            const players = [
                {
                    playerId: "player1",
                    wallet: ethers.utils.parseEther("15"),
                    walletAddress: addr1.address,
                    isWon: true
                },
                {
                    playerId: "player2",
                    wallet: ethers.utils.parseEther("5"),
                    walletAddress: addr2.address,
                    isWon: false
                }
            ];

            await ludoGame.connect(owner).finishHand(
                "ludo4",
                players,
                Math.floor(Date.now() / 1000)
            );

            // Verify commission
            const commission = await ludoGame.commission();
            expect(commission).to.equal(ethers.utils.parseEther("0.15")); // 1% of 15
        });

        it("Should handle leave game", async function () {
            const gameInfo = {
                gameId: "ludo5",
                gameType: "ludo",
                minBet: ethers.utils.parseEther("1"),
                buyIn: ethers.utils.parseEther("10"),
                autoHandStart: true,
                media: "ludo.jpg",
                isPublic: true,
                rTimeout: 300,
                gameTime: 1800
            };

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create game
            const player1 = {
                playerId: "player1",
                wallet: 0,
                walletAddress: addr1.address,
                photoUrl: "photo.jpg",
                name: "Player One"
            };

            const { v, r, s } = await getPermitSignature(
                addr1,
                wejeToken,
                ludoGame.address,
                gameInfo.minBet,
                deadline
            );

            await ludoGame.connect(addr1).createGame(
                gameInfo,
                player1,
                [],
                deadline,
                v,
                r,
                s
            );

            // Leave game
            const leavingPlayers = [{
                playerId: "player1",
                wallet: gameInfo.minBet,
                walletAddress: addr1.address,
                isWon: false
            }];

            await ludoGame.connect(owner).leaveGame(
                "ludo5",
                leavingPlayers,
                Math.floor(Date.now() / 1000)
            );

            // Verify game is removed
            await expect(
                ludoGame.getGameById("ludo5")
            ).to.be.revertedWith("Game not Found");
        });
    });

    describe("Common Game Operations", function () {
        it("Should allow changing deployer", async function () {
            await pokerGame.changeDeployer(addr1.address);
            expect(await pokerGame.deployer()).to.equal(addr1.address);
        });

        it("Should allow changing commission rate", async function () {
            await pokerGame.changeCommissionRate(2);
            expect(await pokerGame.commissionRate()).to.equal(2);
        });

        it("Should allow transferring commission", async function () {
            // Implementation for Poker and Ludo
        });
    });
});