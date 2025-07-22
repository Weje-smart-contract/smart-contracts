//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./GameUtil.sol";

contract LudoGame is GameUtil {
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
        require(bytes(isPlayerJoined(_player.playerId)).length == 0, "Player already joined in an active game");
        require(_game.minBet > 0, "Insufficient buy-in amount");

        // Call permit first
        wejeToken.permit(_player.walletAddress, address(this), _game.minBet, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(_player.walletAddress, address(this), _game.minBet);
        require(success, "Token transfer failed");

        // Initialize the new game
        Game storage newGame = games[_game.gameId];
        newGame.gameId = _game.gameId;
        newGame.gameType = _game.gameType;
        newGame.minBet = _game.minBet;
        newGame.lastModified = block.timestamp;
        newGame.isPublic = _game.isPublic;
        newGame.media = _game.media;
        newGame.rTimeout = _game.rTimeout;
        newGame.admin = _player.playerId;
        newGame.gameTime=_game.gameTime;
        newGame.autoHandStart = _game.autoHandStart;
        handleInvPlayers(_invPlayers, newGame);
        gameIds.push(_game.gameId);

        // Create a new Player struct and initialize it
        Player memory newPlayer;
        newPlayer.playerId = _player.playerId;
        newPlayer.wallet = _game.minBet;
        newPlayer.walletAddress = _player.walletAddress;
        newPlayer.name = _player.name;
        newPlayer.photoUrl = _player.photoUrl;
        newGame.players.push(newPlayer);
        emit GameCreated(_game.gameId, _game.gameType);
    }

    function joinGame(
        string memory _gameId,
        Player calldata _player,
        uint amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant {
        require(bytes(_gameId).length > 0, "Invalid game ID");

        Game storage game = games[_gameId];
        require(bytes(game.gameId).length > 0, "Game not found");

        // Check if the player is already in any active game
        string memory existingGameId = isPlayerJoined(_player.playerId);
        require(bytes(existingGameId).length == 0, "Player already joined in an active game");

        require(game.players.length < 4, "No empty Seat");
        require(amount >= game.minBet, "Invalid deposit amount");

        // Call permit first
        wejeToken.permit(_player.walletAddress, address(this), amount, deadline, v, r, s);

        // Then transferFrom
        bool success = wejeTokenERC20.transferFrom(_player.walletAddress, address(this), amount);
        require(success, "Token transfer failed");

        // Create a new Player struct and initialize it
        Player memory newPlayer;
        newPlayer.playerId = _player.playerId;
        newPlayer.wallet = amount;
        newPlayer.walletAddress = _player.walletAddress;
        newPlayer.name = _player.name;
        newPlayer.photoUrl = _player.photoUrl;
        game.players.push(newPlayer);
        game.lastModified = block.timestamp;

        emit PlayerJoined(_gameId, _player.playerId, amount);
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
}