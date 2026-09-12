// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CarrierReputationToken.sol";

/// ============================================================================
/// CONTRACT: LogisticsEscrow
/// ============================================================================
/// @title Decentralized Milestone-Based Logistics Escrow with Reputation Tracking
/// @notice Implements an automated, trust-minimized escrow protocol for physical freight logistics.
/// @dev Holds shipper funds in escrow, dispatches conditional payouts (30% pickup, 70% delivery)
///      upon cryptographic IPFS proof validation, slashes/mints CRT reputation, and protects both parties
///      against defaults and delivery deadline expirations.
contract LogisticsEscrow {

    /// ============================================================================
    /// SECTION 1: ENUMS (Finite State Machines & Role Types)
    /// ============================================================================

    /// @notice User roles within the logistics decentralized platform
    /// @dev Default value is None (0) for unregistered Ethereum addresses
    enum Role {
        None,       // 0: Unregistered wallet
        Shipper,    // 1: Cargo owner / manufacturer requesting transportation
        Carrier     // 2: Logistics fleet operator / driver delivering cargo
    }

    /// @notice Finite state lifecycle of a freight escrow agreement
    enum AgreementStatus {
        PendingAcceptance,  // 0: Created and funded by Shipper; awaiting Carrier review
        InTransit,          // 1: Accepted by Carrier; Milestone 1 (Cargo Pickup) is active
        Delivering,         // 2: Milestone 1 approved; cargo en route to destination dock
        Completed,          // 3: Milestone 2 verified; escrow funds 100% disbursed to Carrier
        Refunded,           // 4: Delivery deadline expired; escrow refunded to Shipper; late delivery allowed
        Disputed,           // 5: Agreement flagged for arbitration review
        Cancelled,          // 6: Cancelled before pickup or expired before acceptance; full refund issued
        Rejected            // 7: Carrier declined the agreement; full escrow returned to Shipper
    }

    /// ============================================================================
    /// SECTION 2: STRUCTS (Custom Data Structures)
    /// ============================================================================

    /// @notice User profile and staking collateral record
    struct User {
        string name;            // Individual or corporate company name
        Role role;              // Assigned role (Shipper or Carrier)
        bool isRegistered;      // True if the wallet has completed onboarding registration
        uint256 securityStake;  // ETH collateral deposited by carrier to demonstrate financial backing
        uint256 completedJobs;  // Counter of successfully completed deliveries
    }

    /// @notice Checkpoint within a freight agreement with attached financial release %
    struct Milestone {
        string description;     // Textual description (e.g. "Milestone 1: Cargo Pickup Verification")
        uint256 payoutPercent;  // Percentage of total escrow unlocked upon approval (30 or 70)
        bool completed;         // True once Carrier submits photo proof to IPFS
        bool approved;          // True once Shipper verifies and approves payout release
        string ipfsProofHash;   // Decentralized IPFS CID of inspection photo / sign-off document
    }

    /// @notice Physical cargo specifications and transit route details
    struct CargoSpec {
        string cargoTitle;          // Shipment title or manifest identification
        string originLocation;      // Origin warehouse dock address
        string destLocation;        // Destination receiving facility address
        string initialPhotoIpfs;    // Shipper baseline cargo condition photo hash before collection
        uint256 declaredValue;      // Commercial declared cargo value in fiat (MYR)
    }

    /// @notice Complete Freight Escrow Agreement record
    struct Agreement {
        uint256 id;                     // Unique incremental agreement ID
        address payable shipper;        // Cargo owner's wallet (funds escrow, receives refunds)
        address payable carrier;        // Logistics fleet wallet (receives milestone payouts)
        uint256 totalValue;             // Total freight service fee deposited into escrow (in Wei)
        uint256 remainingEscrowBalance; // Current undisbursed ETH held in the smart contract
        uint256 deliveryDeadline;       // Strict Unix timestamp deadline for delivery completion
        AgreementStatus status;         // Current lifecycle state of the agreement
        CargoSpec cargo;                // Detailed route, manifest, and cargo specs
        Milestone[2] milestones;        // Fixed array: [0] = Pickup (30%), [1] = Final Delivery (70%)
    }

    /// ============================================================================
    /// SECTION 3: STATE VARIABLES & STORAGE MAPPINGS
    /// ============================================================================

    address public owner;                           // Platform administrator / contract deployer
    address public arbiter;                         // Dispute resolution arbiter
    uint256 public totalAgreements;                 // Total number of freight agreements created
    ICarrierReputationToken public reputationToken; // Connected Carrier Reputation Token (CRT) contract

    // Key-value store mapping wallet addresses to user registration profiles
    mapping(address => User) public users;

    // Key-value store mapping unique agreement ID to complete Agreement record
    mapping(uint256 => Agreement) public agreements;

    // Array containing all registered carrier wallet addresses for directory discovery
    address[] public registeredCarriers;

    // Audit tracking flag: true if an agreement has had an escrow refund issued to the shipper
    mapping(uint256 => bool) public agreementRefunded;

    // Audit tracking flag: true if an agreement was fulfilled via the late delivery pathway
    mapping(uint256 => bool) public agreementLateCompleted;

    // On-chain timestamp recording when carrier submitted proof for a specific milestone
    // mapping(agreementId => mapping(milestoneIndex => unixTimestamp))
    mapping(uint256 => mapping(uint8 => uint256)) public milestoneSubmittedTimestamp;

    // Audit tracking for milestone rejection & resubmission
    mapping(uint256 => mapping(uint8 => bool)) public milestoneRejected;
    mapping(uint256 => mapping(uint8 => string)) public milestoneRejectionReason;
    mapping(uint256 => mapping(uint8 => string)) public milestoneLastRejectedProof;

    /// ============================================================================
    /// SECTION 4: EVENTS (On-Chain Transparency & Front-End Logging)
    /// ============================================================================

    event UserRegistered(address indexed userAddress, string name, Role role, uint256 stake);
    event StakeDeposited(address indexed carrier, uint256 amount);
    event StakeWithdrawn(address indexed carrier, uint256 amount);
    event AgreementCreated(uint256 indexed agreementId, address indexed shipper, address indexed carrier, uint256 totalValue, uint256 deadline);
    event AgreementAccepted(uint256 indexed agreementId, address indexed carrier);
    event AgreementRejected(uint256 indexed agreementId, address indexed carrier, uint256 refundAmount);
    event AgreementCancelled(uint256 indexed agreementId, address indexed shipper, uint256 refundAmount);
    event MilestoneSubmitted(uint256 indexed agreementId, uint8 milestoneIndex, string ipfsProof);
    event MilestoneRejected(uint256 indexed agreementId, uint8 milestoneIndex, string reason);
    event FundsReleased(uint256 indexed agreementId, uint8 milestoneIndex, uint256 amount, address indexed carrier);
    event RefundIssued(uint256 indexed agreementId, address indexed shipper, uint256 amount);
    event ReputationAwarded(address indexed carrier, uint256 amount, bool isMint);

    /// ============================================================================
    /// SECTION 5: ACCESS CONTROL & VALIDATION MODIFIERS
    /// ============================================================================

    /// @dev Restricts access to the contract deployer (owner)
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner authorized");
        _;
    }

    /// @dev Restricts access to the authorized dispute arbiter or platform owner
    modifier onlyArbiter() {
        require(msg.sender == arbiter || msg.sender == owner, "Only arbiter or owner authorized");
        _;
    }

    /// @dev Restricts access to the specific shipper assigned to agreement `_id`
    modifier onlyShipper(uint256 _id) {
        require(msg.sender == agreements[_id].shipper, "Only assigned shipper authorized");
        _;
    }

    /// @dev Restricts access to the specific carrier assigned to agreement `_id`
    modifier onlyCarrier(uint256 _id) {
        require(msg.sender == agreements[_id].carrier, "Only assigned carrier authorized");
        _;
    }

    /// @dev Enforces that the current block timestamp is on or before the delivery deadline
    modifier withinDeadline(uint256 _id) {
        require(block.timestamp <= agreements[_id].deliveryDeadline, "Delivery deadline has expired");
        _;
    }

    /// @dev Enforces that the delivery deadline has passed (required for timeout refund claims)
    modifier pastDeadline(uint256 _id) {
        require(block.timestamp > agreements[_id].deliveryDeadline, "Delivery deadline has not expired yet");
        _;
    }

    /// ============================================================================
    /// SECTION 6: CONSTRUCTOR & PLATFORM CONFIGURATION
    /// ============================================================================

    /// @notice Initializes the LogisticsEscrow contract and connects the reputation token
    /// @param _tokenAddress The deployed address of the CarrierReputationToken contract
    constructor(address _tokenAddress) {
        require(_tokenAddress != address(0), "Invalid token address");
        owner = msg.sender;
        arbiter = msg.sender;
        reputationToken = ICarrierReputationToken(_tokenAddress);
    }

    /// @notice Allows the contract owner to designate a dispute resolution arbiter
    /// @param _newArbiter Ethereum address of the newly appointed arbiter
    function setArbiter(address _newArbiter) external onlyOwner {
        require(_newArbiter != address(0), "Invalid arbiter address");
        arbiter = _newArbiter;
    }

    /// ============================================================================
    /// SECTION 7: USER ONBOARDING & CARRIER COLLATERAL STAKING
    /// ============================================================================

    /// @notice Self-register as a verified platform participant (Shipper or Carrier)
    /// @dev Carriers may optionally deposit initial security stake along with registration
    /// @param _name The legal name or corporate moniker of the participant
    /// @param _role The chosen platform role (must be Shipper or Carrier)
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

        // Add carrier address to the searchable directory array
        if (_role == Role.Carrier) {
            registeredCarriers.push(msg.sender);
        }

        emit UserRegistered(msg.sender, _name, _role, msg.value);
    }

    /// @notice Allows registered carriers to deposit ETH collateral into the security pool
    /// @dev Staked balance signals carrier reliability and covers potential default liabilities
    function depositStake() external payable {
        require(users[msg.sender].role == Role.Carrier, "Only registered carriers can stake");
        require(msg.value > 0, "Stake must be greater than zero");
        users[msg.sender].securityStake += msg.value;
        emit StakeDeposited(msg.sender, msg.value);
    }

    /// @notice Allows carriers to safely withdraw their unencumbered collateral stake
    /// @param _amount The amount of ETH (in Wei) to withdraw back to their wallet
    function withdrawStake(uint256 _amount) external {
        require(users[msg.sender].role == Role.Carrier, "Only registered carriers can withdraw");
        require(users[msg.sender].securityStake >= _amount, "Insufficient staked balance");
        
        users[msg.sender].securityStake -= _amount;
        (bool sent, ) = msg.sender.call{value: _amount}("");
        require(sent, "Stake withdrawal failed");
        
        emit StakeWithdrawn(msg.sender, _amount);
    }

    /// ============================================================================
    /// SECTION 8: FREIGHT AGREEMENT CREATION & CONTRACT OFFER FLOW
    /// ============================================================================

    /// @notice Creates a new freight escrow agreement, depositing 100% ETH fee into escrow
    /// @dev Initializes a 2-stage milestone schedule (30% pickup, 70% delivery)
    /// @param _carrier The target carrier's registered wallet address
    /// @param _deadline Unix timestamp representing the strict delivery deadline
    /// @param _cargo Struct containing shipment route, baseline photo CID, and declared value
    /// @return agreementId The unique identifier of the newly minted agreement
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

        // Initialize Milestone 1: 30% payout upon pickup verification
        newAgreement.milestones[0] = Milestone({
            description: "Milestone 1: Cargo Pickup Verification",
            payoutPercent: 30,
            completed: false,
            approved: false,
            ipfsProofHash: ""
        });

        // Initialize Milestone 2: 70% payout upon final delivery verification
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

    /// @notice Carrier accepts an incoming freight contract offer
    /// @dev Locks the agreement to the carrier; status advances to InTransit (Pickup Required)
    /// @param _id The unique agreement identifier
    function acceptAgreement(uint256 _id) external onlyCarrier(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.PendingAcceptance, "Agreement not pending acceptance");
        require(block.timestamp <= ag.deliveryDeadline, "Delivery deadline has passed");
        
        ag.status = AgreementStatus.InTransit;
        emit AgreementAccepted(_id, ag.carrier);
    }

    /// @notice Carrier rejects an incoming freight contract offer
    /// @dev Immediately returns 100% of escrow funds back to the shipper with zero penalty to carrier
    /// @param _id The unique agreement identifier
    function rejectAgreement(uint256 _id) external onlyCarrier(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status == AgreementStatus.PendingAcceptance, "Agreement not pending acceptance");
        
        ag.status = AgreementStatus.Rejected;
        uint256 refundAmount = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;
        agreementRefunded[_id] = true;

        (bool sent, ) = ag.shipper.call{value: refundAmount}("");
        require(sent, "Refund transfer failed");
        
        emit AgreementRejected(_id, ag.carrier, refundAmount);
        emit RefundIssued(_id, ag.shipper, refundAmount);
    }

    /// ============================================================================
    /// SECTION 9: EARLY CANCELLATION FLOWS (BEFORE PICKUP)
    /// ============================================================================

    /// @notice Shipper cancels an agreement before physical cargo pickup occurs
    /// @dev If the carrier accepted but missed the deadline before picking up, carrier is slashed 300 CRT
    /// @param _id The unique agreement identifier
    function cancelAgreement(uint256 _id) public onlyShipper(_id) {
        Agreement storage ag = agreements[_id];
        require(
            ag.status == AgreementStatus.PendingAcceptance ||
            (ag.status == AgreementStatus.InTransit && !ag.milestones[0].completed),
            "Cannot cancel in current state"
        );

        // If carrier accepted (InTransit), but delivery deadline expired and carrier missed pickup, slash 300 CRT penalty
        if (ag.status == AgreementStatus.InTransit && block.timestamp > ag.deliveryDeadline) {
            reputationToken.slashReputation(ag.carrier, 300);
            emit ReputationAwarded(ag.carrier, 300, false);
        }

        uint256 refundAmount = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;
        ag.status = AgreementStatus.Cancelled;
        agreementRefunded[_id] = true;

        (bool sent, ) = ag.shipper.call{value: refundAmount}("");
        require(sent, "Refund transfer failed");
        
        emit AgreementCancelled(_id, ag.shipper, refundAmount);
        emit RefundIssued(_id, ag.shipper, refundAmount);
    }

    /// @notice Convenience wrapper for cancelAgreement
    /// @param _id The unique agreement identifier
    function cancelBeforePickup(uint256 _id) external onlyShipper(_id) {
        cancelAgreement(_id);
    }

    /// ============================================================================
    /// SECTION 10: MILESTONE EXECUTION & CONDITIONAL PAYOUT SETTLEMENT
    /// ============================================================================

    /// @notice Carrier uploads decentralized IPFS proof for a milestone (Pickup photo or Delivery sign-off)
    /// @dev Also explicitly permitted when status == Refunded to enable late delivery proof submission
    /// @param _id The unique agreement identifier
    /// @param _msIndex Milestone index: 0 for Pickup, 1 for Final Delivery
    /// @param _ipfsProof IPFS Content Identifier (CID) hash representing verifiable inspection photo
    function submitMilestoneProof(uint256 _id, uint8 _msIndex, string calldata _ipfsProof) external onlyCarrier(_id) {
        require(_msIndex < 2, "Invalid milestone index");
        Agreement storage ag = agreements[_id];
        require(
            ag.status == AgreementStatus.InTransit ||
            ag.status == AgreementStatus.Delivering ||
            (ag.status == AgreementStatus.Refunded && ag.milestones[0].completed),
            "Agreement not active"
        );
        require(!ag.milestones[_msIndex].completed, "Milestone already completed");

        // Milestone 2 delivery proof requires Milestone 1 pickup to be approved first
        if (_msIndex == 1) {
            require(ag.milestones[0].approved, "Milestone 1 must be approved first");
        }

        ag.milestones[_msIndex].completed = true;
        ag.milestones[_msIndex].ipfsProofHash = _ipfsProof;
        milestoneSubmittedTimestamp[_id][_msIndex] = block.timestamp;
        
        // Clear previous rejection state upon resubmission
        milestoneRejected[_id][_msIndex] = false;
        milestoneRejectionReason[_id][_msIndex] = "";
        
        emit MilestoneSubmitted(_id, _msIndex, _ipfsProof);
    }

    /// @notice Shipper rejects an inadequate or invalid milestone proof and requests resubmission
    /// @dev Resets milestone completion, preserves rejected proof, and logs rejection reason
    /// @param _id The unique agreement identifier
    /// @param _msIndex Milestone index: 0 for Pickup, 1 for Final Delivery
    /// @param _reason The explanation provided by shipper (e.g. "Blurry photo", "Damaged packaging")
    function rejectMilestoneProof(uint256 _id, uint8 _msIndex, string calldata _reason) external onlyShipper(_id) {
        require(_msIndex < 2, "Invalid milestone index");
        Agreement storage ag = agreements[_id];
        require(ag.milestones[_msIndex].completed, "Milestone proof not submitted yet");
        require(!ag.milestones[_msIndex].approved, "Milestone payout already approved");

        ag.milestones[_msIndex].completed = false;
        milestoneLastRejectedProof[_id][_msIndex] = ag.milestones[_msIndex].ipfsProofHash;
        ag.milestones[_msIndex].ipfsProofHash = "";
        milestoneSubmittedTimestamp[_id][_msIndex] = 0;

        milestoneRejected[_id][_msIndex] = true;
        milestoneRejectionReason[_id][_msIndex] = _reason;

        emit MilestoneRejected(_id, _msIndex, _reason);
    }

    /// @notice Shipper verifies inspection proof and triggers conditional milestone escrow release
    /// @dev Releases 30% for Milestone 1 or 70% for Milestone 2; awards CRT tokens to carrier
    /// @param _id The unique agreement identifier
    /// @param _msIndex Milestone index: 0 for Pickup (30%), 1 for Final Delivery (70%)
    function approveMilestonePayout(uint256 _id, uint8 _msIndex) external onlyShipper(_id) {
        require(_msIndex < 2, "Invalid milestone index");
        Agreement storage ag = agreements[_id];
        require(ag.milestones[_msIndex].completed, "Milestone proof not submitted yet");
        require(!ag.milestones[_msIndex].approved, "Milestone payout already approved");

        // If approving Milestone 2, ensure delivery was submitted on or before deadline
        if (_msIndex == 1) {
            uint256 subTime = milestoneSubmittedTimestamp[_id][1];
            if (subTime == 0) subTime = block.timestamp;
            require(
                subTime <= ag.deliveryDeadline,
                "Delivery deadline was missed by carrier. Please claim refund and validate late delivery."
            );
        }

        ag.milestones[_msIndex].approved = true;
        uint256 payoutAmount = (ag.totalValue * ag.milestones[_msIndex].payoutPercent) / 100;
        require(ag.remainingEscrowBalance >= payoutAmount, "Insufficient escrow balance");
        ag.remainingEscrowBalance -= payoutAmount;

        if (_msIndex == 0) {
            // Milestone 1 (Pickup): Advance status to Delivering; award +50 CRT
            ag.status = AgreementStatus.Delivering;
            reputationToken.mintReputation(ag.carrier, 50);
            emit ReputationAwarded(ag.carrier, 50, true);
        } else if (_msIndex == 1) {
            // Milestone 2 (Delivery): Advance status to Completed; increment jobs; award +100 CRT
            ag.status = AgreementStatus.Completed;
            users[ag.carrier].completedJobs++;
            reputationToken.mintReputation(ag.carrier, 100);
            emit ReputationAwarded(ag.carrier, 100, true);
        }

        (bool sent, ) = ag.carrier.call{value: payoutAmount}("");
        require(sent, "ETH payout transfer failed");
        
        emit FundsReleased(_id, _msIndex, payoutAmount, ag.carrier);
    }

    /// ============================================================================
    /// SECTION 11: LATE DELIVERY & TIMEOUT REFUND RECOVERY (Edge Case Handling)
    /// ============================================================================

    /// @notice Shipper confirms late cargo delivery was fulfilled after deadline expired
    /// @dev Refunds remaining escrow to shipper; awards +100 CRT to carrier for completing delivery
    /// @param _id The unique agreement identifier
    function validateLateDelivery(uint256 _id) external onlyShipper(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.milestones[0].completed, "Milestone 1 pickup was not completed");
        require(ag.milestones[1].completed, "Milestone 2 delivery proof not submitted yet");
        require(!ag.milestones[1].approved, "Milestone 2 already validated");

        ag.milestones[1].approved = true;
        ag.status = AgreementStatus.Completed;
        users[ag.carrier].completedJobs++;

        agreementLateCompleted[_id] = true;
        agreementRefunded[_id] = true;

        // If remaining escrow has not been refunded yet, refund it to the shipper now
        if (ag.remainingEscrowBalance > 0) {
            uint256 refundAmount = ag.remainingEscrowBalance;
            ag.remainingEscrowBalance = 0;
            reputationToken.slashReputation(ag.carrier, 300);
            emit ReputationAwarded(ag.carrier, 300, false);
            
            (bool sent, ) = ag.shipper.call{value: refundAmount}("");
            require(sent, "Refund transfer to shipper failed");
            emit RefundIssued(_id, ag.shipper, refundAmount);
        }

        // Carrier gets back +100 CRT for completing late delivery
        reputationToken.mintReputation(ag.carrier, 100);
        emit ReputationAwarded(ag.carrier, 100, true);

        emit FundsReleased(_id, 1, 0, ag.carrier);
    }

    /// @notice Shipper validates pickup and claims timeout refund when delivery deadline expires
    /// @dev If pickup was on-time: carrier gets 30% ETH payout and +50 CRT; shipper gets 70% refund.
    ///      If pickup was late: carrier gets 0 ETH and net -250 CRT; shipper gets 100% refund.
    /// @param _id The unique agreement identifier
    function validatePickupAndClaimTimeoutRefund(uint256 _id) external onlyShipper(_id) pastDeadline(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.milestones[0].completed, "Pickup proof not submitted yet");
        require(!ag.milestones[0].approved, "Pickup already approved");
        require(ag.remainingEscrowBalance > 0, "No escrow balance remaining");

        ag.milestones[0].approved = true;

        uint256 pickupSubTime = milestoneSubmittedTimestamp[_id][0];
        
        // Scenario A: Carrier submitted pickup proof on or before deadline
        if (pickupSubTime > 0 && pickupSubTime <= ag.deliveryDeadline) {
            uint256 pickupPayout = (ag.totalValue * 30) / 100;
            require(ag.remainingEscrowBalance >= pickupPayout, "Insufficient escrow for pickup");
            ag.remainingEscrowBalance -= pickupPayout;

            // Reward carrier +50 CRT for on-time pickup
            reputationToken.mintReputation(ag.carrier, 50);
            emit ReputationAwarded(ag.carrier, 50, true);

            // Transfer 30% payout to carrier
            (bool sentCarrier, ) = ag.carrier.call{value: pickupPayout}("");
            require(sentCarrier, "Carrier pickup payout failed");
            emit FundsReleased(_id, 0, pickupPayout, ag.carrier);

            // Refund remaining 70% to shipper
            uint256 refundAmount = ag.remainingEscrowBalance;
            ag.remainingEscrowBalance = 0;
            ag.status = AgreementStatus.Refunded;
            agreementRefunded[_id] = true;

            // Penalty of 300 CRT for missing delivery deadline
            reputationToken.slashReputation(ag.carrier, 300);
            emit ReputationAwarded(ag.carrier, 300, false);

            (bool sentShipper, ) = ag.shipper.call{value: refundAmount}("");
            require(sentShipper, "Shipper refund failed");
            emit RefundIssued(_id, ag.shipper, refundAmount);
        } else {
            // Scenario B: Carrier submitted pickup proof LATE (after deadline expired)
            // Carrier receives 0 ETH payout (100% refunded to shipper)
            uint256 refundAmount = ag.remainingEscrowBalance;
            ag.remainingEscrowBalance = 0;
            ag.status = AgreementStatus.Refunded;
            agreementRefunded[_id] = true;

            // Slashes 300 CRT for missing deadline, but mints +50 CRT reward for completing pickup
            reputationToken.slashReputation(ag.carrier, 300);
            emit ReputationAwarded(ag.carrier, 300, false);

            reputationToken.mintReputation(ag.carrier, 50);
            emit ReputationAwarded(ag.carrier, 50, true);

            emit FundsReleased(_id, 0, 0, ag.carrier);

            (bool sentShipper, ) = ag.shipper.call{value: refundAmount}("");
            require(sentShipper, "Shipper refund failed");
            emit RefundIssued(_id, ag.shipper, refundAmount);
        }
    }

    /// @notice Shipper claims escrow refund when delivery deadline expires with cargo in transit
    /// @dev Transitions status to Refunded (if pickup done) or Cancelled (if no pickup); slashes carrier 300 CRT
    /// @param _id The unique agreement identifier
    function claimTimeoutRefund(uint256 _id) external onlyShipper(_id) pastDeadline(_id) {
        Agreement storage ag = agreements[_id];
        require(ag.status != AgreementStatus.PendingAcceptance, "Agreement not accepted yet; use cancelAgreement to refund without penalty");
        require(ag.status != AgreementStatus.Completed, "Agreement already completed");
        require(ag.status != AgreementStatus.Refunded, "Refund already processed");
        require(ag.status != AgreementStatus.Cancelled, "Agreement was cancelled");
        require(ag.remainingEscrowBalance > 0, "No escrow funds remaining");

        uint256 refundAmount = ag.remainingEscrowBalance;
        ag.remainingEscrowBalance = 0;

        // If carrier never picked up cargo, transition to Cancelled; if cargo was picked up, transition to Refunded (overdue in transit)
        if (!ag.milestones[0].completed) {
            ag.status = AgreementStatus.Cancelled;
            emit AgreementCancelled(_id, ag.shipper, refundAmount);
        } else {
            ag.status = AgreementStatus.Refunded;
        }

        agreementRefunded[_id] = true;

        // Slash 300 CRT from carrier for missing agreed delivery deadline
        reputationToken.slashReputation(ag.carrier, 300);
        emit ReputationAwarded(ag.carrier, 300, false);

        (bool sent, ) = ag.shipper.call{value: refundAmount}("");
        require(sent, "Refund transfer to shipper failed");
        emit RefundIssued(_id, ag.shipper, refundAmount);
    }

    /// ============================================================================
    /// SECTION 12: VIEW & AUDIT GETTER FUNCTIONS
    /// ============================================================================

    /// @notice Reads general financial and lifecycle details of a freight agreement
    /// @param _id Agreement ID to query
    /// @return id Agreement identifier
    /// @return shipper Wallet address of the shipper
    /// @return carrier Wallet address of the carrier
    /// @return totalValue Total escrow deposit in Wei
    /// @return remainingBalance Current remaining undisbursed escrow in Wei
    /// @return deadline Delivery deadline Unix timestamp
    /// @return status Current AgreementStatus enum value
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

    /// @notice Reads agreement boolean status flags for audit and frontend presentation
    /// @param _id Agreement ID to query
    /// @return hasRefund True if an escrow refund was processed
    /// @return isLate True if the delivery was fulfilled via the late delivery path
    function getAgreementStatusFlags(uint256 _id) external view returns (bool hasRefund, bool isLate) {
        return (agreementRefunded[_id], agreementLateCompleted[_id]);
    }

    /// @notice Reads the exact block timestamp when carrier submitted proof for a milestone
    /// @param _id Agreement ID to query
    /// @param _msIndex Milestone index: 0 for Pickup, 1 for Final Delivery
    /// @return Unix timestamp of submission (0 if not submitted yet)
    function getMilestoneSubmissionTime(uint256 _id, uint8 _msIndex) external view returns (uint256) {
        return milestoneSubmittedTimestamp[_id][_msIndex];
    }

    /// @notice Reads cargo specification and routing details for an agreement
    /// @param _id Agreement ID to query
    /// @return cargoTitle Shipment title or description
    /// @return originLocation Origin dock address
    /// @return destLocation Destination facility address
    /// @return initialPhotoIpfs Shipper baseline inspection photo IPFS CID
    /// @return declaredValue Declared commercial value in MYR
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

    /// @notice Reads individual milestone status and IPFS inspection proof
    /// @param _id Agreement ID to query
    /// @param _msIndex Milestone index: 0 for Pickup, 1 for Final Delivery
    /// @return description Milestone description text
    /// @return payoutPercent Percentage of escrow allocated (30 or 70)
    /// @return completed True if carrier submitted proof
    /// @return approved True if shipper confirmed payout
    /// @return ipfsProofHash IPFS CID of inspection photo
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

    /// @notice Reads milestone rejection status, reason, and previous rejected photo hash
    /// @param _id Agreement ID to query
    /// @param _msIndex Milestone index: 0 for Pickup, 1 for Final Delivery
    /// @return rejected True if the milestone is currently in rejected state
    /// @return reason The reason string entered by the shipper
    /// @return lastRejectedProof The IPFS CID of the rejected photo
    function getMilestoneRejectionInfo(uint256 _id, uint8 _msIndex) external view returns (
        bool rejected,
        string memory reason,
        string memory lastRejectedProof
    ) {
        return (milestoneRejected[_id][_msIndex], milestoneRejectionReason[_id][_msIndex], milestoneLastRejectedProof[_id][_msIndex]);
    }

    /// @notice Returns the total count of registered carriers in the platform directory
    /// @return Number of registered carrier wallet addresses
    function getCarriersCount() external view returns (uint256) {
        return registeredCarriers.length;
    }
}
