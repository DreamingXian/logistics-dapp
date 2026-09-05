const CarrierReputationToken = artifacts.require("CarrierReputationToken");
const LogisticsEscrow = artifacts.require("LogisticsEscrow");

contract("LogisticsEscrow End-to-End Suite", (accounts) => {
  const [deployer, shipper, carrier, unauthorized] = accounts;
  let token, escrow;

  async function getBlockTime() {
    const block = await web3.eth.getBlock("latest");
    return Number(block.timestamp);
  }

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

    const deadline = (await getBlockTime()) + 3600;
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

  it("6. Should allow Shipper to claim 70% refund when expired after pickup, and validate late delivery done without releasing ETH", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.05", "ether") });

    const deadline = (await getBlockTime()) + 2;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Perishable Fruits", "Cameron Highlands", "Kuala Lumpur", "QmFruitsPhoto", 15000],
      { from: shipper, value: totalVal }
    );

    await escrow.acceptAgreement(1, { from: carrier });
    await escrow.submitMilestoneProof(1, 0, "QmPickupProof", { from: carrier });
    await escrow.approveMilestonePayout(1, 0, { from: shipper });

    let ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.remainingBalance.toString(), web3.utils.toWei("0.7", "ether"));

    // Advance EVM blockchain time past deadline
    await new Promise((resolve, reject) => {
      web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [100],
        id: Date.now()
      }, (err) => {
        if (err) return reject(err);
        web3.currentProvider.send({
          jsonrpc: "2.0",
          method: "evm_mine",
          params: [],
          id: Date.now()
        }, (err2) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });

    // Shipper claims 70% refund because deadline expired
    await escrow.claimTimeoutRefund(1, { from: shipper });

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.remainingBalance.toString(), "0");
    assert.equal(ag.status.toString(), "4"); // Refunded

    // Carrier submits late delivery proof even though status was marked refunded
    await escrow.submitMilestoneProof(1, 1, "QmLateDeliveryProof", { from: carrier });

    const ms2 = await escrow.getMilestoneDetails(1, 1);
    assert.equal(ms2.completed, true);
    assert.equal(ms2.approved, false);

    // Shipper validates late delivery done
    await escrow.validateLateDelivery(1, { from: shipper });

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "3"); // Completed!
    assert.equal(ag.remainingBalance.toString(), "0");

    const finalMs2 = await escrow.getMilestoneDetails(1, 1);
    assert.equal(finalMs2.approved, true);

    // Carrier earned +100 CRT for completing late delivery
    const carrierBal = await token.balanceOf(carrier);
    assert.equal(carrierBal.toString(), "100");

    // Reset EVM time back to machine time
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_setTime", params: [Date.now()], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });
  });

  it("7. Should allow Shipper to validate pickup and claim 70% refund if deadline expired before pickup was approved", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.05", "ether") });

    const deadline = (await getBlockTime()) + 2;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Medical Vaccines", "Bayan Lepas", "Kuala Lumpur", "QmVaccinePhoto", 50000],
      { from: shipper, value: totalVal }
    );

    await escrow.acceptAgreement(1, { from: carrier });
    // Carrier submitted pickup proof, BUT shipper did not approve yet!
    await escrow.submitMilestoneProof(1, 0, "QmVaccinePickup", { from: carrier });

    // Advance EVM time past deadline
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [100], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });

    // Shipper calls validatePickupAndClaimTimeoutRefund
    await escrow.validatePickupAndClaimTimeoutRefund(1, { from: shipper });

    let ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.remainingBalance.toString(), "0");
    assert.equal(ag.status.toString(), "4"); // Refunded

    const ms1 = await escrow.getMilestoneDetails(1, 0);
    assert.equal(ms1.approved, true); // Carrier received 30% for the pickup

    // Carrier now submits delivery proof
    await escrow.submitMilestoneProof(1, 1, "QmVaccineDelivery", { from: carrier });

    // Shipper validates late delivery done
    await escrow.validateLateDelivery(1, { from: shipper });

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "3"); // Completed

    // Reset EVM time back to machine time
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_setTime", params: [Date.now()], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });
  });

  it("8. Should allow Shipper to cancel agreement & claim 100% refund when carrier accepted but missed pickup deadline, slashing 150 CRT", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.05", "ether") });

    // Temporarily allow deployer to mint 300 CRT for testing slash behavior
    await token.setEscrowContract(deployer, { from: deployer });
    await token.mintReputation(carrier, 300, { from: deployer });
    await token.setEscrowContract(escrow.address, { from: deployer });

    const initialRep = await token.balanceOf(carrier);
    assert.equal(initialRep.toString(), "300");

    const deadline = (await getBlockTime()) + 2;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Industrial Generator", "Penang", "Johor", "QmGenPhoto", 80000],
      { from: shipper, value: totalVal }
    );

    // Carrier accepts -> status becomes InTransit (1), awaiting pickup
    await escrow.acceptAgreement(1, { from: carrier });
    let ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "1"); // InTransit

    // Advance EVM time past delivery deadline without carrier submitting pickup proof
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [100], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });

    // Shipper cancels missed pickup agreement
    await escrow.cancelAgreement(1, { from: shipper });

    ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "6"); // Cancelled
    assert.equal(ag.remainingBalance.toString(), "0");

    // Check status flags: marked as refunded!
    const flags = await escrow.getAgreementStatusFlags(1);
    assert.equal(flags.hasRefund, true);

    // Carrier reputation slashed by 300 CRT (300 - 300 = 0)
    const afterSlashRep = await token.balanceOf(carrier);
    assert.equal(afterSlashRep.toString(), "0");

    // Reset EVM time back to machine time
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_setTime", params: [Date.now()], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });
  });

  it("9. Should allow carrier to submit pickup proof even after deadline expired (late pickup)", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.05", "ether") });

    const deadline = (await getBlockTime()) + 2;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Industrial Generator", "Penang", "Johor", "QmGenPhoto", 80000],
      { from: shipper, value: totalVal }
    );

    await escrow.acceptAgreement(1, { from: carrier });

    // Advance EVM time past delivery deadline
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [100], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });

    // Carrier submits late pickup proof
    await escrow.submitMilestoneProof(1, 0, "QmLatePickupProof", { from: carrier });

    const ms1 = await escrow.getMilestoneDetails(1, 0);
    assert.equal(ms1.completed, true);
    assert.equal(ms1.ipfsProofHash, "QmLatePickupProof");

    // Reset EVM time back to machine time
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_setTime", params: [Date.now()], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });
  });

  it("10. Should allow Shipper to approve delivery normally if carrier submitted Milestone 2 before deadline, even if approved after deadline", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.05", "ether") });

    const deadline = (await getBlockTime()) + 50;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Solar Panels", "Kedah", "Selangor", "QmSolarPhoto", 40000],
      { from: shipper, value: totalVal }
    );

    await escrow.acceptAgreement(1, { from: carrier });
    await escrow.submitMilestoneProof(1, 0, "QmSolarPickup", { from: carrier });
    await escrow.approveMilestonePayout(1, 0, { from: shipper });

    // Carrier submits final delivery proof BEFORE deadline!
    await escrow.submitMilestoneProof(1, 1, "QmSolarDeliveredOnTime", { from: carrier });
    const subTime = await escrow.getMilestoneSubmissionTime(1, 1);
    assert(subTime.toNumber() <= deadline);

    // Now advance EVM time past delivery deadline
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [200], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });

    // Shipper approves final delivery AFTER deadline has passed on chain
    await escrow.approveMilestonePayout(1, 1, { from: shipper });

    const ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.status.toString(), "3"); // Completed
    assert.equal(ag.remainingBalance.toString(), "0");

    // Carrier receives 50 (pickup) + 100 (delivery) = 150 CRT without penalty
    const carrierRep = await token.balanceOf(carrier);
    assert.equal(carrierRep.toString(), "150");

    // Reset EVM time back to machine time
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_setTime", params: [Date.now()], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });
  });

  it("11. Should disburse 0 ETH and 0 CRT to carrier and 100% refund to shipper if carrier submits pickup proof LATE (after deadline)", async () => {
    await escrow.registerUser("Acme Corp", 1, { from: shipper });
    await escrow.registerUser("FastTrans Ltd", 2, { from: carrier, value: web3.utils.toWei("0.05", "ether") });

    // Temporarily allow deployer to mint 300 CRT for testing slash behavior
    await token.setEscrowContract(deployer, { from: deployer });
    await token.mintReputation(carrier, 300, { from: deployer });
    await token.setEscrowContract(escrow.address, { from: deployer });

    const deadline = (await getBlockTime()) + 2;
    const totalVal = web3.utils.toWei("1.0", "ether");

    await escrow.createAgreement(
      carrier,
      deadline,
      ["Industrial Pumps", "Shah Alam", "Johor Bahru", "QmPumpPhoto", 30000],
      { from: shipper, value: totalVal }
    );

    await escrow.acceptAgreement(1, { from: carrier });

    // Advance EVM time past deadline WITHOUT submitting pickup proof
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [200], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });

    // Carrier now submits pickup proof LATE after deadline
    await escrow.submitMilestoneProof(1, 0, "QmLatePickupProof", { from: carrier });

    const carrierEthBalBefore = BigInt(await web3.eth.getBalance(carrier));
    const shipperEthBalBefore = BigInt(await web3.eth.getBalance(shipper));

    // Shipper validates late pickup
    const tx = await escrow.validatePickupAndClaimTimeoutRefund(1, { from: shipper });
    const gasUsed = BigInt(tx.receipt.gasUsed);
    const txDetails = await web3.eth.getTransaction(tx.tx);
    const gasPrice = BigInt(txDetails.gasPrice);
    const gasCost = gasUsed * gasPrice;

    const carrierEthBalAfter = BigInt(await web3.eth.getBalance(carrier));
    const shipperEthBalAfter = BigInt(await web3.eth.getBalance(shipper));

    // Carrier should receive 0 ETH
    assert.equal((carrierEthBalAfter - carrierEthBalBefore).toString(), "0");

    // Shipper should receive 100% refund (1.0 ETH minus gas cost)
    const expectedShipperGain = BigInt(totalVal) - gasCost;
    assert.equal((shipperEthBalAfter - shipperEthBalBefore).toString(), expectedShipperGain.toString());

    // Carrier receives +50 CRT for submitting pickup and is slashed 300 CRT for missing deadline (300 - 300 + 50 = 50 CRT)
    const carrierRep = await token.balanceOf(carrier);
    assert.equal(carrierRep.toString(), "50");

    const ag = await escrow.getAgreementDetails(1);
    assert.equal(ag.remainingBalance.toString(), "0");
    assert.equal(ag.status.toString(), "4"); // Refunded

    // Carrier now submits late delivery proof and shipper validates
    await escrow.submitMilestoneProof(1, 1, "QmLateDeliveryProof", { from: carrier });
    await escrow.validateLateDelivery(1, { from: shipper });

    // Carrier gets back +100 CRT for completing late delivery (50 + 100 = 150 CRT)
    const carrierFinalRep = await token.balanceOf(carrier);
    assert.equal(carrierFinalRep.toString(), "150");

    // Reset EVM time back to machine time
    await new Promise((resolve) => {
      web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_setTime", params: [Date.now()], id: Date.now() }, () => {
        web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => resolve());
      });
    });
  });
});
