// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ERC20 } from '../interchain-token/ERC20.sol';
import { Distributable } from '../utils/Distributable.sol';
import { IERC20MintableBurnable } from '../interfaces/IERC20MintableBurnable.sol';

contract TestMintableBurnableERC20 is ERC20, Distributable, IERC20MintableBurnable {
    string public name;
    string public symbol;
    uint8 public decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        _addDistributor(msg.sender);
    }

    function mint(address account, uint256 amount) external onlyRole(uint8(Roles.DISTRIBUTOR)) {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external onlyRole(uint8(Roles.DISTRIBUTOR)) {
        _burn(account, amount);
    }
}
