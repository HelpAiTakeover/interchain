// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IContractIdentifier } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IContractIdentifier.sol';

import { IInterchainTokenBase } from './IInterchainTokenBase.sol';
import { IDistributable } from './IDistributable.sol';
import { IERC20MintableBurnable } from './IERC20MintableBurnable.sol';
import { ITokenManager } from './ITokenManager.sol';
import { IERC20Named } from './IERC20Named.sol';

/**
 * @title InterchainToken
 * @notice This contract implements a interchain token which extends InterchainToken functionality.
 * This contract also inherits Distributable and Implementation logic.
 */
interface IInterchainToken is IInterchainTokenBase, IDistributable, IERC20MintableBurnable, IERC20Named, IContractIdentifier {
    error TokenManagerAddressZero();
    error TokenNameEmpty();

    /**
     * @notice Called by the proxy to setup itself.
     * @dev This should be hidden by the proxy.
     * @param params the data to be used for the initialization.
     */
    function setup(bytes calldata params) external;

    /**
     * @notice Getter for the tokenManager used for this token.
     * @dev Needs to be overwitten.
     * @return tokenManager_ the TokenManager called to facilitate cross chain transfers.
     */
    function tokenManager() external view returns (ITokenManager tokenManager_);
}
