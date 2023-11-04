// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { Create3 } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/deploy/Create3.sol';

import { IInterchainTokenDeployer } from '../interfaces/IInterchainTokenDeployer.sol';

import { InterchainTokenProxy } from '../proxies/InterchainTokenProxy.sol';

/**
 * @title InterchainTokenDeployer
 * @notice This contract is used to deploy new instances of the InterchainTokenProxy contract.
 */
contract InterchainTokenDeployer is IInterchainTokenDeployer, Create3 {
    address public immutable implementationAddress;

    /**
     * @notice Constructor for the InterchainTokenDeployer contract
     * @param implementationAddress_ Address of the InterchainToken contract
     */
    constructor(address implementationAddress_) {
        if (implementationAddress_ == address(0)) revert AddressZero();
        implementationAddress = implementationAddress_;
    }

    /**
     * @notice Deploys a new instance of the InterchainTokenProxy contract
     * @param salt The salt used by Create3Deployer
     * @param tokenManager Address of the token manager
     * @param distributor Address of the distributor
     * @param name Name of the token
     * @param symbol Symbol of the token
     * @param decimals Decimals of the token
     * @return tokenAddress Address of the deployed token
     */
    // slither-disable-next-line locked-ether
    function deployInterchainToken(
        bytes32 salt,
        address tokenManager,
        address distributor,
        string calldata name,
        string calldata symbol,
        uint8 decimals
    ) external payable returns (address tokenAddress) {
        bytes memory params = abi.encode(tokenManager, distributor, name, symbol, decimals);
        // slither-disable-next-line too-many-digits
        bytes memory bytecode = bytes.concat(type(InterchainTokenProxy).creationCode, abi.encode(implementationAddress, params));

        tokenAddress = _create3(bytecode, salt);
        if (tokenAddress.code.length == 0) revert TokenDeploymentFailed();
    }

    function deployedAddress(bytes32 salt) external view returns (address tokenAddress) {
        return _create3Address(salt);
    }
}
