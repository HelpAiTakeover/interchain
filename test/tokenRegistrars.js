'use strict';

const chai = require('chai');
const { expect } = chai;
require('dotenv').config();
const { ethers } = require('hardhat');
const { defaultAbiCoder, keccak256 } = ethers.utils;
const { Contract } = ethers;

const ITokenManager = require('../artifacts/contracts/interfaces/ITokenManager.sol/ITokenManager.json');
const IERC20 = require('../artifacts/@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IERC20.sol/IERC20.json');

const { deployAll, deployContract } = require('../scripts/deploy');

// const SELECTOR_SEND_TOKEN_WITH_DATA = 2;
// const SELECTOR_DEPLOY_TOKEN_MANAGER = 3;
const SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN = 4;

const LOCK_UNLOCK = 0;
const MINT_BURN = 1;

describe.only('Token Registrsrs', () => {
    let wallet;
    let service, gateway, gasService, canonicalTokenRegistrar, standardizedTokenRegistrar;
    const name = 'tokenName';
    const symbol = 'tokenSymbol';
    const decimals = 18;
    const destinationChain = 'destination chain';

    before(async () => {
        const wallets = await ethers.getSigners();
        wallet = wallets[0];
        [service, gateway, gasService] = await deployAll(wallet, 'Test', [destinationChain]);
        canonicalTokenRegistrar = await deployContract(wallet, 'CanonicalTokenRegistrar', [service.address, 'chain name']);
        standardizedTokenRegistrar = await deployContract(wallet, 'StandardizedTokenRegistrar', [service.address, 'chain name']);
    });

    describe('Canonical Token Registrar', async () => {
        let token, tokenId;
        const tokenCap = BigInt(1e18);

        async function deployToken() {
            token = await deployContract(wallet, 'InterchainTokenTest', [name, symbol, decimals, wallet.address]);
            tokenId = await canonicalTokenRegistrar.getCanonicalTokenId(token.address);
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            await (await token.mint(wallet.address, tokenCap)).wait();
            await (await token.setTokenManager(tokenManagerAddress)).wait();
        }

        it('Should register a token', async () => {
            await deployToken();

            const params = defaultAbiCoder.encode(['bytes', 'address'], ['0x', token.address]);

            await expect(canonicalTokenRegistrar.registerCanonicalToken(token.address))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
        });

        it('Should initiate a remote standardized token deployment', async () => {
            const gasValue = 1234;

            await deployToken();

            const salt = await canonicalTokenRegistrar.getCanonicalTokenSalt(token.address);
            const params = defaultAbiCoder.encode(['bytes', 'address'], ['0x', token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, name, symbol, decimals, '0x', '0x', 0, '0x'],
            );

            await expect(canonicalTokenRegistrar.registerCanonicalToken(token.address))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);

            await expect(
                canonicalTokenRegistrar.deployAndRegisterRemoteCanonicalToken(salt, destinationChain, gasValue, { value: gasValue }),
            )
                .to.emit(service, 'RemoteStandardizedTokenAndManagerDeploymentInitialized')
                .withArgs(tokenId, name, symbol, decimals, '0x', '0x', 0, '0x', destinationChain, gasValue)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), payload);
        });
    });

    describe('Standardized Token Registrar', async () => {
        let token, tokenId;
        const mintAmount = 1234;  

    
        it('Should register a token', async () => {
            const salt = keccak256('0x');
            tokenId = await standardizedTokenRegistrar.getStandardizedTokenId(wallet.address, salt);
            const tokenAddress = await standardizedTokenRegistrar.getStandardizedTokenAddress(wallet.address, salt);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [standardizedTokenRegistrar.address, tokenAddress]);
            const tokenManager = new Contract(await service.getTokenManagerAddress(tokenId), ITokenManager.abi, wallet);
            const token = new Contract(tokenAddress, IERC20.abi, wallet)
            await expect(standardizedTokenRegistrar.deployStandardizedToken(
                salt,
                name,
                symbol,
                decimals,
                mintAmount,
                wallet.address,
            ))
                .to.emit(service, 'StandardizedTokenDeployed')
                .withArgs(tokenId, wallet.address, name, symbol, decimals, mintAmount, standardizedTokenRegistrar.address)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params)
                .and.to.emit(token, 'Transfer')
                .withArgs(standardizedTokenRegistrar.address, wallet.address, mintAmount)
                .and.to.emit(tokenManager, 'OperatorshipTransferred')
                .withArgs(wallet.address)
        });

        it('Should initiate a remote standardized token deployment with the same distributor', async () => {
            const gasValue = 1234;

            const salt = keccak256('0x12');
            tokenId = await standardizedTokenRegistrar.getStandardizedTokenId(wallet.address, salt);
            const tokenAddress = await standardizedTokenRegistrar.getStandardizedTokenAddress(wallet.address, salt);
            let params = defaultAbiCoder.encode(['bytes', 'address'], [standardizedTokenRegistrar.address, tokenAddress]);
            const tokenManager = new Contract(await service.getTokenManagerAddress(tokenId), ITokenManager.abi, wallet);
            const token = new Contract(tokenAddress, IERC20.abi, wallet)
            await expect(standardizedTokenRegistrar.deployStandardizedToken(
                salt,
                name,
                symbol,
                decimals,
                mintAmount,
                wallet.address,
            ))
                .to.emit(service, 'StandardizedTokenDeployed')
                .withArgs(tokenId, wallet.address, name, symbol, decimals, mintAmount, standardizedTokenRegistrar.address)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params)
                .and.to.emit(token, 'Transfer')
                .withArgs(standardizedTokenRegistrar.address, wallet.address, mintAmount)
                .and.to.emit(tokenManager, 'OperatorshipTransferred')
                .withArgs(wallet.address)

            params = defaultAbiCoder.encode(['bytes', 'address'], ['0x', token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, name, symbol, decimals, wallet.address.toLowerCase(), '0x', 0, wallet.address.toLowerCase()],
            );


            await expect(
                standardizedTokenRegistrar.deployRemoteStandarizedToken(salt, true, destinationChain, gasValue, { value: gasValue }),
            )
                .to.emit(service, 'RemoteStandardizedTokenAndManagerDeploymentInitialized')
                .withArgs(tokenId, name, symbol, decimals, wallet.address.toLowerCase(), '0x', 0, wallet.address.toLowerCase(), destinationChain, gasValue)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), payload);

            
        });

        it('Should initiate a remote standardized token deployment without the same distributor', async () => {
            const gasValue = 1234;

            const salt = keccak256('0x1245');
            tokenId = await standardizedTokenRegistrar.getStandardizedTokenId(wallet.address, salt);
            const tokenAddress = await standardizedTokenRegistrar.getStandardizedTokenAddress(wallet.address, salt);
            let params = defaultAbiCoder.encode(['bytes', 'address'], [standardizedTokenRegistrar.address, tokenAddress]);
            const tokenManager = new Contract(await service.getTokenManagerAddress(tokenId), ITokenManager.abi, wallet);
            const token = new Contract(tokenAddress, IERC20.abi, wallet)
            await expect(standardizedTokenRegistrar.deployStandardizedToken(
                salt,
                name,
                symbol,
                decimals,
                mintAmount,
                wallet.address,
            ))
                .to.emit(service, 'StandardizedTokenDeployed')
                .withArgs(tokenId, wallet.address, name, symbol, decimals, mintAmount, standardizedTokenRegistrar.address)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params)
                .and.to.emit(token, 'Transfer')
                .withArgs(standardizedTokenRegistrar.address, wallet.address, mintAmount)
                .and.to.emit(tokenManager, 'OperatorshipTransferred')
                .withArgs(wallet.address)

            params = defaultAbiCoder.encode(['bytes', 'address'], ['0x', token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, name, symbol, decimals, '0x', '0x', 0, wallet.address.toLowerCase()],
            );


            await expect(
                standardizedTokenRegistrar.deployRemoteStandarizedToken(salt, false, destinationChain, gasValue, { value: gasValue }),
            )
                .to.emit(service, 'RemoteStandardizedTokenAndManagerDeploymentInitialized')
                .withArgs(tokenId, name, symbol, decimals, '0x', '0x', 0, wallet.address.toLowerCase(), destinationChain, gasValue)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), payload);

            
        });
    });
});
