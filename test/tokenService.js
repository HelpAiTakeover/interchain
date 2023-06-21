'use strict';

const chai = require('chai');
const { expect } = chai;
require('dotenv').config();
const { ethers } = require('hardhat');
const { AddressZero, MaxUint256 } = ethers.constants;
const { defaultAbiCoder, keccak256 } = ethers.utils;
const { Contract, Wallet } = ethers;
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');

const TokenManager = require('../artifacts/contracts/tokenManager/TokenManager.sol/TokenManager.json');

const { approveContractCall, getRandomBytes32 } = require('../scripts/utils');
const { deployAll, deployContract } = require('../scripts/deploy');

const SELECTOR_SEND_TOKEN = 1;
const SELECTOR_SEND_TOKEN_WITH_DATA = 2;
const SELECTOR_DEPLOY_TOKEN_MANAGER = 3;
const SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN = 4;

const LOCK_UNLOCK = 0;
const MINT_BURN = 1;
const LIQUIDITY_POOL = 2;

describe('Interchain Token Service', () => {
    let wallet, liquidityPool;
    let service, gateway, gasService;

    const deployFunctions = {};

    deployFunctions.lockUnlock = async function deployNewLockUnlock(
        tokenName,
        tokenSymbol,
        tokenDecimals,
        mintAmount = 0,
        skipApprove = false,
    ) {
        const salt = getRandomBytes32();
        const tokenId = await service.getCustomTokenId(wallet.address, salt);
        const tokenManager = new Contract(await service.getTokenManagerAddress(tokenId), TokenManager.abi, wallet);

        const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManager.address]);
        const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, token.address]);

        await (await service.deployCustomTokenManager(salt, LOCK_UNLOCK, params)).wait();

        if (mintAmount > 0) {
            await (await token.mint(wallet.address, mintAmount)).wait();
            if (!skipApprove) await (await token.approve(tokenManager.address, mintAmount)).wait();
        }

        return [token, tokenManager, tokenId];
    };

    deployFunctions.mintBurn = async function deployNewMintBurn(tokenName, tokenSymbol, tokenDecimals, mintAmount = 0) {
        const salt = getRandomBytes32();
        const tokenId = await service.getCustomTokenId(wallet.address, salt);
        const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
        const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);

        const tokenManager = new Contract(await service.getTokenManagerAddress(tokenId), TokenManager.abi, wallet);

        if (mintAmount > 0) {
            await (await token.mint(wallet.address, mintAmount)).wait();
        }

        await (await token.setDistributor(tokenManagerAddress)).wait();

        const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, token.address]);
        await (await service.deployCustomTokenManager(salt, MINT_BURN, params)).wait();

        return [token, tokenManager, tokenId];
    };

    deployFunctions.liquidityPool = async function deployNewLiquidityPool(
        tokenName,
        tokenSymbol,
        tokenDecimals,
        mintAmount = 0,
        skipApprove = false,
    ) {
        const salt = getRandomBytes32();
        const tokenId = await service.getCustomTokenId(wallet.address, salt);
        const tokenManager = new Contract(await service.getTokenManagerAddress(tokenId), TokenManager.abi, wallet);

        const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManager.address]);
        const params = defaultAbiCoder.encode(['bytes', 'address', 'address'], [wallet.address, token.address, liquidityPool.address]);

        await (await service.deployCustomTokenManager(salt, LIQUIDITY_POOL, params)).wait();
        await (await token.connect(liquidityPool).approve(tokenManager.address, MaxUint256)).wait();

        if (mintAmount > 0) {
            await (await token.mint(wallet.address, mintAmount)).wait();
            if (!skipApprove) await (await token.approve(tokenManager.address, mintAmount)).wait();
        }

        return [token, tokenManager, tokenId];
    };

    before(async () => {
        const wallets = await ethers.getSigners();
        wallet = wallets[0];
        liquidityPool = wallets[1];
        [service, gateway, gasService] = await deployAll(wallet, 'Test');
    });

    describe('Register Canonical Token', () => {
        let token;
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        let tokenId;
        before(async () => {
            token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, service.address]);
            tokenId = await service.getCanonicalTokenId(token.address);
            await (await token.setTokenManager(await service.getTokenManagerAddress(tokenId))).wait();
        });
        it('Should register a canonical token', async () => {
            const params = defaultAbiCoder.encode(['bytes', 'address'], [service.address, token.address]);
            await expect(service.registerCanonicalToken(token.address))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);

            expect(await tokenManager.admin()).to.equal(service.address);
        });
    });

    describe('Initiate Remote Canonical Token Deployment', () => {
        let token;
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        let tokenId;
        before(async () => {
            token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, service.address]);
            await (await service.registerCanonicalToken(token.address)).wait();
            tokenId = await service.getCanonicalTokenId(token.address);
            await (await token.setTokenManager(await service.getTokenManagerAddress(tokenId))).wait();
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
        });

        it('Should be able to initiate a remote standardized token deployment', async () => {
            const chain = 'chain1';
            const gasValue = 1e6;
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, tokenName, tokenSymbol, tokenDecimals, '0x', '0x'],
            );
            await expect(service.deployRemoteCanonicalToken(tokenId, chain, gasValue, { value: gasValue }))
                .to.emit(service, 'RemoteStandardizedTokenAndManagerDeploymentInitialized')
                .withArgs(tokenId, chain, gasValue)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chain, service.address.toLowerCase(), keccak256(payload), payload);
        });
    });

    describe('Deploy and Register Standardized Token', () => {
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        const mintAmount = 123456;

        it('Should register a standardized token as a lock/unlock', async () => {
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const tokenAddress = await service.getStandardizedTokenAddress(tokenId);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, tokenAddress]);
            await expect(
                service.deployAndRegisterStandardizedToken(salt, tokenName, tokenSymbol, tokenDecimals, mintAmount, wallet.address),
            )
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
            const tokenManagerAddress = await service.getValidTokenManagerAddress(tokenId);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);

            expect(await tokenManager.admin()).to.equal(wallet.address);
        });

        it('Should register a standardized token as a mint/burn', async () => {
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const tokenAddress = await service.getStandardizedTokenAddress(tokenId);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, tokenAddress]);
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            await expect(
                service.deployAndRegisterStandardizedToken(salt, tokenName, tokenSymbol, tokenDecimals, mintAmount, tokenManagerAddress),
            )
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params);
            expect(tokenManagerAddress).to.not.equal(AddressZero);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);

            expect(await tokenManager.admin()).to.equal(wallet.address);
        });
    });

    describe('Deploy and Register remote Standardized Token', () => {
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        const distributor = '0x12345678';
        const admin = '0x5678';
        const destinationChain = 'dest';
        const gasValue = 1234;
        const salt = getRandomBytes32();

        it('Should initialize a remote standardized token deployment', async () => {
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, tokenName, tokenSymbol, tokenDecimals, distributor, admin],
            );
            await expect(
                service.deployAndRegisterRemoteStandardizedTokens(
                    salt,
                    tokenName,
                    tokenSymbol,
                    tokenDecimals,
                    distributor,
                    admin,
                    destinationChain,
                    gasValue,
                    { value: gasValue },
                ),
            )
                .to.emit(service, 'RemoteStandardizedTokenAndManagerDeploymentInitialized')
                .withArgs(tokenId, destinationChain, gasValue)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, destinationChain, service.address.toLowerCase(), keccak256(payload), payload);
        });
    });

    describe('Receive Remote Standardized Token Deployment', () => {
        const sourceChain = 'source chain';
        const tokenName = 'Token Name';
        const tokenSymbol = 'TN';
        const tokenDecimals = 13;
        let sourceAddress;
        before(async () => {
            sourceAddress = service.address.toLowerCase();
        });

        it('Should be able to receive a remote standardized token depoloyment with a lock/unlock token manager', async () => {
            const tokenId = getRandomBytes32();
            const distributor = wallet.address;
            const admin = wallet.address;
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const tokenAddress = await service.getStandardizedTokenAddress(tokenId);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [distributor, tokenAddress]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, tokenName, tokenSymbol, tokenDecimals, distributor, admin],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'StandardizedTokenDeployed')
                .withArgs(tokenId, tokenName, tokenSymbol, tokenDecimals, 0, distributor)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(tokenAddress);
            expect(await tokenManager.admin()).to.equal(wallet.address);
        });
        it('Should be able to receive a remote standardized token depoloyment with a mint/burn token manager', async () => {
            const tokenId = getRandomBytes32();
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const distributor = service.address;
            const admin = wallet.address;
            const tokenAddress = await service.getStandardizedTokenAddress(tokenId);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [admin, tokenAddress]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, tokenName, tokenSymbol, tokenDecimals, distributor, admin],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'StandardizedTokenDeployed')
                .withArgs(tokenId, tokenName, tokenSymbol, tokenDecimals, 0, service.address)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(tokenAddress);
            expect(await tokenManager.admin()).to.equal(admin);
        });

        it('Should be able to receive a remote standardized token depoloyment with a mint/burn token manager', async () => {
            const tokenId = getRandomBytes32();
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const distributor = '0x';
            const admin = '0x';
            const tokenAddress = await service.getStandardizedTokenAddress(tokenId);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [service.address, tokenAddress]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes', 'bytes'],
                [SELECTOR_DEPLOY_AND_REGISTER_STANDARDIZED_TOKEN, tokenId, tokenName, tokenSymbol, tokenDecimals, distributor, admin],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'StandardizedTokenDeployed')
                .withArgs(tokenId, tokenName, tokenSymbol, tokenDecimals, 0, service.address)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(tokenAddress);
            expect(await tokenManager.admin()).to.equal(service.address);
        });
    });

    describe('Custom Token Manager Deployment', () => {
        it('Should deploy a lock/unlock token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, token.address]);

            const tx = service.deployCustomTokenManager(salt, LOCK_UNLOCK, params);
            await expect(tx).to.emit(service, 'TokenManagerDeployed').withArgs(tokenId, LOCK_UNLOCK, params);

            expect(tokenManagerAddress).to.not.equal(AddressZero);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);

            expect(await tokenManager.admin()).to.equal(wallet.address);
        });

        it('Should deploy a mint/burn token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, token.address]);

            const tx = service.deployCustomTokenManager(salt, MINT_BURN, params);
            await expect(tx).to.emit(service, 'TokenManagerDeployed').withArgs(tokenId, MINT_BURN, params);

            expect(tokenManagerAddress).to.not.equal(AddressZero);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);

            expect(await tokenManager.admin()).to.equal(wallet.address);
        });

        it('Should deploy a liquidity pool token manager', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);
            const params = defaultAbiCoder.encode(['bytes', 'address', 'address'], [wallet.address, token.address, liquidityPool.address]);

            const tx = service.deployCustomTokenManager(salt, LIQUIDITY_POOL, params);
            await expect(tx).to.emit(service, 'TokenManagerDeployed').withArgs(tokenId, LIQUIDITY_POOL, params);

            expect(tokenManagerAddress).to.not.equal(AddressZero);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);

            expect(await tokenManager.admin()).to.equal(wallet.address);
        });
    });

    describe('Initialize remote custom token manager deployment', () => {
        it('Should initialize a remote custom token manager deployment', async () => {
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const chain = 'chain1';
            const gasValue = 1e6;
            const params = '0x1234';
            const type = LOCK_UNLOCK;
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, type, params],
            );

            await expect(service.deployRemoteCustomTokenManager(salt, chain, type, params, gasValue, { value: gasValue }))
                .to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chain, gasValue, type, params)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chain, service.address.toLowerCase(), keccak256(payload), payload);
        });
    });

    describe('Initialize remote standardized token and manager deployment', () => {
        it('Should initialize a remote custom token manager deployment', async () => {
            const salt = getRandomBytes32();
            const tokenId = await service.getCustomTokenId(wallet.address, salt);
            const chain = 'chain1';
            const gasValue = 1e6;
            const params = '0x1234';
            const type = LOCK_UNLOCK;
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, type, params],
            );

            await expect(service.deployRemoteCustomTokenManager(salt, chain, type, params, gasValue, { value: gasValue }))
                .to.emit(service, 'RemoteTokenManagerDeploymentInitialized')
                .withArgs(tokenId, chain, gasValue, type, params)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, chain, service.address.toLowerCase(), keccak256(payload), gasValue, wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, chain, service.address.toLowerCase(), keccak256(payload), payload);
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
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);

            const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, LOCK_UNLOCK, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LOCK_UNLOCK, params);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(token.address);
            expect(await tokenManager.admin()).to.equal(wallet.address);
        });

        it('Should be able to receive a remote lock/unlock token manager depoloyment', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const tokenId = getRandomBytes32();
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);

            const params = defaultAbiCoder.encode(['bytes', 'address'], [wallet.address, token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, MINT_BURN, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, MINT_BURN, params);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(token.address);
            expect(await tokenManager.admin()).to.equal(wallet.address);
        });

        it('Should be able to receive a remote lock/unlock token manager depoloyment', async () => {
            const tokenName = 'Token Name';
            const tokenSymbol = 'TN';
            const tokenDecimals = 13;
            const tokenId = getRandomBytes32();
            const tokenManagerAddress = await service.getTokenManagerAddress(tokenId);
            const token = await deployContract(wallet, 'InterchainTokenTest', [tokenName, tokenSymbol, tokenDecimals, tokenManagerAddress]);

            const params = defaultAbiCoder.encode(['bytes', 'address', 'address'], [wallet.address, token.address, liquidityPool.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [SELECTOR_DEPLOY_TOKEN_MANAGER, tokenId, LIQUIDITY_POOL, params],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, LIQUIDITY_POOL, params);
            const tokenManager = new Contract(tokenManagerAddress, TokenManager.abi, wallet);
            expect(await tokenManager.tokenAddress()).to.equal(token.address);
            expect(await tokenManager.admin()).to.equal(wallet.address);
        });
    });

    describe('Send Token', () => {
        const amount = 1234;
        const destChain = 'destination Chain';
        const destAddress = '0x5678';
        const gasValue = 90;

        for (const type of ['lockUnlock', 'mintBurn', 'liquidityPool']) {
            it(`Should be able to initiate an interchain token transfer [${type}]`, async () => {
                const [token, tokenManager, tokenId] = await deployFunctions[type](`Test Token ${type}`, 'TT', 12, amount);

                let sendHash;
                let payloadHash;

                function checkSendHash(hash) {
                    return sendHash === hash;
                }

                function checkPayloadHash(hash) {
                    return payloadHash === hash;
                }

                function checkPayload(payload) {
                    const emmitted = defaultAbiCoder.decode(['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'], payload);

                    if (Number(emmitted[0]) !== SELECTOR_SEND_TOKEN) return false;
                    if (emmitted[1] !== tokenId) return false;
                    if (emmitted[2] !== destAddress) return false;
                    if (Number(emmitted[3]) !== amount) return false;
                    sendHash = emmitted[4];
                    payloadHash = keccak256(payload);
                    return true;
                }

                let transferToAddress = AddressZero;

                if (type === 'lockUnlock') {
                    transferToAddress = tokenManager.address;
                } else if (type === 'liquidityPool') {
                    transferToAddress = liquidityPool.address;
                }

                await expect(tokenManager.sendToken(destChain, destAddress, amount, { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, transferToAddress, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), anyValue, checkPayload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), checkPayloadHash, gasValue, wallet.address)
                    .to.emit(service, 'TokenSent')
                    .withArgs(tokenId, destChain, destAddress, amount, checkSendHash);
            });
        }
    });

    describe('Receive Remote Tokens', () => {
        const sourceChain = 'source chain';
        let sourceAddress;
        const amount = 1234;
        let destAddress;
        before(async () => {
            sourceAddress = service.address.toLowerCase();
            destAddress = wallet.address;
        });

        it('Should be able to receive lock/unlock token', async () => {
            const [token, tokenManager, tokenId] = await deployFunctions.lockUnlock(`Test Token Lock Unlock`, 'TT', 12, amount);
            (await await token.transfer(tokenManager.address, amount)).wait();
            const sendHash = getRandomBytes32();

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                [SELECTOR_SEND_TOKEN, tokenId, destAddress, amount, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(tokenManager.address, destAddress, amount)
                .and.to.emit(service, 'TokenReceived')
                .withArgs(tokenId, sourceChain, destAddress, amount, sendHash);
        });

        it('Should be able to receive mint/burn token', async () => {
            const [token, , tokenId] = await deployFunctions.mintBurn(`Test Token Mint Burn`, 'TT', 12, 0);

            const sendHash = getRandomBytes32();

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                [SELECTOR_SEND_TOKEN, tokenId, destAddress, amount, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(AddressZero, destAddress, amount)
                .and.to.emit(service, 'TokenReceived')
                .withArgs(tokenId, sourceChain, destAddress, amount, sendHash);
        });

        it('Should be able to receive liquidity pool token', async () => {
            const [token, , tokenId] = await deployFunctions.liquidityPool(`Test Token Liquidity Pool`, 'TTLP', 12, amount);
            (await await token.transfer(liquidityPool.address, amount)).wait();
            const sendHash = getRandomBytes32();

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                [SELECTOR_SEND_TOKEN, tokenId, destAddress, amount, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(liquidityPool.address, destAddress, amount)
                .and.to.emit(service, 'TokenReceived')
                .withArgs(tokenId, sourceChain, destAddress, amount, sendHash);
        });
    });

    describe('Send Token With Data', () => {
        const amount = 1234;
        const destChain = 'destination Chain';
        const destAddress = '0x5678';
        const gasValue = 90;
        let sourceAddress;
        const data = '0x1234';

        before(() => {
            sourceAddress = wallet.address;
        });

        for (const type of ['lockUnlock', 'mintBurn', 'liquidityPool']) {
            it(`Should be able to initiate an interchain token transfer [${type}]`, async () => {
                const [token, tokenManager, tokenId] = await deployFunctions[type](`Test Token ${type}`, 'TT', 12, amount);

                let sendHash;
                let payloadHash;

                function checkSendHash(hash) {
                    return sendHash === hash;
                }

                function checkPayloadHash(hash) {
                    return payloadHash === hash;
                }

                function checkPayload(payload) {
                    const emmitted = defaultAbiCoder.decode(
                        ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                        payload,
                    );
                    if (Number(emmitted[0]) !== SELECTOR_SEND_TOKEN_WITH_DATA) return false;
                    if (emmitted[1] !== tokenId) return false;
                    if (emmitted[2] !== destAddress) return false;
                    if (Number(emmitted[3]) !== amount) return false;
                    if (emmitted[4] !== sourceAddress.toLowerCase()) return false;
                    if (emmitted[5] !== data) return false;
                    sendHash = emmitted[6];
                    payloadHash = keccak256(payload);
                    return true;
                }

                let transferToAddress = AddressZero;

                if (type === 'lockUnlock') {
                    transferToAddress = tokenManager.address;
                } else if (type === 'liquidityPool') {
                    transferToAddress = liquidityPool.address;
                }

                await expect(tokenManager.callContractWithInterchainToken(destChain, destAddress, amount, data, { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, transferToAddress, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), anyValue, checkPayload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), checkPayloadHash, gasValue, wallet.address)
                    .to.emit(service, 'TokenSentWithData')
                    .withArgs(tokenId, destChain, destAddress, amount, sourceAddress, data, checkSendHash);
            });
        }
    });

    describe('Receive Remote Tokens with Data', () => {
        const sourceChain = 'source chain';
        let sourceAddress;
        const sourceAddressForService = '0x1234';
        const amount = 1234;
        let destAddress;
        let executable;

        before(async () => {
            sourceAddress = service.address.toLowerCase();
            executable = await deployContract(wallet, 'InterchainExecutableTest');
            destAddress = executable.address;
        });

        it('Should be able to receive lock/unlock token', async () => {
            const [token, tokenManager, tokenId] = await deployFunctions.lockUnlock(`Test Token Lock Unlock`, 'TT', 12, amount);
            (await await token.transfer(tokenManager.address, amount)).wait();
            const sendHash = getRandomBytes32();
            const msg = `lock/unlock`;
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, msg]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                [SELECTOR_SEND_TOKEN_WITH_DATA, tokenId, destAddress, amount, sourceAddressForService, data, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(tokenManager.address, destAddress, amount)
                .to.emit(token, 'Transfer')
                .withArgs(destAddress, wallet.address, amount)
                .and.to.emit(service, 'TokenReceivedWithData')
                .withArgs(tokenId, sourceChain, destAddress, amount, sourceAddressForService, data, sendHash)
                .and.to.emit(executable, 'MessageReceived')
                .withArgs(sourceChain, sourceAddressForService, wallet.address, msg, tokenId, amount);

            expect(await executable.lastMessage()).to.equal(msg);
        });

        it('Should be able to receive mint/burn token', async () => {
            const [token, , tokenId] = await deployFunctions.mintBurn(`Test Token Mint Burn`, 'TT', 12, amount);

            const sendHash = getRandomBytes32();
            const msg = `mint/burn`;
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, msg]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                [SELECTOR_SEND_TOKEN_WITH_DATA, tokenId, destAddress, amount, sourceAddressForService, data, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(AddressZero, destAddress, amount)
                .to.emit(token, 'Transfer')
                .withArgs(destAddress, wallet.address, amount)
                .and.to.emit(service, 'TokenReceivedWithData')
                .withArgs(tokenId, sourceChain, destAddress, amount, sourceAddressForService, data, sendHash)
                .and.to.emit(executable, 'MessageReceived')
                .withArgs(sourceChain, sourceAddressForService, wallet.address, msg, tokenId, amount);

            expect(await executable.lastMessage()).to.equal(msg);
        });

        it('Should be able to receive liquidity pool token', async () => {
            const [token, , tokenId] = await deployFunctions.liquidityPool(`Test Token Liquidity Pool`, 'TTLP', 12, amount);
            (await await token.transfer(liquidityPool.address, amount)).wait();
            const sendHash = getRandomBytes32();
            const msg = `mint/burn`;
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, msg]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                [SELECTOR_SEND_TOKEN_WITH_DATA, tokenId, destAddress, amount, sourceAddressForService, data, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(liquidityPool.address, destAddress, amount)
                .to.emit(token, 'Transfer')
                .withArgs(destAddress, wallet.address, amount)
                .and.to.emit(service, 'TokenReceivedWithData')
                .withArgs(tokenId, sourceChain, destAddress, amount, sourceAddressForService, data, sendHash)
                .and.to.emit(executable, 'MessageReceived')
                .withArgs(sourceChain, sourceAddressForService, wallet.address, msg, tokenId, amount);

            expect(await executable.lastMessage()).to.equal(msg);
        });
    });

    describe('Send Interchain Token', () => {
        const amount = 1234;
        const destChain = 'destination Chain';
        const destAddress = '0x5678';
        const gasValue = 90;

        for (const type of ['lockUnlock', 'mintBurn', 'liquidityPool']) {
            it(`Should be able to initiate an interchain token transfer [${type}]`, async () => {
                const [token, tokenManager, tokenId] = await deployFunctions[type](`Test Token ${type}`, 'TT', 12, amount, true);

                let sendHash;
                let payloadHash;

                function checkSendHash(hash) {
                    return sendHash === hash;
                }

                function checkPayloadHash(hash) {
                    return payloadHash === hash;
                }

                function checkPayload(payload) {
                    const emmitted = defaultAbiCoder.decode(['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'], payload);

                    if (Number(emmitted[0]) !== SELECTOR_SEND_TOKEN) return false;
                    if (emmitted[1] !== tokenId) return false;
                    if (emmitted[2] !== destAddress) return false;
                    if (Number(emmitted[3]) !== amount) return false;
                    sendHash = emmitted[4];
                    payloadHash = keccak256(payload);
                    return true;
                }

                let transferToAddress = AddressZero;

                if (type === 'lockUnlock') {
                    transferToAddress = tokenManager.address;
                } else if (type === 'liquidityPool') {
                    transferToAddress = liquidityPool.address;
                }

                await expect(token.interchainTransfer(destChain, destAddress, amount, '0x', { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, transferToAddress, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), anyValue, checkPayload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), checkPayloadHash, gasValue, wallet.address)
                    .to.emit(service, 'TokenSent')
                    .withArgs(tokenId, destChain, destAddress, amount, checkSendHash);
            });
        }
    });

    describe('Send Interchain Token With Data', () => {
        const amount = 1234;
        const destChain = 'destination Chain';
        const destAddress = '0x5678';
        const gasValue = 90;
        let sourceAddress;
        const data = '0x1234';

        before(() => {
            sourceAddress = wallet.address;
        });

        for (const type of ['lockUnlock', 'mintBurn', 'liquidityPool']) {
            it(`Should be able to initiate an interchain token transfer [${type}]`, async () => {
                const [token, tokenManager, tokenId] = await deployFunctions[type](`Test Token ${type}`, 'TT', 12, amount, false);

                let sendHash;
                let payloadHash;

                function checkSendHash(hash) {
                    return sendHash === hash;
                }

                function checkPayloadHash(hash) {
                    return payloadHash === hash;
                }

                function checkPayload(payload) {
                    const emmitted = defaultAbiCoder.decode(
                        ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                        payload,
                    );
                    if (Number(emmitted[0]) !== SELECTOR_SEND_TOKEN_WITH_DATA) return false;
                    if (emmitted[1] !== tokenId) return false;
                    if (emmitted[2] !== destAddress) return false;
                    if (Number(emmitted[3]) !== amount) return false;
                    if (emmitted[4] !== sourceAddress.toLowerCase()) return false;
                    if (emmitted[5] !== data) return false;
                    sendHash = emmitted[6];
                    payloadHash = keccak256(payload);
                    return true;
                }

                let transferToAddress = AddressZero;

                if (type === 'lockUnlock') {
                    transferToAddress = tokenManager.address;
                } else if (type === 'liquidityPool') {
                    transferToAddress = liquidityPool.address;
                }

                await expect(token.interchainTransfer(destChain, destAddress, amount, data, { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, transferToAddress, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), anyValue, checkPayload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address.toLowerCase(), checkPayloadHash, gasValue, wallet.address)
                    .to.emit(service, 'TokenSentWithData')
                    .withArgs(tokenId, destChain, destAddress, amount, sourceAddress, data, checkSendHash);
            });
        }
    });

    describe('Express Execute', () => {
        const sendHash = getRandomBytes32();
        const sourceChain = 'source chain';
        const sourceAddress = '0x1234';
        const amount = 1234;
        const destinationAddress = (new Wallet(getRandomBytes32())).address;
        const tokenName = 'name';
        const tokenSymbol = 'symbol';
        const tokenDecimals = 16;
        const message = 'message';
        let data;
        let tokenId;
        let executable;
        let token;

        before(async () => {
            [token, , tokenId] = await deployFunctions.lockUnlock(tokenName, tokenSymbol, tokenDecimals, amount*2, true);
            await (await token.approve(service.address, amount*2)).wait();
            data = defaultAbiCoder.encode(['address', 'string'], [destinationAddress, message]);
            executable = await deployContract(wallet, 'InterchainExecutableTest');
        })

        it('Should express execute', async () => {
            await expect(service.expressReceiveToken(tokenId, destinationAddress, amount, sendHash))
                .to.emit(service, 'ExpressExecuted')
                .withArgs(tokenId, destinationAddress, amount, sendHash, wallet.address)
                .and.to.emit(token, 'Transfer')
                .withArgs(wallet.address, destinationAddress, amount);
        });

        it('Should express execute with token', async () => {
            await expect(service.expressReceiveTokenWithData(tokenId, sourceChain, sourceAddress, executable.address, amount, data, sendHash))
                .to.emit(service, 'ExpressExecutedWithData')
                .withArgs(tokenId, sourceChain, sourceAddress, executable.address, amount, data, sendHash, wallet.address)
                .and.to.emit(token, 'Transfer')
                .withArgs(wallet.address, executable.address, amount)
                .and.to.emit(token, 'Transfer')
                .withArgs(executable.address, destinationAddress, amount)
                .and.to.emit(executable, 'MessageReceived')
                .withArgs(sourceChain, sourceAddress, destinationAddress, message, tokenId, amount);
        });
    })   
    
    describe('Express Receive Remote Tokens', () => {
        const sourceChain = 'source chain';
        let sourceAddress;
        const amount = 1234;
        const destAddress = (new Wallet(getRandomBytes32())).address;
        before(async () => {
            sourceAddress = service.address.toLowerCase();
        });

        it('Should be able to receive lock/unlock token', async () => {
            const [token, tokenManager, tokenId] = await deployFunctions.lockUnlock(`Test Token Lock Unlock`, 'TT', 12, 2 * amount);
            await (await token.transfer(tokenManager.address, amount)).wait();
            await (await token.approve(service.address, amount)).wait();

            const sendHash = getRandomBytes32();

            await (await service.expressReceiveToken(tokenId, destAddress, amount, sendHash)).wait();
            

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                [SELECTOR_SEND_TOKEN, tokenId, destAddress, amount, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(tokenManager.address, wallet.address, amount)
                .and.to.emit(service, 'ExpressExecutionFulfilled')
                .withArgs(tokenId, destAddress, amount, sendHash, wallet.address);
        });

        it('Should be able to receive mint/burn token', async () => {
            const [token, , tokenId] = await deployFunctions.mintBurn(`Test Token Mint Burn`, 'TT', 12, amount);
            
            await (await token.approve(service.address, amount)).wait();

            const sendHash = getRandomBytes32();

            await (await service.expressReceiveToken(tokenId, destAddress, amount, sendHash)).wait();

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                [SELECTOR_SEND_TOKEN, tokenId, destAddress, amount, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(AddressZero, wallet.address, amount)
                .and.to.emit(service, 'ExpressExecutionFulfilled')
                .withArgs(tokenId, destAddress, amount, sendHash, wallet.address);
        });

        it('Should be able to receive liquidity pool token', async () => {
            const [token, , tokenId] = await deployFunctions.liquidityPool(`Test Token Liquidity Pool`, 'TTLP', 12, amount * 2);
            await (await token.transfer(liquidityPool.address, amount)).wait();
            await (await token.approve(service.address, amount)).wait();

            const sendHash = getRandomBytes32();

            await (await service.expressReceiveToken(tokenId, destAddress, amount, sendHash)).wait();

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                [SELECTOR_SEND_TOKEN, tokenId, destAddress, amount, sendHash],
            );
            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(liquidityPool.address, wallet.address, amount)
                .and.to.emit(service, 'ExpressExecutionFulfilled')
                .withArgs(tokenId, destAddress, amount, sendHash, wallet.address);
        });
    });

    describe('Receive Remote Tokens with Data', () => {
        const sourceChain = 'source chain';
        let sourceAddress;
        const sourceAddressForService = '0x1234';
        const amount = 1234;
        let destAddress;
        let executable;

        before(async () => {
            sourceAddress = service.address.toLowerCase();
            executable = await deployContract(wallet, 'InterchainExecutableTest');
            destAddress = executable.address;
        });

        it('Should be able to receive lock/unlock token', async () => {
            const [token, tokenManager, tokenId] = await deployFunctions.lockUnlock(`Test Token Lock Unlock`, 'TT', 12, amount * 2);
            await (await token.transfer(tokenManager.address, amount)).wait();
            await (await token.approve(service.address, amount)).wait();

            const sendHash = getRandomBytes32();            
            const msg = `lock/unlock`;
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, msg]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                [SELECTOR_SEND_TOKEN_WITH_DATA, tokenId, destAddress, amount, sourceAddressForService, data, sendHash],
            );

            await (await service.expressReceiveTokenWithData(tokenId, sourceChain, sourceAddressForService, destAddress, amount, data, sendHash)).wait();

            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(tokenManager.address, wallet.address, amount)
                .and.to.emit(service, 'ExpressExecutionWithDataFulfilled')
                .withArgs(
                    tokenId,
                    sourceChain,
                    sourceAddressForService,
                    destAddress,
                    amount,
                    data,
                    sendHash,
                    wallet.address,
                );

            expect(await executable.lastMessage()).to.equal(msg);
        });

        it('Should be able to receive mint/burn token', async () => {
            const [token, , tokenId] = await deployFunctions.mintBurn(`Test Token Mint Burn`, 'TT', 12, amount);
            await (await token.approve(service.address, amount)).wait();

            const sendHash = getRandomBytes32();
            const msg = `mint/burn`;
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, msg]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                [SELECTOR_SEND_TOKEN_WITH_DATA, tokenId, destAddress, amount, sourceAddressForService, data, sendHash],
            );

            await (await service.expressReceiveTokenWithData(tokenId, sourceChain, sourceAddressForService, destAddress, amount, data, sendHash)).wait();

            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(AddressZero, wallet.address, amount)
                .and.to.emit(service, 'ExpressExecutionWithDataFulfilled')
                .withArgs(
                    tokenId,
                    sourceChain,
                    sourceAddressForService,
                    destAddress,
                    amount,
                    data,
                    sendHash,
                    wallet.address,
                );

            expect(await executable.lastMessage()).to.equal(msg);
        });

        it('Should be able to receive liquidity pool token', async () => {
            const [token, , tokenId] = await deployFunctions.liquidityPool(`Test Token Liquidity Pool`, 'TTLP', 12, amount * 2);
            (await await token.transfer(liquidityPool.address, amount)).wait();
            await (await token.approve(service.address, amount)).wait();

            const sendHash = getRandomBytes32();
            const msg = `mint/burn`;
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, msg]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes', 'bytes', 'bytes32'],
                [SELECTOR_SEND_TOKEN_WITH_DATA, tokenId, destAddress, amount, sourceAddressForService, data, sendHash],
            );

            await (await service.expressReceiveTokenWithData(tokenId, sourceChain, sourceAddressForService, destAddress, amount, data, sendHash)).wait();

            const commandId = await approveContractCall(gateway, sourceChain, sourceAddress, service.address, payload);

            await expect(service.execute(commandId, sourceChain, sourceAddress, payload))
                .to.emit(token, 'Transfer')
                .withArgs(liquidityPool.address, wallet.address, amount)
                .and.to.emit(service, 'ExpressExecutionWithDataFulfilled')
                .withArgs(
                    tokenId,
                    sourceChain,
                    sourceAddressForService,
                    destAddress,
                    amount,
                    data,
                    sendHash,
                    wallet.address,
                );

            expect(await executable.lastMessage()).to.equal(msg);
        });
    });

    describe('Flow Limits', () => {
        const destinationChain = 'dest';
        const destinationAddress = '0x1234';
        let tokenManager, tokenId;
        const sendAmount = 1234;
        const flowLimit = (sendAmount * 3) / 2;
        const mintAmount = flowLimit * 3;
        beforeEach(async () => {
            [, tokenManager, tokenId] = await deployFunctions.mintBurn(`Test Token Lock Unlock`, 'TT', 12, mintAmount);
            await (await tokenManager.setFlowLimit(flowLimit)).wait();
        });

        // These tests will fail every once in a while since the two transactions will happen in different epochs.
        // LMK of any fixes to this that do not involve writing a new contract to facilitate a multicall.
        it('Should be able to send token only if it does not trigger the mint limit', async () => {
            await (await tokenManager.sendToken(destinationChain, destinationAddress, sendAmount)).wait();
            await expect(tokenManager.sendToken(destinationChain, destinationAddress, sendAmount)).to.be.revertedWithCustomError(
                tokenManager,
                'FlowLimitExceeded',
            );
        });

        it('Should be able to receive token only if it does not trigger the mint limit', async () => {
            async function receiveToken(sendAmount) {
                const sendHash = getRandomBytes32();

                const payload = defaultAbiCoder.encode(
                    ['uint256', 'bytes32', 'bytes', 'uint256', 'bytes32'],
                    [SELECTOR_SEND_TOKEN, tokenId, wallet.address, sendAmount, sendHash],
                );
                const commandId = await approveContractCall(gateway, destinationChain, service.address, service.address, payload);

                return service.execute(commandId, destinationChain, service.address, payload);
            }

            await (await receiveToken(sendAmount)).wait();

            await expect(receiveToken(sendAmount)).to.be.revertedWithCustomError(tokenManager, 'FlowLimitExceeded');
        });
    });
});
