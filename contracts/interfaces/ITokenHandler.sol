// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ITokenHandler Interface
 * @notice This interface is responsible for handling tokens before initiating an interchain token transfer, or after receiving one.
 */
interface ITokenHandler {
    error UnsupportedTokenManagerType(uint256 tokenManagerType);
    error AddressZero();

    /**
     * @notice Returns the address of the axelar gateway on this chain.
     * @return gateway_ The address of the axelar gateway contract.
     */
    function gateway() external view returns (address gateway_);

    /**
     * @notice This function gives token to a specified address from the token manager.
     * @param tokenManagerType The token manager type.
     * @param tokenAddress The address of the token to give.
     * @param tokenManager The address of the token manager.
     * @param to The address to give tokens to.
     * @param amount The amount of tokens to give.
     * @return uint256 The amount of token actually given, which could be different for certain token type.
     */
    function giveToken(
        uint256 tokenManagerType,
        address tokenAddress,
        address tokenManager,
        address to,
        uint256 amount
    ) external payable returns (uint256);

    /**
     * @notice This function takes token from a specified address to the token manager.
     * @param tokenManagerType The token manager type.
     * @param tokenAddress The address of the token to give.
     * @param tokenManager The address of the token manager.
     * @param from The address to take tokens from.
     * @param amount The amount of token to take.
     * @return uint256 The amount of token actually taken, which could be different for certain token type.
     */
    function takeToken(
        uint256 tokenManagerType,
        address tokenAddress,
        address tokenManager,
        address from,
        uint256 amount
    ) external payable returns (uint256);

    /**
     * @notice This function transfers token from and to a specified address.
     * @param tokenManagerType The token manager type.
     * @param tokenAddress the address of the token to give.
     * @param from The address to transfer tokens from.
     * @param to The address to transfer tokens to.
     * @param amount The amount of token to transfer.
     * @return uint256 The amount of token actually transferred, which could be different for certain token type.
     */
    function transferTokenFrom(
        uint256 tokenManagerType,
        address tokenAddress,
        address from,
        address to,
        uint256 amount
    ) external payable returns (uint256);

    /**
     * @notice This function prepares a token manager after it is deployed
     * @param tokenManagerType The token manager type.
     * @param tokenManager The address of the token manager.
     */
    function postTokenManagerDeploy(uint256 tokenManagerType, address tokenManager) external payable;
}
