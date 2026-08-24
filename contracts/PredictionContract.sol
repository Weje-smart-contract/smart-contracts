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
 * @title PredictionTickets
 * @dev High-performance, secure prediction ticket contract supporting direct EOA/Smart Account calls,
 * ERC-2771 meta-transactions, and gas-sponsored EIP-712 signatures with ERC-1271 verification.
 */
contract PredictionTickets is ERC2771Context, EIP712, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20Permit public immutable wejeTokenPermit;
    IERC20 public immutable wejeToken;

    bytes32 public constant OPEN_TICKET_TYPEHASH = keccak256(
        "OpenTicket(uint256 betId,uint256 amount,uint256 startDate,uint256 endDate,bytes32 uid,bytes32 affiliateId,address walletAddress,uint256 nonce,uint256 deadline)"
    );

    bytes32 public constant JOIN_TICKET_TYPEHASH = keccak256(
        "JoinTicket(uint256 betId,bytes32 uid,bytes32 affiliateId,address walletAddress,uint256 nonce,uint256 deadline)"
    );

    struct User {
        bytes32 uid; // Hashed UID from backend/firebase
        bytes32 affiliateId; // Hashed Affiliate ID
        address walletAddress;
    }

    struct Ticket {
        uint256 amount; // Bet amount per user
        uint256 status; // 0: Open, 1: Running, 2: Finished, 3: Cancelled
        uint256 betId;  // Unique ID for the prediction ticket
        uint256 pool;   // Total accumulated amount
        uint256 startDate;
        uint256 endDate;
        bytes32[] participantIds; 
        mapping(bytes32 => User) participants;
    }

    struct TicketInfo {
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

    mapping(uint256 => Ticket) public tickets;
    mapping(address => uint256) public nonces;
    mapping(address => bool) public admins;

    // O(1) Status tracking arrays and index mappings (1-based index: 0 = not in array)
    uint256[] private openTicketIds;
    uint256[] private runningTicketIds;

    mapping(uint256 => uint256) private openTicketIndex;
    mapping(uint256 => uint256) private runningTicketIndex;

    uint256 public totalCommission;

    event TicketOpened(uint256 indexed betId, bytes32 indexed uid, uint256 amount, uint256 pool);
    event TicketJoined(uint256 indexed betId, bytes32 indexed uid, uint256 amount, uint256 pool);
    event TicketRunning(uint256 indexed betId);
    event TicketFinished(uint256 indexed betId);
    event TicketDeleted(uint256 indexed betId);
    event CommissionCollected(uint256 indexed betId, uint256 commission);
    event CommissionWithdrawn(address indexed recipient, uint256 amount);
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);

    modifier onlyAdmin() {
        require(admins[_msgSender()] || _msgSender() == owner(), "Only admin or owner");
        _;
    }

    constructor(address _wejeTokenAddress, address _trustedForwarder) 
        ERC2771Context(_trustedForwarder)
        EIP712("PredictionTickets", "1")
        Ownable(msg.sender)
    {
        require(_wejeTokenAddress != address(0), "Invalid token address");
        admins[msg.sender] = true;
        wejeTokenPermit = IERC20Permit(_wejeTokenAddress);
        wejeToken = IERC20(_wejeTokenAddress);
    }

    function addAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid address");
        admins[_admin] = true;
        emit AdminAdded(_admin);
    }

    function removeAdmin(address _admin) external onlyOwner {
        require(msg.sender != _admin, "Cannot remove self");
        admins[_admin] = false;
        emit AdminRemoved(_admin);
    }

    // --- Internal O(1) List Management ---

    function _addOpenTicketId(uint256 _betId) internal {
        openTicketIds.push(_betId);
        openTicketIndex[_betId] = openTicketIds.length;
    }

    function _removeOpenTicketId(uint256 _betId) internal {
        uint256 index1Based = openTicketIndex[_betId];
        if (index1Based > 0) {
            uint256 idx = index1Based - 1;
            uint256 lastId = openTicketIds[openTicketIds.length - 1];
            if (idx != openTicketIds.length - 1) {
                openTicketIds[idx] = lastId;
                openTicketIndex[lastId] = index1Based;
            }
            openTicketIds.pop();
            delete openTicketIndex[_betId];
        }
    }

    function _addRunningTicketId(uint256 _betId) internal {
        runningTicketIds.push(_betId);
        runningTicketIndex[_betId] = runningTicketIds.length;
    }

    function _removeRunningTicketId(uint256 _betId) internal {
        uint256 index1Based = runningTicketIndex[_betId];
        if (index1Based > 0) {
            uint256 idx = index1Based - 1;
            uint256 lastId = runningTicketIds[runningTicketIds.length - 1];
            if (idx != runningTicketIds.length - 1) {
                runningTicketIds[idx] = lastId;
                runningTicketIndex[lastId] = index1Based;
            }
            runningTicketIds.pop();
            delete runningTicketIndex[_betId];
        }
    }

    // --- Signature Verification Helpers ---

    function _verifyOpenTicketSignature(
        TicketInfo calldata _ticketInfo,
        User calldata _user,
        uint256 _nonce,
        uint256 _deadline,
        bytes memory _signature
    ) internal {
        require(block.timestamp <= _deadline, "Signature expired");
        require(_nonce == nonces[_user.walletAddress]++, "Invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(
                OPEN_TICKET_TYPEHASH,
                _ticketInfo.betId,
                _ticketInfo.amount,
                _ticketInfo.startDate,
                _ticketInfo.endDate,
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

    function _verifyJoinTicketSignature(
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
                JOIN_TICKET_TYPEHASH,
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
     * @notice Open a new prediction ticket with gas-sponsored EIP-712 / ERC-1271 signature and optional permit
     * @dev Called by OpenZeppelin Relayers (gas sponsorship) or user directly / forwarder
     */
    function openBet(
        TicketInfo calldata _ticketInfo, 
        User calldata _user,
        PermitParams calldata _permit,
        SignatureParams calldata _sig
    ) external nonReentrant {
        require(_ticketInfo.amount > 0, "Amount must be > 0");
        require(_ticketInfo.betId > 0, "Invalid bet ID");
        require(_ticketInfo.startDate < _ticketInfo.endDate, "Invalid dates");
        require(_ticketInfo.endDate > block.timestamp, "End date in past");
        require(_user.walletAddress != address(0), "Invalid wallet address");
        require(_user.uid != bytes32(0), "Invalid UID");
        require(tickets[_ticketInfo.betId].betId == 0, "Ticket already exists");
        
        // Authenticate user: Either via verified EIP-712/ERC-1271 signature (relayer) OR direct caller / ERC2771 forwarder
        if (_sig.deadline > 0 || _sig.signature.length > 0) {
            _verifyOpenTicketSignature(_ticketInfo, _user, _sig.nonce, _sig.deadline, _sig.signature);
        } else {
            require(_user.walletAddress == _msgSender(), "Sender must match user wallet");
        }

        // Handle Permit if provided (try-catch prevents front-running DoS / pull issues)
        if (_permit.deadline > 0) {
            try wejeTokenPermit.permit(_user.walletAddress, address(this), _ticketInfo.amount, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }
        require(wejeToken.allowance(_user.walletAddress, address(this)) >= _ticketInfo.amount, "Insufficient allowance");
        
        // State update (Checks-Effects-Interactions pattern)
        Ticket storage ticket = tickets[_ticketInfo.betId];
        ticket.amount = _ticketInfo.amount;
        ticket.betId = _ticketInfo.betId;
        ticket.status = 0; // Open
        ticket.pool = _ticketInfo.amount;
        ticket.startDate = _ticketInfo.startDate;
        ticket.endDate = _ticketInfo.endDate;

        ticket.participants[_user.uid] = _user;
        ticket.participantIds.push(_user.uid);

        _addOpenTicketId(_ticketInfo.betId);

        // Pull tokens securely
        wejeToken.safeTransferFrom(_user.walletAddress, address(this), _ticketInfo.amount);

        emit TicketOpened(_ticketInfo.betId, _user.uid, _ticketInfo.amount, ticket.pool);
    }

    /**
     * @notice Join an existing prediction ticket with gas-sponsored EIP-712 / ERC-1271 signature and optional permit
     * @dev Called by OpenZeppelin Relayers (gas sponsorship) or user directly / forwarder
     */
    function joinBet(
        uint256 _betId, 
        User calldata _user,
        PermitParams calldata _permit,
        SignatureParams calldata _sig
    ) external nonReentrant {
        Ticket storage ticket = tickets[_betId];
        require(ticket.betId > 0, "Ticket not found");
        require(ticket.status == 0, "Ticket is not open");
        require(block.timestamp <= ticket.startDate, "Bet already started");
        require(_user.walletAddress != address(0), "Invalid wallet address");
        require(_user.uid != bytes32(0), "Invalid UID");
        require(!isJoined(_betId, _user.uid), "Already joined");
        
        // Authenticate user:
        if (_sig.deadline > 0 || _sig.signature.length > 0) {
            _verifyJoinTicketSignature(_betId, _user, _sig.nonce, _sig.deadline, _sig.signature);
        } else {
            require(_user.walletAddress == _msgSender(), "Sender must match user wallet");
        }

        if (_permit.deadline > 0) {
            try wejeTokenPermit.permit(_user.walletAddress, address(this), ticket.amount, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }
        require(wejeToken.allowance(_user.walletAddress, address(this)) >= ticket.amount, "Insufficient allowance");

        // Update state
        ticket.participants[_user.uid] = _user;
        ticket.participantIds.push(_user.uid);
        ticket.pool += ticket.amount;

        // Pull tokens safely
        wejeToken.safeTransferFrom(_user.walletAddress, address(this), ticket.amount);

        emit TicketJoined(_betId, _user.uid, ticket.amount, ticket.pool);
    }

    /**
     * @notice Update ticket status to Running or Delete (refund) if only 1 participant
     */
    function updateBetTicketStatus(uint256 _betId) external onlyAdmin nonReentrant {
        Ticket storage ticket = tickets[_betId];
        require(ticket.betId > 0, "Ticket not found");
        require(ticket.status == 0, "Status already running/finished");

        if (ticket.participantIds.length == 1) {
            // Refund the single participant
            bytes32 singleUser = ticket.participantIds[0];
            address playerAddress = ticket.participants[singleUser].walletAddress;
            _removeOpenTicketId(_betId);
            wejeToken.safeTransfer(playerAddress, ticket.amount);
            delete tickets[_betId];
            emit TicketDeleted(_betId);
        } else {
            ticket.status = 1; // Running
            _removeOpenTicketId(_betId);
            _addRunningTicketId(_betId);
            emit TicketRunning(_betId);
        }
    }

    /**
     * @notice Distribute winnings safely to winners with pool protection
     */
    function distributeWinners(
        uint256 _betId,
        DistributionData[] calldata distributionData,
        bool isFinal
    ) public onlyAdmin nonReentrant {
        Ticket storage ticket = tickets[_betId];
        require(ticket.betId > 0, "Ticket not found");
        require(ticket.status == 1, "Ticket not running");

        uint256 totalDistribute = 0;
        for (uint256 i = 0; i < distributionData.length; i++) {
            totalDistribute += distributionData[i].amount;
        }
        require(totalDistribute <= ticket.pool, "Distribution exceeds pool");
        ticket.pool -= totalDistribute;

        for (uint256 i = 0; i < distributionData.length; i++) {
            bytes32 uid = distributionData[i].uid;
            User memory user = ticket.participants[uid];
            require(user.walletAddress != address(0), "User not found");
            
            if (distributionData[i].amount > 0) {
                wejeToken.safeTransfer(user.walletAddress, distributionData[i].amount);
            }
        }

        if (isFinal) {
            uint256 commission = ticket.pool;
            if (commission > 0) {
                totalCommission += commission;
                ticket.pool = 0;
                emit CommissionCollected(_betId, commission);
            }

            delete tickets[_betId];
            _removeRunningTicketId(_betId);
            emit TicketFinished(_betId);
        }
    }

    /**
     * @notice Withdraw collected commission to recipient address
     */
    function withdrawCommission(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(amount <= totalCommission, "Amount exceeds commission");
        totalCommission -= amount;
        wejeToken.safeTransfer(recipient, amount);
        emit CommissionWithdrawn(recipient, amount);
    }

    // --- View & Helper Functions ---

    function getTicketInfo(uint256 _betId) public view returns (uint amount, uint status, uint pool, uint startDate, uint endDate, uint participantsCount) {
        Ticket storage ticket = tickets[_betId];
        return (ticket.amount, ticket.status, ticket.pool, ticket.startDate, ticket.endDate, ticket.participantIds.length);
    }

    function getTicketById(uint256 _betId) external view returns (
        TicketInfo memory info,
        uint256 pool,
        uint256 status,
        uint256 participantsCount
    ) {
        Ticket storage ticket = tickets[_betId];
        info = TicketInfo(ticket.amount, ticket.betId, ticket.startDate, ticket.endDate);
        return (info, ticket.pool, ticket.status, ticket.participantIds.length);
    }

    function getTicketsByStatus(uint256 _status) external view returns (uint256[] memory) {
        if (_status == 0) return openTicketIds;
        if (_status == 1) return runningTicketIds;
        revert("Invalid status");
    }

    function isJoined(uint256 _betId, bytes32 _uid) public view returns (bool) {
        Ticket storage ticket = tickets[_betId];
        return ticket.participants[_uid].walletAddress != address(0);
    }

    function getParticipantIds(uint256 _betId) external view returns (bytes32[] memory) {
        return tickets[_betId].participantIds;
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
