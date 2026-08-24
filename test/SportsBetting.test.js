const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SportsBetting Gas Simulation (Batched Push)", function () {
  let sportsBetting, mockToken, mockForwarder;
  let deployer;
  let users = [];
  const TOTAL_USERS = 20; // 20 users for gas scaling test
  const BET_AMOUNT = ethers.parseEther("10");

  // Helper to get permit signature
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
    return { v, r, s };
  }

  before(async function () {
    [deployer] = await ethers.getSigners();
    
    // Deploy MockToken
    const MockToken = await ethers.getContractFactory("MockToken");
    mockToken = await MockToken.deploy();
    await mockToken.waitForDeployment();

    // Deploy MockForwarder
    const MockForwarder = await ethers.getContractFactory("MockForwarder");
    mockForwarder = await MockForwarder.deploy();
    await mockForwarder.waitForDeployment();
    
    // Deploy SportsBetting
    const SportsBetting = await ethers.getContractFactory("contracts/SportsBetting.sol:SportsBetting");
    sportsBetting = await SportsBetting.deploy(await mockToken.getAddress(), await mockForwarder.getAddress());
    await sportsBetting.waitForDeployment();

    console.log("Creating and funding users...");
    for (let i = 0; i < TOTAL_USERS; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await deployer.sendTransaction({ to: wallet.address, value: ethers.parseEther("0.1") });
        await mockToken.mint(wallet.address, ethers.parseEther("1000"));
        users.push(wallet);
    }
  });

  it("Check joinBet gas scaling (Verify O(1))", async function () {
    const betId = 1;
    const startDate = Math.floor(Date.now() / 1000) + 3600;
    const endDate = startDate + 7200;
    const deadline = ethers.MaxUint256;
    
    const host = users[0];
    const { v, r, s } = await getPermitSignature(host, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
    await sportsBetting.connect(host).openBet(
        { amount: BET_AMOUNT, betId: betId, startDate, endDate },
        { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: host.address },
        { deadline, v, r, s },
        { nonce: 0, deadline: 0, signature: "0x" }
    );

    console.log("Joining users...");
    let firstGas = 0n;
    let lastGas = 0n;

    for (let i = 1; i < TOTAL_USERS; i++) {
        const user = users[i];
        const { v, r, s } = await getPermitSignature(user, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
        const tx = await sportsBetting.connect(user).joinBet(
            betId,
            { uid: ethers.keccak256(ethers.toUtf8Bytes(`user_${i}`)), affiliateId: ethers.ZeroHash, walletAddress: user.address },
            { deadline, v, r, s },
            { nonce: 0, deadline: 0, signature: "0x" }
        );
        const receipt = await tx.wait();
        if(i === 1) firstGas = receipt.gasUsed;
        if(i === TOTAL_USERS - 1) lastGas = receipt.gasUsed;
    }

    console.log(`Gas used for 1st join: ${firstGas.toString()}`);
    console.log(`Gas used for ${TOTAL_USERS}th join: ${lastGas.toString()}`);
    
    // Difference should be negligible (mostly zero vs non-zero storage, but standard variance)
    const diff = lastGas > firstGas ? lastGas - firstGas : firstGas - lastGas;
    expect(diff).to.be.lt(20000n); 
  });

  it("Compare Single vs Batched Distribution Gas", async function () {
    const betId1 = 10;
    const betId2 = 11;
    const startDate = Math.floor(Date.now() / 1000) + 3600;
    const endDate = startDate + 7200;
    const deadline = ethers.MaxUint256;
    
    // Create two bets: one for single, one for batch
    const host = users[0];
    const { v, r, s } = await getPermitSignature(host, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
    
    // Bet 1 (Single)
    await sportsBetting.connect(host).openBet(
        { amount: BET_AMOUNT, betId: betId1, startDate, endDate },
        { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: host.address },
        { deadline, v, r, s },
        { nonce: 0, deadline: 0, signature: "0x" }
    );
    // Bet 2 (Batch)
    const { v:v2, r:r2, s:s2 } = await getPermitSignature(host, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
    await sportsBetting.connect(host).openBet(
        { amount: BET_AMOUNT, betId: betId2, startDate, endDate },
        { uid: ethers.keccak256(ethers.toUtf8Bytes("host")), affiliateId: ethers.ZeroHash, walletAddress: host.address },
        { deadline, v: v2, r: r2, s: s2 },
        { nonce: 0, deadline: 0, signature: "0x" }
    );

    // Prepare data
    const items = [];
    for (let i = 0; i < TOTAL_USERS; i++) {
        items.push({ uid: ethers.keccak256(ethers.toUtf8Bytes(`user_${i}`)), amount: BET_AMOUNT });
    }
    
    // Quick loop to join everyone to both bets (skip host who is already in)
    for(let i=1; i<TOTAL_USERS; i++) {
        const u = users[i];
        const { v, r, s } = await getPermitSignature(u, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
        await sportsBetting.connect(u).joinBet(betId1, { uid: ethers.keccak256(ethers.toUtf8Bytes(`user_${i}`)), affiliateId: ethers.ZeroHash, walletAddress: u.address }, {deadline,v,r,s}, { nonce: 0, deadline: 0, signature: "0x" });
        
        const { v:vb, r:rb, s:sb } = await getPermitSignature(u, mockToken, await sportsBetting.getAddress(), BET_AMOUNT, deadline);
        await sportsBetting.connect(u).joinBet(betId2, { uid: ethers.keccak256(ethers.toUtf8Bytes(`user_${i}`)), affiliateId: ethers.ZeroHash, walletAddress: u.address }, {deadline, v:vb, r:rb, s:sb}, { nonce: 0, deadline: 0, signature: "0x" });
    }

    // Now update status to Running
    await sportsBetting.connect(deployer).updateBetTicketStatus(betId1);
    await sportsBetting.connect(deployer).updateBetTicketStatus(betId2);

    // Data for distribution (Host + Users)
    const distData = [];
    distData.push({ uid: ethers.keccak256(ethers.toUtf8Bytes("host")), amount: BET_AMOUNT });
    for(let i=1; i<TOTAL_USERS; i++) distData.push({ uid: ethers.keccak256(ethers.toUtf8Bytes(`user_${i}`)), amount: BET_AMOUNT });

    // 1. Single Call
    console.log("Running Single Call...");
    const tx1 = await sportsBetting.connect(deployer).distributeWinners(betId1, distData, true);
    const receipt1 = await tx1.wait();
    console.log(`Single Call Total Gas (${TOTAL_USERS} users): ${receipt1.gasUsed.toString()}`);

    // 2. Batched Calls (Batch size 10)
    console.log("Running Batched Calls...");
    const batchSize = 10;
    let totalBatchGas = 0n;
    for (let i = 0; i < distData.length; i += batchSize) {
        const chunk = distData.slice(i, i + batchSize);
        const isFinal = (i + batchSize >= distData.length);
        const tx = await sportsBetting.connect(deployer).distributeWinners(betId2, chunk, isFinal);
        const receipt = await tx.wait();
        totalBatchGas += receipt.gasUsed;
    }
    console.log(`Batched Call Total Gas (${TOTAL_USERS} users): ${totalBatchGas.toString()}`);
    
    const diff = totalBatchGas - receipt1.gasUsed;
    console.log(`Gas Difference: ${diff.toString()}`);
    console.log(`Overhead per extra transaction: ${diff / BigInt((distData.length/batchSize) - 1)}`);
  });
});
