// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SportsBetting
 * @dev High-performance, secure sports betting contract supporting direct EOA/Smart Account calls,
 * ERC-2771 meta-transactions, and gas-sponsored EIP-712 signatures with ERC-1271 verification.
 */
contract SportsBetting is ERC2771Context, EIP712, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20Permit public immutable wejeToken;
    IERC20 public immutable wejeTokenERC20;

    bytes32 public constant OPEN_BET_TYPEHASH = keccak256(
        "OpenBet(uint256 betId,uint256 amount,uint256 startDate,uint256 endDate,bytes32 uid,bytes32 affiliateId,address walletAddress,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant JOIN_BET_TYPEHASH = keccak256(
        "JoinBet(uint256 betId,bytes32 uid,bytes32 affiliateId,address walletAddress,uint256 nonce,uint256 deadline)"
    );

    struct User {
        bytes32 uid; // Hashed UID
        bytes32 affiliateId; // Hashed Affiliate ID
        address walletAddress;
    }

    struct Bet {
        uint256 amount;
        uint256 status; // 0: Open, 1: Running, 2: Finished, 3: Cancelled
        uint256 betId;
        uint256 pool;
        uint256 startDate;
        uint256 endDate;
        bytes32[] participantIds;
        mapping(bytes32 => User) participants;
    }

    struct BetInfo {
        uint256 amount;
        uint256 betId;
        uint256 startDate;
        uint256 endDate;
    }

    struct DistributionData {
        bytes32 uid;
        uint256 amount;
    }

    struct PermitParams {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct SignatureParams {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    mapping(uint256 => Bet) public bets;
    mapping(address => uint256) public nonces;

    // O(1) Status tracking arrays and index mappings (1-based index: 0 = not in array)
    uint256[] private openBetIds;
    uint256[] private runningBetIds;

    mapping(uint256 => uint256) private openBetIndex;
    mapping(uint256 => uint256) private runningBetIndex;

    uint256 public totalCommission;

    event BetOpened(uint256 indexed betId, bytes32 indexed uid, uint256 amount, uint256 pool);
    event BetJoined(uint256 indexed betId, bytes32 indexed uid, uint256 amount, uint256 pool);
    event BetRunning(uint256 indexed betId);
    event BetFinished(uint256 indexed betId);
    event BetDeleted(uint256 indexed betId);
    event CommissionCollected(uint256 indexed betId, uint256 commission);
    event CommissionWithdrawn(address indexed recipient, uint256 amount);

    constructor(address _wejeTokenAddress, address _trustedForwarder)
        ERC2771Context(_trustedForwarder)
        EIP712("SportsBetting", "1")
        Ownable(msg.sender)
    {
        require(_wejeTokenAddress != address(0), "Invalid token address");
        wejeToken = IERC20Permit(_wejeTokenAddress);
        wejeTokenERC20 = IERC20(_wejeTokenAddress);
    }

    // --- Internal O(1) List Management ---

    function _addOpenBetId(uint256 _betId) internal {
        openBetIds.push(_betId);
        openBetIndex[_betId] = openBetIds.length;
    }

    function _removeOpenBetId(uint256 _betId) internal {
        uint256 index1Based = openBetIndex[_betId];
        if (index1Based > 0) {
            uint256 idx = index1Based - 1;
            uint256 lastId = openBetIds[openBetIds.length - 1];
            if (idx != openBetIds.length - 1) {
                openBetIds[idx] = lastId;
                openBetIndex[lastId] = index1Based;
            }
            openBetIds.pop();
            delete openBetIndex[_betId];
        }
    }

    function _addRunningBetId(uint256 _betId) internal {
        runningBetIds.push(_betId);
        runningBetIndex[_betId] = runningBetIds.length;
    }

    function _removeRunningBetId(uint256 _betId) internal {
        uint256 index1Based = runningBetIndex[_betId];
        if (index1Based > 0) {
            uint256 idx = index1Based - 1;
            uint256 lastId = runningBetIds[runningBetIds.length - 1];
            if (idx != runningBetIds.length - 1) {
                runningBetIds[idx] = lastId;
                runningBetIndex[lastId] = index1Based;
            }
            runningBetIds.pop();
            delete runningBetIndex[_betId];
        }
    }

    // --- Signature Verification Helpers ---

    function _verifyOpenBetSignature(
        BetInfo calldata _betInfo,
        User calldata _user,
        uint256 _nonce,
        uint256 _deadline,
        bytes memory _signature
    ) internal {
        require(block.timestamp <= _deadline, "Signature expired");
        require(_nonce == nonces[_user.walletAddress]++, "Invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(
                OPEN_BET_TYPEHASH,
                _betInfo.betId,
                _betInfo.amount,
                _betInfo.startDate,
                _betInfo.endDate,
                _user.uid,
                _user.affiliateId,
                _user.walletAddress,
                _nonce,
                _deadline
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        require(
            SignatureChecker.isValidSignatureNow(_user.walletAddress, hash, _signature),
            "Invalid signer signature"
        );
    }

    function _verifyJoinBetSignature(
        uint256 _betId,
        User calldata _user,
        uint256 _nonce,
        uint256 _deadline,
        bytes memory _signature
    ) internal {
        require(block.timestamp <= _deadline, "Signature expired");
        require(_nonce == nonces[_user.walletAddress]++, "Invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(
                JOIN_BET_TYPEHASH,
                _betId,
                _user.uid,
                _user.affiliateId,
                _user.walletAddress,
                _nonce,
                _deadline
            )
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        require(
            SignatureChecker.isValidSignatureNow(_user.walletAddress, hash, _signature),
            "Invalid signer signature"
        );
    }

    // --- Core Betting Functions ---

    /**
     * @notice Open a new bet ticket with gas-sponsored EIP-712 / ERC-1271 signature and optional permit
     * @dev Called by OpenZeppelin Relayers (gas sponsorship) or user directly / forwarder
     */
    function openBet(
        BetInfo calldata _betInfo,
        User calldata _user,
        PermitParams calldata _permit,
        SignatureParams calldata _sig
    ) external nonReentrant {
        require(_betInfo.amount > 0, "Amount > 0");
        require(_betInfo.betId > 0, "Invalid bet ID");
        require(_betInfo.startDate < _betInfo.endDate, "Invalid dates");
        require(_betInfo.endDate > block.timestamp, "End date in past");
        require(_user.walletAddress != address(0), "Invalid wallet address");
        require(_user.uid != bytes32(0), "Invalid UID");
        require(bets[_betInfo.betId].betId == 0, "Bet already exists");

        // Authenticate user: Either via verified EIP-712/ERC-1271 signature (relayer) OR direct caller / ERC2771 forwarder
        if (_sig.deadline > 0 || _sig.signature.length > 0) {
            _verifyOpenBetSignature(_betInfo, _user, _sig.nonce, _sig.deadline, _sig.signature);
        } else {
            require(_user.walletAddress == _msgSender(), "Sender must match user wallet");
        }

        // Execute Permit if provided (try-catch eliminates front-running DoS / pull issues)
        if (_permit.deadline > 0) {
            try wejeToken.permit(_user.walletAddress, address(this), _betInfo.amount, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }
        require(wejeTokenERC20.allowance(_user.walletAddress, address(this)) >= _betInfo.amount, "Insufficient allowance");

        // State update (Checks-Effects-Interactions pattern)
        Bet storage bet = bets[_betInfo.betId];
        bet.amount = _betInfo.amount;
        bet.betId = _betInfo.betId;
        bet.status = 0; // Open
        bet.pool = _betInfo.amount;
        bet.startDate = _betInfo.startDate;
        bet.endDate = _betInfo.endDate;

        bet.participants[_user.uid] = _user;
        bet.participantIds.push(_user.uid);

        _addOpenBetId(_betInfo.betId);

        // Pull tokens securely
        wejeTokenERC20.safeTransferFrom(_user.walletAddress, address(this), _betInfo.amount);

        emit BetOpened(_betInfo.betId, _user.uid, _betInfo.amount, bet.pool);
    }

    /**
     * @notice Join an existing open bet ticket with gas-sponsored EIP-712 / ERC-1271 signature and optional permit
     * @dev Called by OpenZeppelin Relayers (gas sponsorship) or user directly / forwarder
     */
    function joinBet(
        uint256 _betId,
        User calldata _user,
        PermitParams calldata _permit,
        SignatureParams calldata _sig
    ) external nonReentrant {
        Bet storage bet = bets[_betId];
        require(bet.betId > 0, "Bet Ticket not found");
        require(bet.status == 0, "Bet is not open");
        require(block.timestamp <= bet.startDate, "Bet already started");
        require(_user.walletAddress != address(0), "Invalid wallet address");
        require(_user.uid != bytes32(0), "Invalid UID");
        require(!isJoined(_betId, _user.uid), "Already joined");

        // Authenticate user:
        if (_sig.deadline > 0 || _sig.signature.length > 0) {
            _verifyJoinBetSignature(_betId, _user, _sig.nonce, _sig.deadline, _sig.signature);
        } else {
            require(_user.walletAddress == _msgSender(), "Sender must match user wallet");
        }

        // Try permit if passed
        if (_permit.deadline > 0) {
            try wejeToken.permit(_user.walletAddress, address(this), bet.amount, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }
        require(wejeTokenERC20.allowance(_user.walletAddress, address(this)) >= bet.amount, "Insufficient allowance");

        // Update state
        bet.participants[_user.uid] = _user;
        bet.participantIds.push(_user.uid);
        bet.pool += bet.amount;

        // Pull tokens safely
        wejeTokenERC20.safeTransferFrom(_user.walletAddress, address(this), bet.amount);

        emit BetJoined(_betId, _user.uid, bet.amount, bet.pool);
    }

    /**
     * @notice Transition bet ticket to Running or Refund/Delete if only 1 participant
     */
    function updateBetTicketStatus(uint256 _betId) external onlyOwner nonReentrant {
        Bet storage bet = bets[_betId];
        require(bet.betId > 0, "Bet ticket not found");
        require(bet.status == 0, "Status already running/finished");

        if (bet.participantIds.length == 1) {
            // Refund the single user
            bytes32 singleUser = bet.participantIds[0];
            address playerAddress = bet.participants[singleUser].walletAddress;
            _removeOpenBetId(_betId);
            wejeTokenERC20.safeTransfer(playerAddress, bet.amount);
            delete bets[_betId];
            emit BetDeleted(_betId);
        } else {
            bet.status = 1;
            _removeOpenBetId(_betId);
            _addRunningBetId(_betId);
            emit BetRunning(_betId);
        }
    }

    /**
     * @notice Distribute winnings safely to winners with pool protection
     */
    function distributeWinners(
        uint256 _betId,
        DistributionData[] calldata distributionData,
        bool isFinal
    ) public onlyOwner nonReentrant {
        Bet storage bet = bets[_betId];
        require(bet.betId > 0, "Bet ticket not found");
        require(bet.status == 1, "Bet not running");

        uint256 totalDistribute = 0;
        for (uint256 i = 0; i < distributionData.length; i++) {
            totalDistribute += distributionData[i].amount;
        }
        require(totalDistribute <= bet.pool, "Distribution exceeds pool");
        bet.pool -= totalDistribute;

        for (uint256 i = 0; i < distributionData.length; i++) {
            bytes32 uid = distributionData[i].uid;
            User memory user = bet.participants[uid];
            require(user.walletAddress != address(0), "User not found");
            
            if (distributionData[i].amount > 0) {
                wejeTokenERC20.safeTransfer(user.walletAddress, distributionData[i].amount);
            }
        }

        if (isFinal) {
            uint256 commission = bet.pool;
            if (commission > 0) {
                totalCommission += commission;
                bet.pool = 0;
                emit CommissionCollected(_betId, commission);
            }

            bet.status = 2; // Finished
            _removeRunningBetId(_betId);
             delete bets[_betId];
            emit BetFinished(_betId);
        }
    }

    /**
     * @notice Withdraw collected commission to recipient address
     */
    function withdrawCommission(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(amount <= totalCommission, "Amount exceeds commission");
        totalCommission -= amount;
        wejeTokenERC20.safeTransfer(recipient, amount);
        emit CommissionWithdrawn(recipient, amount);
    }

    // --- View & Helper Functions ---

    function getBetInfo(uint256 _betId) external view returns (
        uint256 amount,
        uint256 status,
        uint256 pool,
        uint256 startDate,
        uint256 endDate,
        uint256 participantsCount
    ) {
        Bet storage bet = bets[_betId];
        return (bet.amount, bet.status, bet.pool, bet.startDate, bet.endDate, bet.participantIds.length);
    }

    function isJoined(uint256 _betId, bytes32 _uid) public view returns (bool) {
        Bet storage bet = bets[_betId];
        return bet.participants[_uid].walletAddress != address(0);
    }

    function getParticipantIds(uint256 _betId) external view returns (bytes32[] memory) {
        return bets[_betId].participantIds;
    }

    function getBetsByStatus(uint256 _status) external view returns (uint256[] memory) {
        if (_status == 0) return openBetIds;
        if (_status == 1) return runningBetIds;
        revert("Invalid status");
    }

    // --- Context Overrides for ERC2771 ---

    function _msgSender() internal view virtual override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view virtual override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view virtual override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}