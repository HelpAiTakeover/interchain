// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Create3 } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/deploy/Create3.sol';

import { ITokenManagerDeployer } from '../interfaces/ITokenManagerDeployer.sol';

import { TokenManagerProxy } from '../proxies/TokenManagerProxy.sol';

/**
 * @title TokenManagerDeployer
 * @notice This contract is used to deploy new instances of the TokenManagerProxy contract.
 */
contract TokenManagerDeployer is ITokenManagerDeployer, Create3 {
    /**
     * @notice Deploys a new instance of the TokenManagerProxy contract
     * @param tokenId The unique identifier for the token
     * @param implementationType Token manager implementation type
     * @param params Additional parameters used in the setup of the token manager
     */
    // slither-disable-next-line locked-ether
    function deployTokenManager(bytes32 tokenId, uint256 implementationType, bytes calldata params) external payable {
        bytes memory args = abi.encode(address(this), implementationType, tokenId, params);
        // slither-disable-next-line too-many-digits
        bytes memory bytecode = abi.encodePacked(type(TokenManagerProxy).creationCode, args);

        address tokenManagerAddress = _create3(bytecode, tokenId);

        if (tokenManagerAddress.code.length == 0) revert TokenManagerDeploymentFailed();
    }
}
