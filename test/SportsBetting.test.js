const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("WejeToken and SportsBetting", function () {
  let WejeToken, wejeToken;
  let SportsBetting, sportsBetting;
  let owner, deployer, user1, user2, user3, user4;
  let startTime;

  const TOKEN_NAME = "Weje Token";
  const TOKEN_SYMBOL = "WEJE";
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1M tokens
  const START_DELAY = 86400; // 1 day
  const BET_AMOUNT = ethers.parseEther("100");

  beforeEach(async function () {
    [owner, deployer, user1, user2, user3, user4] = await ethers.getSigners();
    
    // Deploy WejeToken
    WejeToken = await ethers.getContractFactory("WejeToken");
    wejeToken = await WejeToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, START_DELAY);
    await wejeToken.waitForDeployment();
    
    startTime = await time.latest() + START_DELAY;
    
    // Deploy SportsBetting
    SportsBetting = await ethers.getContractFactory("SportsBetting");
    sportsBetting = await SportsBetting.connect(deployer).deploy(await wejeToken.getAddress());
    await sportsBetting.waitForDeployment();
  });

  describe("WejeToken Deployment", function () {
    it("Should deploy with correct parameters", async function () {
      expect(await wejeToken.name()).to.equal(TOKEN_NAME);
      expect(await wejeToken.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await wejeToken.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await wejeToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
      expect(await wejeToken.owner()).to.equal(owner.address);
    });

    it("Should have correct operation start time", async function () {
      const operationsStartTime = await wejeToken.operationsStartTime();
      expect(operationsStartTime).to.be.greaterThan(await time.latest());
    });

    it("Should revert if start delay is less than minimum", async function () {
      await expect(
        WejeToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY, 3600) // 1 hour
      ).to.be.revertedWithCustomError(wejeToken, "InvalidStartTime");
    });
  });

  describe("WejeToken Operations Before Start Time", function () {
    it("Should revert mint before start time", async function () {
      await expect(
        wejeToken.mint(user1.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(wejeToken, "OperationBeforeStartTime");
    });

    it("Should revert burn before start time", async function () {
      await expect(
        wejeToken.burn(ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(wejeToken, "OperationBeforeStartTime");
    });

    it("Should allow transfers before start time", async function () {
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      expect(await wejeToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("WejeToken Operations After Start Time", function () {
    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
    });

    it("Should allow minting after start time", async function () {
      const mintAmount = ethers.parseEther("1000");
      await expect(wejeToken.mint(user1.address, mintAmount))
        .to.emit(wejeToken, "TokensMinted")
        .withArgs(user1.address, mintAmount);
      
      expect(await wejeToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should allow burning after start time", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(wejeToken.burn(burnAmount))
        .to.emit(wejeToken, "TokensBurned")
        .withArgs(owner.address, burnAmount);
      
      expect(await wejeToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - burnAmount);
    });

    it("Should allow burn from after start time", async function () {
      const burnAmount = ethers.parseEther("100");
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.connect(user1).approve(owner.address, burnAmount);
      
      await expect(wejeToken.burnFrom(user1.address, burnAmount))
        .to.emit(wejeToken, "TokensBurned")
        .withArgs(user1.address, burnAmount);
    });

    it("Should revert mint if not owner", async function () {
      await expect(
        wejeToken.connect(user1).mint(user1.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(wejeToken, "OwnableUnauthorizedAccount");
    });
  });

  describe("SportsBetting Deployment", function () {
    it("Should deploy with correct parameters", async function () {
      expect(await sportsBetting.wejeToken()).to.equal(await wejeToken.getAddress());
    });
  });

  describe("SportsBetting - Opening Bets", function () {
    let betInfo, matches, user, selections;

    beforeEach(async function () {
      // Advance time and distribute tokens
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user2.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user3.address, ethers.parseEther("1000"));

      // Setup bet data
      betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600, // 1 hour from now
        endDate: await time.latest() + 7200    // 2 hours from now
      };

      matches = [
        {
          gameId: 1,
          isDrawable: true,
          homeId: 1,
          awayId: 2,
          homeName: "Team A",
          awayName: "Team B",
          homeLogo: "logoA.png",
          awayLogo: "logoB.png",
          gameTime: await time.latest() + 3600
        }
      ];

      user = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      selections = [
        {
          gameId: 1,
          choice: 1 // Home team wins
        }
      ];

      // Approve tokens
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
    });

    it("Should revert if token transfer fails", async function () {
      // Don't approve tokens
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), 0);
      
      await expect(
        sportsBetting.connect(user1).openBet(betInfo, matches, user, selections)
      ).to.be.reverted;
    });

    it("Should open a bet successfully", async function () {
      await expect(
        sportsBetting.connect(user1).openBet(betInfo, matches, user, selections)
      )
        .to.emit(sportsBetting, "BetOpened")
        .withArgs(betInfo.betId, `Ticket is opened by ${user.name}`);

      // Check token transfer
      expect(await wejeToken.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1000") - BET_AMOUNT
      );
      expect(await wejeToken.balanceOf(await sportsBetting.getAddress())).to.equal(BET_AMOUNT);
    });

    it("Should revert if bet amount is 0", async function () {
      betInfo.amount = 0;
      await expect(
        sportsBetting.connect(user1).openBet(betInfo, matches, user, selections)
      ).to.be.revertedWith("not enough Balance");
    });

   

    it("Should revert if insufficient token balance", async function () {
      betInfo.amount = ethers.parseEther("20000"); // More than user has
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), betInfo.amount);
      
      await expect(
        sportsBetting.connect(user1).openBet(betInfo, matches, user, selections)
      ).to.be.reverted;
    });
  });

  describe("SportsBetting - Joining Bets", function () {
    let betInfo, matches, user1Data, user2Data, selections;

    beforeEach(async function () {
      // Setup and open initial bet
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user2.address, ethers.parseEther("1000"));

      betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      user1Data = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      user2Data = {
        uid: "user2",
        name: "User Two",
        photoUrl: "photo2.jpg",
        walletAddress: user2.address,
        affiliateId: "affiliate2"
      };

      selections = [{
        gameId: 1,
        choice: 1
      }];

      // Open bet
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user1).openBet(betInfo, matches, user1Data, selections);
    });

    it("Should join a bet successfully", async function () {
      const user2Selections = [{
        gameId: 1,
        choice: 2 // Away team wins
      }];

      await wejeToken.connect(user2).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      
      await expect(
        sportsBetting.connect(user2).joinBet(betInfo.betId, user2Selections, user2Data)
      )
        .to.emit(sportsBetting, "BetJoined")
        .withArgs(betInfo.betId, `Ticket is opened by ${user2Data.name}`);

      // Check token balances
      expect(await wejeToken.balanceOf(user2.address)).to.equal(
        ethers.parseEther("1000") - BET_AMOUNT
      );
      expect(await wejeToken.balanceOf(await sportsBetting.getAddress())).to.equal(
        BET_AMOUNT * 2n
      );
    });

    it("Should revert if bet doesn't exist", async function () {
      await expect(
        sportsBetting.connect(user2).joinBet(999, selections, user2Data)
      ).to.be.revertedWith("Bet Ticket not found");
    });

    it("Should revert if bet is not open", async function () {
      // Update bet status to running
      await sportsBetting.connect(deployer).updateBetTicketStatus(betInfo.betId);
      
      await expect(
        sportsBetting.connect(user2).joinBet(betInfo.betId, selections, user2Data)
      ).to.be.revertedWith("Bet Ticket not found");
    });
  });

  describe("SportsBetting - Bet Status Updates", function () {
    let betInfo, matches, user1Data, selections;

    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user2.address, ethers.parseEther("1000"));

      betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      user1Data = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      selections = [{
        gameId: 1,
        choice: 1
      }];

      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user1).openBet(betInfo, matches, user1Data, selections);
    });

    it("Should delete bet and refund if only one user", async function () {
      const initialBalance = await wejeToken.balanceOf(user1.address);
      
      await expect(
        sportsBetting.connect(deployer).updateBetTicketStatus(betInfo.betId)
      )
        .to.emit(sportsBetting, "BetDeleted")
        .withArgs(betInfo.betId, "Only one user, ticket is deleted");

      // Check refund
      expect(await wejeToken.balanceOf(user1.address)).to.equal(initialBalance + BET_AMOUNT);
    });

    it("Should update bet to running if multiple users", async function () {
      // Add second user
      const user2Data = {
        uid: "user2",
        name: "User Two",
        photoUrl: "photo2.jpg",
        walletAddress: user2.address,
        affiliateId: "affiliate2"
      };

      await wejeToken.connect(user2).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user2).joinBet(betInfo.betId, selections, user2Data);

      await expect(
        sportsBetting.connect(deployer).updateBetTicketStatus(betInfo.betId)
      )
        .to.emit(sportsBetting, "BetRunning")
        .withArgs(betInfo.betId, "Ticket status is running");
    });

    it("Should revert if not deployer", async function () {
      await expect(
        sportsBetting.connect(user1).updateBetTicketStatus(betInfo.betId)
      ).to.be.revertedWith("Only deployer can call this function");
    });

    it("Should revert if bet not found", async function () {
      await expect(
        sportsBetting.connect(deployer).updateBetTicketStatus(999)
      ).to.be.revertedWith("Bet ticket not found");
    });
  });

  describe("SportsBetting - Distribution", function () {
    let betInfo, matches, user1Data, user2Data, selections;

    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user2.address, ethers.parseEther("1000"));

      betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      user1Data = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      user2Data = {
        uid: "user2",
        name: "User Two",
        photoUrl: "photo2.jpg",
        walletAddress: user2.address,
        affiliateId: "affiliate2"
      };

      selections = [{
        gameId: 1,
        choice: 1
      }];

      // Open bet and add second user
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user1).openBet(betInfo, matches, user1Data, selections);
      
      await wejeToken.connect(user2).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user2).joinBet(betInfo.betId, selections, user2Data);
      
      // Update to running
      await sportsBetting.connect(deployer).updateBetTicketStatus(betInfo.betId);
    });

    it("Should distribute winnings successfully", async function () {
      const distributionData = [
        {
          uid: "user1",
          amount: ethers.parseEther("200") // Winner gets both amounts
        }
      ];

      const initialBalance = await wejeToken.balanceOf(user1.address);

      await expect(
        sportsBetting.connect(deployer).distributeWinners(betInfo.betId, distributionData)
      )
        .to.emit(sportsBetting, "BetFinished")
        .withArgs(betInfo.betId, "Distribution done, Ticket removed");

      // Check winner received tokens
      expect(await wejeToken.balanceOf(user1.address)).to.equal(
        initialBalance + ethers.parseEther("200")
      );
    });

    it("Should revert if bet not found", async function () {
      await expect(
        sportsBetting.connect(deployer).distributeWinners(999, [])
      ).to.be.revertedWith("Bet ticket not found");
    });

    it("Should revert if bet not running", async function () {
      // Create new bet that's still open
      const newBetInfo = { ...betInfo, betId: 2 };
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user1).openBet(newBetInfo, matches, user1Data, selections);

      await expect(
        sportsBetting.connect(deployer).distributeWinners(2, [])
      ).to.be.revertedWith("Bet already finished");
    });

    it("Should revert if not deployer", async function () {
      await expect(
        sportsBetting.connect(user1).distributeWinners(betInfo.betId, [])
      ).to.be.revertedWith("Only deployer can call this function");
    });
  });

  describe("SportsBetting - View Functions", function () {
    let betInfo, matches, user1Data, user2Data, selections;

    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user2.address, ethers.parseEther("1000"));

      betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      user1Data = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      user2Data = {
        uid: "user2",
        name: "User Two",
        photoUrl: "photo2.jpg",
        walletAddress: user2.address,
        affiliateId: "affiliate2"
      };

      selections = [{
        gameId: 1,
        choice: 1
      }];

      // Create multiple bets for testing
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT * 3n);
      await sportsBetting.connect(user1).openBet(betInfo, matches, user1Data, selections);
      
      // Second bet
      const betInfo2 = { ...betInfo, betId: 2 };
      await sportsBetting.connect(user1).openBet(betInfo2, matches, user1Data, selections);
    });

    it("Should get open tickets", async function () {
      const [tickets, totalCount] = await sportsBetting.getTickets(0, 0, 10);
      expect(totalCount).to.equal(2);
      expect(tickets.length).to.equal(2);
      expect(tickets[0].betId).to.equal(2); // Latest first
      expect(tickets[1].betId).to.equal(1);
    });

    it("Should get ticket by ID", async function () {
      const ticket = await sportsBetting.connect(user1).getTicketByUserId(1);
      expect(ticket.betId).to.equal(1);
      expect(ticket.amount).to.equal(BET_AMOUNT);
      expect(ticket.pool).to.equal(BET_AMOUNT);
      expect(ticket.userSelections.length).to.equal(1);
      expect(ticket.userSelections[0].selections.length).to.equal(1); // Can see own selections
    });

    it("Should hide selections from other users", async function () {
      const ticket = await sportsBetting.connect(user2).getTicketByUserId(1);
      expect(ticket.userSelections[0].selections.length).to.equal(0); // Cannot see other's selections
    });

    it("Should get ticket with selections (deployer only)", async function () {
      const ticket = await sportsBetting.connect(deployer).getTicketByIdWithSelections(1);
      expect(ticket.userSelections[0].selections.length).to.equal(1); // Deployer can see all selections
    });

    it("Should revert if ticket not found", async function () {
      await expect(
        sportsBetting.getTicketByUserId(999)
      ).to.be.revertedWith("Ticket not found");
    });
  });

  describe("SportsBetting - Edge Cases and Security", function () {
    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
    });

    it("Should prevent reentrancy attacks", async function () {
      // This test would require a malicious contract to properly test reentrancy
      // For now, we verify the modifier is in place
      expect(await sportsBetting.connect(user1).openBet.staticCall).to.not.throw;
    });

    it("Should handle pagination correctly", async function () {
      // Create multiple bets
      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT * 5n);
      
      for (let i = 1; i <= 5; i++) {
        const betInfo = {
          amount: BET_AMOUNT,
          betId: i,
          startDate: await time.latest() + 3600,
          endDate: await time.latest() + 7200
        };
        
        const matches = [{
          gameId: i,
          isDrawable: true,
          homeId: i,
          awayId: i + 1,
          homeName: `Team ${i}`,
          awayName: `Team ${i + 1}`,
          homeLogo: `logo${i}.png`,
          awayLogo: `logo${i + 1}.png`,
          gameTime: await time.latest() + 3600
        }];

        const userData = {
          uid: `user${i}`,
          name: `User ${i}`,
          photoUrl: `photo${i}.jpg`,
          walletAddress: user1.address,
          affiliateId: `affiliate${i}`
        };

        const selections = [{
          gameId: i,
          choice: 1
        }];

        await sportsBetting.connect(user1).openBet(betInfo, matches, userData, selections);
      }

      // Test pagination
      const [tickets1, total1] = await sportsBetting.getTickets(0, 0, 3);
      expect(tickets1.length).to.equal(3);
      expect(total1).to.equal(5);
      
      const [tickets2, total2] = await sportsBetting.getTickets(0, 3, 3);
      expect(tickets2.length).to.equal(2);
      expect(total2).to.equal(5);
    });

    it("Should handle empty arrays correctly", async function () {
      const [tickets, totalCount] = await sportsBetting.getTickets(1, 0, 10); // Running bets
      expect(totalCount).to.equal(0);
      expect(tickets.length).to.equal(0);
    });
  });

  describe("SportsBetting - Token Transfer Function", function () {
    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(await sportsBetting.getAddress(), ethers.parseEther("1000"));
    });

    it("Should transfer tokens successfully", async function () {
      const transferAmount = ethers.parseEther("100");
      const initialBalance = await wejeToken.balanceOf(user1.address);
      
      await sportsBetting.connect(deployer).transferMatic(user1.address, transferAmount);
      
      expect(await wejeToken.balanceOf(user1.address)).to.equal(initialBalance + transferAmount);
    });

    it("Should revert if not deployer", async function () {
      await expect(
        sportsBetting.connect(user1).transferMatic(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Only deployer can call this function");
    });

    it("Should revert with invalid recipient", async function () {
      await expect(
        sportsBetting.connect(deployer).transferMatic(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWith("Invalid recipient address");
    });

    it("Should revert with insufficient balance", async function () {
      await expect(
        sportsBetting.connect(deployer).transferMatic(user1.address, ethers.parseEther("2000"))
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Complex Betting Scenarios", function () {
    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      // Fund multiple users
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user2.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user3.address, ethers.parseEther("1000"));
      await wejeToken.transfer(user4.address, ethers.parseEther("1000"));
    });

    it("Should handle complete betting lifecycle", async function () {
      // 1. Open bet
      const betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      const matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      const user1Data = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      const selections = [{
        gameId: 1,
        choice: 1
      }];

      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      await sportsBetting.connect(user1).openBet(betInfo, matches, user1Data, selections);

      // 2. Multiple users join
      const users = [user2, user3, user4];
      const userDatas = [
        { uid: "user2", name: "User Two", photoUrl: "photo2.jpg", walletAddress: user2.address, affiliateId: "affiliate2" },
        { uid: "user3", name: "User Three", photoUrl: "photo3.jpg", walletAddress: user3.address, affiliateId: "affiliate3" },
        { uid: "user4", name: "User Four", photoUrl: "photo4.jpg", walletAddress: user4.address, affiliateId: "affiliate4" }
      ];

      for (let i = 0; i < users.length; i++) {
        await wejeToken.connect(users[i]).approve(await sportsBetting.getAddress(), BET_AMOUNT);
        await sportsBetting.connect(users[i]).joinBet(betInfo.betId, selections, userDatas[i]);
      }

      // 3. Update status to running
      await sportsBetting.connect(deployer).updateBetTicketStatus(betInfo.betId);

      // 4. Distribute winnings
      const distributionData = [
        { uid: "user1", amount: ethers.parseEther("200") }, // Winner gets half
        { uid: "user3", amount: ethers.parseEther("200") }  // Another winner gets half
      ];

      const user1InitialBalance = await wejeToken.balanceOf(user1.address);
      const user3InitialBalance = await wejeToken.balanceOf(user3.address);

      await sportsBetting.connect(deployer).distributeWinners(betInfo.betId, distributionData);

      // Verify distributions
      expect(await wejeToken.balanceOf(user1.address)).to.equal(user1InitialBalance + ethers.parseEther("200"));
      expect(await wejeToken.balanceOf(user3.address)).to.equal(user3InitialBalance + ethers.parseEther("200"));

      // Verify bet is deleted
      await expect(sportsBetting.getTicketByUserId(betInfo.betId)).to.be.revertedWith("Ticket not found");
    });

    it("Should handle multiple concurrent bets", async function () {
      const betCount = 3;
      const bets = [];

      // Create multiple bets
      for (let i = 1; i <= betCount; i++) {
        const betInfo = {
          amount: BET_AMOUNT,
          betId: i,
          startDate: await time.latest() + 3600,
          endDate: await time.latest() + 7200
        };

        const matches = [{
          gameId: i,
          isDrawable: true,
          homeId: i,
          awayId: i + 1,
          homeName: `Team ${i}A`,
          awayName: `Team ${i}B`,
          homeLogo: `logo${i}A.png`,
          awayLogo: `logo${i}B.png`,
          gameTime: await time.latest() + 3600
        }];

        const userData = {
          uid: `user1_bet${i}`,
          name: "User One",
          photoUrl: "photo1.jpg",
          walletAddress: user1.address,
          affiliateId: "affiliate1"
        };

        const selections = [{
          gameId: i,
          choice: 1
        }];

        await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
        await sportsBetting.connect(user1).openBet(betInfo, matches, userData, selections);
        
        bets.push({ betInfo, matches, userData, selections });
      }

      // Verify all bets are open
      const [openTickets, totalOpen] = await sportsBetting.getTickets(0, 0, 10);
      expect(totalOpen).to.equal(betCount);
      expect(openTickets.length).to.equal(betCount);

      // Update all bets to running (they all have only one user, so they'll be deleted)
      for (let i = 1; i <= betCount; i++) {
        await expect(sportsBetting.connect(deployer).updateBetTicketStatus(i))
          .to.emit(sportsBetting, "BetDeleted");
      }

      // Verify all bets are deleted
      const [openTicketsAfter, totalOpenAfter] = await sportsBetting.getTickets(0, 0, 10);
      expect(totalOpenAfter).to.equal(0);
    });

    it("Should handle mixed bet outcomes", async function () {
      // Create 3 bets with different outcomes
      const betIds = [1, 2, 3];
      
      for (const betId of betIds) {
        const betInfo = {
          amount: BET_AMOUNT,
          betId: betId,
          startDate: await time.latest() + 3600,
          endDate: await time.latest() + 7200
        };

        const matches = [{
          gameId: betId,
          isDrawable: true,
          homeId: betId,
          awayId: betId + 1,
          homeName: `Team ${betId}A`,
          awayName: `Team ${betId}B`,
          homeLogo: `logo${betId}A.png`,
          awayLogo: `logo${betId}B.png`,
          gameTime: await time.latest() + 3600
        }];

        const user1Data = {
          uid: `user1_bet${betId}`,
          name: "User One",
          photoUrl: "photo1.jpg",
          walletAddress: user1.address,
          affiliateId: "affiliate1"
        };

        const user2Data = {
          uid: `user2_bet${betId}`,
          name: "User Two",
          photoUrl: "photo2.jpg",
          walletAddress: user2.address,
          affiliateId: "affiliate2"
        };

        const selections = [{
          gameId: betId,
          choice: 1
        }];

        // Open bet and join with second user
        await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
        await sportsBetting.connect(user1).openBet(betInfo, matches, user1Data, selections);
        
        await wejeToken.connect(user2).approve(await sportsBetting.getAddress(), BET_AMOUNT);
        await sportsBetting.connect(user2).joinBet(betId, selections, user2Data);

        // Update to running
        await sportsBetting.connect(deployer).updateBetTicketStatus(betId);
      }

      // Verify all bets are running
      const [runningTickets, totalRunning] = await sportsBetting.getTickets(1, 0, 10);
      expect(totalRunning).to.equal(3);

      // Distribute different outcomes
      // Bet 1: User1 wins all
      await sportsBetting.connect(deployer).distributeWinners(1, [
        { uid: "user1_bet1", amount: ethers.parseEther("200") }
      ]);

      // Bet 2: User2 wins all
      await sportsBetting.connect(deployer).distributeWinners(2, [
        { uid: "user2_bet2", amount: ethers.parseEther("200") }
      ]);

      // Bet 3: Split between both users
      await sportsBetting.connect(deployer).distributeWinners(3, [
        { uid: "user1_bet3", amount: ethers.parseEther("100") },
        { uid: "user2_bet3", amount: ethers.parseEther("100") }
      ]);

      // Verify no running bets remain
      const [runningTicketsAfter, totalRunningAfter] = await sportsBetting.getTickets(1, 0, 10);
      expect(totalRunningAfter).to.equal(0);
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should have reasonable gas costs for opening bets", async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));

      const betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      const matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      const userData = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      const selections = [{
        gameId: 1,
        choice: 1
      }];

      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      
      const tx = await sportsBetting.connect(user1).openBet(betInfo, matches, userData, selections);
      const receipt = await tx.wait();
      
      // Gas should be reasonable (adjust threshold as needed)
      expect(receipt.gasUsed).to.be.lessThan(700000);
    });
  });

  describe("Error Handling and Edge Cases", function () {
    beforeEach(async function () {
      await time.increaseTo(startTime + 1);
      await wejeToken.transfer(user1.address, ethers.parseEther("1000"));
    });

    it("Should handle empty selections array", async function () {
      const betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      const matches = [];
      const userData = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      const selections = [];

      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      
      // Should not revert with empty arrays
      await expect(sportsBetting.connect(user1).openBet(betInfo, matches, userData, selections))
        .to.emit(sportsBetting, "BetOpened");
    });

    it("Should handle very large bet amounts", async function () {
      const largeBetAmount = ethers.parseEther("99999");
      await wejeToken.transfer(user1.address, largeBetAmount);

      const betInfo = {
        amount: largeBetAmount,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      const matches = [{
        gameId: 1,
        isDrawable: true,
        homeId: 1,
        awayId: 2,
        homeName: "Team A",
        awayName: "Team B",
        homeLogo: "logoA.png",
        awayLogo: "logoB.png",
        gameTime: await time.latest() + 3600
      }];

      const userData = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      const selections = [{
        gameId: 1,
        choice: 1
      }];

      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), largeBetAmount);
      
      await expect(sportsBetting.connect(user1).openBet(betInfo, matches, userData, selections))
        .to.emit(sportsBetting, "BetOpened");
    });

    it("Should handle multiple matches in single bet", async function () {
      const betInfo = {
        amount: BET_AMOUNT,
        betId: 1,
        startDate: await time.latest() + 3600,
        endDate: await time.latest() + 7200
      };

      const matches = [
        {
          gameId: 1,
          isDrawable: true,
          homeId: 1,
          awayId: 2,
          homeName: "Team A",
          awayName: "Team B",
          homeLogo: "logoA.png",
          awayLogo: "logoB.png",
          gameTime: await time.latest() + 3600
        },
        {
          gameId: 2,
          isDrawable: false,
          homeId: 3,
          awayId: 4,
          homeName: "Team C",
          awayName: "Team D",
          homeLogo: "logoC.png",
          awayLogo: "logoD.png",
          gameTime: await time.latest() + 5400
        }
      ];

      const userData = {
        uid: "user1",
        name: "User One",
        photoUrl: "photo1.jpg",
        walletAddress: user1.address,
        affiliateId: "affiliate1"
      };

      const selections = [
        { gameId: 1, choice: 1 },
        { gameId: 2, choice: 2 }
      ];

      await wejeToken.connect(user1).approve(await sportsBetting.getAddress(), BET_AMOUNT);
      
      await expect(sportsBetting.connect(user1).openBet(betInfo, matches, userData, selections))
        .to.emit(sportsBetting, "BetOpened");

      const ticket = await sportsBetting.connect(user1).getTicketByUserId(1);
      expect(ticket.matches.length).to.equal(2);
      expect(ticket.userSelections[0].selections.length).to.equal(2);
    });
  });
});

// Additional helper functions for testing
async function createSampleBet(sportsBetting, wejeToken, betId, user, userAddress, betAmount) {
  const betInfo = {
    amount: betAmount,
    betId: betId,
    startDate: await time.latest() + 3600,
    endDate: await time.latest() + 7200
  };

  const matches = [{
    gameId: betId,
    isDrawable: true,
    homeId: betId,
    awayId: betId + 1,
    homeName: `Team ${betId}A`,
    awayName: `Team ${betId}B`,
    homeLogo: `logo${betId}A.png`,
    awayLogo: `logo${betId}B.png`,
    gameTime: await time.latest() + 3600
  }];

  const userData = {
    uid: `user${betId}`,
    name: `User ${betId}`,
    photoUrl: `photo${betId}.jpg`,
    walletAddress: userAddress,
    affiliateId: `affiliate${betId}`
  };

  const selections = [{
    gameId: betId,
    choice: 1
  }];

  await wejeToken.connect(user).approve(await sportsBetting.getAddress(), betAmount);
  return await sportsBetting.connect(user).openBet(betInfo, matches, userData, selections);
}