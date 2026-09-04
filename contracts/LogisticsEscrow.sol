// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CarrierReputationToken.sol";

contract LogisticsEscrow {
    enum Role { None, Shipper, Carrier }
    enum AgreementStatus { PendingAcceptance, InTransit, Delivering, Completed, Refunded, Disputed, Cancelled, Rejected }

    struct User {
        string name;
        Role role;
        bool isRegistered;
        uint256 securityStake;
        uint256 completedJobs;
    }

    struct Milestone {
        string description;
        uint256 payoutPercent;
        bool completed;
        bool approved;
        string ipfsProofHash;
    }

    struct CargoSpec {
        string cargoTitle;
        string originLocation;
        string destLocation;
        string initialPhotoIpfs;
        uint256 declaredValue;
    }

    struct Agreement {
        uint256 id;
        address payable shipper;
        address payable carrier;
        uint256 totalValue;
        uint256 remainingEscrowBalance;
        uint256 deliveryDeadline;
        AgreementStatus status;
        CargoSpec cargo;
        Milestone[2] milestones;
    }

    address public owner;
    address public arbiter;
    uint256 public totalAgreements;
    ICarrierReputationToken public reputationToken;

    mapping(address => User) public users;
    mapping(uint256 => Agreement) public agreements;
    address[] public registeredCarriers;

    event UserRegistered(address indexed userAddress, string name, Role role, uint256 stake);
    event StakeDeposited(address indexed carrier, uint256 amount);
    event StakeWithdrawn(address indexed carrier, uint256 amount);
    event AgreementCreated(uint256 indexed agreementId, address indexed shipper, address indexed carrier, uint256 totalValue, uint256 deadline);
    event AgreementAccepted(uint256 indexed agreementId, address indexed carrier);
    event AgreementRejected(uint256 indexed agreementId, address indexed carrier, uint256 refundAmount);
    event AgreementCancelled(uint256 indexed agreementId, address indexed shipper, uint256 refundAmount);
    event MilestoneSubmitted(uint256 indexed agreementId, uint8 milestoneIndex, string ipfsProof);
    event FundsReleased(uint256 indexed agreementId, uint8 milestoneIndex, uint256 amount, address indexed carrier);
    event RefundIssued(uint256 indexed agreementId, address indexed shipper, uint256 amount);
    event DisputeRaised(uint256 indexed agreementId, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed agreementId, uint256 shipperRefund, uint256 carrierPayout, uint256 slashedStake);
    event ReputationAwarded(address indexed carrier, uint256 amount, bool isMint);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner authorized");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter || msg.sender == owner, "Only arbiter or owner authorized");
        _;
    }

    modifier onlyShipper(uint256 _id) {
        require(msg.sender == agreements[_id].shipper, "Only assigned shipper authorized");
        _;
    }

    modifier onlyCarrier(uint256 _id) {
        require(msg.sender == agreements[_id].carrier, "Only assigned carrier authorized");
        _;
    }

    modifier withinDeadline(uint256 _id) {
        require(block.timestamp <= agreements[_id].deliveryDeadline, "Delivery deadline has expired");
        _;
    }

    modifier pastDeadline(uint256 _id) {
        require(block.timestamp > agreements[_id].deliveryDeadline, "Delivery deadline has not expired yet");
        _;
    }

    constructor(address _tokenAddress) {
        require(_tokenAddress != address(0), "Invalid token address");
        owner = msg.sender;
        arbiter = msg.sender;
        reputationToken = ICarrierReputationToken(_tokenAddress);
    }

    function setArbiter(address _newArbiter) external onlyOwner {
        require(_newArbiter != address(0), "Invalid arbiter address");
        arbiter = _newArbiter;
    }

    function registerUser(string calldata _name, Role _role) external payable {
        require(!users[msg.sender].isRegistered, "User already registered");
        require(_role == Role.Shipper || _role == Role.Carrier, "Invalid role selection");

        users[msg.sender] = User({
            name: _name,
            role: _role,
            isRegistered: true,
            securityStake: msg.value,
            completedJobs: 0
        });

        if (_role == Role.Carrier) {
            registeredCarriers.push(msg.sender);
        }

        emit UserRegistered(msg.sender, _name, _role, msg.value);
    }

    function depositStake() external payable {
        require(users[msg.sender].role == Role.Carrier, "Only registered carriers can stake");
        require(msg.value > 0, "Stake must be greater than zero");
        users[msg.sender].securityStake += msg.value;
        emit StakeDeposited(msg.sender, msg.value);
    }

    function withdrawStake(uint256 _amount) external {
        require(users[msg.sender].role == Role.Carrier, "Only registered carriers can withdraw");
        require(users[msg.sender].securityStake >= _amount, "Insufficient staked balance");
        users[msg.sender].securityStake -= _amount;
        (bool sent, ) = msg.sender.call{value: _amount}("");
        require(sent, "Stake withdrawal failed");
        emit StakeWithdrawn(msg.sender, _amount);
    }

    function createAgreement(
        address payable _carrier,
        uint256 _deadline,
        CargoSpec calldata _cargo
    ) external payable returns (uint256) {
        require(users[msg.sender].role == Role.Shipper, "Only registered shippers can create agreements");
        require(users[_carrier].role == Role.Carrier, "Target carrier is not registered");
        require(msg.value > 0, "Funding amount must be greater than zero");
        require(_deadline > block.timestamp, "Deadline must be a future Unix timestamp");

        totalAgreements++;
        uint256 agreementId = totalAgreements;
        Agreement storage newAgreement = agreements[agreementId];
        newAgreement.id = agreementId;
        newAgreement.shipper = payable(msg.sender);
        newAgreement.carrier = _carrier;
        newAgreement.totalValue = msg.value;
        newAgreement.remainingEscrowBalance = msg.value;
        newAgreement.deliveryDeadline = _deadline;
        newAgreement.status = AgreementStatus.PendingAcceptance;
        newAgreement.cargo = _cargo;

        newAgreement.milestones[0] = Milestone({
            description: "Milestone 1: Cargo Pickup Verification",
            payoutPercent: 30,
            completed: false,
            approved: false,
            ipfsProofHash: ""
        });

        newAgreement.milestones[1] = Milestone({
            description: "Milestone 2: Final Delivery Verification",
            payoutPercent: 70,
            completed: false,
            approved: false,
            ipfsProofHash: ""
        });

        emit AgreementCreated(agreementId, msg.sender, _carrier, msg.value, _deadline);
        return agreementId;
    }

    function acceptAgreement(uint256 _id) external onlyCarrier(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.PendingAcceptance, "Agreement not pending acceptance");
        require(block.timestamp <= ag.deliveryDeadline, "Delivery deadline has passed");
        ag.status = AgreementStatus.InTransit;
        emit AgreementAccepted(_id, ag.carrier);
    }

    function rejectAgreement(uint256 _id) external onlyCarrier(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.PendingAcceptance, "Agreement not pending acceptance");
        ag.status = AgreementStatus.Rejected;
        uint256 refundAmount = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;
        (bool sent, ) = ag.shipper.call{value: refundAmount}("");
        require(sent, "Refund transfer failed");
        emit AgreementRejected(_id, ag.carrier, refundAmount);
    }

    function cancelAgreement(uint256 _id) public onlyShipper(_id) {
        Agreement storage ag = agreements[_id];
        require(
            ag.status == AgreementStatus.PendingAcceptance ||
            (ag.status == AgreementStatus.InTransit && !ag.milestones[0].completed),
            "Cannot cancel in current state"
        );

        uint256 refundAmount = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;
        ag.status = AgreementStatus.Cancelled;

        (bool sent, ) = ag.shipper.call{value: refundAmount}("");
        require(sent, "Refund transfer failed");
        emit AgreementCancelled(_id, ag.shipper, refundAmount);
    }

    function cancelBeforePickup(uint256 _id) external onlyShipper(_id) {
        cancelAgreement(_id);
    }

    function submitMilestoneProof(uint256 _id, uint8 _msIndex, string calldata _ipfsProof) external onlyCarrier(_id) withinDeadline(_id) {
        require(_msIndex < 2, "Invalid milestone index");
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.InTransit || ag.status == AgreementStatus.Delivering, "Agreement not active");
        require(!ag.milestones[_msIndex].completed, "Milestone already completed");

        if (_msIndex == 1) {
            require(ag.milestones[0].approved, "Milestone 1 must be approved first");
        }

        ag.milestones[_msIndex].completed = true;
        ag.milestones[_msIndex].ipfsProofHash = _ipfsProof;
        emit MilestoneSubmitted(_id, _msIndex, _ipfsProof);
    }

    function approveMilestonePayout(uint256 _id, uint8 _msIndex) external onlyShipper(_id) {
        require(_msIndex < 2, "Invalid milestone index");
        Agreement storage ag = agreements[_id];
        require(ag.milestones[_msIndex].completed, "Milestone proof not submitted yet");
        require(!ag.milestones[_msIndex].approved, "Milestone payout already approved");

        ag.milestones[_msIndex].approved = true;
        uint256 payoutAmount = (ag.totalValue * ag.milestones[_msIndex].payoutPercent) / 100;
        require(ag.remainingEscrowBalance >= payoutAmount, "Insufficient escrow balance");
        ag.remainingEscrowBalance -= payoutAmount;

        if (_msIndex == 0) {
            ag.status = AgreementStatus.Delivering;
            reputationToken.mintReputation(ag.carrier, 50);
            emit ReputationAwarded(ag.carrier, 50, true);
        } else if (_msIndex == 1) {
            ag.status = AgreementStatus.Completed;
            users[ag.carrier].completedJobs++;
            reputationToken.mintReputation(ag.carrier, 100);
            emit ReputationAwarded(ag.carrier, 100, true);
        }

        (bool sent, ) = ag.carrier.call{value: payoutAmount}("");
        require(sent, "ETH payout transfer failed");
        emit FundsReleased(_id, _msIndex, payoutAmount, ag.carrier);
    }

    function claimTimeoutRefund(uint256 _id) external onlyShipper(_id) pastDeadline(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status != AgreementStatus.Completed, "Agreement already completed");
        require(ag.status != AgreementStatus.Refunded, "Refund already processed");
        require(ag.status != AgreementStatus.Cancelled, "Agreement was cancelled");
        require(ag.remainingEscrowBalance > 0, "No escrow funds remaining");

        uint256 refundAmount = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;
        ag.status = AgreementStatus.Refunded;

        reputationToken.slashReputation(ag.carrier, 150);
        emit ReputationAwarded(ag.carrier, 150, false);

        (bool sent, ) = ag.shipper.call{value: refundAmount}("");
        require(sent, "Refund transfer to shipper failed");
        emit RefundIssued(_id, ag.shipper, refundAmount);
    }

    function raiseDispute(uint256 _id, string calldata _reason) external onlyShipper(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.InTransit || ag.status == AgreementStatus.Delivering, "Cannot dispute in current status");
        ag.status = AgreementStatus.Disputed;
        emit DisputeRaised(_id, msg.sender, _reason);
    }

    function resolveDispute(
        uint256 _id,
        uint256 _shipperRefundPct,
        uint256 _carrierPayoutPct,
        bool _slashCarrierStake,
        uint256 _stakeSlashAmount
    ) external onlyArbiter {
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.Disputed, "Agreement is not in dispute");
        require(_shipperRefundPct + _carrierPayoutPct == 100, "Percentages must total 100");

        uint256 escrowBal = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;
        ag.status = AgreementStatus.Refunded;

        uint256 shipperRefund = (escrowBal * _shipperRefundPct) / 100;
        uint256 carrierPayout = (escrowBal * _carrierPayoutPct) / 100;

        uint256 actualStakeSlashed = 0;
        if (_slashCarrierStake && _stakeSlashAmount > 0) {
            User storage carrierUser = users[ag.carrier];
            actualStakeSlashed = carrierUser.securityStake < _stakeSlashAmount ? carrierUser.securityStake : _stakeSlashAmount;
            carrierUser.securityStake -= actualStakeSlashed;
            shipperRefund += actualStakeSlashed;
            reputationToken.slashReputation(ag.carrier, 150);
            emit ReputationAwarded(ag.carrier, 150, false);
        }

        if (shipperRefund > 0) {
            (bool sentShipper, ) = ag.shipper.call{value: shipperRefund}("");
            require(sentShipper, "Shipper dispute refund failed");
        }
        if (carrierPayout > 0) {
            (bool sentCarrier, ) = ag.carrier.call{value: carrierPayout}("");
            require(sentCarrier, "Carrier dispute payout failed");
        }

        emit DisputeResolved(_id, shipperRefund, carrierPayout, actualStakeSlashed);
    }

    function getAgreementDetails(uint256 _id) external view returns (
        uint256 id,
        address shipper,
        address carrier,
        uint256 totalValue,
        uint256 remainingBalance,
        uint256 deadline,
        AgreementStatus status
    ) {
        Agreement storage ag = agreements[_id];
        return (ag.id, ag.shipper, ag.carrier, ag.totalValue, ag.remainingEscrowBalance, ag.deliveryDeadline, ag.status);
    }

    function getAgreementCargo(uint256 _id) external view returns (
        string memory cargoTitle,
        string memory originLocation,
        string memory destLocation,
        string memory initialPhotoIpfs,
        uint256 declaredValue
    ) {
        CargoSpec storage c = agreements[_id].cargo;
        return (c.cargoTitle, c.originLocation, c.destLocation, c.initialPhotoIpfs, c.declaredValue);
    }

    function getMilestoneDetails(uint256 _id, uint8 _msIndex) external view returns (
        string memory description,
        uint256 payoutPercent,
        bool completed,
        bool approved,
        string memory ipfsProofHash
    ) {
        require(_msIndex < 2, "Invalid milestone index");
        Milestone storage ms = agreements[_id].milestones[_msIndex];
        return (ms.description, ms.payoutPercent, ms.completed, ms.approved, ms.ipfsProofHash);
    }

    function getCarriersCount() external view returns (uint256) {
        return registeredCarriers.length;
    }
}
