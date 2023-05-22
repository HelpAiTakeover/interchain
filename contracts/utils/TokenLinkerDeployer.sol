// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import { Create3Deployer } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/deploy/Create3Deployer.sol';

import { ITokenLinkerDeployer } from '../interfaces/ITokenLinkerDeployer.sol';

contract TokenLinkerDeployer is ITokenLinkerDeployer {
    Create3Deployer public immutable deployer;
    address public immutable bytecodeServer;

    constructor(address deployer_, address bytecodeServer_) {
        if (deployer_ == address(0) || bytecodeServer_ == address(0)) revert AddressZero();
        deployer = Create3Deployer(deployer_);
        bytecodeServer = bytecodeServer_;
    }

    // this function assumes that the sender will delegatecall to deploy tokens, which is the case.
    function getTokenLinkerAddress(bytes32 tokenLinkerId) public view returns (address deployment) {
        deployment = deployer.deployedAddress(address(this), tokenLinkerId);
    }

    function getBytecode(bytes calldata args) external view returns (bytes memory bytecode) {
        uint256 bytecodeLen;
        address server = bytecodeServer;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            bytecodeLen := extcodesize(server)
        }
        uint256 argsLen = args.length;
        uint256 totalLen = argsLen + bytecodeLen;
        bytecode = new bytes(totalLen);
        uint256 start = bytecodeLen + 32;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            extcodecopy(server, add(bytecode, 32), 0, bytecodeLen)
            calldatacopy(add(bytecode, start), args.offset, argsLen)
            mstore(bytecode, totalLen)
        }
    }

    function _deployTokenLinker(
        bytes32 tokenLinkerId,
        TokenLinkerType implementationType,
        bytes calldata params
    ) internal returns (address tokenAddress) {
        bytes memory args = abi.encode(address(this), implementationType, params);
        // convert args to calldata by doing an external call to handle more easily in the function
        bytes memory bytecode = this.getBytecode(args);
        tokenAddress = deployer.deploy(bytecode, tokenLinkerId);
    }
}
