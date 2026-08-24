// Scripts/remix_test.js
// Right click on the file and select 'Run' in Remix IDE.
const { ethers } = require("ethers");
/**
 * Note: In Remix, 'ethers' is injected globally usually, but if running with 'node', we require it.
 * Remix 'Scripts' plugin usually allows using 'ethers' directly or via 'web3'.
 * We assume 'ethers' v6 syntax (Remix uses it).
 */
async function main() {
    console.log("Starting Test Script (Ethers v5)...");
    // 1. Get Signer
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    // 2. Deploy Mock Token
    console.log("Deploying MockToken...");
    const MockToken = await ethers.getContractFactory("MockToken");
    const token = await MockToken.deploy();
    await token.deployed(); // v5 syntax
    const tokenAddress = token.address; // v5 syntax
    console.log("MockToken deployed to:", tokenAddress);
    // 3. Deploy SportsBetting
    console.log("Deploying SportsBetting...");
    const SportsBetting = await ethers.getContractFactory("SportsBetting");
    const betting = await SportsBetting.deploy(tokenAddress);
    await betting.deployed(); // v5 syntax
    const bettingAddress = betting.address; // v5 syntax
    console.log("SportsBetting deployed to:", bettingAddress);
    // 4. Setup Data
    const betId = 123456;
    const amount = ethers.utils.parseEther("10"); // v5 syntax
    const startDate = Math.floor(Date.now() / 1000) + 3600; 
    const endDate = startDate + 7200; 
    // 20 Matches
    const matches = [];
    for(let i=1; i<=20; i++) {
        matches.push({
            gameId: 1000 + i,
            gameTime: startDate + 100 
        });
    }
    // 5. Create 100 Users 
    const users = [];
    console.log("Creating 100 wallets...");
    for(let i=0; i<100; i++) {
        const wallet = ethers.Wallet.createRandom().connect(deployer.provider);
        users.push(wallet);
    }
    // Fund users
    console.log("Funding wallets...");
    for(const user of users) {
        const tx = await deployer.sendTransaction({
            to: user.address,
            value: ethers.utils.parseEther("0.01") // v5 syntax
        });
        await tx.wait();
        const tx2 = await token.mint(user.address, amount.mul(2)); // v5 syntax (BigNumber)
        await tx2.wait();
    }
    // 6. Open Bet
    const opener = users[0];
    const openerUid = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("user_0")); // v5 syntax
    const affiliateId = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("aff_0")); // v5 syntax
    const betInfo = {
        amount: amount,
        betId: betId,
        startDate: startDate,
        endDate: endDate
    };
    const selections = [{ gameId: 1001, choice: 1 }];
    // Permit Signature
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    // v5 nonces is BigNumber
    const nonces = await token.nonces(opener.address); 
    const chainId = (await deployer.provider.getNetwork()).chainId;
    
    const domain = {
        name: "MockToken",
        version: "1",
        chainId: chainId,
        verifyingContract: tokenAddress
    };
    const types = {
        Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
        ]
    };
    const value = {
        owner: opener.address,
        spender: bettingAddress,
        value: amount,
        nonce: nonces,
        deadline: deadline
    };
    // v5 signTypedData usually requires underscore for explicit call if using Wallet
    // or wallet._signTypedData
    // Approve instead of Permit
    console.log("Approving token...");
    await token.connect(opener).approve(bettingAddress, amount);
    await token.connect(opener).approve(bettingAddress, amount); // Sometimes approval needs wait or is separate TX
    console.log("Opening Bet (with Approve)...");
    const openTx = await betting.connect(opener).openBet(
        betInfo,
        matches,
        { uid: openerUid, affiliateId: affiliateId, walletAddress: opener.address },
        selections,
        { deadline: 0, v: 0, r: ethers.utils.hexZeroPad("0x00", 32), s: ethers.utils.hexZeroPad("0x00", 32) }
    );
    await openTx.wait();
    console.log("Bet Opened!");
    // 7. Join Bet (Remaining 99 users)
    console.log("Joining 99 users...");
    for(let i=1; i<100; i++) {
        const joiner = users[i];
        const uid = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`user_${i}`)); // v5 syntax
        
        const nonce = await token.nonces(joiner.address);
        // Approve
        await token.connect(joiner).approve(bettingAddress, amount);
        const joinTx = await betting.connect(joiner).joinBet(
            betId,
            { uid: uid, affiliateId: affiliateId, walletAddress: joiner.address },
            selections,
            { deadline: 0, v: 0, r: ethers.utils.hexZeroPad("0x00", 32), s: ethers.utils.hexZeroPad("0x00", 32) }
        );
        await joinTx.wait();
        if(i % 10 === 0) console.log(`Joined ${i} users...`);
    }
    console.log("All users joined!");
    // 8. Update Status
    console.log("Updating ticket status to Running...");
    await betting.connect(deployer).updateBetTicketStatus(betId);
    console.log("Status updated.");
    // 9. Distribute Winners (Batched)
    console.log("Distributing Winners (Push)...");
    
    // Total 100 users, let's do one batch for simplicity or two
    const distributionData = [];
    for(let i=0; i<100; i++) {
        distributionData.push({
            uid: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`user_${i}`)),
            amount: amount 
        });
    }

    // Call with isFinal = true since we fit all 100 in one block (Gas ~1.7M is fine for Remix/Polygon)
    // If you were doing 1000 users, you would loop this.
    console.log(`Distributing to ${distributionData.length} users...`);
    
    // In Remix/Ethers v6, invalid args might revert. Adjusting loop if needed.
    const distTx = await betting.connect(deployer).distributeWinners(betId, distributionData, true);
    await distTx.wait();
    console.log("Distributed!");
    
    console.log("Test Complete.");
}
// Execute
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
