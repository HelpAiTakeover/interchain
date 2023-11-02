// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { FixedProxy } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/upgradable/FixedProxy.sol';

import { IStandardizedToken } from '../interfaces/IStandardizedToken.sol';
import { IImplementation } from '../interfaces/IImplementation.sol';

/**
 * @title StandardizedTokenProxy
 * @dev Proxy contract for StandardizedToken contracts. Inherits from FixedProxy.
 */
contract StandardizedTokenProxy is FixedProxy {
    bytes32 private constant CONTRACT_ID = keccak256('standardized-token');

    /**
     * @dev Constructs the StandardizedTokenProxy contract.
     * @param implementationAddress Address of the StandardizedToken implementation
     * @param params Initialization parameters for the StandardizedToken contract
     */
    constructor(address implementationAddress, bytes memory params) FixedProxy(implementationAddress) {
        if (IStandardizedToken(implementationAddress).contractId() != CONTRACT_ID) revert InvalidImplementation();

        (bool success, ) = implementationAddress.delegatecall(abi.encodeWithSelector(IImplementation.setup.selector, params));
        if (!success) revert SetupFailed();
    }

    /**
     * @notice Getter for the contract id.
     */
    function contractId() internal pure override returns (bytes32) {
        return CONTRACT_ID;
    }
}
