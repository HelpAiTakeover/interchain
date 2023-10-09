// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IERC20 } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol';
import { SafeTokenCall } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/libs/SafeTransfer.sol';

import { TokenManager } from '../TokenManager.sol';
import { IERC20MintableBurnable } from '../../interfaces/IERC20MintableBurnable.sol';
import { ITokenManagerMintBurn } from '../../interfaces/ITokenManagerMintBurn.sol';

/**
 * @title TokenManagerMintBurn
 * @notice This contract is an implementation of TokenManager that mints and burns a specific token on behalf of the interchain token service.
 * @dev This contract extends TokenManagerAddressStorage and provides implementation for its abstract methods.
 * It uses the Axelar SDK to safely transfer tokens.
 */
contract TokenManagerMintBurn is TokenManager, ITokenManagerMintBurn {
    using SafeTokenCall for IERC20;

    /**
     * @dev Constructs an instance of TokenManagerMintBurn. Calls the constructor
     * of TokenManagerAddressStorage which calls the constructor of TokenManager.
     * @param interchainTokenService_ The address of the interchain token service contract
     */
    constructor(address interchainTokenService_) TokenManager(interchainTokenService_) {}

    function implementationType() external pure virtual returns (uint256) {
        return uint256(TokenManagerType.MINT_BURN);
    }

    /**
     * @dev Sets up the token address.
     * @param params The setup parameters in bytes. Should be encoded with the token address.
     */
    function _setup(bytes calldata params) internal override {
        // The first argument is reserved for the operator.
        (, address tokenAddress_) = abi.decode(params, (bytes, address));
        _setTokenAddress(tokenAddress_);
    }

    /**
     * @dev Burns the specified amount of tokens from a particular address.
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     * @return uint Amount of tokens burned
     */
    function _takeToken(address from, uint256 amount) internal virtual override returns (uint256) {
        IERC20 token = IERC20(tokenAddress());

        token.safeCall(abi.encodeWithSelector(IERC20MintableBurnable.burn.selector, from, amount));

        return amount;
    }

    /**
     * @dev Mints the specified amount of tokens to a particular address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     * @return uint Amount of tokens minted
     */
    function _giveToken(address to, uint256 amount) internal override returns (uint256) {
        IERC20 token = IERC20(tokenAddress());

        token.safeCall(abi.encodeWithSelector(IERC20MintableBurnable.mint.selector, to, amount));

        return amount;
    }

    /**
     * @notice Getter function for the parameters of a lock/unlock TokenManager. Mainly to be used by frontends.
     * @param operator_ the operator of the TokenManager.
     * @param tokenAddress_ the token to be managed.
     * @return params the resulting params to be passed to custom TokenManager deployments.
     */
    function getParams(bytes memory operator_, address tokenAddress_) external pure returns (bytes memory params) {
        params = abi.encode(operator_, tokenAddress_);
    }
}
