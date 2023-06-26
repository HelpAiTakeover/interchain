// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

// Let's avoid using TokenManagerType in the Proxy. If we add from types in the future, it'll change the proxy address.
// While we're using Create3, to minimize changes to Proxies, I think we should just store a uint256 in the proxy. We can use the enum in ITS.
interface ITokenManagerProxy {
    error ImplementationLookupFailed();
    error SetupFailed();

    function implementationType() external view returns (uint256);

    function implementation() external view returns (address);

    function tokenId() external view returns (bytes32);
}
