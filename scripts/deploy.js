const {ethers } = require("hardhat");


async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  
  // const Token = await ethers.getContractFactory("WejeToken");
  // const token = await Token.deploy(
  //   "LVToken",
  //   "LV",
  //   ethers.parseEther("1000000"), // Initial supply
  //   86400 // 1 day delay
  // );

  // await token.waitForDeployment();
  
  // console.log("Token deployed to:", token.target);
  // console.log("Operations start time:", await token.operationsStartTime());

  const SportsBetting = await ethers.getContractFactory("SportsBetting");
  const sportsBetting = await SportsBetting.deploy("0xB0412e8EcfDF82197f3dC782803a63EF3557404d");
  await sportsBetting.waitForDeployment();
  console.log("sportsBetting deployed to:", sportsBetting.target);

  // const PredictionBetting = await ethers.getContractFactory("PredictionTickets");
  // const predictionBetting = await PredictionBetting.deploy("0xB0412e8EcfDF82197f3dC782803a63EF3557404d");
  // await predictionBetting.waitForDeployment();
  // console.log("Prediction Contract deployed to:", predictionBetting.target);

  // const pokerGame = await ethers.getContractFactory("PokerGame");
  // const pokerContract = await pokerGame.deploy("0xB0412e8EcfDF82197f3dC782803a63EF3557404d");
  // await pokerContract.waitForDeployment();
  // console.log("pokerContract deployed to:", pokerContract.target);

  // const LudoGame = await ethers.getContractFactory("LudoGame");
  // const ludoContract = await LudoGame.deploy("0xB0412e8EcfDF82197f3dC782803a63EF3557404d");
  // await ludoContract.waitForDeployment();
  // console.log("ludoContract deployed to:", ludoContract.target);

  //BETA

  // const blackjackGame = await ethers.getContractFactory("BlackjackGame");
  // const blackjackContract = await blackjackGame.deploy("0xB94284FB7Fd4e13198E81454B8e5C877BDe1d61A");
  // await blackjackContract.waitForDeployment();
  // console.log("blackjackContract deployed to:", blackjackContract.target);

  
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run scripts/deploy.js --network polygon 
// npx hardhat verify 0xa86d5d0284f9F7A04B9B2E4723818ba981417f9E --network polygon
// npx hardhat verify 0x748194BeAd5e1B5103ED9DF857237C3CaB1aa915 0xB0412e8EcfDF82197f3dC782803a63EF3557404d --network polygon 
// npx hardhat verify 0xF16fE13a7A4596ccC93B694637Fc975c1920eA08 0xB94284FB7Fd4e13198E81454B8e5C877BDe1d61A --network polygon
