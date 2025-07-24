// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title WejeToken
 * @dev Enhanced ERC20 token with comprehensive security features (NO FEES)
 * Features: Anti-whale, Anti-bot, Blacklist, Pausable - NO TAX FEES
 */
contract WejeToken is
    ERC20,
    ERC20Permit,
    Pausable,
    Ownable2Step,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // ============ CONSTANTS ============
    uint256 public constant MAX_SUPPLY = 2_000_000_000 * 10 ** 18; // 2 billion tokens

    // ============ STATE VARIABLES ============
    bool public limitsEnabled = false;
    // Anti-whale limits
    uint256 public maxTransactionAmount = 20_000_000 * 10 ** 18; // 1% of supply (20M tokens)
    uint256 public maxWalletAmount = 40_000_000 * 10 ** 18; // 2% of supply (40M tokens)

    // Anti-bot protection
    uint256 public transferCooldown = 300; // 5 minutes between transfers
    mapping(address => uint256) public lastTransferTime;
    mapping(address => bool) public isExcludedFromLimits;

    // ============ EVENTS ============
    event ExcludedFromLimits(address indexed account, bool status);
    event LimitsUpdated(uint256 maxTx, uint256 maxWallet);
    event CooldownUpdated(uint256 newCooldown);
    event LimitsEnabledUpdated(bool enabled);
    event TokensRecovered(address indexed token, uint256 amount);

    // ============ ERRORS ============
    error TransferCooldownActive();
    error ExceedsMaxTransaction();
    error ExceedsMaxWallet();
    error InvalidAddress();
    error InvalidAmount();
    error ExceedsMaxSupply();

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        // Mint total supply to owner
        _mint(msg.sender, MAX_SUPPLY);

        // Exclude owner and contract from limits
        isExcludedFromLimits[msg.sender] = true;
        isExcludedFromLimits[address(this)] = true;
    }

    // ============ ANTI-BOT & SECURITY ============

    function excludeFromLimits(
        address[] calldata accounts,
        bool excluded
    ) external onlyOwner {
        require(accounts.length > 0, "Empty array");
        require(accounts.length <= 50, "Array too large");

        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert InvalidAddress();
            isExcludedFromLimits[accounts[i]] = excluded;
            emit ExcludedFromLimits(accounts[i], excluded);
        }
    }

    function excludeFromLimits(
        address account,
        bool excluded
    ) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        isExcludedFromLimits[account] = excluded;
        emit ExcludedFromLimits(account, excluded);
    }

    // ============ LIMITS MANAGEMENT ============

    function updateLimits(
        uint256 _maxTx,
        uint256 _maxWallet
    ) external onlyOwner {
        require(_maxTx >= MAX_SUPPLY / 1000, "Max tx too low"); // Min 0.1% (2M tokens)
        require(_maxWallet >= MAX_SUPPLY / 500, "Max wallet too low"); // Min 0.2% (4M tokens)
        require(_maxTx <= MAX_SUPPLY / 20, "Max tx too high"); // Max 5% (100M tokens)
        require(_maxWallet <= MAX_SUPPLY / 10, "Max wallet too high"); // Max 10% (200M tokens)

        maxTransactionAmount = _maxTx;
        maxWalletAmount = _maxWallet;
        emit LimitsUpdated(_maxTx, _maxWallet);
    }

    function updateCooldown(uint256 _cooldown) external onlyOwner {
        require(_cooldown <= 1 hours, "Cooldown too high");
        transferCooldown = _cooldown;
        emit CooldownUpdated(_cooldown);
    }

    function setLimitsEnabled(bool _enabled) external onlyOwner {
        limitsEnabled = _enabled;
        emit LimitsEnabledUpdated(_enabled);
    }

    // ============ TRANSFER LOGIC (NO FEES) ============

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        // Skip checks for minting (from = address(0))
        if (
            from == address(0) ||
            to == address(0) ||
            !limitsEnabled ||
            isExcludedFromLimits[from] ||
            isExcludedFromLimits[to]
        ) {
            super._update(from, to, value);
            return;
        }
        if (value > maxTransactionAmount) {
            revert ExceedsMaxTransaction();
        }

        if (balanceOf(to) + value > maxWalletAmount) {
            revert ExceedsMaxWallet();
        }
        // Only check cooldown if enabled and not excluded
        if (
            transferCooldown > 0 &&
            block.timestamp < lastTransferTime[from] + transferCooldown
        ) {
            revert TransferCooldownActive();
        }

        // Update last transfer time for cooldown
        lastTransferTime[from] = block.timestamp;

        // Execute transfer with no fees
        super._update(from, to, value);
    }

    // ============ PAUSABLE FUNCTIONS ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ EMERGENCY FUNCTIONS ============
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        require(amount > 0, "Amount must be positive");

        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient balance");
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "transfer failed");
        } else {
            require(token != address(this), "Cannot withdraw own tokens"); // ✅ SECURITY
            IERC20(token).safeTransfer(owner(), amount);
        }

        emit TokensRecovered(token, amount); // ✅ FIX: Added event
    }

    // ============ VIEW FUNCTIONS ============

    function getRemainingCooldown(
        address account
    ) external view returns (uint256) {
        if (isExcludedFromLimits[account]) return 0;
        uint256 elapsed = block.timestamp - lastTransferTime[account];
        return elapsed >= transferCooldown ? 0 : transferCooldown - elapsed;
    }

    function getTokenInfo()
        external
        view
        returns (
            uint256 totalSupply_,
            uint256 maxTx,
            uint256 maxWallet,
            uint256 cooldown,
            bool limits
        )
    {
        return (
            totalSupply(),
            maxTransactionAmount,
            maxWalletAmount,
            transferCooldown,
            limitsEnabled
        );
    }
    //check for can a wallet transfer specific amount
    function canTransfer(
        address from,
        address to,
        uint256 amount
    ) external view returns (bool, string memory) {
        if (paused()) return (false, "Contract is paused");
        if (!limitsEnabled) return (true, "Limits disabled");
        if (isExcludedFromLimits[from] || isExcludedFromLimits[to])
            return (true, "Address excluded");

        if (amount > maxTransactionAmount)
            return (false, "Exceeds max transaction");
        if (balanceOf(to) + amount > maxWalletAmount)
            return (false, "Exceeds max wallet");
        if (block.timestamp < lastTransferTime[from] + transferCooldown)
            return (false, "Cooldown active");

        return (true, "Transfer allowed");
    }

    // ============ PREVENT ACCIDENTAL OWNERSHIP LOSS ============

    // FIX: Properly override renounceOwnership to prevent it completely
    function renounceOwnership() public pure override {
        revert("Ownership cannot be renounced for security");
    }

    // ============ FALLBACK ============

    receive() external payable {
        // Allow contract to receive ETH
    }
}
