'use strict';

const chai = require('chai');
const { expect } = chai;
require('dotenv').config();
const { deployAll, deployContract } = require('../scripts/deploy');
const { ethers } = require('hardhat');
const { AddressZero } = ethers.constants;
const { defaultAbiCoder, keccak256 } = ethers.utils;
const { Contract } = ethers;

const TokenManager = require('../artifacts/contracts/tokenManager/TokenManager.sol/TokenManager.json');
const { approveContractCall, getRandomBytes32, deployGatewayToken } = require('../scripts/utils');

describe('Interchain Token Service', () => {
    let wallet;
    let service, gateway, gasService;

    // const SELECTOR_SEND_TOKEN = 1;
    // const SELECTOR_SEND_TOKEN_WITH_DATA = 2;
    const SELECTOR_DEPLOY_TOKEN_MANAGER = 3;

    const LOCK_UNLOCK = 0;
    const MINT_BURN = 1;
    const CANONICAL = 2;
    const GATEWAY = 3;

    before(async () => {
        const wallets = await ethers.getSigners();
        wallet = wallets[0];

        [service, gateway, gasService] = await deployAll(wallet, 'Test');
    });

    describe('Register Canonical Token', () => {
        let token;
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        let tokenId;
        before(async () => {
            token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);
        });
        it('Should register a canonical token', async () => {
            const params = defaultAbiCoder.encode(['address', 'address'], [service.address, token.address]);
            tokenId = await service.getCanonicalTokenId(token.address);
            await expect(service.registerCanonicalToken(token.address))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });
    });

    describe('Initiate Remote Canonical Token Deployment', () => {
        let token;
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        let tokenId;
        before(async () => {
            token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);
            await (await service.registerCanonicalToken(token.address)).wait();
            tokenId = await service.getCanonicalTokenId(token.address);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });

        it('Should be able to initiate a remote canonical token deployment', async () => {
            const chains = ['chain1', 'chain2'];
            const gasValues = [1e6, 0];
            const params = defaultAbiCoder.encode(
                ['address', 'string', ' string', 'uint8'],
                [AddressZero, tokenName, tokenSymbol, tokenDecimals],
            );
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, CANONICAL, params],
            );
            await expect(service.deployRemoteCanonicalTokens(tokenId, chains, gasValues, { value: 1e6 }))
                .to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[0], gasValues[0], CANONICAL, params)
                .and.to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[1], gasValues[1], CANONICAL, params)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payload), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payload), payload)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[1], service.address.toLowerCase(), keccak256(payload), payload);
        });
    });

    describe('Register Canonical Token and Deploy Remote Tokens', async () => {
        let token;
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        let tokenId;
        before(async () => {
            token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);
            tokenId = await service.getCanonicalTokenId(token.address);
        });

        it('Should be able to register a canonical token and initiate a remote canonical token deployment', async () => {
            const chains = ['chain1', 'chain2'];
            const gasValues = [1e6, 0];
            const originParams = defaultAbiCoder.encode(['address', 'address'], [service.address, token.address]);
            const remoteParams = defaultAbiCoder.encode(
                ['address', 'string', ' string', 'uint8'],
                [AddressZero, tokenName, tokenSymbol, tokenDecimals],
            );
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, CANONICAL, remoteParams],
            );
            tokenId = await service.getCanonicalTokenId(token.address);

            await expect(service.registerCanonicalTokenAndDeployRemoteCanonicalTokens(token.address, chains, gasValues, { value: 1e6 }))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, originParams)
                .and.to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[0], gasValues[0], CANONICAL, remoteParams)
                .and.to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[1], gasValues[1], CANONICAL, remoteParams)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payload), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payload), payload)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[1], service.address.toLowerCase(), keccak256(payload), payload);

            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });
    });

    describe('Custom Token Manager Deploymenr', () => {
        it('Should deploy a lock/unlock token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);
            const params = defaultAbiCoder.encode(['address', 'address'], [wallet.address, token.address]);
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            await expect(service.deployCustomTokenManager(salt, LOCK_UNLOCK, params))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);

            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });

        it('Should deploy a mint/burn token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);
            const params = defaultAbiCoder.encode(['address', 'address'], [wallet.address, token.address]);
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            await expect(service.deployCustomTokenManager(salt, MINT_BURN, params))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params);

            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });

        it('Should deploy a canonical token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const params = defaultAbiCoder.encode(
                ['address', 'string', 'string', 'uint8'],
                [wallet.address, tokenName, tokenSymbol, tokenDecimals],
            );

            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            await expect(service.deployCustomTokenManager(salt, CANONICAL, params))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, CANONICAL, params);

            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });

        it('Should deploy a canonical token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;

            await deployGatewayToken(gateway, tokenName, tokenSymbol, tokenDecimals);

            const params = defaultAbiCoder.encode(['address', 'string'], [wallet.address, tokenSymbol]);

            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            await expect(service.deployCustomTokenManager(salt, GATEWAY, params))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, GATEWAY, params);

            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });
    });

    describe('Initialize remote custom token manager deployment', () => {
        it('Should initialize a remote custom token manager deployment', async () => {
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const chains = ['chain1', 'chain2'];
            const gasValues = [1e6, 0];
            const params = ['0x1234', '0x4567'];
            const types = [LOCK_UNLOCK, MINT_BURN];
            const payloads = [];

            for (const i of [0, 1]) {
                payloads.push(
                    defaultAbiCoder.encode(
                        ['uint256', 'bytes32', 'uint256', 'bytes'],
                        [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, types[i], params[i]],
                    ),
                );
            }

            await expect(service.deployRemoteCustomTokenManagers(salt, chains, types, params, gasValues, { value: 1e6 }))
                .to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[0], gasValues[0], types[0], params[0])
                .and.to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[1], gasValues[1], types[1], params[1])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payloads[0]), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payloads[0]), payloads[0])
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[1], service.address.toLowerCase(), keccak256(payloads[1]), payloads[1]);
        });
    });

    describe('Deploy custom token manager and initialize remote custom token manager deployment', () => {
        let salt;
        let tokenManagerType;
        let params;
        it('Should deploy a lock/unlock token manager', async () => {
            tokenManagerType = LOCK_UNLOCK;

            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);

            params = defaultAbiCoder.encode(['address', 'address'], [wallet.address, token.address]);
            salt = getRandomBytes32();
        });

        it('Should deploy a mint/burn token manager', async () => {
            tokenManagerType = MINT_BURN;

            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);
            params = defaultAbiCoder.encode(['address', 'address'], [wallet.address, token.address]);
            salt = getRandomBytes32();
        });

        it('Should deploy a canonical token manager', async () => {
            tokenManagerType = CANONICAL;

            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;

            params = defaultAbiCoder.encode(
                ['address', 'string', 'string', 'uint8'],
                [wallet.address, tokenName, tokenSymbol, tokenDecimals],
            );
            salt = getRandomBytes32();
        });

        it('Should deploy a gateway token manager', async () => {
            tokenManagerType = GATEWAY;

            const tokenName = 'Token Name';
            const tokenSymbol = 'TN3';
            const tokenDecimals = 13;

            await deployGatewayToken(gateway, tokenName, tokenSymbol, tokenDecimals);

            params = defaultAbiCoder.encode(['address', 'string'], [wallet.address, tokenSymbol]);

            salt = getRandomBytes32();
        });

        afterEach('Should initialize a remote custom token manager deployment', async () => {
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const chains = ['chain1', 'chain2'];
            const gasValues = [1e6, 0];
            const remoteParams = ['0x1234', '0x4567'];
            const types = [LOCK_UNLOCK, MINT_BURN];
            const payloads = [];

            for (const i of [0, 1]) {
                payloads.push(
                    defaultAbiCoder.encode(
                        ['uint256', 'bytes32', 'uint256', 'bytes'],
                        [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, types[i], remoteParams[i]],
                    ),
                );
            }

            await expect(
                service.deployCustomTokenManagerAndDeployRemote(salt, tokenManagerType, params, chains, types, remoteParams, gasValues, {
                    value: 1e6,
                }),
            )
                .to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[0], gasValues[0], types[0], remoteParams[0])
                .and.to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chains[1], gasValues[1], types[1], remoteParams[1])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payloads[0]), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[0], service.address.toLowerCase(), keccak256(payloads[0]), payloads[0])
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chains[1], service.address.toLowerCase(), keccak256(payloads[1]), payloads[1]);
        });
    });

    describe('Receive Remote Token Manager Deployment', () => {
        const sourceChain = 'source chain';
        let sourceAddress;
        before(async () => {
            sourceAddress = service.address.toLowerCase();
        });

        it('Should be able to receive a remote lock/unlock token manager depoloyment', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const tokenId = getRandomBytes32();
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);

            const params = defaultAbiCoder.encode(['address', 'address'], [AddressZero, token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, LOCK_UNLOCK, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(token.address);
        });

        it('Should be able to receive a remote lock/unlock token manager depoloyment', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const tokenId = getRandomBytes32();
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals]);

            const params = defaultAbiCoder.encode(['address', 'address'], [AddressZero, token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, MINT_BURN, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(token.address);
        });

        it('Should be able to receive a remote canonical token manager depoloyment', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const tokenId = getRandomBytes32();
            const params = defaultAbiCoder.encode(
                ['address', 'string', ' string', 'uint8'],
                [AddressZero, tokenName, tokenSymbol, tokenDecimals],
            );
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, CANONICAL, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, CANONICAL, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(tokenManagerAddress);
        });

        it('Should be able to receive a remote gateway token manager depoloyment', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN2';
            const tokenDecimals = 13;
            const tokenId = getRandomBytes32();

            await deployGatewayToken(gateway, tokenName, tokenSymbol, tokenDecimals);
            const tokenAddress = await gateway.tokenAddresses(tokenSymbol);
            const params = defaultAbiCoder.encode(['address', 'string'], [AddressZero, tokenSymbol]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, GATEWAY, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, GATEWAY, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(tokenAddress);
        });
    });
});
