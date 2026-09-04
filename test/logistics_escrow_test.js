const CarrierReputationToken = artifacts.require("CarrierReputationToken");
const LogisticsEscrow = artifacts.require("LogisticsEscrow");

contract("LogisticsEscrow End-to-End Suite", (accounts) => {
  const [deployer, shipper, carrier, unauthorized] = accounts;
  let token, escrow;

  beforeEach(async () => {
    token = await CarrierReputationToken.new({ from: deployer });
    escrow = await LogisticsEscrow.new(token.address, { from: deployer });
    await token.setEscrowContract(escrow.address, { from: deployer });
  });

  it("1. Should register Shipper and Carrier successfully", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.1", "ether") });

    const shipperUser = await escrow.users(shipper);
    const carrierUser = await escrow.users(carrier);

    assert.equal(shipperUser.name, "Acme Corp");
    assert.equal(shipperUser.role.toString(), "1");
    assert.equal(carrierUser.name, "FastTrans Ltd");
    assert.equal(carrierUser.role.toString(), "2");
  });

  it("2. Should execute full milestone lifecycle with carrier acceptance, 30%/70% payouts and CRT minting", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Microcontroller PCBs", "Bayan Lepas, Penang", "Port Klang, Selangor", "QmInitialCargoPhotoHash123", 25000],
      { from: shipper, value: totalVal }
    );

    let cargo = await escrow.getAgreementCargo(1);
    assert.equal(cargo.cargoTitle, "Microcontroller PCBs");
    assert.equal(cargo.originLocation, "Bayan Lepas, Penang");
    assert.equal(cargo.destLocation, "Port Klang, Selangor");
    assert.equal(cargo.initialPhotoIpfs, "QmInitialCargoPhotoHash123");

    let ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "0"); // PendingAcceptance

    // Carrier accepts shipment
    await escrow.acceptAgreement(1, { from: carrier });
    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "1"); // InTransit

    // Milestone 1 (Pickup)
    await escrow.submitMilestoneProof(1, 0, "QmPickupHash123", { from: carrier });
    await escrow.approveMilestonePayout(1, 0, { from: shipper });

    let rep = await token.balanceOf(carrier);
    assert.equal(rep.toString(), "50");

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "2"); // Delivering

    // Milestone 2 (Delivery)
    await escrow.submitMilestoneProof(1, 1, "QmDeliveryHash456", { from: carrier });
    await escrow.approveMilestonePayout(1, 1, { from: shipper });

    rep = await token.balanceOf(carrier);
    assert.equal(rep.toString(), "150");

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "3"); // Completed
  });

  it("3. Should allow Shipper to cancel agreement before pickup and receive full refund", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const totalVal = web3.utils.toWei("0.5", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Refrigeration Motors", "Ipoh, Perak", "Shah Alam, Selangor", "QmPhotoMotors", 18000],
      { from: shipper, value: totalVal }
    );

    await escrow.cancelAgreement(1, { from: shipper });

    const ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "6"); // Cancelled
    assert.equal(ag.remainingBalance.toString(), "0");
  });

  it("4. Should allow Shipper to raise dispute and Arbiter to resolve dispute split", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.1", "ether") });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Chemical Drums", "Kuantan Port", "Pasir Gudang", "QmDrumsPhoto", 30000],
      { from: shipper, value: totalVal }
    );

    await escrow.acceptAgreement(1, { from: carrier });
    await escrow.submitMilestoneProof(1, 0, "QmPickupHash123", { from: carrier });
    await escrow.approveMilestonePayout(1, 0, { from: shipper });

    // Carrier delivers damaged goods, Shipper disputes
    await escrow.submitMilestoneProof(1, 1, "QmDeliveryDamaged", { from: carrier });
    await escrow.raiseDispute(1, "Cargo arrived broken", { from: shipper });

    let ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "5"); // Disputed

    // Arbiter mediates: 60% refund to shipper, 40% payout to carrier, slash stake
    await escrow.resolveDispute(1, 60, 40, true, web3.utils.toWei("0.05", "ether"), { from: deployer });

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "4"); // Refunded
  });

  it("5. Should reject unauthorized operations", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await escrow.createAgreement(
      carrier,
      deadline,
      ["Test Cargo", "Origin", "Dest", "QmTest", 10000],
      { from: shipper, value: web3.utils.toWei("1.0", "ether") }
    );

    // Unauthorized user trying to approve milestone
    try {
      await escrow.approveMilestonePayout(1, 0, { from: unauthorized });
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.include(err.message, "Only assigned shipper authorized");
    }
  });
});
