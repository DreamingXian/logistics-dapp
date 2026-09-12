// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// ============================================================================
/// SECTION 1: INTERFACE DEFINITION (ICarrierReputationToken)
/// ============================================================================
/// @title ICarrierReputationToken
/// @notice Interface defining callable functions for the Carrier Reputation Token (CRT).
/// @dev Allows LogisticsEscrow.sol to call mint/slash functions without needing full contract code.
interface ICarrierReputationToken {
    /// @notice Mint (reward) reputation tokens to a carrier's wallet address
    /// @param _carrier The target carrier's Ethereum address
    /// @param _amount The integer amount of CRT tokens to reward (e.g. 50 or 100)
    function mintReputation(address _carrier, uint256 _amount) external;

    /// @notice Slash (penalize) reputation tokens from a carrier's wallet address
    /// @param _carrier The target carrier's Ethereum address
    /// @param _amount The integer amount of CRT tokens to deduct (e.g. 300)
    function slashReputation(address _carrier, uint256 _amount) external;

    /// @notice Read the human-readable CRT token balance of an account
    /// @param _account The wallet address to query
    /// @return The token balance as a whole integer
    function balanceOf(address _account) external view returns (uint256);
}

/// ============================================================================
/// SECTION 2: CONTRACT DEFINITION & STATE VARIABLES
/// ============================================================================
/// @title CarrierReputationToken (CRT)
/// @notice Non-transferable on-chain reputation token awarded or slashed based on delivery performance.
/// @dev Adheres to standard token metrics (18 decimals), but restricts mint/burn to LogisticsEscrow.
contract CarrierReputationToken is ICarrierReputationToken {

    // --- Token Metadata (Constants stored directly in contract bytecode to save gas) ---
    string public constant name = "Carrier Reputation Token"; // Human-readable token name
    string public constant symbol = "CRT";                    // Ticker symbol displayed in UI
    uint8 public constant decimals = 18;                      // 18 decimals (matches standard ERC-20 / ETH precision)

    // --- Administrative & Access Control Addresses ---
    address public owner;           // Address of the contract deployer (administrator)
    address public escrowContract;  // Authorized address of LogisticsEscrow.sol permitted to mint/slash
    uint256 public totalSupply;     // Total circulating token supply in wei-units (10^18)

    // --- Balances Mapping ---
    // Maps each user address to their internal balance in raw 18-decimal units
    // Private to prevent direct external manipulation; read via balanceOf() or rawBalanceOf()
    mapping(address => uint256) private _balances;

    /// ============================================================================
    /// SECTION 3: EVENTS (On-Chain Logging)
    /// ============================================================================
    // Emitted when tokens are created (from 0x0), destroyed (to 0x0), or transferred
    event Transfer(address indexed from, address indexed to, uint256 value);
    // Emitted when the contract owner binds or updates the authorized LogisticsEscrow address
    event EscrowContractUpdated(address indexed previousEscrow, address indexed newEscrow);

    /// ============================================================================
    /// SECTION 4: ACCESS CONTROL MODIFIERS
    /// ============================================================================
    /// @dev Restricts function execution to only the contract deployer (owner)
    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner can execute");
        _; // Continues execution of the decorated function
    }

    /// @dev Crucial security guard: Only the bound LogisticsEscrow contract can mint or slash tokens
    modifier onlyEscrow() {
        require(msg.sender == escrowContract, "Only authorized Escrow contract can modify reputation");
        _;
    }

    /// ============================================================================
    /// SECTION 5: CONSTRUCTOR & ESCROW CONFIGURATION
    /// ============================================================================
    /// @notice Constructor sets the deployer as the contract owner
    constructor() {
        owner = msg.sender;
    }

    /// @notice Link this reputation token to the deployed LogisticsEscrow contract
    /// @dev Can only be called by contract owner during initial setup or migration
    /// @param _escrow The Ethereum address of the deployed LogisticsEscrow contract
    function setEscrowContract(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Invalid escrow contract address");
        emit EscrowContractUpdated(escrowContract, _escrow);
        escrowContract = _escrow;
    }

    /// ============================================================================
    /// SECTION 6: REPUTATION MINTING & SLASHING (Core Business Logic)
    /// ============================================================================

    /// @notice Mint CRT tokens to reward carrier upon verified milestone completion
    /// @dev Multiplies whole token count by 10^18 to convert to standard 18-decimal units
    /// @param _carrier Carrier address to receive tokens
    /// @param _amount Whole number of tokens to mint (e.g., 50 for pickup, 100 for delivery)
    function mintReputation(address _carrier, uint256 _amount) external override onlyEscrow {
        require(_carrier != address(0), "Cannot mint to zero address");
        uint256 tokenAmount = _amount * (10 ** uint256(decimals));
        totalSupply += tokenAmount;
        _balances[_carrier] += tokenAmount;
        emit Transfer(address(0), _carrier, tokenAmount); // Emits mint event from 0x0
    }

    /// @notice Slash (burn) CRT tokens to penalize carrier for missed deadlines or defaults
    /// @dev Caps slash at current balance to prevent underflow error (balance cannot drop below 0)
    /// @param _carrier Carrier address to penalize
    /// @param _amount Whole number of tokens to slash (e.g., 300 for missed deadline)
    function slashReputation(address _carrier, uint256 _amount) external override onlyEscrow {
        require(_carrier != address(0), "Cannot slash zero address");
        uint256 tokenAmount = _amount * (10 ** uint256(decimals));
        
        // Safety check: if carrier has less than tokenAmount, only slash whatever they currently hold
        if (_balances[_carrier] < tokenAmount) {
            tokenAmount = _balances[_carrier];
        }
        
        if (tokenAmount > 0) {
            _balances[_carrier] -= tokenAmount;
            totalSupply -= tokenAmount;
            emit Transfer(_carrier, address(0), tokenAmount); // Emits burn event to 0x0
        }
    }

    /// ============================================================================
    /// SECTION 7: VIEW / GETTER FUNCTIONS
    /// ============================================================================

    /// @notice Get the human-readable CRT balance of an account (in whole tokens)
    /// @dev Divides internal 18-decimal balance by 10^18 for clean display in UI
    /// @param _account Wallet address to query
    /// @return Whole number token balance
    function balanceOf(address _account) external view override returns (uint256) {
        return _balances[_account] / (10 ** uint256(decimals));
    }

    /// @notice Get the raw token balance with all 18 decimals
    /// @param _account Wallet address to query
    /// @return Balance in smallest unit (wei-like 10^-18)
    function rawBalanceOf(address _account) external view returns (uint256) {
        return _balances[_account];
    }
}
