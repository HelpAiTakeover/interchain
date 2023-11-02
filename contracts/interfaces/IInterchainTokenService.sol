// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IAxelarValuedExpressExecutable } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarValuedExpressExecutable.sol';
import { IContractIdentifier } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IContractIdentifier.sol';
import { IMulticall } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IMulticall.sol';
import { IInterchainAddressTracker } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IInterchainAddressTracker.sol';
import { IPausable } from '@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IPausable.sol';

import { ITokenManagerType } from './ITokenManagerType.sol';

interface IInterchainTokenService is ITokenManagerType, IAxelarValuedExpressExecutable, IPausable, IMulticall, IContractIdentifier {
    error ZeroAddress();
    error LengthMismatch();
    error InvalidTokenManagerImplementationType(address implementation);
    error NotRemoteService();
    error TokenManagerDoesNotExist(bytes32 tokenId_);
    error NotTokenManager(address caller, address tokenManager);
    error ExecuteWithInterchainTokenFailed(address contractAddress);
    error InvalidCanonicalTokenId(bytes32 expectedCanonicalTokenId);
    error ExpressExecuteWithInterchainTokenFailed(address contractAddress);
    error GatewayToken();
    error TokenManagerDeploymentFailed(bytes error);
    error StandardizedTokenDeploymentFailed(bytes error);
    error SelectorUnknown(uint256 selector);
    error InvalidMetadataVersion(uint32 version);
    error ExecuteWithTokenNotSupported();
    error UntrustedChain(string chainName);
    error InvalidExpressSelector(uint256 selector);

    event TokenSent(bytes32 indexed tokenId_, string destinationChain, bytes destinationAddress, uint256 indexed amount);
    event TokenSentWithData(
        bytes32 indexed tokenId_,
        string destinationChain,
        bytes destinationAddress,
        uint256 indexed amount,
        address indexed sourceAddress,
        bytes data
    );
    event TokenReceived(
        bytes32 indexed tokenId_,
        string sourceChain,
        bytes sourceAddress,
        address indexed destinationAddress,
        uint256 indexed amount
    );
    event TokenReceivedWithData(
        bytes32 indexed tokenId_,
        string sourceChain,
        bytes sourceAddress,
        address indexed destinationAddress,
        uint256 indexed amount
    );
    event RemoteTokenManagerDeploymentInitialized(
        bytes32 indexed tokenId_,
        string destinationChain,
        uint256 indexed gasValue,
        TokenManagerType indexed tokenManagerType,
        bytes params
    );
    event RemoteStandardizedTokenAndManagerDeploymentInitialized(
        bytes32 indexed tokenId_,
        string tokenName,
        string tokenSymbol,
        uint8 tokenDecimals,
        bytes distributor,
        bytes mintTo,
        uint256 indexed mintAmount,
        bytes operator,
        string destinationChain,
        uint256 indexed gasValue
    );
    event TokenManagerDeployed(bytes32 indexed tokenId_, address tokenManager, TokenManagerType indexed tokenManagerType, bytes params);
    event StandardizedTokenDeployed(
        bytes32 indexed tokenId_,
        address tokenAddress,
        address indexed distributor,
        string name,
        string symbol,
        uint8 decimals,
        uint256 indexed mintAmount,
        address mintTo
    );
    event CustomTokenIdClaimed(bytes32 indexed tokenId_, address indexed deployer, bytes32 indexed salt);
    event PausedSet(bool indexed paused, address indexed msgSender);

    /**
     * @notice Returns the address of the interchain router contract.
     * @return interchainAddressTracker_ The interchainAddressTracker.
     */
    function interchainAddressTracker() external view returns (IInterchainAddressTracker interchainAddressTracker_);

    /**
     * @notice Returns the address of the token manager deployer contract.
     * @return tokenManagerDeployerAddress The address of the token manager deployer contract.
     */
    function tokenManagerDeployer() external view returns (address tokenManagerDeployerAddress);

