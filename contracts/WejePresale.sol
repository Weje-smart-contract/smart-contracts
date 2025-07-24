// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title WejePresale
 * @dev Multi-tier presale contract with direct token transfer
 */
contract WejePresale is ReentrancyGuard, Pausable, Ownable2Step {
    using SafeERC20 for IERC20;

    // ============ STATE VARIABLES ============
    
    IERC20 public immutable wejeToken;
    IERC20 public immutable usdcToken;
    IERC20 public immutable usdtToken;

     // ============ CONSTANTS ============
    uint256 public constant MAX_TIERS = 5;
    uint256 public constant PRECISION_MULTIPLIER = 1e18;
    
    struct PresaleTier {
        uint256 price;           // Price per token in USDC (6 decimals)
        uint256 tokensAvailable; // Tokens available in this tier
        uint256 tokensSold;      // Tokens sold in this tier
        uint256 minPurchase;     // Minimum purchase in USDC
        uint256 maxPurchase;     // Maximum purchase in USDC
        bool isActive;           // Tier is active
        string name;             // Tier name
    }
    
    // Presale tiers
    mapping(uint256 => PresaleTier) public tiers;
    uint256 public currentTier = 1;
    
    // User purchases (tracking for analytics)
    mapping(address => uint256) public userPurchases; // Total USDC contributed
    mapping(address => uint256) public userTokensReceived; // Total WEJE received
    
    // Referral system -
    mapping(address => address) public referrers;
    mapping(address => uint256) public referralRewards;
    mapping(address => uint256) public totalReferrals;
    mapping(address => bool) public validReferrers; // FIX: Track valid referrers
    uint256 public referralBonus = 500; // 5% bonus for referrer
    uint256 public minReferrerPurchase = 1000 * 10**6; // Min $1000 to be referrer
    
    // Presale settings
    uint256 public presaleStartTime;
    uint256 public presaleEndTime;
    uint256 public totalRaised;
    uint256 public totalTokensSold;
    uint256 public totalParticipants;
  

    
    // Goals and caps
    uint256 public softCap = 3_000_000 * 10**6; // $3M soft cap
    uint256 public hardCap = 6_500_000 * 10**6; // $6.5M hard cap
    bool public softCapReached = false;
    bool public hardCapReached = false;
    
    // ============ EVENTS ============
    event TokensPurchased(
        address indexed buyer,
        uint256 tier,
        uint256 usdcAmount,
        uint256 tokenAmount,
        address paymentToken,
        address referrer
    );
    event TierActivated(uint256 tierNumber);
    event TierCompleted(uint256 tierNumber);
    event PriceUpdated(string token, uint256 newPrice, uint256 deviation);
    event SoftCapReached(uint256 totalRaised);
    event HardCapReached(uint256 totalRaised);
    event ReferralRewarded(address indexed referrer, address indexed referee, uint256 reward);
    event EmergencyWithdraw(address indexed token, uint256 amount);
    event ValidReferrerAdded(address indexed referrer);
    event PresaleTimesUpdated(uint256 startTime, uint256 endTime);
    event TierParamsUpdated(uint256 indexed tierNumber, uint256 price, uint256 tokensAvailable);
    event CapsUpdated(uint256 softCap, uint256 hardCap);
    event ReferralBonusUpdated(uint256 newBonus);
    
    // ============ ERRORS ============
    error PresaleNotActive();
    error PresaleEnded();
    error TierNotActive();
    error InsufficientTokensInTier();
    error PurchaseAmountTooLow();
    error PurchaseAmountTooHigh();
    error InvalidTier();
    error InvalidAmount();
    error HardCapExceeded();
    error InvalidReferrer();
    error InsufficientTokenBalance();
    error InvalidReferrerStatus();
    error ZeroAddress();           // ✅ FIX: Added zero address validation
    error PrecisionLoss();         // ✅ FIX: Added precision loss detection
    error InvalidTimeRange();
    error InvalidPriceRange();

     modifier validAddress(address _addr) {
        if (_addr == address(0)) revert ZeroAddress();
        _;
    }

    constructor(
        address _wejeToken,
        address _usdcToken,
        address _usdtToken,
        uint256 _presaleStartTime,
        uint256 _presaleEndTime
    ) Ownable(msg.sender) {
        require(_presaleStartTime > block.timestamp, "Start time must be future");
        require(_presaleEndTime > _presaleStartTime, "Invalid time range");
        require(_presaleEndTime <= block.timestamp + 365 days, "End time too far");

        wejeToken = IERC20(_wejeToken);
        usdcToken = IERC20(_usdcToken);
        usdtToken = IERC20(_usdtToken);
        
        presaleStartTime = _presaleStartTime;
        presaleEndTime = _presaleEndTime;
        
        _initializeTiers();
         emit PresaleTimesUpdated(_presaleStartTime, _presaleEndTime);
    }

    // ============ INITIALIZATION ============
    
    function _initializeTiers() private {
        // Tier 1: $0.0083, 30M tokens
        tiers[1] = PresaleTier({
            price: 8300, // $0.0083 in micro-USDC (6 decimals)
            tokensAvailable: 30_000_000 * 10**18,
            tokensSold: 0,
            minPurchase: 20 * 10**6, // $20
            maxPurchase: 50_000 * 10**6, // $50,000
            isActive: true,
            name: "Angels"
        });
        
        // Tier 2: $0.015, 40M tokens
        tiers[2] = PresaleTier({
            price: 15000, // $0.0150
            tokensAvailable: 50_000_000 * 10**18,
            tokensSold: 0,
            minPurchase: 20 * 10**6,
            maxPurchase: 100_000 * 10**6, // $100,000
            isActive: false,
            name: "Pre-Seed"
        });
        
        // Tier 3: $0.025, 50M tokens
        tiers[3] = PresaleTier({
            price: 25000, // $0.0250
            tokensAvailable: 60_000_000 * 10**18,
            tokensSold: 0,
            minPurchase: 20 * 10**6,
            maxPurchase: 150_000 * 10**6, // $150,000
            isActive: false,
            name: "Seed"
        });
        
        // Tier 4: $0.0333, 30M tokens
        tiers[4] = PresaleTier({
            price: 33300, // $0.0333
            tokensAvailable: 60_000_000 * 10**18,
            tokensSold: 0,
            minPurchase: 20 * 10**6,
            maxPurchase: 200_000 * 10**6, // $200,000
            isActive: false,
            name: "Series A"
        });

         tiers[5] = PresaleTier({
            price: 40000, // $0.0400
            tokensAvailable: 50_000_000 * 10**18,
            tokensSold: 0,
            minPurchase: 20 * 10**6,
            maxPurchase: 500_000 * 10**6, // $200,000
            isActive: false,
            name: "Public"
        });
    }

    // ============ PURCHASE FUNCTIONS ============
    
    function purchaseWithUSDC(uint256 usdcAmount, address referrer) external nonReentrant whenNotPaused {
        _purchase(msg.sender, usdcAmount, address(usdcToken), referrer);
        usdcToken.safeTransferFrom(msg.sender, address(this), usdcAmount);
    }
    
    function purchaseWithUSDT(uint256 usdtAmount, address referrer) external nonReentrant whenNotPaused {
        _purchase(msg.sender, usdtAmount, address(usdtToken), referrer);
        usdtToken.safeTransferFrom(msg.sender, address(this), usdtAmount);
    }
    

    function _purchase(address buyer, uint256 usdcAmount, address paymentToken, address referrer) private {
        // FIX: Optimized validation order - check caps first to save gas
        if (hardCapReached || totalRaised + usdcAmount > hardCap) {
            revert HardCapExceeded();
        }
        
        // Validate presale is active
        if (block.timestamp < presaleStartTime) revert PresaleNotActive();
        if (block.timestamp > presaleEndTime) revert PresaleEnded();
        
        if (usdcAmount == 0) revert InvalidAmount();

        // Get current active tier
        PresaleTier storage tier = tiers[currentTier];
        if (!tier.isActive) revert TierNotActive();
        
        // Validate purchase amount
        if (usdcAmount < tier.minPurchase) revert PurchaseAmountTooLow();
        if (userPurchases[buyer] + usdcAmount > tier.maxPurchase) revert PurchaseAmountTooHigh();
        
        // FIX: Calculate tokens with better precision (multiply before divide)
        uint256 totalTokens = _calculateTokensWithPrecision(usdcAmount, tier.price);
        
        // Check if tier has enough tokens
        if (tier.tokensSold + totalTokens > tier.tokensAvailable) {
            revert InsufficientTokensInTier();
        }
        
        // Check if contract has enough tokens
        if (wejeToken.balanceOf(address(this)) < totalTokens) {
            revert InsufficientTokenBalance();
        }
        
        // Handle referral - FIX: Enhanced validation
        address finalReferrer = _handleReferral(buyer, referrer, usdcAmount);
        
        // Update state
        tier.tokensSold += totalTokens;
        totalTokensSold += totalTokens;
        totalRaised += usdcAmount;
        
        // Track user data
        if (userPurchases[buyer] == 0) {
            totalParticipants++;
        }
        userPurchases[buyer] += usdcAmount;
        userTokensReceived[buyer] += totalTokens;
        
        // DIRECT TRANSFER: Send tokens immediately to buyer
        wejeToken.safeTransfer(buyer, totalTokens);
        
        // Handle referral rewards if any
        if (finalReferrer != address(0)) {
            uint256 referralReward = (usdcAmount * referralBonus) / 10000;
            uint256 referralTokens = _calculateTokensWithPrecision(referralReward, tier.price);
            
            if (wejeToken.balanceOf(address(this)) >= referralTokens) {
                wejeToken.safeTransfer(finalReferrer, referralTokens);
                referralRewards[finalReferrer] += referralTokens;
            }
        }
        
        // Check milestones
        _checkMilestones();
       
        
        // Check if tier is sold out and activate next tier
        if (tier.tokensSold >= tier.tokensAvailable && currentTier < MAX_TIERS) {
            tier.isActive = false;
            emit TierCompleted(currentTier);
            
            currentTier++;
            tiers[currentTier].isActive = true;
            emit TierActivated(currentTier);
        }
        
        emit TokensPurchased(buyer, currentTier, usdcAmount, totalTokens, paymentToken, finalReferrer);
    }

    function _calculateTokensWithPrecision(uint256 usdcAmount, uint256 price) private pure returns (uint256) {
        if (usdcAmount == 0) return 0;
        
        // Use high precision arithmetic: (amount * 10^18 * PRECISION) / (price * PRECISION)
        uint256 tokens = (usdcAmount * 10**18 * PRECISION_MULTIPLIER) / (price * PRECISION_MULTIPLIER);
        
        // Ensure meaningful result
        if (tokens == 0 && usdcAmount > 0) {
            revert PrecisionLoss();
        }
        
        return tokens;
    }
    
    function _handleReferral(
        address buyer, 
        address referrer, 
        uint256 usdcAmount
    ) private returns (address) {
         if (referrer == address(0) || 
            referrer == buyer || 
            !validReferrers[referrer] || 
            userPurchases[referrer] < minReferrerPurchase ||
            referrers[buyer] != address(0)) {
            return address(0);
        }
        
        referrers[buyer] = referrer;
        totalReferrals[referrer]++;
        
        emit ReferralRewarded(referrer, buyer, (usdcAmount * referralBonus) / 10000);
        return referrer;
    }

    function _checkMilestones() private {
        if (!softCapReached && totalRaised >= softCap) {
            softCapReached = true;
            emit SoftCapReached(totalRaised);
        }
        
        if (!hardCapReached && totalRaised >= hardCap) {
            hardCapReached = true;
            emit HardCapReached(totalRaised);
        }
    }

    // ============ ADMIN FUNCTIONS ============

    function setValidReferrer(address referrer, bool valid) external onlyOwner validAddress(referrer) {
        validReferrers[referrer] = valid;
        emit ValidReferrerAdded(referrer);
    }
    
     function updatePresaleTimes(
        uint256 _presaleStartTime,
        uint256 _presaleEndTime
    ) external onlyOwner {
        require(_presaleStartTime > block.timestamp, "Start time must be future");
        require(_presaleEndTime > _presaleStartTime, "Invalid time range");

        presaleStartTime = _presaleStartTime;
        presaleEndTime = _presaleEndTime;
        emit PresaleTimesUpdated(_presaleStartTime, _presaleEndTime);
    }
    
   function activateTier(uint256 tierNumber) external onlyOwner {
        if (tierNumber == 0 || tierNumber > MAX_TIERS) revert InvalidTier();
        
        // Deactivate current tier
        if (currentTier > 0 && currentTier <= MAX_TIERS) {
            tiers[currentTier].isActive = false;
        }
        
        // Activate new tier
        currentTier = tierNumber;
        tiers[tierNumber].isActive = true;
        
        emit TierActivated(tierNumber);
    }
    
     function updateTierParams(
        uint256 tierNumber,
        uint256 price,
        uint256 tokensAvailable,
        uint256 minPurchase,
        uint256 maxPurchase
    ) external onlyOwner {
        if (tierNumber == 0 || tierNumber > MAX_TIERS) revert InvalidTier();
        require(price > 0, "Price must be positive");
        require(tokensAvailable > 0, "Tokens must be positive");
        require(minPurchase > 0 && minPurchase <= maxPurchase, "Invalid purchase limits");
        
        PresaleTier storage tier = tiers[tierNumber];
        tier.price = price;
        tier.tokensAvailable = tokensAvailable;
        tier.minPurchase = minPurchase;
        tier.maxPurchase = maxPurchase;
        
        emit TierParamsUpdated(tierNumber, price, tokensAvailable);
    }
    
     function updateCaps(uint256 _softCap, uint256 _hardCap) external onlyOwner {
        require(_softCap > 0 && _softCap < _hardCap, "Invalid caps");
        
        softCap = _softCap;
        hardCap = _hardCap;
        
        emit CapsUpdated(_softCap, _hardCap);
    }
    
     function updateReferralBonus(uint256 _bonus) external onlyOwner {
        require(_bonus <= 1000, "Bonus too high"); // Max 10%
        
        referralBonus = _bonus;
        emit ReferralBonusUpdated(_bonus);
    }

    // ============ EMERGENCY FUNCTIONS ============
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    function emergencyWithdrawTokens(address token, uint256 amount, string calldata reason) 
        external 
        onlyOwner 
    {
        require(bytes(reason).length > 0, "Reason required");
        require(amount > 0, "Amount must be positive");
        
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient ETH balance");
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
        
        emit EmergencyWithdraw(token, amount);
    }
    
    function emergencyWithdrawAll() external onlyOwner {
        // Withdraw stablecoins
        uint256 usdcBalance = usdcToken.balanceOf(address(this));
        if (usdcBalance > 0) {
            usdcToken.safeTransfer(owner(), usdcBalance);
            emit EmergencyWithdraw(address(usdcToken), usdcBalance);
        }
        
        uint256 usdtBalance = usdtToken.balanceOf(address(this));
        if (usdtBalance > 0) {
            usdtToken.safeTransfer(owner(), usdtBalance);
            emit EmergencyWithdraw(address(usdtToken), usdtBalance);
        }
        
        // Withdraw remaining WEJE tokens
        uint256 wejeBalance = wejeToken.balanceOf(address(this));
        if (wejeBalance > 0) {
            wejeToken.safeTransfer(owner(), wejeBalance);
            emit EmergencyWithdraw(address(wejeToken), wejeBalance);
        }
    }

    // ============ VIEW FUNCTIONS ============
    
     function getCurrentTierInfo() external view returns (
        uint256 tierNumber,
        string memory name,
        uint256 price,
        uint256 tokensAvailable,
        uint256 tokensSold,
        uint256 tokensRemaining,
        uint256 minPurchase,
        uint256 maxPurchase,
        bool isActive
    ) {
        PresaleTier memory tier = tiers[currentTier];
        return (
            currentTier,
            tier.name,
            tier.price,
            tier.tokensAvailable,
            tier.tokensSold,
            tier.tokensAvailable - tier.tokensSold,
            tier.minPurchase,
            tier.maxPurchase,
            tier.isActive
        );
    }
    
    function getTierInfo(uint256 tierNumber) external view returns (
        string memory name,
        uint256 price,
        uint256 tokensAvailable,
        uint256 tokensSold,
        uint256 tokensRemaining,
        uint256 minPurchase,
        uint256 maxPurchase,
        bool isActive
    ) {
        PresaleTier memory tier = tiers[tierNumber];
        return (
            tier.name,
            tier.price,
            tier.tokensAvailable,
            tier.tokensSold,
            tier.tokensAvailable - tier.tokensSold,
            tier.minPurchase,
            tier.maxPurchase,
            tier.isActive
        );
    }
    
    
    function getUserInfo(address user) external view returns (
        uint256 totalPurchased,
        uint256 totalTokensReceived,
        uint256 referralRewards_,
        address referrer,
        uint256 totalReferrals_,
        uint256 remainingPurchaseCapacity
    ) {
        PresaleTier memory tier = tiers[currentTier];
        uint256 remaining = tier.maxPurchase > userPurchases[user] 
            ? tier.maxPurchase - userPurchases[user] 
            : 0;
            
        return (
            userPurchases[user],
            userTokensReceived[user],
            referralRewards[user],
            referrers[user],
            totalReferrals[user],
            remaining
        );
    }
    
   function getPresaleProgress() external view returns (
        uint256 totalRaisedAmount,
        uint256 totalTokensSoldAmount,
        uint256 totalParticipants_,
        uint256 currentTierNumber,
        uint256 presaleStartTimestamp,
        uint256 presaleEndTimestamp,
        bool isPresaleActive,
        bool softCapReached_,
        bool hardCapReached_,
        uint256 progressPercentage
    ) {
        bool isActive = block.timestamp >= presaleStartTime && 
                       block.timestamp <= presaleEndTime && 
                       !hardCapReached;
        
        uint256 progress = hardCap > 0 ? (totalRaised * 100) / hardCap : 0;
        
        return (
            totalRaised,
            totalTokensSold,
            totalParticipants,
            currentTier,
            presaleStartTime,
            presaleEndTime,
            isActive,
            softCapReached,
            hardCapReached,
            progress
        );
    }
    
    function calculateTokensForUSDC(uint256 usdcAmount) external view returns (
        uint256 totalTokens,
        uint256 tierNumber,
        string memory tierName,
        uint256 pricePerToken
    ) {
        require(usdcAmount > 0, "Amount must be positive");
        
        PresaleTier memory tier = tiers[currentTier];
        uint256 tokens = _calculateTokensWithPrecision(usdcAmount, tier.price);
        
        return (tokens, currentTier, tier.name, tier.price);
    }
    
    function getContractStats() external view returns (
        uint256 totalRaised_,
        uint256 totalTokensSold_,
        uint256 totalParticipants_,
        uint256 softCap_,
        uint256 hardCap_,
        bool softCapReached_,
        bool hardCapReached_,
        uint256 contractTokenBalance,
        uint256 contractUSDCBalance,
        uint256 contractUSDTBalance
    ) {
        return (
            totalRaised,
            totalTokensSold,
            totalParticipants,
            softCap,
            hardCap,
            softCapReached,
            hardCapReached,
            wejeToken.balanceOf(address(this)),
            usdcToken.balanceOf(address(this)),
            usdtToken.balanceOf(address(this))
        );
    }
    
    
    function getAllTiersInfo() external view returns (
        uint256[] memory tierNumbers,
        string[] memory names,
        uint256[] memory prices,
        uint256[] memory tokensAvailable,
        uint256[] memory tokensSold,
        bool[] memory isActive
    ) {
        tierNumbers = new uint256[](MAX_TIERS);
        names = new string[](MAX_TIERS);
        prices = new uint256[](MAX_TIERS);
        tokensAvailable = new uint256[](MAX_TIERS);
        tokensSold = new uint256[](MAX_TIERS);
        isActive = new bool[](MAX_TIERS);
        
        for (uint256 i = 1; i <= MAX_TIERS; i++) {
            PresaleTier memory tier = tiers[i];
            tierNumbers[i-1] = i;
            names[i-1] = tier.name;
            prices[i-1] = tier.price;
            tokensAvailable[i-1] = tier.tokensAvailable;
            tokensSold[i-1] = tier.tokensSold;
            isActive[i-1] = tier.isActive;
        }
    }

    // ============ RECEIVE FUNCTIONS ============
    
    receive() external payable {
        revert("Direct ETH not accepted. Use USDC/USDT only");
    }
    
    fallback() external payable {
        revert("Function not found");
    }
}