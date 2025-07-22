// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token for testing purposes
 * Allows minting and burning for test scenarios
 */
contract MockERC20 is ERC20, Ownable {
    uint8 private _decimals;
    
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimals_;
    }
    
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
    
    /**
     * @dev Mint tokens to specified address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    /**
     * @dev Mint tokens to multiple addresses
     * @param recipients Array of addresses to mint tokens to
     * @param amounts Array of amounts to mint to each address
     */
    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }
    
    /**
     * @dev Burn tokens from specified address
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
    
    /**
     * @dev Burn tokens from caller
     * @param amount Amount of tokens to burn
     */
    function burnSelf(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    /**
     * @dev Set allowance for testing purposes
     * @param owner Owner of tokens
     * @param spender Spender address
     * @param amount Allowance amount
     */
    function setAllowance(address owner, address spender, uint256 amount) external onlyOwner {
        _approve(owner, spender, amount);
    }
    
    /**
     * @dev Force transfer tokens (for testing edge cases)
     * @param from From address
     * @param to To address
     * @param amount Amount to transfer
     */
    function forceTransfer(address from, address to, uint256 amount) external onlyOwner {
        _transfer(from, to, amount);
    }
    
    /**
     * @dev Get total supply for testing
     */
    function getTotalSupply() external view returns (uint256) {
        return totalSupply();
    }
    
    /**
     * @dev Pause all transfers (for testing emergency scenarios)
     */
    bool private _paused = false;
    
    function pause() external onlyOwner {
        _paused = true;
    }
    
    function unpause() external onlyOwner {
        _paused = false;
    }
    
    function paused() external view returns (bool) {
        return _paused;
    }
    
    /**
     * @dev Override transfer to add pause functionality
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        require(!_paused, "Token transfers are paused");
        super._update(from, to, value);
    }
    
    /**
     * @dev Simulate transfer failure for testing
     */
    bool private _shouldFailTransfers = false;
    
    function setShouldFailTransfers(bool shouldFail) external onlyOwner {
        _shouldFailTransfers = shouldFail;
    }
    
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        require(!_shouldFailTransfers, "Transfer artificially failed");
        return super.transfer(to, amount);
    }
    
    function transferFrom(address from, address to, uint256 amount) public virtual override returns (bool) {
        require(!_shouldFailTransfers, "Transfer artificially failed");
        return super.transferFrom(from, to, amount);
    }
    
    /**
     * @dev Add some test utility functions
     */
    function mintToContract(address contractAddress, uint256 amount) external onlyOwner {
        _mint(contractAddress, amount);
    }
    
    function getBalanceOf(address account) external view returns (uint256) {
        return balanceOf(account);
    }
    
    function getAllowanceOf(address owner, address spender) external view returns (uint256) {
        return allowance(owner, spender);
    }
}

/**
 * @title MockERC20Revert
 * @dev Mock token that always reverts on transfer (for testing error handling)
 */
contract MockERC20Revert is ERC20, Ownable {
    constructor() ERC20("Revert Token", "REVERT") Ownable(msg.sender) {}
    
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    function transfer(address, uint256) public pure override returns (bool) {
        revert("MockERC20Revert: transfer always fails");
    }
    
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert("MockERC20Revert: transferFrom always fails");
    }
}

/**
 * @title MockERC20ReturnFalse
 * @dev Mock token that returns false on transfer (for testing non-reverting failures)
 */
contract MockERC20ReturnFalse is ERC20, Ownable {
    constructor() ERC20("False Token", "FALSE") Ownable(msg.sender) {}
    
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
    
    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}