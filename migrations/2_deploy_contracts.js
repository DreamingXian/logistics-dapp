const CarrierReputationToken = artifacts.require("CarrierReputationToken");
const LogisticsEscrow = artifacts.require("LogisticsEscrow");

module.exports = async function (deployer) {
  await deployer.deploy(CarrierReputationToken);
  const tokenInstance = await CarrierReputationToken.deployed();

  await deployer.deploy(LogisticsEscrow, tokenInstance.address);
  const escrowInstance = await LogisticsEscrow.deployed();

  await tokenInstance.setEscrowContract(escrowInstance.address);

  console.log("----------------------------------------------------");
  console.log("CarrierReputationToken deployed to:", tokenInstance.address);
  console.log("LogisticsEscrow deployed to:       ", escrowInstance.address);
  console.log("----------------------------------------------------");
};
