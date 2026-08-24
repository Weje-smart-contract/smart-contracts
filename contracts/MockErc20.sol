// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title MockERC20
 * @dev Mock ERC20 token with EIP-2612 Permit for testing purposes
 */
contract MockERC20 is ERC20, ERC20Permit, Ownable {
    uint8 private _decimals;
    
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(msg.sender) {
        _decimals = decimals_;
    }
    
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }
    
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
    
    function burnSelf(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    function setAllowance(address owner, address spender, uint256 amount) external onlyOwner {
        _approve(owner, spender, amount);
    }
    
    function forceTransfer(address from, address to, uint256 amount) external onlyOwner {
        _transfer(from, to, amount);
    }
    
    function getTotalSupply() external view returns (uint256) {
        return totalSupply();
    }
    
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
    
    function _update(address from, address to, uint256 value) internal virtual override {
        require(!_paused, "Token transfers are paused");
        super._update(from, to, value);
    }
    
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
 * @title MockToken
 * @dev Alias contract for MockERC20 with default 18 decimals
 */
contract MockToken is MockERC20 {
    constructor() MockERC20("Mock Token", "MTK", 18) {}
}

/**
 * @title MockSmartAccount
 * @dev Mock Smart Contract Wallet supporting ERC-1271 isValidSignature
 */
contract MockSmartAccount is IERC1271, Ownable {
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;
    bool public shouldFailSignature = false;

    constructor(address _owner) Ownable(_owner) {}

    function setShouldFailSignature(bool _fail) external onlyOwner {
        shouldFailSignature = _fail;
    }

    function approveToken(address token, address spender, uint256 amount) external onlyOwner {
        IERC20(token).approve(spender, amount);
    }

    function execute(address target, uint256 value, bytes calldata data) external onlyOwner returns (bytes memory) {
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "Execution failed");
        return result;
    }

    function isValidSignature(bytes32 _hash, bytes memory _signature) external view override returns (bytes4) {
        if (shouldFailSignature) {
            return 0xffffffff;
        }
        address recovered = ECDSA.recover(_hash, _signature);
        if (recovered == owner()) {
            return MAGICVALUE;
        }
        return 0xffffffff;
    }
}

/**
 * @title MockForwarder
 * @dev Minimal ERC-2771 trusted forwarder for testing
 */
contract MockForwarder {
    function execute(address target, bytes calldata reqData, address user) external payable returns (bool, bytes memory) {
        bytes memory dataWithSender = abi.encodePacked(reqData, user);
        return target.call{value: msg.value}(dataWithSender);
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