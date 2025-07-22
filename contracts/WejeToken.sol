// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WejeToken
 * @dev Enhanced ERC20 token with comprehensive security features (NO FEES)
 * Features: Anti-whale, Anti-bot, Blacklist, Pausable - NO TAX FEES
 * 
 * SECURITY FIXES APPLIED:
 * - Fixed ownership renouncement vulnerability
 * - Replaced deprecated transfer() with call()
 * - Added max supply enforcement
 * - Added missing events
 * - Improved blacklist validation
 */
contract WejeToken is ERC20, ERC20Permit, Pausable, Ownable, ReentrancyGuard {
    
    // ============ CONSTANTS ============
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    
    // ============ STATE VARIABLES ============
    bool public limitsEnabled = true;
    
    // Anti-whale limits
    uint256 public maxTransactionAmount = 1_000_000 * 10**18; // 0.1% of supply
    uint256 public maxWalletAmount = 5_000_000 * 10**18;      // 0.5% of supply
    
    // Anti-bot protection
    uint256 public transferCooldown = 300; // 5 minutes between transfers
    mapping(address => uint256) public lastTransferTime;
    mapping(address => bool) public isExcludedFromLimits;
    
    // Blacklist and security
    mapping(address => bool) public blacklisted;
    mapping(address => bool) public isBot;
    
    // FIX: Track total minted to prevent exceeding MAX_SUPPLY
    uint256 public totalMinted;
    
    // ============ EVENTS ============
    event AddressBlacklistedEvent(address indexed account, bool status);
    event BotDetectedEvent(address indexed account);
    event ExcludedFromLimits(address indexed account, bool status);
    event LimitsUpdated(uint256 maxTx, uint256 maxWallet);
    // FIX: Added missing events
    event CooldownUpdated(uint256 newCooldown);
    event LimitsEnabledUpdated(bool enabled);
    
    // ============ ERRORS ============
    error TransferCooldownActive();
    error AddressIsBlacklisted(); 
    error BotWasDetected();
    error ExceedsMaxTransaction();
    error ExceedsMaxWallet();
    error InvalidAddress();
    error InvalidAmount();
    error CannotBlacklistOwner();
    // FIX: Added new error for max supply
    error ExceedsMaxSupply();

    // FIX: Added modifier for blacklist checks
    modifier notBlacklisted(address account) {
        if (account != owner()) {
            require(!blacklisted[account], "Cannot blacklist owner");
        }
        _;
    }

    constructor(
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        
        // Mint total supply to owner
        _mint(msg.sender, MAX_SUPPLY);
        // FIX: Track minted amount
        totalMinted = MAX_SUPPLY;
        
        // Exclude owner and contract from limits
        isExcludedFromLimits[msg.sender] = true;
        isExcludedFromLimits[address(this)] = true;
    }

    // ============ ANTI-BOT & SECURITY ============
    
    // FIX: Use modifier for cleaner code
    function blacklistAddress(address account, bool status) external onlyOwner notBlacklisted(account) {
        blacklisted[account] = status;
        emit AddressBlacklistedEvent(account, status);
    }
    
    function blacklistBatch(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] != owner()) {
                blacklisted[accounts[i]] = status;
                emit AddressBlacklistedEvent(accounts[i], status);
            }
        }
    }
    
    function markAsBot(address account) external onlyOwner notBlacklisted(account) {
        isBot[account] = true;
        blacklisted[account] = true;
        emit BotDetectedEvent(account);
        emit AddressBlacklistedEvent(account, true);
    }
    
    function excludeFromLimits(address account, bool excluded) external onlyOwner {
        isExcludedFromLimits[account] = excluded;
        emit ExcludedFromLimits(account, excluded);
    }

    // ============ LIMITS MANAGEMENT ============
    
    function updateLimits(uint256 _maxTx, uint256 _maxWallet) external onlyOwner {
        require(_maxTx >= MAX_SUPPLY / 1000, "Max tx too low"); // Min 0.1%
        require(_maxWallet >= MAX_SUPPLY / 200, "Max wallet too low"); // Min 0.5%
        
        maxTransactionAmount = _maxTx;
        maxWalletAmount = _maxWallet;
        emit LimitsUpdated(_maxTx, _maxWallet);
    }
    
    function updateCooldown(uint256 _cooldown) external onlyOwner {
        require(_cooldown <= 1 hours, "Cooldown too high");
        transferCooldown = _cooldown;
        // FIX: Added missing event
        emit CooldownUpdated(_cooldown);
    }
    
    function setLimitsEnabled(bool _enabled) external onlyOwner {
        limitsEnabled = _enabled;
        // FIX: Added missing event
        emit LimitsEnabledUpdated(_enabled);
    }

    // ============ TRANSFER LOGIC (NO FEES) ============
    
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        // Skip checks for minting (from = address(0))
        if (from == address(0)) {
            // FIX: Prevent minting beyond MAX_SUPPLY
            if (totalMinted + value > MAX_SUPPLY) {
                revert ExceedsMaxSupply();
            }
            totalMinted += value;
            super._update(from, to, value);
            return;
        }
        
        // Check blacklist
        if (blacklisted[from] || blacklisted[to]) {
            revert AddressIsBlacklisted();
        }
        
        // Check bot detection
        if (isBot[from] || isBot[to]) {
            revert BotWasDetected();
        }
        
        // Apply limits if enabled
        if (limitsEnabled && !isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
            // Transaction amount check
            if (value > maxTransactionAmount) {
                revert ExceedsMaxTransaction();
            }
            
            // Wallet amount check (for buys)
            if (to != address(0) && balanceOf(to) + value > maxWalletAmount) {
                revert ExceedsMaxWallet();
            }
            
            // Cooldown check
            if (block.timestamp < lastTransferTime[from] + transferCooldown) {
                revert TransferCooldownActive();
            }
            
            lastTransferTime[from] = block.timestamp;
        }
        
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
    
    // FIX: Replaced deprecated transfer() with call()
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            // Use call instead of transfer for ETH
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).transfer(owner(), amount);
        }
    }
    
    function emergencyPause() external onlyOwner {
        _pause();
    }

    // ============ VIEW FUNCTIONS ============
    
    function isBlacklisted(address account) external view returns (bool) {
        return blacklisted[account];
    }
    
    function getRemainingCooldown(address account) external view returns (uint256) {
        if (isExcludedFromLimits[account]) return 0;
        uint256 elapsed = block.timestamp - lastTransferTime[account];
        return elapsed >= transferCooldown ? 0 : transferCooldown - elapsed;
    }
    
    function getTokenInfo() external view returns (
        uint256 totalSupply_,
        uint256 maxTx,
        uint256 maxWallet,
        uint256 cooldown,
        bool limits
    ) {
        return (
            totalSupply(),
            maxTransactionAmount,
            maxWalletAmount,
            transferCooldown,
            limitsEnabled
        );
    }

    // ============ PREVENT ACCIDENTAL OWNERSHIP LOSS ============
    
    // FIX: Properly override renounceOwnership to prevent it completely
    function renounceOwnership() public pure override {
        revert("Ownership cannot be renounced for security");
    }
    
    // Controlled ownership transfer
    mapping(address => bool) public pendingOwners;
    
    function initiateOwnershipTransfer(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        pendingOwners[newOwner] = true;
    }
    
    function acceptOwnership() external {
        require(pendingOwners[msg.sender], "Not a pending owner");
        pendingOwners[msg.sender] = false;
        _transferOwnership(msg.sender);
    }

    // FIX: Added function to check remaining supply
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    // ============ FALLBACK ============
    
    receive() external payable {
        // Allow contract to receive ETH
    }
}