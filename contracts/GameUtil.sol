//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract GameUtil {
    IERC20Permit public immutable wejeToken;
    IERC20 public immutable wejeTokenERC20;
    address public deployer;
    uint public commissionRate;
    uint public commission;

    struct Player {
        string playerId;
        uint wallet;
        address walletAddress;
        string photoUrl;
        string name;
    }

    struct PlayerCall {
        string playerId;
        uint wallet;
        address walletAddress;
        bool isWon;
    }

    struct Game {
        string gameId;
        string gameType;
        uint minBet;
        bool autoHandStart;
        Player[] players;
        uint256 lastModified;
        string admin;
        string media;
        bool isPublic;
        uint rTimeout;
        uint buyIn;
        string[] invPlayers;
        uint gameTime;
    }

    struct GameInfo {
        string gameId;
        string gameType;
        uint minBet;
        uint buyIn;
        bool autoHandStart;
        string media;
        bool isPublic;
        uint rTimeout;
        uint gameTime;
    }

    mapping(string => Game) public games;
    string[] public gameIds;

    bool private locked;

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyDeployer() {
        require(msg.sender == deployer, "Only deployer can call this function");
        _;
    }

    event PlayerJoined(string gameId, string playerId, uint amount);
    event PlayerLeft(string gameId, string playerId, bytes data);
    event GameCreated(string gameId, string gameType);
    event BuyCoin(string gameId, string playerId, uint amount);
    event DeployerChanged(address oldDeployer, address newDeployer);
    event MaticTransferred(address recipient, uint amount, bytes data);
    event Received(address sender, uint256 amount);

    constructor(address _wejeTokenAddress) {
        deployer = msg.sender;
        commissionRate = 1;
        wejeToken = IERC20Permit(_wejeTokenAddress);
        wejeTokenERC20 = IERC20(_wejeTokenAddress);
    }

    function removeGameId(string memory gameId) internal {
        for (uint i = 0; i < gameIds.length; i++) {
            if (keccak256(bytes(gameIds[i])) == keccak256(bytes(gameId))) {
                gameIds[i] = gameIds[gameIds.length - 1];
                gameIds.pop();
                break;
            }
        }
    }

    function removePlayer(Game storage game, string memory playerId) internal {
        for (uint i = 0; i < game.players.length; i++) {
            if (keccak256(bytes(game.players[i].playerId)) == keccak256(bytes(playerId))) {
                game.players[i] = game.players[game.players.length - 1];
                game.players.pop();
                break;
            }
        }
    }

    function findPlayerIndex(Game storage game, string memory playerId) internal view returns (int) {
        if (game.minBet >= 0) {
            for (uint i = 0; i < game.players.length; i++) {
                if (keccak256(abi.encodePacked(game.players[i].playerId)) == keccak256(abi.encodePacked(playerId))) {
                    return int(i);
                }
            }
            return -1;
        }
        return -1;
    }

    function isPlayerJoined(string memory playerId) public view returns (string memory) {
        for (uint i = 0; i < gameIds.length; i++) {
            for (uint j = 0; j < games[gameIds[i]].players.length; j++) {
                if (keccak256(abi.encodePacked(games[gameIds[i]].players[j].playerId)) == keccak256(abi.encodePacked(playerId))) {
                    return gameIds[i];
                }
            }
        }
        return "";
    }

    function handleInvPlayers(string[] calldata _invPlayers, Game storage game) internal {
        for (uint i = 0; i < _invPlayers.length; i++) {
            game.invPlayers.push(_invPlayers[i]);
        }
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function changeDeployer(address newDeployer) external onlyDeployer {
        require(newDeployer != address(0), "Invalid deployer address");
        emit DeployerChanged(deployer, newDeployer);
        deployer = newDeployer;
    }

    function transferMatic(address payable recipient, uint amount) external onlyDeployer {
        require(recipient != address(0), "Invalid recipient address");
        uint256 contractBalance = wejeTokenERC20.balanceOf(address(this));
        require(contractBalance >= amount, "Insufficient balance");
        bool success = wejeTokenERC20.transfer(recipient, amount);
        require(success, "Token transfer failed");
        emit MaticTransferred(recipient, amount, "");
    }

    function changeCommissionRate(uint rate) external onlyDeployer {
        require(rate > 0, "Commission rate must greater than 0");
        commissionRate = rate;
    }

    function transferCommissionMatic(address payable recipient) external onlyDeployer {
        require(recipient != address(0), "Invalid recipient address");
        uint256 contractBalance = wejeTokenERC20.balanceOf(address(this));
        require(contractBalance >= commission, "not enough commission to trasfer");
        
        bool success = wejeTokenERC20.transfer(recipient, commission);
        require(success, "Token transfer failed");
        commission = 0;
        emit MaticTransferred(recipient, commission, "");
    }

    function getAllGames() public view returns (Game[] memory) {
        Game[] memory gameData = new Game[](gameIds.length);
        for (uint i = 0; i < gameIds.length; i++) {
            gameData[i] = games[gameIds[i]];
        }
        return gameData;
    }

    function getGameById(string memory gameId) public view returns (Game memory) {
        require(bytes(games[gameId].gameId).length > 0, "Game not Found");
        return games[gameId];
    }

    // Abstract functions that each game must implement
    function createGame(GameInfo calldata _game, Player calldata player, string[] calldata _invPlayers, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external virtual;
    function joinGame(string memory gameId, Player calldata player, uint amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external virtual;
    function leaveGame(string memory gameId, PlayerCall[] memory players, uint256 date) external virtual;
    function buyCoins(string memory gameId, string memory playerId, uint depositAmount, uint256 date, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external virtual;
    function finishHand(string memory gameId, PlayerCall[] memory players, uint256 date) external virtual;
}