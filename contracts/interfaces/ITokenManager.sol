// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import { ITokenManagerType } from './ITokenManagerType.sol';
import { IAdminable } from './IAdminable.sol';
import { IFlowLimit } from './IFlowLimit.sol';
import { IImplementation } from './IImplementation.sol';

interface ITokenManager is ITokenManagerType, IAdminable, IFlowLimit, IImplementation {
    error TokenLinkerZeroAddress();
    error NotService();
    error TakeTokenFailed();
    error GiveTokenFailed();
    error NotToken();

    function tokenAddress() external view returns (address);

    function sendToken(string calldata destinationChain, bytes calldata destinationAddress, uint256 amount) external payable;

    function callContractWithInterchainToken(
        string calldata destinationChain,
        bytes calldata destinationAddress,
        uint256 amount,
        bytes calldata data
    ) external payable;

    function sendSelf(address from, string calldata destinationChain, bytes calldata destinationAddress, uint256 amount) external payable;

    function callContractWithSelf(
        address from,
        string calldata destinationChain,
        bytes calldata destinationAddress,
        uint256 amount,
        bytes calldata data
    ) external payable;

    function giveToken(address destinationAddress, uint256 amount) external returns (uint256);

    function setFlowLimit(uint256 flowLimit) external;

    function requiresApproval() external view returns (bool);
}