    /**
     * @notice Returns the address of the standardized token deployer contract.
     * @return standardizedTokenDeployerAddress The address of the standardized token deployer contract.
     */
    function standardizedTokenDeployer() external view returns (address standardizedTokenDeployerAddress);

    /**
     * @notice Returns the address of the token manager associated with the given tokenId_.
     * @param tokenId_ The tokenId_ of the token manager.
     * @return tokenManagerAddress_ The address of the token manager.
     */
    function tokenManagerAddress(bytes32 tokenId_) external view returns (address tokenManagerAddress_);

    /**
     * @notice Returns the address of the valid token manager associated with the given tokenId_.
     * @param tokenId_ The tokenId_ of the token manager.
     * @return tokenManagerAddress_ The address of the valid token manager.
     */
    function validTokenManagerAddress(bytes32 tokenId_) external view returns (address tokenManagerAddress_);

    /**
     * @notice Returns the address of the token associated with the given tokenId_.
     * @param tokenId_ The tokenId_ of the token manager.
     * @return tokenAddress_ The address of the token.
     */
    function tokenAddress(bytes32 tokenId_) external view returns (address tokenAddress_);

    /**
     * @notice Returns the address of the standardized token associated with the given tokenId_.
     * @param tokenId_ The tokenId_ of the standardized token.
     * @return tokenAddress_ The address of the standardized token.
     */
    function interchainTokenAddress(bytes32 tokenId_) external view returns (address tokenAddress_);

    /**
     * @notice Returns the canonical tokenId_ associated with the given tokenAddress.
     * @param tokenAddress_ The address of the token.
     * @return tokenId_ The canonical tokenId_ associated with the tokenAddress.
     */
    function canonicalTokenId(address tokenAddress_) external view returns (bytes32 tokenId_);

    /**
     * @notice Returns the custom tokenId_ associated with the given operator and salt.
     * @param operator_ The operator address.
     * @param salt The salt used for token id calculation.
     * @return tokenId_ The custom tokenId_ associated with the operator and salt.
     */
    function tokenId(address operator_, bytes32 salt) external view returns (bytes32 tokenId_);

    /**
     * @notice Registers a canonical token and returns its associated tokenId_.
     * @param tokenAddress_ The address of the canonical token.
     * @return tokenId_ The tokenId_ associated with the registered canonical token.
     */
    function registerCanonicalToken(address tokenAddress_) external payable returns (bytes32 tokenId_);

    /**
     * @notice Deploys a standardized canonical token on a remote chain.
     * @param tokenId_ The tokenId_ of the canonical token.
     * @param destinationChain The name of the destination chain.
     * @param gasValue The gas value for deployment.
     */
    function deployRemoteCanonicalToken(bytes32 tokenId_, string calldata destinationChain, uint256 gasValue) external payable;

    /**
     * @notice Deploys a custom token manager contract.
     * @param salt The salt used for token manager deployment.
     * @param tokenManagerType The type of token manager.
     * @param params The deployment parameters.
     * @return tokenId_ The tokenId_ of the deployed token manager.
     */
    function deployCustomTokenManager(
        bytes32 salt,
        TokenManagerType tokenManagerType,
        bytes memory params
    ) external payable returns (bytes32 tokenId_);

    /**
     * @notice Deploys a custom token manager contract on a remote chain.
     * @param salt The salt used for token manager deployment.
     * @param destinationChain The name of the destination chain.
     * @param tokenManagerType The type of token manager.
     * @param params The deployment parameters.
     * @param gasValue The gas value for deployment.
     */
    function deployTokenManager(
        bytes32 salt,
        string calldata destinationChain,
        TokenManagerType tokenManagerType,
        bytes calldata params,
        uint256 gasValue
    ) external payable returns (bytes32 tokenId_);

