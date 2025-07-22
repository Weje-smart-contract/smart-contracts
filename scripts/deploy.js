const {ethers } = require("hardhat");


async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  
  const Token = await ethers.getContractFactory("WejeToken");
  const token = await Token.deploy(
    "LVToken",
    "LV",
    ethers.parseEther("1000000"), // Initial supply
    86400 // 1 day delay
  );

  await token.waitForDeployment();
  
  console.log("Token deployed to:", token.target);
  console.log("Operations start time:", await token.operationsStartTime());

  // const SportsBetting = await ethers.getContractFactory("SportsBetting");
  // const sportsBetting = await SportsBetting.deploy("0x38267e9C0F5Aa50aD9F085318bc88B43B2B578f2");
  // await sportsBetting.waitForDeployment();
  
  // console.log("SportsBetting deployed to:", sportsBetting.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// npx hardhat run scripts/deploy.js --network polygon 