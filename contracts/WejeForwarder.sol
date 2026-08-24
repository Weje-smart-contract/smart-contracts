// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title WejeForwarder
 * @dev Standard OpenZeppelin ERC-2771 Trusted Forwarder for gas-sponsored meta-transactions
 */
contract WejeForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("WejeTrustedForwarder") {}
}
