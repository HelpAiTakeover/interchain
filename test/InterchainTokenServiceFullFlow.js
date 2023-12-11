'use strict';

const chai = require('chai');
const { expect } = chai;
const { ethers } = require('hardhat');
const { AddressZero } = ethers.constants;

const {
    getContractAt,
    Wallet,
    constants: { HashZero },
    utils: { defaultAbiCoder, keccak256, solidityPack, arrayify },
} = ethers;

const { getRandomBytes32, expectRevert } = require('./utils');
const { deployAll, deployContract } = require('../scripts/deploy');
const { approveContractCall } = require('../scripts/utils');

const MESSAGE_TYPE_INTERCHAIN_TRANSFER = 0;
const MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN = 1;
const MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER = 2;

const MINTER_ROLE = 0;

const MINT_BURN = 0;
const LOCK_UNLOCK = 2;

describe('Interchain Token Service Full Flow', () => {
    let wallet;
    let service, gateway, gasService, factory, tokenId;
    const name = 'tokenName';
    const symbol = 'tokenSymbol';
    const otherChains = ['chain 1', 'chain 2'];
    const decimals = 6;
    const chainName = 'Test';

    before(async () => {
        const wallets = await ethers.getSigners();
        wallet = wallets[0];
        [service, gateway, gasService, factory] = await deployAll(wallet, chainName, otherChains);
    });

    /**
     * This test deploys Canonical Interchain tokens for a pre-existing token on remote chains via the InterchainTokenFactory and multicall.
     * Canonical tokens are registered under Lock/Unlock token manager on local chain, and mint/burn on remote chains.
     * They can be deployed to remote chains by anyone, and don't depend on a deployer address/salt.
     * - Register pre-existing token as Canonical
     * - Deploy Canonical Interchain token to each remote chain via the factory
     * - Transfer tokens via ITS between chains after deployment
     */
    describe('Canonical Interchain Token', () => {
        let token;
        const gasValues = [1234, 5678];
        const tokenCap = 1e9;
        const transferAmount = 1e6;

        before(async () => {
            // Any ERC20 can be used here
            token = await deployContract(wallet, 'TestMintableBurnableERC20', [name, symbol, decimals]);
            await token.mint(wallet.address, tokenCap + transferAmount).then((tx) => tx.wait());
        });

        it('Should register the token and initiate its deployment on other chains', async () => {
            tokenId = await factory.canonicalInterchainTokenId(token.address);

            let tx = await factory.populateTransaction.registerCanonicalInterchainToken(token.address);
            const calls = [tx.data];
            let value = 0;

            for (const i in otherChains) {
                tx = await factory.populateTransaction.deployRemoteCanonicalInterchainToken(
                    chainName,
                    token.address,
                    otherChains[i],
                    gasValues[i],
                );
                calls.push(tx.data);
                value += gasValues[i];
            }

            const params = defaultAbiCoder.encode(['bytes', 'address'], ['0x', token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
                [MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN, tokenId, name, symbol, decimals, '0x'],
            );
            const expectedTokenManagerAddress = await service.tokenManagerAddress(tokenId);

            const multicall = await factory.multicall(calls, { value });

            await expect(multicall)
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, expectedTokenManagerAddress, LOCK_UNLOCK, params)
                .and.to.emit(service, 'InterchainTokenDeploymentStarted')
                .withArgs(tokenId, name, symbol, decimals, '0x', otherChains[0])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), payload)
                .and.to.emit(service, 'InterchainTokenDeploymentStarted')
                .withArgs(tokenId, name, symbol, decimals, '0x', otherChains[1])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), gasValues[1], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), payload);
        });

        describe('Interchain transfer', () => {
            const amount = 1234;
            const destAddress = '0x1234';
            const destChain = otherChains[0];
            const gasValue = 6789;
            let payload, payloadHash;

            before(async () => {
                payload = defaultAbiCoder.encode(
                    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
                    [MESSAGE_TYPE_INTERCHAIN_TRANSFER, tokenId, arrayify(wallet.address), destAddress, amount, '0x'],
                );
                payloadHash = keccak256(payload);
            });

            it('Should send some tokens to another chain via ITS', async () => {
                const tokenManagerAddress = await service.tokenManagerAddress(tokenId);

                // Canonical (pre-existing) token requires an approval due to locking
                await expect(token.approve(service.address, amount))
                    .to.emit(token, 'Approval')
                    .withArgs(wallet.address, service.address, amount);

                await expect(service.interchainTransfer(tokenId, destChain, destAddress, amount, '0x', gasValue, { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, tokenManagerAddress, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, payload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, gasValue, wallet.address)
                    .to.emit(service, 'InterchainTransfer')
                    .withArgs(tokenId, wallet.address, destChain, destAddress, amount, HashZero);
            });
        });
    });

    /**
     * This test deploys brand new Interchain tokens to all chains via the InterchainTokenFactory and multicall:
     * - Deploy new Interchain token on local chain via the factory with an initial supply
     * - Deploy new Interchain token to each remote chain via the factory
     * - Transfer token via native method on the token
     * - Transfer tokens via ITS between chains after deployment
     * - Transfers mint/burn role from original deployer wallet to another address
     */
    describe('New Interchain token', () => {
        let token;
        let tokenId;
        const salt = getRandomBytes32();
        const gasValues = [1234, 5678];
        const tokenCap = 1e9;

        before(async () => {
            tokenId = await factory.interchainTokenId(wallet.address, salt);
            const tokenAddress = await service.interchainTokenAddress(tokenId);
            token = await getContractAt('InterchainToken', tokenAddress, wallet);
        });

        it('Should register the token and initiate its deployment on other chains', async () => {
            const totalMint = tokenCap;

            // Deploy a new Interchain token on the local chain.
            // The initial mint occurs on the factory contract, so it can be moved to other chains within the same multicall.
            let tx = await factory.populateTransaction.deployInterchainToken(salt, name, symbol, decimals, totalMint, wallet.address);
            const calls = [tx.data];
            let value = 0;

            // Deploy a linked Interchain token to remote chains.
            for (const i in otherChains) {
                tx = await factory.populateTransaction.deployRemoteInterchainToken(
                    chainName,
                    salt,
                    wallet.address,
                    otherChains[i],
                    gasValues[i],
                );
                calls.push(tx.data);
                value += gasValues[i];
            }

            const params = defaultAbiCoder.encode(['bytes', 'address'], [factory.address, token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
                [MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN, tokenId, name, symbol, decimals, wallet.address],
            );
            const expectedTokenManagerAddress = await service.tokenManagerAddress(tokenId);
            const expectedTokenAddress = await service.interchainTokenAddress(tokenId);

            const multicall = await factory.multicall(calls, { value });
            await expect(multicall)
                .to.emit(service, 'InterchainTokenDeployed')
                .withArgs(tokenId, expectedTokenAddress, factory.address, name, symbol, decimals)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, expectedTokenManagerAddress, MINT_BURN, params)
                .and.to.emit(service, 'InterchainTokenDeploymentStarted')
                .withArgs(tokenId, name, symbol, decimals, wallet.address.toLowerCase(), otherChains[0])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), payload)
                .and.to.emit(service, 'InterchainTokenDeploymentStarted')
                .withArgs(tokenId, name, symbol, decimals, wallet.address.toLowerCase(), otherChains[1])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), gasValues[1], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), payload);

            expect(await token.balanceOf(wallet.address)).to.equal(totalMint);

            expect(await service.validTokenManagerAddress(tokenId)).to.equal(expectedTokenManagerAddress);
        });

        describe('Interchain transfer', () => {
            const amount = 1234;
            const destAddress = '0x1234';
            const destChain = otherChains[0];
            const gasValue = 6789;
            let payload, payloadHash;

            before(async () => {
                payload = defaultAbiCoder.encode(
                    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
                    [MESSAGE_TYPE_INTERCHAIN_TRANSFER, tokenId, arrayify(wallet.address), destAddress, amount, '0x'],
                );
                payloadHash = keccak256(payload);
            });

            it('Should send some tokens to another chain via the token', async () => {
                await expect(token.interchainTransfer(destChain, destAddress, amount, '0x', { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, AddressZero, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, payload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, gasValue, wallet.address)
                    .to.emit(service, 'InterchainTransfer')
                    .withArgs(tokenId, wallet.address, destChain, destAddress, amount, HashZero);
            });

            it('Should send some tokens to another chain via ITS', async () => {
                await expect(service.interchainTransfer(tokenId, destChain, destAddress, amount, '0x', gasValue, { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, AddressZero, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, payload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, gasValue, wallet.address)
                    .to.emit(service, 'InterchainTransfer')
                    .withArgs(tokenId, wallet.address, destChain, destAddress, amount, HashZero);
            });

            it('Should send some tokens to multiple chains via ITS', async () => {
                const calls = [];
                const destAddress = arrayify(wallet.address);
                let value = 0;

                for (const i in otherChains) {
                    const tx = await service.populateTransaction.interchainTransfer(
                        tokenId,
                        otherChains[i],
                        destAddress,
                        amount,
                        '0x',
                        gasValues[i],
                    );
                    calls.push(tx.data);
                    value += gasValues[i];
                }

                const payload = defaultAbiCoder.encode(
                    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
                    [MESSAGE_TYPE_INTERCHAIN_TRANSFER, tokenId, wallet.address, destAddress, amount, '0x'],
                );
                const payloadHash = keccak256(payload);

                const multicall = await service.multicall(calls, { value });
                await expect(multicall)
                    .to.emit(token, 'Transfer')
                    .withArgs(wallet.address, AddressZero, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, otherChains[0], service.address, payloadHash, payload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, otherChains[0], service.address, payloadHash, gasValues[0], wallet.address)
                    .and.to.emit(service, 'InterchainTransfer')
                    .withArgs(tokenId, wallet.address, otherChains[0], destAddress, amount, HashZero)
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, AddressZero, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, otherChains[1], service.address, payloadHash, payload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, otherChains[1], service.address, payloadHash, gasValues[1], wallet.address)
                    .and.to.emit(service, 'InterchainTransfer')
                    .withArgs(tokenId, wallet.address, otherChains[1], destAddress, amount, HashZero);
            });
        });

        /**
         * Change the minter/minter to another address
         */
        it('Should be able to change the token minter', async () => {
            const newAddress = new Wallet(getRandomBytes32()).address;
            const amount = 1234;

            await expect(token.mint(newAddress, amount)).to.emit(token, 'Transfer').withArgs(AddressZero, newAddress, amount);
            await expect(token.burn(newAddress, amount)).to.emit(token, 'Transfer').withArgs(newAddress, AddressZero, amount);

            await expect(token.transferMintership(newAddress))
                .to.emit(token, 'RolesRemoved')
                .withArgs(wallet.address, 1 << MINTER_ROLE)
                .to.emit(token, 'RolesAdded')
                .withArgs(newAddress, 1 << MINTER_ROLE);

            await expectRevert((gasOptions) => token.mint(newAddress, amount, gasOptions), token, 'MissingRole', [
                wallet.address,
                MINTER_ROLE,
            ]);
            await expectRevert((gasOptions) => token.burn(newAddress, amount, gasOptions), token, 'MissingRole', [
                wallet.address,
                MINTER_ROLE,
            ]);
        });
    });

    /**
     * This test creates a token link between pre-existing tokens by giving mint/burn permission to ITS.
     * - Deploy a normal mint/burn ERC20 registered with an owner
     * - Deploy a mint/burn token manager for the token on all chains
     * - Transfer mint/burn permission (minter role) to ITS
     * - Transfer tokens via ITS between chains
     */
    describe('Pre-existing Token as Mint/Burn', () => {
        let token;
        const otherChains = ['chain 1', 'chain 2'];
        const gasValues = [1234, 5678];
        const tokenCap = 1e9;
        const salt = keccak256('0x697858');

        before(async () => {
            token = await deployContract(wallet, 'TestMintableBurnableERC20', [name, symbol, decimals]);

            tokenId = await service.interchainTokenId(wallet.address, salt);
            await (await token.mint(wallet.address, tokenCap)).wait();
        });

        it('Should register the token and initiate its deployment on other chains', async () => {
            const tokenManagerImplementationAddress = await service.tokenManager();
            const tokenManagerImplementation = await getContractAt('TokenManager', tokenManagerImplementationAddress, wallet);

            const params = await tokenManagerImplementation.params(wallet.address, token.address);
            let tx = await service.populateTransaction.deployTokenManager(salt, '', MINT_BURN, params, 0);

            const calls = [tx.data];
            let value = 0;

            for (const i in otherChains) {
                // This should be replaced with the existing token address on each chain being linked
                const remoteTokenAddress = token.address;
                const params = await tokenManagerImplementation.params(wallet.address, remoteTokenAddress);

                tx = await service.populateTransaction.deployTokenManager(salt, otherChains[i], MINT_BURN, params, gasValues[i]);
                calls.push(tx.data);
                value += gasValues[i];
            }

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'uint256', 'bytes'],
                [MESSAGE_TYPE_DEPLOY_TOKEN_MANAGER, tokenId, MINT_BURN, params],
            );
            const expectedTokenManagerAddress = await service.tokenManagerAddress(tokenId);
            await expect(service.multicall(calls, { value }))
                .to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, expectedTokenManagerAddress, MINT_BURN, params)
                .and.to.emit(service, 'TokenManagerDeploymentStarted')
                .withArgs(tokenId, otherChains[0], MINT_BURN, params)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), payload)
                .and.to.emit(service, 'TokenManagerDeploymentStarted')
                .withArgs(tokenId, otherChains[1], MINT_BURN, params)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), gasValues[1], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), payload);
        });

        /**
         * Transfer the minter to ITS on all chains to allow it to mint/burn
         */
        it('Should be able to change the token minter', async () => {
            const newAddress = new Wallet(getRandomBytes32()).address;
            const amount = 1234;

            await expect(token.mint(newAddress, amount)).to.emit(token, 'Transfer').withArgs(AddressZero, newAddress, amount);
            await expect(token.burn(newAddress, amount)).to.emit(token, 'Transfer').withArgs(newAddress, AddressZero, amount);

            await expect(token.transferMintership(service.address))
                .to.emit(token, 'RolesRemoved')
                .withArgs(wallet.address, 1 << MINTER_ROLE)
                .to.emit(token, 'RolesAdded')
                .withArgs(service.address, 1 << MINTER_ROLE);

            await expectRevert((gasOptions) => token.mint(newAddress, amount, gasOptions), token, 'MissingRole', [
                wallet.address,
                MINTER_ROLE,
            ]);
            await expectRevert((gasOptions) => token.burn(newAddress, amount, gasOptions), token, 'MissingRole', [
                wallet.address,
                MINTER_ROLE,
            ]);
        });

        /**
         * Send an interchain transfer. To receive the tokens, the receiving ITS
         * also needs to have the mint/burn permission.
         */
        describe('Interchain transfer', () => {
            const amount = 1234;
            const destAddress = '0x1234';
            const destChain = otherChains[0];
            const gasValue = 6789;
            let payload, payloadHash;

            before(async () => {
                payload = defaultAbiCoder.encode(
                    ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
                    [MESSAGE_TYPE_INTERCHAIN_TRANSFER, tokenId, arrayify(wallet.address), destAddress, amount, '0x'],
                );
                payloadHash = keccak256(payload);
            });

            it('Should send some tokens to another chain via ITS', async () => {
                await expect(service.interchainTransfer(tokenId, destChain, destAddress, amount, '0x', gasValue, { value: gasValue }))
                    .and.to.emit(token, 'Transfer')
                    .withArgs(wallet.address, AddressZero, amount)
                    .and.to.emit(gateway, 'ContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, payload)
                    .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                    .withArgs(service.address, destChain, service.address, payloadHash, gasValue, wallet.address)
                    .to.emit(service, 'InterchainTransfer')
                    .withArgs(tokenId, wallet.address, destChain, destAddress, amount, HashZero);
            });
        });
    });

    /**
     * This test deploys a fixed supply InterchainToken
     * - Deploy an InterchainToken without a minter and a fixed supply
     * - Deploy the InterchainToken to additional chains
     * - Transfer from the fixed supply to additional chains
     * - Transfer tokens via ITS between chains
     */
    describe('Fixed Supply Interchain Token', () => {
        let token;
        let tokenId;
        const salt = getRandomBytes32();
        const gasValues = [1234, 5678];
        const tokenCap = 1e9;
        const totalMint = (1 + otherChains.length) * tokenCap;

        before(async () => {
            tokenId = await factory.interchainTokenId(wallet.address, salt);
            const tokenAddress = await service.interchainTokenAddress(tokenId);
            token = await getContractAt('InterchainToken', tokenAddress, wallet);
        });

        // To get a fixed supply InterchainToken, simply set the minter to address(0) during deployment.
        it('Should deploy the token and deploy on other chains', async () => {
            // Deploy a new Interchain token on the local chain.
            // The initial mint occurs on the factory contract, so it can be moved to other chains within the same multicall.
            let tx = await factory.populateTransaction.deployInterchainToken(salt, name, symbol, decimals, totalMint, AddressZero);
            const calls = [tx.data];
            let value = 0;

            // Deploy a linked Interchain token to remote chains.
            for (const i in otherChains) {
                tx = await factory.populateTransaction.deployRemoteInterchainToken(
                    chainName,
                    salt,
                    AddressZero,
                    otherChains[i],
                    gasValues[i],
                );
                calls.push(tx.data);
                value += gasValues[i];
            }

            const params = defaultAbiCoder.encode(['bytes', 'address'], [factory.address, token.address]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'string', 'string', 'uint8', 'bytes'],
                [MESSAGE_TYPE_DEPLOY_INTERCHAIN_TOKEN, tokenId, name, symbol, decimals, '0x'],
            );
            const expectedTokenManagerAddress = await service.tokenManagerAddress(tokenId);
            const expectedTokenAddress = await service.interchainTokenAddress(tokenId);

            const multicall = await factory.multicall(calls, { value });
            await expect(multicall)
                .to.emit(service, 'InterchainTokenDeployed')
                .withArgs(tokenId, expectedTokenAddress, factory.address, name, symbol, decimals)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, expectedTokenManagerAddress, MINT_BURN, params)
                .and.to.emit(service, 'InterchainTokenDeploymentStarted')
                .withArgs(tokenId, name, symbol, decimals, '0x', otherChains[0])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), gasValues[0], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[0], service.address, keccak256(payload), payload)
                .and.to.emit(service, 'InterchainTokenDeploymentStarted')
                .withArgs(tokenId, name, symbol, decimals, '0x', otherChains[1])
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), gasValues[1], wallet.address)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[1], service.address, keccak256(payload), payload);

            // Only tokens minted for the local chain should be left, remaining should be burned.
            expect(await token.balanceOf(wallet.address)).to.equal(totalMint);

            expect(await service.validTokenManagerAddress(tokenId)).to.equal(expectedTokenManagerAddress);
        });

        // After the remote deployments are complete we transfer the initial supply to them.
        it('Should transfer from the fixed supply to both other chains', async () => {
            const calls = [];
            const destAddress = arrayify(wallet.address);
            let value = 0;

            for (const i in otherChains) {
                const tx = await service.populateTransaction.interchainTransfer(
                    tokenId,
                    otherChains[i],
                    destAddress,
                    tokenCap,
                    '0x',
                    gasValues[i],
                );
                calls.push(tx.data);
                value += gasValues[i];
            }

            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
                [MESSAGE_TYPE_INTERCHAIN_TRANSFER, tokenId, wallet.address, destAddress, tokenCap, '0x'],
            );
            const payloadHash = keccak256(payload);

            const multicall = await service.multicall(calls, { value });
            await expect(multicall)
                .to.emit(token, 'Transfer')
                .withArgs(wallet.address, AddressZero, tokenCap)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[0], service.address, payloadHash, payload)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[0], service.address, payloadHash, gasValues[0], wallet.address)
                .and.to.emit(service, 'InterchainTransfer')
                .withArgs(tokenId, wallet.address, otherChains[0], destAddress, tokenCap, HashZero)
                .and.to.emit(token, 'Transfer')
                .withArgs(wallet.address, AddressZero, tokenCap)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, otherChains[1], service.address, payloadHash, payload)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, otherChains[1], service.address, payloadHash, gasValues[1], wallet.address)
                .and.to.emit(service, 'InterchainTransfer')
                .withArgs(tokenId, wallet.address, otherChains[1], destAddress, tokenCap, HashZero);

            expect(await token.balanceOf(wallet.address)).to.equal(totalMint - otherChains.length * tokenCap);
        });
    });

    /**
     * This test deploys an InterchainToken and an InterchainExecutable, which then receives an InterchainTransfer with data
     * - Deploy an InterchainToken and the Executable
     * - Call the executable with an interchain transfer
     * - Execute the application, TestInterchainExecutable
     */
    describe('Executable Example', () => {
        let token, tokenId, executable;
        const totalMint = 1e9;

        before(async () => {
            const salt = getRandomBytes32();
            tokenId = await factory.interchainTokenId(wallet.address, salt);
            const tokenAddress = await service.interchainTokenAddress(tokenId);
            const expectedTokenManagerAddress = await service.tokenManagerAddress(tokenId);
            const params = defaultAbiCoder.encode(['bytes', 'address'], [factory.address, tokenAddress]);

            await expect(factory.deployInterchainToken(salt, name, symbol, decimals, totalMint, AddressZero))
                .to.emit(service, 'InterchainTokenDeployed')
                .withArgs(tokenId, tokenAddress, factory.address, name, symbol, decimals)
                .and.to.emit(service, 'TokenManagerDeployed')
                .withArgs(tokenId, expectedTokenManagerAddress, MINT_BURN, params);

            token = await getContractAt('InterchainToken', tokenAddress, wallet);
            executable = await deployContract(wallet, 'TestInterchainExecutable', [service.address]);
        });

        it('Should execute an application with interchain transfer', async () => {
            const sourceChain = otherChains[0];
            const destChain = otherChains[1];
            const sourceAddress = arrayify(wallet.address);
            const amount = 1234;
            const gasValue = 6789; // Set this to the gas quote for the interchain call in production

            const message = 'Hello World!';
            const data = defaultAbiCoder.encode(['address', 'string'], [wallet.address, message]);
            const metadataVersion = 0;
            const metadata = solidityPack(['uint32', 'bytes'], [metadataVersion, data]);
            const payload = defaultAbiCoder.encode(
                ['uint256', 'bytes32', 'bytes', 'bytes', 'uint256', 'bytes'],
                [MESSAGE_TYPE_INTERCHAIN_TRANSFER, tokenId, sourceAddress, executable.address, amount, data],
            );
            const commandId = getRandomBytes32();

            // Initiate the contract call with transfer
            await expect(
                service.interchainTransfer(tokenId, destChain, executable.address, amount, metadata, gasValue, { value: gasValue }),
            )
                .and.to.emit(token, 'Transfer')
                .withArgs(wallet.address, AddressZero, amount)
                .and.to.emit(gateway, 'ContractCall')
                .withArgs(service.address, destChain, service.address, keccak256(payload), payload)
                .and.to.emit(gasService, 'NativeGasPaidForContractCall')
                .withArgs(service.address, destChain, service.address, keccak256(payload), gasValue, wallet.address)
                .to.emit(service, 'InterchainTransfer')
                .withArgs(tokenId, wallet.address, destChain, executable.address.toLowerCase(), amount, keccak256(data));

            await approveContractCall(gateway, sourceChain, service.address, service.address, payload, getRandomBytes32(), 0, commandId);

            // Execute the contract call on destination with transfer
            await expect(service.execute(commandId, sourceChain, service.address, payload))
                .to.emit(service, 'InterchainTransferReceived')
                .withArgs(commandId, tokenId, sourceChain, sourceAddress, executable.address, amount, keccak256(data))
                .and.to.emit(token, 'Transfer')
                .withArgs(AddressZero, executable.address, amount)
                .and.to.emit(token, 'Transfer')
                .withArgs(executable.address, wallet.address, amount)
                .and.to.emit(executable, 'MessageReceived')
                .withArgs(commandId, sourceChain, sourceAddress, wallet.address, message, tokenId, amount);
        });
    });
});
