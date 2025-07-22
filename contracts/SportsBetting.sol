// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract SportsBetting {
    IERC20Permit public immutable wejeToken;
    IERC20 public immutable wejeTokenERC20;
    struct Match {
        uint gameId;
        bool isDrawable;
        uint homeId;
        uint awayId;
        string homeName; 
        string awayName;
        string homeLogo;
        string awayLogo;
        uint gameTime;
    }

    struct User {
        string uid;
        string name;
        string photoUrl;
        address walletAddress;
        string affiliateId;
    }

    struct DistributionData {
        string uid;
        uint amount;
    }
    struct Selection {
        uint gameId;
        uint choice; // Enum for choices
    }

    struct Bet {
    uint amount;
    uint status;
    uint betId; // Consider bytes32 for efficiency
    uint pool;
    uint startDate; //first match start date
    uint endDate; // last match end date
    string[] userIds;
    Match[] matches;
    Selection[] results;
    mapping(string => UserWithSelections) userSelections;
}

    struct BetInfo {
        uint amount;
        uint betId;
        uint startDate;
        uint endDate;
    }

    struct UserWithSelections {
        string uid;
        string name;
        string photoUrl;
        string affiliateId;
        address walletAddress;
        Selection[] selections;
    }

    struct BetSelectionDetails {
        uint amount;
        uint status;
        uint betId; // Consider bytes32 for efficiency
        uint pool;
        uint startDate; //first match start date
        uint endDate; // last match end date
        Match[] matches;
        Selection[] results;
        UserWithSelections[] userSelections;
    }

    mapping(uint => Bet) private bets; // Mapping of formId to Bet
    
    uint[] private openBetIds;
    uint[] private runningBetIds;
    uint[] private finishedBetIds;

    uint private commission;
    bool private locked;
    address private deployer;
    uint private commissionRate;

    event BetOpened(uint betId, string desc);
    event BetJoined(uint betId, string desc);
    event BetRunning(uint betId, string desc);
    event BetFinished(uint betId, string desc);
    event BetDeleted(uint betId, string desc);
    event Received(address sender, uint256 amount); 

     modifier onlyDeployer() {
        require(msg.sender == deployer, "Only deployer can call this function");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

     constructor(address _wejeTokenAddress) {
        deployer = msg.sender;
        commissionRate = 1;
        wejeToken = IERC20Permit(_wejeTokenAddress);
        wejeTokenERC20 = IERC20(_wejeTokenAddress);
    }
    

     // Helper function to remove a bet ID from an array
    function _removeBetIdFromArray(uint _betId, uint[] storage array) internal {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == _betId) {
                array[i] = array[array.length - 1];
                array.pop();
                break;
            }
        }
    }
    

    function openBet(BetInfo calldata _betInfo, Match[] calldata _matches, User calldata _openBy, Selection[] calldata _selections,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s) public nonReentrant  {
        require(_betInfo.amount >0, "not enough Balance");

         // Call permit first
        wejeToken.permit(_openBy.walletAddress, address(this), _betInfo.amount, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(_openBy.walletAddress, address(this), _betInfo.amount);
        require(success, "Token transfer failed");

        Bet storage bet = bets[_betInfo.betId];
        bet.amount = _betInfo.amount;
        bet.betId = _betInfo.betId;
        bet.status = 0;
        bet.pool = _betInfo.amount;
        bet.startDate = _betInfo.startDate;
        bet.endDate = _betInfo.endDate;
        bet.userSelections[_openBy.uid].uid = _openBy.uid;
        bet.userSelections[_openBy.uid].name = _openBy.name;
        bet.userSelections[_openBy.uid].walletAddress = _openBy.walletAddress;
        bet.userSelections[_openBy.uid].photoUrl = _openBy.photoUrl;
        bet.userSelections[_openBy.uid].affiliateId = _openBy.affiliateId;
        for (uint i = 0; i < _selections.length; i++) {
            bet.matches.push(_matches[i]);
            bet.userSelections[_openBy.uid].selections.push(Selection({
                gameId: _selections[i].gameId,
                choice: _selections[i].choice
            }));
        }
        bet.userIds.push(_openBy.uid);
        openBetIds.push(_betInfo.betId);
        emit BetOpened(_betInfo.betId, string(abi.encodePacked("Ticket is opened by ", _openBy.name)));
    }

    function joinBet(uint _betId, Selection[] calldata _selections, User calldata _user,  uint256 deadline, uint8 v, bytes32 r, bytes32 s) public nonReentrant {
        Bet storage bet = bets[_betId];
        require(bet.betId >0, "Bet Ticket not found");
        require(bet.status == 0, "Bet is not open");

         // Call permit first
        wejeToken.permit(_user.walletAddress, address(this), bet.amount, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(_user.walletAddress, address(this), bet.amount);
        require(success, "Token transfer failed");

        bet.userSelections[_user.uid].uid = _user.uid;
        bet.userSelections[_user.uid].name = _user.name;
        bet.userSelections[_user.uid].walletAddress = _user.walletAddress;
        bet.userSelections[_user.uid].photoUrl = _user.photoUrl;
        bet.userSelections[_user.uid].affiliateId = _user.affiliateId;
        for (uint i = 0; i < _selections.length; i++) {
            bet.userSelections[_user.uid].selections.push(Selection({
                gameId: _selections[i].gameId,
                choice: _selections[i].choice
            }));
        }
        bet.userIds.push(_user.uid);
        bets[_betId].pool += bet.amount;

      emit BetJoined(_betId, string(abi.encodePacked("Ticket is opened by ", _user.name)));
    }

    function updateBetTicketStatus(uint _betId) external onlyDeployer  {
        Bet storage bet = bets[_betId];
        require(bet.betId >0, "Bet ticket not found");
        require(bet.status == 0, "Status already either running or finished");
        //check if only one user return money and delete ticket
        if(bet.userIds.length == 1) {
            UserWithSelections memory user = bet.userSelections[bet.userIds[0]];
             address payable playerAddress = payable(user.walletAddress);
             bool success = wejeTokenERC20.transfer(playerAddress, bets[_betId].amount);
             require(success, "Token transfer failed");
            delete bets[_betId];
             _removeBetIdFromArray(_betId, openBetIds);
           emit BetDeleted(_betId, "Only one user, ticket is deleted");
        }else {
            bets[_betId].status = 1;
             // Move the bet ID from openBetIds to activeBetIds
            _removeBetIdFromArray(_betId, openBetIds);
            runningBetIds.push(_betId);
            emit BetRunning(_betId, string(abi.encodePacked("Ticket status is running")));
        }
    }

    function distributeWinners(uint _betId, DistributionData[] calldata distributionData) public onlyDeployer nonReentrant {
        Bet storage bet = bets[_betId];
        require(bet.betId > 0, "Bet ticket not found");
        require(bet.status == 1, "Bet already finished");

        for (uint i = 0; i < distributionData.length; i++) {
            UserWithSelections memory user = bet.userSelections[distributionData[i].uid];
            require(bytes(user.uid).length > 0, "User not found");
            //delete bets[_betId].userSelections[user.uid];
            address payable userAddress = payable(user.walletAddress);
            bool success = wejeTokenERC20.transfer(userAddress, distributionData[i].amount);
            require(success, "Token transfer failed");
        }

        delete bets[_betId];
         // Move the bet ID from activeBetIds to completedBetIds
        _removeBetIdFromArray(_betId, runningBetIds);
        emit BetFinished(_betId, "Distribution done, Ticket removed");
    }

    function getTickets(uint _status, uint _offset, uint _limit) public view returns(BetSelectionDetails[] memory, uint totalCount) {
        uint[] memory betIds;
        if (_status == 0) {
            betIds = openBetIds;
        } else if (_status == 1) {
            betIds = runningBetIds;
        } else if (_status == 2) {
            betIds = finishedBetIds;
        }

        // Calculate the total number of bets
        uint totalBets = betIds.length;

        // Adjust the limit if it exceeds the remaining bets
        if (_offset + _limit > totalBets) {
            _limit = totalBets - _offset;
        }

        // Initialize the result array
        BetSelectionDetails[] memory result = new BetSelectionDetails[](_limit);

        // Populate the result array in reverse order (latest first)
        for (uint i = 0; i < _limit; i++) {
            uint index = totalBets - _offset - i - 1;
            result[i] = getTicketByUserId(betIds[index]);
        }
        
        return (result, totalBets);
    }




    function getTicketByUserId(uint _betId) public view returns (BetSelectionDetails memory) {
    Bet storage bet = bets[_betId];
    require(bet.betId > 0, "Ticket not found");

    BetSelectionDetails memory betDetail;
    betDetail.betId = _betId;
    betDetail.pool = bet.pool;
    betDetail.status = bet.status;
    betDetail.amount = bet.amount;
    betDetail.startDate = bet.startDate;
    betDetail.endDate = bet.endDate;
    betDetail.matches = bet.matches;

    UserWithSelections[] memory userWithSelection = new UserWithSelections[](bet.userIds.length);
    for (uint i = 0; i < bet.userIds.length; i++) {
        userWithSelection[i].uid = bet.userSelections[bet.userIds[i]].uid;
        userWithSelection[i].name = bet.userSelections[bet.userIds[i]].name;
        userWithSelection[i].photoUrl = bet.userSelections[bet.userIds[i]].photoUrl;
        userWithSelection[i].walletAddress = bet.userSelections[bet.userIds[i]].walletAddress;
        userWithSelection[i].affiliateId = bet.userSelections[bet.userIds[i]].affiliateId;
        if (bet.userSelections[bet.userIds[i]].walletAddress == msg.sender || bet.status > 0) {
             userWithSelection[i].selections = bet.userSelections[bet.userIds[i]].selections;
        }else{
            userWithSelection[i].selections = new Selection[](0);
        }
       
    }
    betDetail.userSelections = userWithSelection;
    
    // check if match result is there return resul
    if(bet.status == 2){
    betDetail.results = bet.results;
    }

    return betDetail;
}


 function getTicketByIdWithSelections(uint _betId) public view onlyDeployer returns (BetSelectionDetails memory) {
    Bet storage bet = bets[_betId];
    require(bet.betId > 0, "Ticket not found");

    BetSelectionDetails memory betDetail;
    betDetail.betId = _betId;
    betDetail.pool = bet.pool;
    betDetail.status = bet.status;
    betDetail.amount = bet.amount;
    betDetail.startDate = bet.startDate;
    betDetail.endDate = bet.endDate;
    betDetail.matches = bet.matches;

    UserWithSelections[] memory userWithSelection = new UserWithSelections[](bet.userIds.length);
    for (uint i = 0; i < bet.userIds.length; i++) {
        userWithSelection[i].uid = bet.userSelections[bet.userIds[i]].uid;
        userWithSelection[i].name = bet.userSelections[bet.userIds[i]].name;
        userWithSelection[i].photoUrl = bet.userSelections[bet.userIds[i]].photoUrl;
        userWithSelection[i].walletAddress = bet.userSelections[bet.userIds[i]].walletAddress;
        userWithSelection[i].affiliateId = bet.userSelections[bet.userIds[i]].affiliateId;
        userWithSelection[i].selections = bet.userSelections[bet.userIds[i]].selections;
    }
    betDetail.userSelections = userWithSelection;
    return betDetail;
}


     // Function to transfer matic to recipient
    function transferMatic(address payable recipient, uint amount) external onlyDeployer {
        require(recipient != address(0), "Invalid recipient address");
        uint256 contractBalance = wejeTokenERC20.balanceOf(address(this));
        require(contractBalance >= amount, "Insufficient balance");
        bool success = wejeTokenERC20.transfer(recipient, amount);
        require(success, "Token transfer failed");
    }
}