    /**
     * @notice Deploys a standardized token and registers it. The token manager type will be lock/unlock unless the distributor matches its address, in which case it will be a mint/burn one.
     * @param salt The salt used for token deployment.
     * @param name The name of the standardized token.
     * @param symbol The symbol of the standardized token.
     * @param decimals The number of decimals for the standardized token.
     * @param mintAmount The amount of tokens to mint to the deployer.
     * @param distributor The address of the distributor for mint/burn operations.
     */
    function deployAndRegisterStandardizedToken(
        bytes32 salt,
        string calldata name,
        string calldata symbol,
        uint8 decimals,
        uint256 mintAmount,
        address distributor
    ) external payable;

    /**
     * @notice Deploys and registers a standardized token on a remote chain.
     * @param salt The salt used for token deployment.
     * @param name The name of the standardized tokens.
     * @param symbol The symbol of the standardized tokens.
     * @param decimals The number of decimals for the standardized tokens.
     * @param distributor The distributor data for mint/burn operations.
     * @param mintTo The address where the minted tokens will be sent upon deployment.
     * @param mintAmount The amount of tokens to be minted upon deployment.
     * @param operator The operator data for standardized tokens.
     * @param destinationChain The name of the destination chain.
     * @param gasValue The gas value for deployment.
     */
    function deployInterchainToken(
        bytes32 salt,
        string memory name,
        string memory symbol,
        uint8 decimals,
        bytes memory distributor,
        bytes memory mintTo,
        uint256 mintAmount,
        bytes memory operator,
        string calldata destinationChain,
        uint256 gasValue
    ) external payable;

    /**
     * @notice Returns the implementation address for a given token manager type.
     * @param tokenManagerType The type of token manager.
     * @return tokenManagerAddress_ The address of the token manager implementation.
     */
    function tokenManagerImplementation(uint256 tokenManagerType) external view returns (address tokenManagerAddress_);

    function interchainTransfer(
        bytes32 tokenId_,
        string calldata destinationChain,
        bytes calldata destinationAddress,
        uint256 amount,
        bytes calldata metadata
    ) external payable;

    function sendTokenWithData(
        bytes32 tokenId_,
        string calldata destinationChain,
        bytes calldata destinationAddress,
        uint256 amount,
        bytes calldata data
    ) external payable;

    /**
     * @notice Initiates an interchain token transfer. Only callable by TokenManagers
     * @param tokenId_ The tokenId_ of the token to be transmitted.
     * @param sourceAddress The source address of the token.
     * @param destinationChain The name of the destination chain.
     * @param destinationAddress The destination address on the destination chain.
     * @param amount The amount of tokens to transmit.
     * @param metadata The metadata associated with the transmission.
     */
    function transmitSendToken(
        bytes32 tokenId_,
        address sourceAddress,
        string calldata destinationChain,
        bytes memory destinationAddress,
        uint256 amount,
        bytes calldata metadata
    ) external payable;

    /**
     * @notice Sets the flow limits for multiple tokens.
     * @param tokenIds An array of tokenIds.
     * @param flowLimits An array of flow limits corresponding to the tokenIds.
     */
    function setFlowLimits(bytes32[] calldata tokenIds, uint256[] calldata flowLimits) external;

    /**
     * @notice Returns the flow limit for a specific token.
     * @param tokenId_ The tokenId_ of the token.
     * @return flowLimit_ The flow limit for the token.
     */
    function flowLimit(bytes32 tokenId_) external view returns (uint256 flowLimit_);

    /**
     * @notice Returns the total amount of outgoing flow for a specific token.
     * @param tokenId_ The tokenId_ of the token.
     * @return flowOutAmount_ The total amount of outgoing flow for the token.
     */
    function flowOutAmount(bytes32 tokenId_) external view returns (uint256 flowOutAmount_);

    /**
     * @notice Returns the total amount of incoming flow for a specific token.
     * @param tokenId_ The tokenId_ of the token.
     * @return flowInAmount_ The total amount of incoming flow for the token.
     */
    function flowInAmount(bytes32 tokenId_) external view returns (uint256 flowInAmount_);

    /**
     * @notice Sets the paused state of the contract.
     * @param paused The boolean value indicating whether the contract is paused or not.
     */
    function setPaused(bool paused) external;
}
