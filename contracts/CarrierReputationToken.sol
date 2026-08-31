// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICarrierReputationToken {
    function mintReputation(address _carrier, uint256 _amount) external;
    function slashReputation(address _carrier, uint256 _amount) external;
    function balanceOf(address _account) external view returns (uint256);
}

contract CarrierReputationToken is ICarrierReputationToken {
    string public constant name = "Carrier Reputation Token";
    string public constant symbol = "CRT";
    uint8 public constant decimals = 18;

    address public owner;
    address public escrowContract;
    uint256 public totalSupply;

    mapping(address => uint256) private _balances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event EscrowContractUpdated(address indexed previousEscrow, address indexed newEscrow);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner can execute");
        _;
    }

    modifier onlyEscrow() {
        require(msg.sender == escrowContract, "Only authorized Escrow contract can modify reputation");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setEscrowContract(address _escrow) external onlyOwner {
        require(_escrow != address(0), "Invalid escrow contract address");
        emit EscrowContractUpdated(escrowContract, _escrow);
        escrowContract = _escrow;
    }

    function mintReputation(address _carrier, uint256 _amount) external override onlyEscrow {
        require(_carrier != address(0), "Cannot mint to zero address");
        uint256 tokenAmount = _amount * (10 ** uint256(decimals));
        totalSupply += tokenAmount;
        _balances[_carrier] += tokenAmount;
        emit Transfer(address(0), _carrier, tokenAmount);
    }

    function slashReputation(address _carrier, uint256 _amount) external override onlyEscrow {
        require(_carrier != address(0), "Cannot slash zero address");
        uint256 tokenAmount = _amount * (10 ** uint256(decimals));
        if (_balances[_carrier] < tokenAmount) {
            tokenAmount = _balances[_carrier];
        }
        if (tokenAmount > 0) {
            _balances[_carrier] -= tokenAmount;
            totalSupply -= tokenAmount;
            emit Transfer(_carrier, address(0), tokenAmount);
        }
    }

    function balanceOf(address _account) external view override returns (uint256) {
        return _balances[_account] / (10 ** uint256(decimals));
    }

    function rawBalanceOf(address _account) external view returns (uint256) {
        return _balances[_account];
    }
}
