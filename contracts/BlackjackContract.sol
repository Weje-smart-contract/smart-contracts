//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GameUtil.sol";

contract BlackjackGame is GameUtil {
    using SafeERC20 for IERC20;
    constructor(address _wejeTokenAddress) GameUtil(_wejeTokenAddress) {}

    function createGame(
        GameInfo calldata _game,
        Player calldata player,
        string[] calldata _invPlayers,
        PermitParams calldata _permit
    ) external override nonReentrant {
        require(_game.buyIn > 0, "Insufficient buy-in amount");
        bytes memory result = bytes(isPlayerJoined(player.playerId));
        require(result.length == 0, "Player already joined in an active game");

        // Call permit first
        if(_permit.deadline > 0) {
            try wejeToken.permit(player.walletAddress, address(this), _game.buyIn, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }

        // Then transferFrom
        wejeTokenERC20.safeTransferFrom(player.walletAddress, address(this), _game.buyIn);

        Game storage newGame = games[_game.gameId];
        newGame.gameId = _game.gameId;
        newGame.gameType = _game.gameType;
        newGame.minBet = _game.minBet;
        newGame.lastModified = block.timestamp;
        newGame.isPublic = _game.isPublic;
        newGame.media = _game.media;
        newGame.rTimeout = _game.rTimeout;
        newGame.admin = player.playerId;
        newGame.autoHandStart = _game.autoHandStart;
        gameIds.push(_game.gameId);

        // Create a new Player struct and initialize it
        Player memory newPlayer;
        newPlayer.playerId = player.playerId;
        newPlayer.wallet = _game.buyIn;
        newPlayer.walletAddress = player.walletAddress;
        newPlayer.name = player.name;
        newPlayer.photoUrl = player.photoUrl;
        newGame.players.push(newPlayer);
        handleInvPlayers(_invPlayers, newGame);
        emit GameCreated(_game.gameId, _game.gameType);
    }

    function joinGame(
        string memory gameId,
        Player calldata player,
        uint amount,
       PermitParams calldata _permit
    ) external override nonReentrant {
        require(bytes(gameId).length > 0, "Invalid game ID");
        require(bytes(games[gameId].gameId).length > 0, "Game not found");
        require(games[gameId].players.length < 7, "No empty Seat");
        require(amount >= games[gameId].minBet, "Invalid deposit amount");

        // Check if the player is already joined in any active game
        require(findPlayerIndex(games[gameId], player.playerId) == -1, "Player already joined in an active game");

        if(_permit.deadline > 0) {
            try wejeToken.permit(player.walletAddress, address(this), amount, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }

        // Then transferFrom
        wejeTokenERC20.safeTransferFrom(player.walletAddress, address(this), amount);

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
        for (uint i = 0; i < players.length; i++) {
            int playerIndex = findPlayerIndex(game, players[i].playerId);
            require(playerIndex != -1, "Player does not exist");

            address payable playerAddress = payable(game.players[uint(playerIndex)].walletAddress);

            bool success = wejeTokenERC20.transfer(playerAddress, players[i].wallet);
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

    // Blackjack doesn't use finishHand, it uses leaveGame for game completion
    function finishHand(
        string memory,
        PlayerCall[] memory,
        uint256
    ) external pure override {
       
    }

    function buyCoins(
        string memory gameId,
        string memory playerId,
        uint depositAmount,
        uint256 date,
       PermitParams calldata _permit
    ) external override nonReentrant {
        require(bytes(gameId).length > 0, "Invalid game ID");
        require(bytes(games[gameId].gameId).length > 0, "Game not found");
        require(depositAmount >= games[gameId].minBet, "Invalid deposit amount");

        // Check if the player exists in the current game's players array
        int playerIndex = findPlayerIndex(games[gameId], playerId);
        require(playerIndex != -1, "Player does not exist");

        // Call permit first
        if(_permit.deadline > 0) {
            try wejeToken.permit(games[gameId].players[uint(playerIndex)].walletAddress, address(this), depositAmount, _permit.deadline, _permit.v, _permit.r, _permit.s) {} catch {}
        }

        // Then transferFrom
        wejeTokenERC20.safeTransferFrom(games[gameId].players[uint(playerIndex)].walletAddress, address(this), depositAmount);

        // Update the player's wallet with the depositAmount
        games[gameId].players[uint(playerIndex)].wallet += depositAmount;
        games[gameId].lastModified = date;

        emit BuyCoin(gameId, playerId, depositAmount);
    }
}