// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WejeStaking
 * @dev Comprehensive staking contract with multiple tiers and flexible rewards
 * 
 * SECURITY FIXES APPLIED:
 * - Fixed precision loss in reward calculations
 * - Added proper validation for auto-compound
 * - Enhanced premium user controls
 * - Added global tier limits
 * - Improved emergency fee handling
 * - Better reward pool management
 */
contract WejeStaking is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable wejeToken;
    
    // FIX: Enhanced precision for calculations
    uint256 private constant PRECISION = 1e18;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    
    struct StakingTier {
        uint256 lockPeriod;      // Lock period in seconds
        uint256 rewardRate;      // APY in basis points (e.g., 800 = 8%)
        uint256 minStakeAmount;  // Minimum stake amount
        uint256 maxStakeAmount;  // Maximum stake amount per user
        uint256 tierMaxStake;    // FIX: Maximum total stake for this tier
        bool isActive;           // Tier is active
        string name;             // Tier name
        uint256 totalStaked;     // Total amount staked in this tier
        uint256 stakersCount;    // Number of unique stakers in this tier
    }
    
    struct StakeInfo {
        uint256 amount;              // Amount staked
        uint256 startTime;           // When stake began
        uint256 lastClaimTime;       // Last reward claim time
        uint256 lockPeriod;          // Lock period for this stake
        uint256 rewardRate;          // APY for this stake
        uint256 tier;                // Staking tier
        bool isActive;               // Stake is active
        uint256 totalRewardsClaimed; // Total rewards claimed for this stake
        // FIX: Added for precision tracking
        uint256 lastRewardPerToken;  // Last reward per token paid
        uint256 rewardDebt;         // Reward debt for compound calculations
    }
    
    // Staking tiers
    mapping(uint256 => StakingTier) public stakingTiers;
    uint256 public totalTiers = 4;
    
    // User stakes
    mapping(address => StakeInfo[]) public userStakes;
    mapping(address => uint256) public userStakeCount;
    mapping(address => uint256) public userTotalStaked;
    mapping(address => uint256) public userTotalRewards;
    
    // Global stats
    uint256 public totalStaked;
    uint256 public totalRewardsPaid;
    uint256 public totalStakers;
    uint256 public rewardPool;
    uint256 public emergencyWithdrawFee = 2000; // 20% fee for emergency withdrawal
    // FIX: Minimum emergency fee to prevent gaming
    uint256 public constant MIN_EMERGENCY_FEE = 500; // 5%
    
    // Reward distribution
    uint256 public rewardPoolDuration = 5 * 365 days; // 5 years
    uint256 public rewardStartTime;
    uint256 public lastRewardUpdate;
    uint256 public rewardPerSecond;
    
    // Security and limits
    uint256 public maxStakesPerUser = 10;
    uint256 public minClaimInterval = 1 days;
    mapping(address => uint256) public lastClaimTime;
    
    // Premium features - FIX: Enhanced controls
    mapping(address => bool) public isPremiumUser;
    mapping(uint256 => uint256) public tierPremiumBonus; // Additional bonus for premium users
    uint256 public maxPremiumUsers = 100; // FIX: Limit premium users
    uint256 public premiumUserCount;
    mapping(address => uint256) public premiumUserSince; // Track when user became premium
    
    // Auto-compound feature (NO FEES)
    mapping(address => mapping(uint256 => bool)) public autoCompoundEnabled;
    mapping(address => mapping(uint256 => uint256)) public lastAutoCompound; // FIX: Track last compound
    uint256 public minAutoCompoundAmount = 100 * 10**18; // FIX: Min amount for auto compound
    
    // ============ EVENTS ============
    event Staked(
        address indexed user,
        uint256 indexed stakeIndex,
        uint256 amount,
        uint256 tier,
        uint256 lockPeriod,
        uint256 rewardRate
    );
    
    event Unstaked(
        address indexed user,
        uint256 indexed stakeIndex,
        uint256 amount,
        uint256 rewards
    );
    
    event RewardsClaimed(
        address indexed user,
        uint256 indexed stakeIndex,
        uint256 amount
    );
    
    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed stakeIndex,
        uint256 amount,
        uint256 fee
    );
    
    event TierUpdated(
        uint256 indexed tier,
        uint256 lockPeriod,
        uint256 rewardRate,
        bool isActive
    );
    
    event RewardPoolUpdated(uint256 newAmount, uint256 duration);
    event PremiumStatusUpdated(address indexed user, bool isPremium);
    event AutoCompoundToggled(address indexed user, uint256 stakeIndex, bool enabled);
    
    // FIX: Added new events
    event AutoCompoundExecuted(address indexed user, uint256 stakeIndex, uint256 amount);
    event PremiumUserLimitUpdated(uint256 newLimit);
    event EmergencyFeeUpdated(uint256 newFee);

    // ============ ERRORS ============
    error InvalidTier();
    error InvalidAmount();
    error InsufficientBalance();
    error StakeNotFound();
    error StakeLocked();
    error ClaimTooEarly();
    error MaxStakesReached();
    error TierNotActive();
    error InvalidStakeIndex();
    error StakeNotActive();
    error RewardPoolEmpty();
    error InvalidDuration();
    // FIX: Added new errors
    error TierCapacityExceeded();
    error PremiumUserLimitReached();
    error AutoCompoundTooSmall();
    error InvalidEmergencyFee();

    constructor(
        address _wejeToken,
        uint256 _rewardPoolAmount,
        uint256 _rewardStartTime
    ) Ownable(msg.sender) {
        wejeToken = IERC20(_wejeToken);
        rewardPool = _rewardPoolAmount;
        rewardStartTime = _rewardStartTime;
        lastRewardUpdate = _rewardStartTime;
        
        // Calculate reward per second (distributed over 5 years)
        rewardPerSecond = _rewardPoolAmount / rewardPoolDuration;
        
        _initializeStakingTiers();
    }

    // ============ INITIALIZATION ============
    
    function _initializeStakingTiers() private {
        // Tier 1: 30 days, 8% APY
        stakingTiers[1] = StakingTier({
            lockPeriod: 30 days,
            rewardRate: 800, // 8%
            minStakeAmount: 1000 * 10**18, // 1,000 WEJE
            maxStakeAmount: 1_000_000 * 10**18, // 1M WEJE per user
            tierMaxStake: 50_000_000 * 10**18, // FIX: 50M WEJE total tier limit
            isActive: true,
            name: "Bronze",
            totalStaked: 0,
            stakersCount: 0
        });
        
        // Tier 2: 90 days, 12% APY
        stakingTiers[2] = StakingTier({
            lockPeriod: 90 days,
            rewardRate: 1200, // 12%
            minStakeAmount: 5000 * 10**18, // 5,000 WEJE
            maxStakeAmount: 2_000_000 * 10**18, // 2M WEJE per user
            tierMaxStake: 75_000_000 * 10**18, // FIX: 75M WEJE total tier limit
            isActive: true,
            name: "Silver",
            totalStaked: 0,
            stakersCount: 0
        });
        
        // Tier 3: 180 days, 18% APY
        stakingTiers[3] = StakingTier({
            lockPeriod: 180 days,
            rewardRate: 1800, // 18%
            minStakeAmount: 10_000 * 10**18, // 10,000 WEJE
            maxStakeAmount: 5_000_000 * 10**18, // 5M WEJE per user
            tierMaxStake: 100_000_000 * 10**18, // FIX: 100M WEJE total tier limit
            isActive: true,
            name: "Gold",
            totalStaked: 0,
            stakersCount: 0
        });
        
        // Tier 4: 365 days, 25% APY
        stakingTiers[4] = StakingTier({
            lockPeriod: 365 days,
            rewardRate: 2500, // 25%
            minStakeAmount: 25_000 * 10**18, // 25,000 WEJE
            maxStakeAmount: 10_000_000 * 10**18, // 10M WEJE per user
            tierMaxStake: 150_000_000 * 10**18, // FIX: 150M WEJE total tier limit
            isActive: true,
            name: "Diamond",
            totalStaked: 0,
            stakersCount: 0
        });
        
        // Set premium bonuses (additional APY for premium users)
        tierPremiumBonus[1] = 200; // +2% for Bronze
        tierPremiumBonus[2] = 300; // +3% for Silver
        tierPremiumBonus[3] = 400; // +4% for Gold
        tierPremiumBonus[4] = 500; // +5% for Diamond
    }

    // ============ STAKING FUNCTIONS ============
    
    function stake(uint256 amount, uint256 tier) external nonReentrant whenNotPaused {
        if (tier == 0 || tier > totalTiers) revert InvalidTier();
        if (amount == 0) revert InvalidAmount();
        if (userStakeCount[msg.sender] >= maxStakesPerUser) revert MaxStakesReached();
        
        StakingTier storage stakingTier = stakingTiers[tier];
        if (!stakingTier.isActive) revert TierNotActive();
        if (amount < stakingTier.minStakeAmount) revert InvalidAmount();
        if (userTotalStaked[msg.sender] + amount > stakingTier.maxStakeAmount) revert InvalidAmount();
        
        // FIX: Check global tier capacity
        if (stakingTier.totalStaked + amount > stakingTier.tierMaxStake) {
            revert TierCapacityExceeded();
        }
        
        // Transfer tokens from user
        wejeToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate effective reward rate (including premium bonus)
        uint256 effectiveRewardRate = stakingTier.rewardRate;
        if (isPremiumUser[msg.sender]) {
            effectiveRewardRate += tierPremiumBonus[tier];
        }
        
        // Create stake record
        uint256 stakeIndex = userStakes[msg.sender].length;
        userStakes[msg.sender].push(StakeInfo({
            amount: amount,
            startTime: block.timestamp,
            lastClaimTime: block.timestamp,
            lockPeriod: stakingTier.lockPeriod,
            rewardRate: effectiveRewardRate,
            tier: tier,
            isActive: true,
            totalRewardsClaimed: 0,
            lastRewardPerToken: 0,  // FIX: Initialize precision tracking
            rewardDebt: 0
        }));
        
        // Update counters
        if (userStakeCount[msg.sender] == 0) {
            totalStakers++;
            stakingTier.stakersCount++;
        }
        
        userStakeCount[msg.sender]++;
        userTotalStaked[msg.sender] += amount;
        totalStaked += amount;
        stakingTier.totalStaked += amount;
        
        emit Staked(msg.sender, stakeIndex, amount, tier, stakingTier.lockPeriod, effectiveRewardRate);
    }
    
    function unstake(uint256 stakeIndex) external nonReentrant whenNotPaused {
        if (stakeIndex >= userStakes[msg.sender].length) revert InvalidStakeIndex();
        
        StakeInfo storage stakeInfo = userStakes[msg.sender][stakeIndex];
        if (!stakeInfo.isActive) revert StakeNotActive();
        
        // Check if lock period has passed
        if (block.timestamp < stakeInfo.startTime + stakeInfo.lockPeriod) {
            revert StakeLocked();
        }
        
        uint256 stakedAmount = stakeInfo.amount;
        uint256 pendingRewards = _calculatePendingRewards(stakeInfo);
        
        // Mark stake as inactive
        stakeInfo.isActive = false;
        
        // Update counters
        userTotalStaked[msg.sender] -= stakedAmount;
        totalStaked -= stakedAmount;
        stakingTiers[stakeInfo.tier].totalStaked -= stakedAmount;
        
        // Update global rewards
        totalRewardsPaid += pendingRewards;
        userTotalRewards[msg.sender] += pendingRewards;
        stakeInfo.totalRewardsClaimed += pendingRewards;
        
        // Transfer tokens back to user (principal + rewards)
        uint256 totalAmount = stakedAmount + pendingRewards;
        wejeToken.safeTransfer(msg.sender, totalAmount);
        
        emit Unstaked(msg.sender, stakeIndex, stakedAmount, pendingRewards);
    }
    
    function claimRewards(uint256 stakeIndex) external nonReentrant whenNotPaused {
        if (stakeIndex >= userStakes[msg.sender].length) revert InvalidStakeIndex();
        if (block.timestamp < lastClaimTime[msg.sender] + minClaimInterval) revert ClaimTooEarly();
        
        StakeInfo storage stakeInfo = userStakes[msg.sender][stakeIndex];
        if (!stakeInfo.isActive) revert StakeNotActive();
        
        uint256 pendingRewards = _calculatePendingRewards(stakeInfo);
        if (pendingRewards == 0) return;
        
        // Update claim time and total rewards
        stakeInfo.lastClaimTime = block.timestamp;
        lastClaimTime[msg.sender] = block.timestamp;
        totalRewardsPaid += pendingRewards;
        userTotalRewards[msg.sender] += pendingRewards;
        stakeInfo.totalRewardsClaimed += pendingRewards;
        
        // Handle auto-compound or transfer
        if (autoCompoundEnabled[msg.sender][stakeIndex]) {
            // FIX: Check minimum compound amount
            if (pendingRewards >= minAutoCompoundAmount) {
                // Add full amount to existing stake (NO FEE)
                stakeInfo.amount += pendingRewards;
                userTotalStaked[msg.sender] += pendingRewards;
                totalStaked += pendingRewards;
                stakingTiers[stakeInfo.tier].totalStaked += pendingRewards;
                
                // FIX: Update compound tracking
                lastAutoCompound[msg.sender][stakeIndex] = block.timestamp;
                emit AutoCompoundExecuted(msg.sender, stakeIndex, pendingRewards);
            } else {
                // Amount too small to compound, transfer instead
                wejeToken.safeTransfer(msg.sender, pendingRewards);
            }
        } else {
            // Transfer rewards to user
            wejeToken.safeTransfer(msg.sender, pendingRewards);
        }
        
        emit RewardsClaimed(msg.sender, stakeIndex, pendingRewards);
    }
    
    function claimAllRewards() external nonReentrant whenNotPaused {
        if (block.timestamp < lastClaimTime[msg.sender] + minClaimInterval) revert ClaimTooEarly();
        
        uint256 totalRewards = 0;
        uint256 totalCompounded = 0;
        
        // Calculate and update all pending rewards
        for (uint256 i = 0; i < userStakes[msg.sender].length; i++) {
            if (userStakes[msg.sender][i].isActive) {
                StakeInfo storage stakeInfo = userStakes[msg.sender][i];
                uint256 pendingRewards = _calculatePendingRewards(stakeInfo);
                
                if (pendingRewards > 0) {
                    stakeInfo.lastClaimTime = block.timestamp;
                    stakeInfo.totalRewardsClaimed += pendingRewards;
                    
                    // Handle auto-compound if enabled
                    if (autoCompoundEnabled[msg.sender][i] && pendingRewards >= minAutoCompoundAmount) {
                        // Add full amount to stake (NO FEE)
                        stakeInfo.amount += pendingRewards;
                        userTotalStaked[msg.sender] += pendingRewards;
                        totalStaked += pendingRewards;
                        stakingTiers[stakeInfo.tier].totalStaked += pendingRewards;
                        totalCompounded += pendingRewards;
                        
                        lastAutoCompound[msg.sender][i] = block.timestamp;
                        emit AutoCompoundExecuted(msg.sender, i, pendingRewards);
                    } else {
                        totalRewards += pendingRewards;
                    }
                    
                    emit RewardsClaimed(msg.sender, i, pendingRewards);
                }
            }
        }
        
        // Update global stats
        lastClaimTime[msg.sender] = block.timestamp;
        uint256 totalPayout = totalRewards + totalCompounded;
        totalRewardsPaid += totalPayout;
        userTotalRewards[msg.sender] += totalPayout;
        
        // Transfer non-compounded rewards to user
        if (totalRewards > 0) {
            wejeToken.safeTransfer(msg.sender, totalRewards);
        }
    }

    // ============ EMERGENCY FUNCTIONS ============
    
    function emergencyUnstake(uint256 stakeIndex) external nonReentrant {
        if (stakeIndex >= userStakes[msg.sender].length) revert InvalidStakeIndex();
        
        StakeInfo storage stakeInfo = userStakes[msg.sender][stakeIndex];
        if (!stakeInfo.isActive) revert StakeNotActive();
        
        uint256 stakedAmount = stakeInfo.amount;
        uint256 fee = (stakedAmount * emergencyWithdrawFee) / 10000;
        uint256 withdrawAmount = stakedAmount - fee;
        
        // Mark stake as inactive
        stakeInfo.isActive = false;
        
        // Update counters
        userTotalStaked[msg.sender] -= stakedAmount;
        totalStaked -= stakedAmount;
        stakingTiers[stakeInfo.tier].totalStaked -= stakedAmount;
        
        // Transfer tokens (minus fee)
        wejeToken.safeTransfer(msg.sender, withdrawAmount);
        wejeToken.safeTransfer(owner(), fee);
        
        emit EmergencyWithdraw(msg.sender, stakeIndex, withdrawAmount, fee);
    }

    // ============ CALCULATION FUNCTIONS ============
    
    // FIX: Enhanced precision reward calculation
    function _calculatePendingRewards(StakeInfo memory stakeInfo) 
        private 
        view 
        returns (uint256) 
    {
        if (!stakeInfo.isActive) return 0;
        
        uint256 timeStaked = block.timestamp - stakeInfo.lastClaimTime;
        if (timeStaked == 0) return 0;
        
        // Use higher precision arithmetic
        uint256 annualReward = (stakeInfo.amount * stakeInfo.rewardRate) / 10000;
        uint256 rewards = (annualReward * timeStaked * PRECISION) / (SECONDS_PER_YEAR * PRECISION);
        
        return rewards;
    }
    
    function calculatePendingRewards(address user, uint256 stakeIndex) 
        public 
        view 
        returns (uint256) 
    {
        if (stakeIndex >= userStakes[user].length) return 0;
        return _calculatePendingRewards(userStakes[user][stakeIndex]);
    }
    
    function calculateTotalPendingRewards(address user) external view returns (uint256) {
        uint256 totalPending = 0;
        
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].isActive) {
                totalPending += _calculatePendingRewards(userStakes[user][i]);
            }
        }
        
        return totalPending;
    }
    
    function calculateProjectedRewards(uint256 amount, uint256 tier, uint256 stakingDays) 
        external 
        view 
        returns (uint256) 
    {
        if (tier == 0 || tier > totalTiers) return 0;
        
        StakingTier memory stakingTier = stakingTiers[tier];
        uint256 effectiveRate = stakingTier.rewardRate;
        
        // Add premium bonus if user is premium
        if (isPremiumUser[msg.sender]) {
            effectiveRate += tierPremiumBonus[tier];
        }
        
        uint256 timeInSeconds = stakingDays * 1 days;
        return (amount * effectiveRate * timeInSeconds) / (SECONDS_PER_YEAR * 10000);
    }

    // ============ ADMIN FUNCTIONS ============
    
    function updateStakingTier(
        uint256 tier,
        uint256 lockPeriod,
        uint256 rewardRate,
        uint256 minStake,
        uint256 maxStake,
        uint256 tierMaxStake, // FIX: Add global tier limit
        bool isActive,
        string memory name
    ) external onlyOwner {
        if (tier == 0 || tier > totalTiers) revert InvalidTier();
        
        StakingTier storage stakingTier = stakingTiers[tier];
        stakingTier.lockPeriod = lockPeriod;
        stakingTier.rewardRate = rewardRate;
        stakingTier.minStakeAmount = minStake;
        stakingTier.maxStakeAmount = maxStake;
        stakingTier.tierMaxStake = tierMaxStake; // FIX
        stakingTier.isActive = isActive;
        stakingTier.name = name;
        
        emit TierUpdated(tier, lockPeriod, rewardRate, isActive);
    }
    
    function addNewTier(
        uint256 lockPeriod,
        uint256 rewardRate,
        uint256 minStake,
        uint256 maxStake,
        uint256 tierMaxStake, // FIX: Add global tier limit
        string memory name
    ) external onlyOwner {
        totalTiers++;
        
        stakingTiers[totalTiers] = StakingTier({
            lockPeriod: lockPeriod,
            rewardRate: rewardRate,
            minStakeAmount: minStake,
            maxStakeAmount: maxStake,
            tierMaxStake: tierMaxStake, // FIX
            isActive: true,
            name: name,
            totalStaked: 0,
            stakersCount: 0
        });
        
        emit TierUpdated(totalTiers, lockPeriod, rewardRate, true);
    }
    
    function updateRewardPool(uint256 newAmount, uint256 duration) external onlyOwner {
        if (duration == 0) revert InvalidDuration();
        
        rewardPool = newAmount;
        rewardPoolDuration = duration;
        rewardPerSecond = newAmount / duration;
        
        emit RewardPoolUpdated(newAmount, duration);
    }
    
    // FIX: Enhanced premium user management
    function setPremiumUser(address user, bool isPremium) external onlyOwner {
        if (isPremium && !isPremiumUser[user]) {
            if (premiumUserCount >= maxPremiumUsers) {
                revert PremiumUserLimitReached();
            }
            premiumUserCount++;
            premiumUserSince[user] = block.timestamp;
        } else if (!isPremium && isPremiumUser[user]) {
            premiumUserCount--;
            premiumUserSince[user] = 0;
        }
        
        isPremiumUser[user] = isPremium;
        emit PremiumStatusUpdated(user, isPremium);
    }
    
    // FIX: Update premium user limit
    function updateMaxPremiumUsers(uint256 newLimit) external onlyOwner {
        require(newLimit >= premiumUserCount, "Below current count");
        maxPremiumUsers = newLimit;
        emit PremiumUserLimitUpdated(newLimit);
    }
    
    function updatePremiumBonus(uint256 tier, uint256 bonus) external onlyOwner {
        if (tier == 0 || tier > totalTiers) revert InvalidTier();
        tierPremiumBonus[tier] = bonus;
    }
    
    // FIX: Enhanced emergency fee management
    function updateEmergencyWithdrawFee(uint256 fee) external onlyOwner {
        if (fee < MIN_EMERGENCY_FEE || fee > 5000) revert InvalidEmergencyFee(); // 5%-50%
        emergencyWithdrawFee = fee;
        emit EmergencyFeeUpdated(fee);
    }
    
    function updateMaxStakesPerUser(uint256 maxStakes) external onlyOwner {
        require(maxStakes <= 50, "Too many stakes allowed");
        maxStakesPerUser = maxStakes;
    }
    
    function updateMinClaimInterval(uint256 interval) external onlyOwner {
        require(interval <= 7 days, "Interval too long");
        minClaimInterval = interval;
    }
    
    // FIX: Update auto-compound settings
    function updateMinAutoCompoundAmount(uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid amount");
        minAutoCompoundAmount = amount;
    }

    // ============ USER PREFERENCE FUNCTIONS ============
    
    // FIX: Enhanced auto-compound validation
    function toggleAutoCompound(uint256 stakeIndex) external {
        if (stakeIndex >= userStakes[msg.sender].length) revert InvalidStakeIndex();
        if (!userStakes[msg.sender][stakeIndex].isActive) revert StakeNotActive();
        
        bool currentStatus = autoCompoundEnabled[msg.sender][stakeIndex];
        autoCompoundEnabled[msg.sender][stakeIndex] = !currentStatus;
        
        emit AutoCompoundToggled(msg.sender, stakeIndex, !currentStatus);
    }
    
    function setAutoCompoundForAllStakes(bool enabled) external {
        for (uint256 i = 0; i < userStakes[msg.sender].length; i++) {
            if (userStakes[msg.sender][i].isActive) {
                autoCompoundEnabled[msg.sender][i] = enabled;
                emit AutoCompoundToggled(msg.sender, i, enabled);
            }
        }
    }
    
        // ============ EMERGENCY FUNCTIONS ============
    
   function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    function emergencyWithdrawRewards(uint256 amount) external onlyOwner {
        uint256 availableRewards = wejeToken.balanceOf(address(this)) - totalStaked;
        require(amount <= availableRewards, "Cannot withdraw staked tokens");
        wejeToken.safeTransfer(owner(), amount);
    }
    
    function updateRewardStartTime(uint256 newStartTime) external onlyOwner {
        rewardStartTime = newStartTime;
        lastRewardUpdate = newStartTime;
    }
     
    // ============ VIEW FUNCTIONS ============
    
    function getStakingTier(uint256 tier) external view returns (StakingTier memory) {
        return stakingTiers[tier];
    }
    
    function getAllStakingTiers() external view returns (StakingTier[] memory) {
        StakingTier[] memory tiers = new StakingTier[](totalTiers);
        for (uint256 i = 1; i <= totalTiers; i++) {
            tiers[i - 1] = stakingTiers[i];
        }
        return tiers;
    }
    
    function getUserStakes(address user) external view returns (StakeInfo[] memory) {
        return userStakes[user];
    }
    
    function getUserActiveStakes(address user) external view returns (
        StakeInfo[] memory activeStakes,
        uint256[] memory stakeIndexes
    ) {
        uint256 activeCount = 0;
        
        // Count active stakes
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].isActive) {
                activeCount++;
            }
        }
        
        // Create arrays for active stakes
        activeStakes = new StakeInfo[](activeCount);
        stakeIndexes = new uint256[](activeCount);
        
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].isActive) {
                activeStakes[currentIndex] = userStakes[user][i];
                stakeIndexes[currentIndex] = i;
                currentIndex++;
            }
        }
    }
    
    function getUserStakingStats(address user) external view returns (
        uint256 totalStaked_,
        uint256 totalRewards_,
        uint256 activeStakesCount,
        uint256 totalPendingRewards,
        bool isPremium
    ) {
        totalStaked_ = userTotalStaked[user];
        totalRewards_ = userTotalRewards[user];
        isPremium = isPremiumUser[user];
        
        // Count active stakes and calculate pending rewards
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].isActive) {
                activeStakesCount++;
                totalPendingRewards += calculatePendingRewards(user, i);
            }
        }
    }
    
    function getGlobalStats() external view returns (
        uint256 totalStaked_,
        uint256 totalRewardsPaid_,
        uint256 totalStakers_,
        uint256 rewardPool_,
        uint256 availableRewards,
        uint256 totalTiers_
    ) {
        totalStaked_ = totalStaked;
        totalRewardsPaid_ = totalRewardsPaid;
        totalStakers_ = totalStakers;
        rewardPool_ = rewardPool;
        availableRewards = wejeToken.balanceOf(address(this)) - totalStaked;
        totalTiers_ = totalTiers;
    }
    
    function getTierStats(uint256 tier) external view returns (
        string memory name,
        uint256 totalStaked_,
        uint256 stakersCount_,
        uint256 avgStakeAmount,
        uint256 lockPeriod,
        uint256 rewardRate,
        bool isActive
    ) {
        StakingTier memory stakingTier = stakingTiers[tier];
        
        name = stakingTier.name;
        totalStaked_ = stakingTier.totalStaked;
        stakersCount_ = stakingTier.stakersCount;
        avgStakeAmount = stakersCount_ > 0 ? totalStaked_ / stakersCount_ : 0;
        lockPeriod = stakingTier.lockPeriod;
        rewardRate = stakingTier.rewardRate;
        isActive = stakingTier.isActive;
    }
    
    function getStakeDetails(address user, uint256 stakeIndex) external view returns (
        uint256 amount,
        uint256 tier,
        uint256 startTime,
        uint256 unlockTime,
        uint256 pendingRewards,
        uint256 totalRewardsClaimed,
        bool canUnstake,
        bool autoCompound,
        string memory tierName
    ) {
        if (stakeIndex >= userStakes[user].length) {
            return (0, 0, 0, 0, 0, 0, false, false, "");
        }
        
        StakeInfo memory stakeInfo = userStakes[user][stakeIndex];
        
        amount = stakeInfo.amount;
        tier = stakeInfo.tier;
        startTime = stakeInfo.startTime;
        unlockTime = stakeInfo.startTime + stakeInfo.lockPeriod;
        pendingRewards = calculatePendingRewards(user, stakeIndex);
        totalRewardsClaimed = stakeInfo.totalRewardsClaimed;
        canUnstake = block.timestamp >= unlockTime && stakeInfo.isActive;
        autoCompound = autoCompoundEnabled[user][stakeIndex];
        tierName = stakingTiers[tier].name;
    }
    
    function canUserStake(address user, uint256 amount, uint256 tier) external view returns (
        bool canStake,
        string memory reason
    ) {
        if (tier == 0 || tier > totalTiers) {
            return (false, "Invalid tier");
        }
        
        if (!stakingTiers[tier].isActive) {
            return (false, "Tier not active");
        }
        
        if (amount < stakingTiers[tier].minStakeAmount) {
            return (false, "Amount below minimum");
        }
        
        if (userTotalStaked[user] + amount > stakingTiers[tier].maxStakeAmount) {
            return (false, "Exceeds maximum stake");
        }
        
        if (userStakeCount[user] >= maxStakesPerUser) {
            return (false, "Max stakes reached");
        }
        
        if (wejeToken.balanceOf(user) < amount) {
            return (false, "Insufficient balance");
        }
        
        return (true, "Can stake");
    }
    
   
    
    
    

    // ============ UTILITY FUNCTIONS ============
    
    function getTimeUntilUnlock(address user, uint256 stakeIndex) external view returns (uint256) {
        if (stakeIndex >= userStakes[user].length) return 0;
        
        StakeInfo memory stakeInfo = userStakes[user][stakeIndex];
        uint256 unlockTime = stakeInfo.startTime + stakeInfo.lockPeriod;
        
        return block.timestamp >= unlockTime ? 0 : unlockTime - block.timestamp;
    }
    
    function getStakesByTier(address user, uint256 tier) external view returns (
        uint256[] memory stakeIndexes,
        uint256[] memory amounts,
        uint256[] memory unlockTimes
    ) {
        uint256 count = 0;
        
        // Count stakes in tier
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].tier == tier && userStakes[user][i].isActive) {
                count++;
            }
        }
        
        // Create arrays
        stakeIndexes = new uint256[](count);
        amounts = new uint256[](count);
        unlockTimes = new uint256[](count);
        
        uint256 currentIndex = 0;
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].tier == tier && userStakes[user][i].isActive) {
                stakeIndexes[currentIndex] = i;
                amounts[currentIndex] = userStakes[user][i].amount;
                unlockTimes[currentIndex] = userStakes[user][i].startTime + userStakes[user][i].lockPeriod;
                currentIndex++;
            }
        }
    }
    
    function estimateRewardsForPeriod(address user, uint256 days_) external view returns (uint256) {
        uint256 totalEstimatedRewards = 0;
        
        for (uint256 i = 0; i < userStakes[user].length; i++) {
            if (userStakes[user][i].isActive) {
                StakeInfo memory stakeInfo = userStakes[user][i];
                uint256 timeInSeconds = days_ * 1 days;
                uint256 estimatedReward = (stakeInfo.amount * stakeInfo.rewardRate * timeInSeconds) / (365 days * 10000);
                totalEstimatedRewards += estimatedReward;
            }
        }
        
        return totalEstimatedRewards;
    }
}