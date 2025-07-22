// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title WejeVesting
 * @dev Comprehensive vesting contract for team, advisors, and investors
 */
contract WejeVesting is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable wejeToken;

    struct VestingSchedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 cliffDuration;
        uint256 vestingDuration;
        uint256 startTime;
        uint256 released;
        bool revocable;
        bool revoked;
        string category; // "team", "advisor", "investor", etc.
        uint256 tgePercent; // Token Generation Event immediate release (basis points)
    }

    // Vesting schedules
    mapping(bytes32 => VestingSchedule) public vestingSchedules;
    mapping(address => uint256) public holdersVestingCount;
    mapping(address => bytes32[]) public holderToSchedules;
    
    // Categories and limits
    mapping(string => uint256) public categoryTotalAllocated;
    mapping(string => uint256) public categoryMaxAllocation;
    mapping(string => uint256) public categoryVestingCount;
    
    // Global stats
    uint256 public totalVestingSchedules;
    uint256 public totalTokensVested;
    uint256 public totalTokensReleased;
    uint256 public totalBeneficiaries;
    
    // Security features
    mapping(address => bool) public authorizedCreators;
    mapping(address => uint256) public lastClaimTime;
    uint256 public claimCooldown = 1 days; // Prevent claim spamming
    
    // Emergency features
    bool public emergencyMode = false;
    address public emergencyRecipient;

    // ============ EVENTS ============
    event VestingScheduleCreated(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        string category,
        uint256 tgePercent
    );
    
    event TokensReleased(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 amount,
        uint256 totalReleased
    );
    
    event VestingRevoked(
        bytes32 indexed scheduleId,
        address indexed beneficiary,
        uint256 unvestedAmount
    );
    
    event CategoryCreated(string category, uint256 maxAllocation);
    event AuthorizedCreatorUpdated(address indexed creator, bool authorized);
    event EmergencyModeToggled(bool enabled);
    event ClaimCooldownUpdated(uint256 newCooldown);

    // ============ ERRORS ============
    error InvalidBeneficiary();
    error InvalidAmount();
    error InvalidDuration();
    error ScheduleNotFound();
    error NotRevocable();
    error AlreadyRevoked();
    error NoTokensToRelease();
    error InsufficientBalance();
    error UnauthorizedCreator();
    error CategoryNotExists();
    error ExceedsCategoryLimit();
    error ClaimCooldownActive();
    error EmergencyModeActive();
    error InvalidTGEPercent();
    error NotBeneficiary();
    error InvalidCategory();

    modifier onlyAuthorized() {
        if (!authorizedCreators[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedCreator();
        }
        _;
    }

    modifier notInEmergency() {
        if (emergencyMode) {
            revert EmergencyModeActive();
        }
        _;
    }

    constructor(address _wejeToken, address _emergencyRecipient) Ownable(msg.sender) {
        wejeToken = IERC20(_wejeToken);
        emergencyRecipient = _emergencyRecipient;
        authorizedCreators[msg.sender] = true;
        
        _initializeCategories();
    }

    // ============ INITIALIZATION ============
    
    function _initializeCategories() private {
        // Set up default categories with allocations (120M total for vesting)
        _createCategory("team", 80_000_000 * 10**18);      // 80M for team
        _createCategory("advisor", 25_000_000 * 10**18);   // 25M for advisors
        _createCategory("investor", 15_000_000 * 10**18);  // 15M for early investors
    }
    
    function _createCategory(string memory category, uint256 maxAllocation) private {
        categoryMaxAllocation[category] = maxAllocation;
        emit CategoryCreated(category, maxAllocation);
    }

    // ============ ADMIN FUNCTIONS ============
    
    function createCategory(string memory category, uint256 maxAllocation) external onlyOwner {
        require(categoryMaxAllocation[category] == 0, "Category already exists");
        _createCategory(category, maxAllocation);
    }
    
    function updateCategoryLimit(string memory category, uint256 newLimit) external onlyOwner {
        require(categoryMaxAllocation[category] > 0, "Category doesn't exist");
        require(newLimit >= categoryTotalAllocated[category], "Limit below allocated");
        categoryMaxAllocation[category] = newLimit;
    }
    
    function setAuthorizedCreator(address creator, bool authorized) external onlyOwner {
        authorizedCreators[creator] = authorized;
        emit AuthorizedCreatorUpdated(creator, authorized);
    }
    
    function setClaimCooldown(uint256 _cooldown) external onlyOwner {
        require(_cooldown <= 7 days, "Cooldown too long");
        claimCooldown = _cooldown;
        emit ClaimCooldownUpdated(_cooldown);
    }

    // ============ VESTING SCHEDULE CREATION ============
    // FIXED: Changed from external to public to allow internal calls
    function createVestingSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        bool revocable,
        string memory category,
        uint256 tgePercent
    ) public onlyAuthorized notInEmergency whenNotPaused returns (bytes32) {
        
        // Validation
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (totalAmount == 0) revert InvalidAmount();
        if (vestingDuration == 0) revert InvalidDuration();
        if (categoryMaxAllocation[category] == 0) revert CategoryNotExists();
        if (tgePercent > 5000) revert InvalidTGEPercent(); // Max 50% TGE
        
        // Check category limits
        if (categoryTotalAllocated[category] + totalAmount > categoryMaxAllocation[category]) {
            revert ExceedsCategoryLimit();
        }
        
        // Check contract balance
        uint256 availableBalance = wejeToken.balanceOf(address(this)) - 
                                   (totalTokensVested - totalTokensReleased);
        if (availableBalance < totalAmount) {
            revert InsufficientBalance();
        }

        bytes32 scheduleId = keccak256(
            abi.encodePacked(
                beneficiary,
                totalAmount,
                cliffDuration,
                vestingDuration,
                block.timestamp,
                totalVestingSchedules,
                category
            )
        );

        vestingSchedules[scheduleId] = VestingSchedule({
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            startTime: block.timestamp,
            released: 0,
            revocable: revocable,
            revoked: false,
            category: category,
            tgePercent: tgePercent
        });

        // Update tracking
        if (holdersVestingCount[beneficiary] == 0) {
            totalBeneficiaries++;
        }
        holdersVestingCount[beneficiary]++;
        holderToSchedules[beneficiary].push(scheduleId);
        totalVestingSchedules++;
        totalTokensVested += totalAmount;
        categoryTotalAllocated[category] += totalAmount;
        categoryVestingCount[category]++;

        // Handle TGE release
        if (tgePercent > 0) {
            uint256 tgeAmount = (totalAmount * tgePercent) / 10000;
            vestingSchedules[scheduleId].released = tgeAmount;
            totalTokensReleased += tgeAmount;
            wejeToken.safeTransfer(beneficiary, tgeAmount);
        }

        emit VestingScheduleCreated(
            scheduleId,
            beneficiary,
            totalAmount,
            cliffDuration,
            vestingDuration,
            category,
            tgePercent
        );

        return scheduleId;
    }

    // ============ BATCH CREATION FUNCTIONS ============

    function createTeamVesting(
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        string[] calldata roles
    ) external onlyAuthorized {
        require(beneficiaries.length == amounts.length, "Array length mismatch");
        require(beneficiaries.length == roles.length, "Array length mismatch");
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            // Team: 24 months cliff + 36 months vesting + 10% TGE
            createVestingSchedule(
                beneficiaries[i],
                amounts[i],
                730 days,  // 24 months cliff
                1095 days, // 36 months vesting
                true,      // revocable
                string(abi.encodePacked("team_", roles[i])),
                1000       // 10% TGE
            );
        }
    }

    function createAdvisorVesting(
        address[] calldata beneficiaries,
        uint256[] calldata amounts
    ) external onlyAuthorized {
        require(beneficiaries.length == amounts.length, "Array length mismatch");
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            // Advisors: 12 months cliff + 24 months vesting + 15% TGE
            createVestingSchedule(
                beneficiaries[i],
                amounts[i],
                365 days,  // 12 months cliff
                730 days,  // 24 months vesting
                true,      // revocable
                "advisor",
                1500       // 15% TGE
            );
        }
    }

    function createInvestorVesting(
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        uint256 cliffDuration,
        uint256 vestingDuration,
        string memory investorType
    ) external onlyAuthorized {
        require(beneficiaries.length == amounts.length, "Array length mismatch");
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            createVestingSchedule(
                beneficiaries[i],
                amounts[i],
                cliffDuration,
                vestingDuration,
                false,     // not revocable for investors
                string(abi.encodePacked("investor_", investorType)),
                2000       // 20% TGE for investors
            );
        }
    }

    // ============ TOKEN RELEASE ============

    function release(bytes32 scheduleId) external nonReentrant notInEmergency whenNotPaused {
        VestingSchedule storage schedule = vestingSchedules[scheduleId];
        
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        if (schedule.beneficiary != msg.sender) revert NotBeneficiary();
        if (schedule.revoked) revert AlreadyRevoked();
        
        // Check cooldown
        if (block.timestamp < lastClaimTime[msg.sender] + claimCooldown) {
            revert ClaimCooldownActive();
        }
        
        uint256 releasableAmount = _computeReleasableAmount(schedule);
        if (releasableAmount == 0) revert NoTokensToRelease();

        schedule.released += releasableAmount;
        totalTokensReleased += releasableAmount;
        lastClaimTime[msg.sender] = block.timestamp;

        wejeToken.safeTransfer(schedule.beneficiary, releasableAmount);

        emit TokensReleased(scheduleId, schedule.beneficiary, releasableAmount, schedule.released);
    }

    function releaseAll(address beneficiary) external nonReentrant notInEmergency whenNotPaused {
        require(beneficiary == msg.sender || msg.sender == owner(), "Unauthorized");
        
        // Check cooldown
        if (block.timestamp < lastClaimTime[beneficiary] + claimCooldown) {
            revert ClaimCooldownActive();
        }
        
        bytes32[] memory scheduleIds = holderToSchedules[beneficiary];
        uint256 totalReleasable = 0;

        for (uint256 i = 0; i < scheduleIds.length; i++) {
            VestingSchedule storage schedule = vestingSchedules[scheduleIds[i]];
            
            if (!schedule.revoked) {
                uint256 releasableAmount = _computeReleasableAmount(schedule);
                if (releasableAmount > 0) {
                    schedule.released += releasableAmount;
                    totalReleasable += releasableAmount;
                    
                    emit TokensReleased(scheduleIds[i], beneficiary, releasableAmount, schedule.released);
                }
            }
        }

        if (totalReleasable > 0) {
            totalTokensReleased += totalReleasable;
            lastClaimTime[beneficiary] = block.timestamp;
            wejeToken.safeTransfer(beneficiary, totalReleasable);
        }
    }

    // ============ REVOCATION ============

    function revoke(bytes32 scheduleId) external onlyOwner {
        VestingSchedule storage schedule = vestingSchedules[scheduleId];
        
        if (schedule.beneficiary == address(0)) revert ScheduleNotFound();
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        uint256 releasableAmount = _computeReleasableAmount(schedule);
        uint256 unvestedAmount = schedule.totalAmount - schedule.released - releasableAmount;

        schedule.revoked = true;
        totalTokensVested -= unvestedAmount;
        categoryTotalAllocated[schedule.category] -= unvestedAmount;

        // Release any currently vested tokens to beneficiary
        if (releasableAmount > 0) {
            schedule.released += releasableAmount;
            totalTokensReleased += releasableAmount;
            wejeToken.safeTransfer(schedule.beneficiary, releasableAmount);
        }

        emit VestingRevoked(scheduleId, schedule.beneficiary, unvestedAmount);
    }

    function batchRevoke(bytes32[] calldata scheduleIds) external onlyOwner {
        for (uint256 i = 0; i < scheduleIds.length; i++) {
            VestingSchedule storage schedule = vestingSchedules[scheduleIds[i]];
            
            if (schedule.beneficiary != address(0) && schedule.revocable && !schedule.revoked) {
                // Call internal revoke logic directly
                uint256 releasableAmount = _computeReleasableAmount(schedule);
                uint256 unvestedAmount = schedule.totalAmount - schedule.released - releasableAmount;

                schedule.revoked = true;
                totalTokensVested -= unvestedAmount;
                categoryTotalAllocated[schedule.category] -= unvestedAmount;

                // Release any currently vested tokens to beneficiary
                if (releasableAmount > 0) {
                    schedule.released += releasableAmount;
                    totalTokensReleased += releasableAmount;
                    wejeToken.safeTransfer(schedule.beneficiary, releasableAmount);
                }

                emit VestingRevoked(scheduleIds[i], schedule.beneficiary, unvestedAmount);
            }
        }
    }

    // ============ INTERNAL FUNCTIONS ============

    function _computeReleasableAmount(VestingSchedule memory schedule) 
        private 
        view 
        returns (uint256) 
    {
        if (schedule.revoked) return 0;
        
        uint256 currentTime = block.timestamp;
        uint256 cliffEnd = schedule.startTime + schedule.cliffDuration;
        uint256 vestingEnd = cliffEnd + schedule.vestingDuration;
        
        // Before cliff
        if (currentTime < cliffEnd) {
            return 0;
        }
        
        // After full vesting
        if (currentTime >= vestingEnd) {
            return schedule.totalAmount - schedule.released;
        }
        
        // During vesting period
        uint256 timeFromCliff = currentTime - cliffEnd;
        uint256 vestedAmount = schedule.totalAmount * timeFromCliff / schedule.vestingDuration;
        
        return vestedAmount - (schedule.released - (schedule.totalAmount * schedule.tgePercent / 10000));
    }

    // ============ BATCH OPERATIONS ============

    function batchCreateVesting(
        address[] calldata beneficiaries,
        uint256[] calldata amounts,
        uint256[] calldata cliffDurations,
        uint256[] calldata vestingDurations,
        bool[] calldata revocableFlags,
        string[] calldata categories,
        uint256[] calldata tgePercents
    ) external onlyAuthorized returns (bytes32[] memory) {
        require(beneficiaries.length == amounts.length, "Array length mismatch");
        require(beneficiaries.length == cliffDurations.length, "Array length mismatch");
        require(beneficiaries.length == vestingDurations.length, "Array length mismatch");
        require(beneficiaries.length == revocableFlags.length, "Array length mismatch");
        require(beneficiaries.length == categories.length, "Array length mismatch");
        require(beneficiaries.length == tgePercents.length, "Array length mismatch");
        
        bytes32[] memory scheduleIds = new bytes32[](beneficiaries.length);
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            scheduleIds[i] = createVestingSchedule(
                beneficiaries[i],
                amounts[i],
                cliffDurations[i],
                vestingDurations[i],
                revocableFlags[i],
                categories[i],
                tgePercents[i]
            );
        }
        
        return scheduleIds;
    }

    function batchRelease(bytes32[] calldata scheduleIds) external nonReentrant {
        for (uint256 i = 0; i < scheduleIds.length; i++) {
            VestingSchedule storage schedule = vestingSchedules[scheduleIds[i]];
            
            if (schedule.beneficiary == msg.sender && !schedule.revoked) {
                uint256 releasableAmount = _computeReleasableAmount(schedule);
                
                if (releasableAmount > 0) {
                    schedule.released += releasableAmount;
                    totalTokensReleased += releasableAmount;
                    
                    wejeToken.safeTransfer(schedule.beneficiary, releasableAmount);
                    emit TokensReleased(scheduleIds[i], schedule.beneficiary, releasableAmount, schedule.released);
                }
            }
        }
        
        lastClaimTime[msg.sender] = block.timestamp;
    }

    // ============ VIEW FUNCTIONS ============

    function getReleasableAmount(bytes32 scheduleId) external view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[scheduleId];
        return _computeReleasableAmount(schedule);
    }

    function getVestingSchedule(bytes32 scheduleId) 
        external 
        view 
        returns (VestingSchedule memory) 
    {
        return vestingSchedules[scheduleId];
    }

    function getVestingSchedulesForBeneficiary(address beneficiary) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return holderToSchedules[beneficiary];
    }

    function getTotalReleasableForBeneficiary(address beneficiary) 
        external 
        view 
        returns (uint256) 
    {
        bytes32[] memory scheduleIds = holderToSchedules[beneficiary];
        uint256 totalReleasable = 0;

        for (uint256 i = 0; i < scheduleIds.length; i++) {
            VestingSchedule memory schedule = vestingSchedules[scheduleIds[i]];
            if (!schedule.revoked) {
                totalReleasable += _computeReleasableAmount(schedule);
            }
        }

        return totalReleasable;
    }

    function getBeneficiaryInfo(address beneficiary) external view returns (
        uint256 totalAllocated,
        uint256 totalReleased,
        uint256 totalReleasable,
        uint256 scheduleCount,
        uint256 nextClaimTime
    ) {
        bytes32[] memory scheduleIds = holderToSchedules[beneficiary];
        
        for (uint256 i = 0; i < scheduleIds.length; i++) {
            VestingSchedule memory schedule = vestingSchedules[scheduleIds[i]];
            if (!schedule.revoked) {
                totalAllocated += schedule.totalAmount;
                totalReleased += schedule.released;
                totalReleasable += _computeReleasableAmount(schedule);
            }
        }
        
        scheduleCount = scheduleIds.length;
        nextClaimTime = lastClaimTime[beneficiary] + claimCooldown;
    }

    function getVestingStats() 
        external 
        view 
        returns (
            uint256 totalSchedules,
            uint256 totalVested,
            uint256 totalReleased,
            uint256 totalLocked,
            uint256 totalBeneficiaries_
        ) 
    {
        return (
            totalVestingSchedules,
            totalTokensVested,
            totalTokensReleased,
            totalTokensVested - totalTokensReleased,
            totalBeneficiaries
        );
    }

    function getCategoryStats(string memory category) external view returns (
        uint256 totalAllocated,
        uint256 maxAllocation,
        uint256 vestingCount,
        uint256 remainingAllocation
    ) {
        return (
            categoryTotalAllocated[category],
            categoryMaxAllocation[category],
            categoryVestingCount[category],
            categoryMaxAllocation[category] - categoryTotalAllocated[category]
        );
    }

    // ============ EMERGENCY FUNCTIONS ============

    function toggleEmergencyMode() external onlyOwner {
        emergencyMode = !emergencyMode;
        emit EmergencyModeToggled(emergencyMode);
    }

    function setEmergencyRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Invalid recipient");
        emergencyRecipient = _recipient;
    }

    function emergencyWithdraw() external onlyOwner {
        require(emergencyMode, "Emergency mode not active");
        uint256 balance = wejeToken.balanceOf(address(this));
        wejeToken.safeTransfer(emergencyRecipient, balance);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawNonVestedTokens() external onlyOwner {
        uint256 lockedTokens = totalTokensVested - totalTokensReleased;
        uint256 contractBalance = wejeToken.balanceOf(address(this));
        
        if (contractBalance > lockedTokens) {
            uint256 withdrawable = contractBalance - lockedTokens;
            wejeToken.safeTransfer(owner(), withdrawable);
        }
    }

    // ============ UTILITY FUNCTIONS ============

    function isVestingActive(bytes32 scheduleId) external view returns (bool) {
        VestingSchedule memory schedule = vestingSchedules[scheduleId];
        return schedule.beneficiary != address(0) && !schedule.revoked;
    }

    function getVestingProgress(bytes32 scheduleId) external view returns (
        uint256 percentageVested,
        uint256 percentageReleased,
        uint256 timeRemaining
    ) {
        VestingSchedule memory schedule = vestingSchedules[scheduleId];
        
        if (schedule.beneficiary == address(0)) {
            return (0, 0, 0);
        }
        
        uint256 currentTime = block.timestamp;
        uint256 totalDuration = schedule.cliffDuration + schedule.vestingDuration;
        uint256 elapsed = currentTime >= schedule.startTime ? 
                         currentTime - schedule.startTime : 0;
        
        if (elapsed >= totalDuration) {
            percentageVested = 10000; // 100%
            timeRemaining = 0;
        } else {
            percentageVested = (elapsed * 10000) / totalDuration;
            timeRemaining = schedule.startTime + totalDuration - currentTime;
        }
        
        percentageReleased = (schedule.released * 10000) / schedule.totalAmount;
    }

    function canClaim(address beneficiary) external view returns (
        bool canClaimNow,
        uint256 claimableAmount,
        uint256 nextClaimTime
    ) {
        canClaimNow = block.timestamp >= lastClaimTime[beneficiary] + claimCooldown;
        claimableAmount = this.getTotalReleasableForBeneficiary(beneficiary);
        nextClaimTime = lastClaimTime[beneficiary] + claimCooldown;
    }
}