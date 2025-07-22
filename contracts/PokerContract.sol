//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./GameUtil.sol";

contract PokerGame is GameUtil {
    constructor(address _wejeTokenAddress) GameUtil(_wejeTokenAddress) {}

    function createGame(
        GameInfo calldata _game,
        Player calldata _player,
        string[] calldata _invPlayers,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant {
        require(_game.buyIn > 0, "Insufficient buy-in amount");
        bytes memory result = bytes(isPlayerJoined(_player.playerId));
        require(result.length == 0, "Player already joined in an active game");

        // Call permit first
        wejeToken.permit(_player.walletAddress, address(this), _game.buyIn, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(_player.walletAddress, address(this), _game.buyIn);
        require(success, "Token transfer failed");

        Game storage newGame = games[_game.gameId];
        newGame.gameId = _game.gameId;
        newGame.gameType = _game.gameType;
        newGame.minBet = _game.minBet;
        newGame.buyIn = _game.buyIn;
        newGame.lastModified = block.timestamp;
        newGame.isPublic = _game.isPublic;
        newGame.media = _game.media;
        newGame.rTimeout = _game.rTimeout;
        newGame.admin = _player.playerId;
        newGame.autoHandStart = _game.autoHandStart;
        gameIds.push(_game.gameId);

        // Create a new Player struct and initialize it
        Player memory newPlayer;
        newPlayer.playerId = _player.playerId;
        newPlayer.wallet = _game.buyIn;
        newPlayer.walletAddress = _player.walletAddress;
        newPlayer.name = _player.name;
        newPlayer.photoUrl = _player.photoUrl;
        newGame.players.push(newPlayer);
        handleInvPlayers(_invPlayers, newGame);
        emit GameCreated(_game.gameId, _game.gameType);
    }

    function joinGame(
        string memory gameId,
        Player calldata player,
        uint amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant {
        require(bytes(gameId).length > 0, "Invalid game ID");
        require(bytes(games[gameId].gameId).length > 0, "Game not found");
        require(games[gameId].players.length < 10, "No empty Seat");
        require(amount >= games[gameId].buyIn, "Invalid deposit amount");

        // Check if the player is already joined in any active game
        require(findPlayerIndex(games[gameId], player.playerId) == -1, "Player already joined in an active game");

        // Call permit first
        wejeToken.permit(player.walletAddress, address(this), amount, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(player.walletAddress, address(this), amount);
        require(success, "Token transfer failed");

        // Create a new Player struct and initialize it
        Player memory newPlayer;
        newPlayer.playerId = player.playerId;
        newPlayer.wallet = amount;
        newPlayer.walletAddress = player.walletAddress;
        newPlayer.name = player.name;
        newPlayer.photoUrl = player.photoUrl;
        games[gameId].players.push(newPlayer);
        games[gameId].lastModified = block.timestamp;

        emit PlayerJoined(gameId, player.playerId, amount);
    }

    function leaveGame(
        string memory gameId,
        PlayerCall[] memory players,
        uint256 date
    ) external override onlyDeployer {
        Game storage game = games[gameId];
        require(bytes(game.gameId).length > 0, "Game not found");
        uint amt = 0;
        for (uint i = 0; i < players.length; i++) {
            int playerIndex = findPlayerIndex(game, players[i].playerId);
            require(playerIndex != -1, "Player does not exist");

            address payable playerAddress = payable(game.players[uint(playerIndex)].walletAddress);
            if (game.players[uint(playerIndex)].wallet > uint256(players[i].wallet)) {
                amt = game.players[uint(playerIndex)].wallet - uint256(players[i].wallet);
            }

            bool success = wejeTokenERC20.transfer(playerAddress, amt);
            require(success, "Token transfer failed");

            game.players[uint(playerIndex)] = game.players[game.players.length - 1];
            game.players.pop();

            if ((keccak256(abi.encodePacked(game.admin)) == keccak256(abi.encodePacked(players[i].playerId))) && game.players.length > 0) {
                game.admin = game.players[0].playerId;
            }

            game.lastModified = date;
            emit PlayerLeft(game.gameId, players[i].playerId, "");
        }

        if (game.players.length == 0) {
            delete games[gameId];
            removeGameId(gameId);
        }
    }

    function finishHand(
        string memory gameId,
        PlayerCall[] memory players,
        uint256 date
    ) external override onlyDeployer {
        Game storage game = games[gameId];
        require(bytes(game.gameId).length > 0, "Game not found");

        for (uint i = 0; i < players.length; i++) {
            int playerIndex = findPlayerIndex(game, players[i].playerId);
            require(playerIndex != -1, "Player not found in the game");
            uint amt = 0;
            if (!players[i].isWon) {
                if (game.players[uint(playerIndex)].wallet > players[i].wallet) {
                    amt = game.players[uint(playerIndex)].wallet - players[i].wallet;
                }
            } else {
                uint commissionAmount = players[i].wallet * commissionRate / 100;
                commission += commissionAmount;
                amt = game.players[uint(playerIndex)].wallet + players[i].wallet - commissionAmount;
            }
            game.players[uint(playerIndex)].wallet = amt;
        }
        game.lastModified = date;
    }

    function buyCoins(
        string memory gameId,
        string memory playerId,
        uint depositAmount,
        uint256 date,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant {
        require(bytes(gameId).length > 0, "Invalid game ID");
        require(bytes(games[gameId].gameId).length > 0, "Game not found");
        require(depositAmount >= games[gameId].minBet, "Invalid deposit amount");

        // Check if the player exists in the current game's players array
        int playerIndex = findPlayerIndex(games[gameId], playerId);
        require(playerIndex != -1, "Player does not exist");

        // Call permit first
        wejeToken.permit(games[gameId].players[uint(playerIndex)].walletAddress, address(this), depositAmount, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(games[gameId].players[uint(playerIndex)].walletAddress, address(this), depositAmount);
        require(success, "Token transfer failed");

        // Update the player's wallet with the depositAmount
        games[gameId].players[uint(playerIndex)].wallet += depositAmount;
        games[gameId].lastModified = date;

        emit BuyCoin(gameId, playerId, depositAmount);
    }

    function getContractBalance() public view returns (uint256, uint256) {
        uint256 nativeBalance = address(this).balance;
        uint256 contractBalance = wejeTokenERC20.balanceOf(address(this));
        return (nativeBalance, contractBalance);
    }
}