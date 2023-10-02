// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IInterchainTokenService } from '../interfaces/IInterchainTokenService.sol';
import { ICanonicalTokenRegistrar } from '../interfaces/ICanonicalTokenRegistrar.sol';
import { ITokenManagerType } from '../interfaces/ITokenManagerType.sol';
import { IERC20Named } from '../interfaces/IERC20Named.sol';

import { Multicall } from '../utils/Multicall.sol';

contract CanonicalTokenRegistrar is ICanonicalTokenRegistrar, ITokenManagerType, Multicall {
    IInterchainTokenService public immutable service;
    string public chainName;
    bytes32 public immutable chainNameHash;

    bytes32 internal constant PREFIX_CANONICAL_TOKEN_SALT = keccak256('canonical-token-salt');

    constructor(address interchainTokenServiceAddress, string memory chainName_) {
        if (interchainTokenServiceAddress == address(0)) revert ZeroAddress();
        service = IInterchainTokenService(interchainTokenServiceAddress);
        chainName = chainName_;
        chainNameHash = keccak256(bytes(chainName_));
    }

    function getCanonicalTokenSalt(address tokenAddress) public pure returns (bytes32 salt) {
        salt = keccak256(abi.encode(PREFIX_CANONICAL_TOKEN_SALT, tokenAddress));
    }

    function getCanonicalTokenId(address tokenAddress) public view returns (bytes32 tokenId) {
        tokenId = service.getCustomTokenId(address(this), getCanonicalTokenSalt(tokenAddress));
    }

    function registerCanonicalToken(address tokenAddress) external payable {
        bytes memory params = abi.encode('', tokenAddress);
        bytes32 salt = getCanonicalTokenSalt(tokenAddress);
        service.deployCustomTokenManager(salt, TokenManagerType.LOCK_UNLOCK, params);
    }

    function deployAndRegisterRemoteCanonicalToken(bytes32 salt, string calldata destinationChain, uint256 gasValue) external payable {
        // This ensures that the token manages has been deployed by this address, so it's safe to trust it.
        bytes32 tokenId = service.getCustomTokenId(address(this), salt);
        IERC20Named token = IERC20Named(service.getTokenAddress(tokenId));
        // The 3 lines below will revert if the token manager does not exist.
        string memory tokenName = token.name();
        string memory tokenSymbol = token.symbol();
        uint8 tokenDecimals = token.decimals();
        service.deployAndRegisterRemoteStandardizedToken{ value: gasValue }(
            salt,
            tokenName,
            tokenSymbol,
            tokenDecimals,
            '',
            '',
            0,
            '',
            destinationChain,
            gasValue
        );
    }
}
