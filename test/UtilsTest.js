'use strict';

require('dotenv').config();
const chai = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { Wallet, Contract } = ethers;
const { AddressZero } = ethers.constants;
const { defaultAbiCoder, arrayify, toUtf8Bytes, hexlify } = ethers.utils;
const { expect } = chai;
const { getRandomBytes32, expectRevert, isHardhat, waitFor } = require('./utils');
const { deployContract } = require('../scripts/deploy');

const ImplemenationTest = require('../artifacts/contracts/test/utils/ImplementationTest.sol/ImplementationTest.json');
const StandardizedToken = require('../artifacts/contracts/token-implementations/StandardizedToken.sol/StandardizedToken.json');
const StandardizedTokenProxy = require('../artifacts/contracts/proxies/StandardizedTokenProxy.sol/StandardizedTokenProxy.json');

let ownerWallet, otherWallet;

before(async () => {
    const wallets = await ethers.getSigners();
    ownerWallet = wallets[0];
    otherWallet = wallets[1];
});

describe('Operatable', () => {
    let test;
    let operatorRole;

    before(async () => {
        test = await deployContract(ownerWallet, 'OperatorableTest', [ownerWallet.address]);
        operatorRole = await test.getOperatorRole();
    });

    it('Should calculate hardcoded constants correctly', async () => {
        await expect(deployContract(ownerWallet, `TestOperatable`, [])).to.not.be.reverted;
    });

    it('Should be able to run the onlyOperatorable function as the operator', async () => {
        await (await test.testOperatorable()).wait();

        expect(await test.nonce()).to.equal(1);
    });

    it('Should not be able to run the onlyOperatorable function as not the operator', async () => {
        await expectRevert((gasOptions) => test.connect(otherWallet).testOperatorable(gasOptions), test, 'MissingRole');
    });

    it('Should be able to change the operator only as the operator', async () => {
        expect(await test.hasRole(ownerWallet.address, operatorRole)).to.be.true;

        await expect(test.transferOperatorship(otherWallet.address))
            .to.emit(test, 'RolesRemoved')
            .withArgs(ownerWallet.address, 1 << operatorRole)
            .to.emit(test, 'RolesAdded')
            .withArgs(otherWallet.address, 1 << operatorRole);

        expect(await test.hasRole(otherWallet.address, operatorRole)).to.be.true;

        await expectRevert((gasOptions) => test.transferOperatorship(otherWallet.address, gasOptions), test, 'MissingRole');
    });

    it('Should be able to propose operator only as the operator', async () => {
        expect(await test.hasRole(otherWallet.address, operatorRole)).to.be.true;

        await expectRevert((gasOptions) => test.proposeOperatorship(ownerWallet.address, gasOptions), test, 'MissingRole');

        await expect(test.connect(otherWallet).proposeOperatorship(ownerWallet.address))
            .to.emit(test, 'RolesProposed')
            .withArgs(otherWallet.address, ownerWallet.address, 1 << operatorRole);
    });

    it('Should be able to accept operatorship only as proposed operator', async () => {
        expect(await test.hasRole(otherWallet.address, operatorRole)).to.be.true;

        await expectRevert(
            (gasOptions) => test.connect(otherWallet).acceptOperatorship(otherWallet.address, gasOptions),
            test,
            'InvalidProposedRoles',
        );

        await expect(test.connect(ownerWallet).acceptOperatorship(otherWallet.address))
            .to.emit(test, 'RolesRemoved')
            .withArgs(otherWallet.address, 1 << operatorRole)
            .to.emit(test, 'RolesAdded')
            .withArgs(ownerWallet.address, 1 << operatorRole);
    });
});

describe('Distributable', () => {
    let test;
    let distributorRole;

    before(async () => {
        test = await deployContract(ownerWallet, 'DistributableTest', [ownerWallet.address]);
        distributorRole = await test.getDistributorRole();
    });

    it('Should calculate hardcoded constants correctly', async () => {
        await expect(deployContract(ownerWallet, `TestDistributable`, [])).to.not.be.reverted;
    });

    it('Should be able to run the onlyDistributor function as the distributor', async () => {
        await (await test.testDistributable()).wait();

        expect(await test.nonce()).to.equal(1);
    });

    it('Should not be able to run the onlyDistributor function as not the distributor', async () => {
        await expectRevert((gasOptions) => test.connect(otherWallet).testDistributable(gasOptions), test, 'MissingRole');
    });

    it('Should be able to change the distributor only as the distributor', async () => {
        expect(await test.hasRole(ownerWallet.address, distributorRole)).to.be.true;

        await expect(test.transferDistributorship(otherWallet.address))
            .to.emit(test, 'RolesRemoved')
            .withArgs(ownerWallet.address, 1 << distributorRole)
            .to.emit(test, 'RolesAdded')
            .withArgs(otherWallet.address, 1 << distributorRole);

        expect(await test.hasRole(otherWallet.address, distributorRole)).to.be.true;

        await expectRevert((gasOptions) => test.transferDistributorship(otherWallet.address, gasOptions), test, 'MissingRole');
    });

    it('Should be able to propose a new distributor only as distributor', async () => {
        expect(await test.hasRole(otherWallet.address, distributorRole)).to.be.true;

        await expectRevert(
            (gasOptions) => test.connect(ownerWallet).proposeDistributorship(ownerWallet.address, gasOptions),
            test,
            'MissingRole',
        );

        await expect(test.connect(otherWallet).proposeDistributorship(ownerWallet.address))
            .to.emit(test, 'RolesProposed')
            .withArgs(otherWallet.address, ownerWallet.address, 1 << distributorRole);
    });

    it('Should be able to accept distributorship only as the proposed distributor', async () => {
        expect(await test.hasRole(otherWallet.address, distributorRole)).to.be.true;

        await expectRevert(
            (gasOptions) => test.connect(otherWallet).acceptDistributorship(otherWallet.address, gasOptions),
            test,
            'InvalidProposedRoles',
        );

        await expect(test.connect(ownerWallet).acceptDistributorship(otherWallet.address))
            .to.emit(test, 'RolesRemoved')
            .withArgs(otherWallet.address, 1 << distributorRole)
            .to.emit(test, 'RolesAdded')
            .withArgs(ownerWallet.address, 1 << distributorRole);
    });
});

describe('FlowLimit', async () => {
    let test;
    const flowLimit = isHardhat ? 5 : 2;

    before(async () => {
        test = isHardhat
            ? await deployContract(ownerWallet, 'FlowLimitTest')
            : await deployContract(ownerWallet, 'FlowLimitTestLiveNetwork');
    });

    async function nextEpoch() {
        const epoch = isHardhat ? 6 * 3600 : 60;

        if (isHardhat) {
            const latest = Number(await time.latest());
            const next = (Math.floor(latest / epoch) + 1) * epoch;

            await time.increaseTo(next);
        } else {
            await waitFor(epoch);
        }
    }

    it('Should calculate hardcoded constants correctly', async () => {
        await expect(deployContract(ownerWallet, `TestFlowLimit`, [])).to.not.be.reverted;
    });

    it('Should be able to set the flow limit', async () => {
        await expect(test.setFlowLimit(flowLimit)).to.emit(test, 'FlowLimitSet').withArgs(flowLimit);

        expect(await test.getFlowLimit()).to.equal(flowLimit);
    });

    it('Should test flow in', async () => {
        await nextEpoch();

        for (let i = 0; i < flowLimit; i++) {
            await (await test.addFlowIn(1)).wait();
            expect(await test.getFlowInAmount()).to.equal(i + 1);
        }

        await expectRevert((gasOptions) => test.addFlowIn(1, gasOptions), test, 'FlowLimitExceeded');

        await nextEpoch();

        expect(await test.getFlowInAmount()).to.equal(0);

        await (await test.addFlowIn(flowLimit)).wait();
    });

    it('Should test flow out', async () => {
        await nextEpoch();

        for (let i = 0; i < flowLimit; i++) {
            await (await test.addFlowOut(1)).wait();
            expect(await test.getFlowOutAmount()).to.equal(i + 1);
        }

        await expectRevert((gasOptions) => test.addFlowOut(1, gasOptions), test, 'FlowLimitExceeded');

        await nextEpoch();

        expect(await test.getFlowOutAmount()).to.equal(0);

        await (await test.addFlowOut(flowLimit)).wait();
    });
});

describe('Implementation', () => {
    let implementation, proxy;

    before(async () => {
        implementation = await deployContract(ownerWallet, 'ImplementationTest');
        proxy = await deployContract(ownerWallet, 'NakedProxy', [implementation.address]);
        proxy = new Contract(proxy.address, ImplemenationTest.abi, ownerWallet);
    });

    it('Should test the implemenation contract', async () => {
        const val = 123;
        const params = defaultAbiCoder.encode(['uint256'], [val]);

        await (await proxy.setup(params)).wait();

        expect(await proxy.val()).to.equal(val);

        await expectRevert((gasOptions) => implementation.setup(params, gasOptions), implementation, 'NotProxy');
    });
});

describe('Mutlicall', () => {
    let test;
    let function1Data;
    let function2Data;
    let function3Data;

    before(async () => {
        test = await deployContract(ownerWallet, 'MulticallTest');
        function1Data = (await test.populateTransaction.function1()).data;
        function2Data = (await test.populateTransaction.function2()).data;
        function3Data = (await test.populateTransaction.function3()).data;
    });

    it('Shoult test the multicall', async () => {
        const nonce = Number(await test.nonce());

        await expect(test.multicall([function1Data, function2Data, function2Data, function1Data]))
            .to.emit(test, 'Function1Called')
            .withArgs(nonce)
            .and.to.emit(test, 'Function2Called')
            .withArgs(nonce + 1)
            .and.to.emit(test, 'Function2Called')
            .withArgs(nonce + 2)
            .and.to.emit(test, 'Function1Called')
            .withArgs(nonce + 3);
    });

    it('Shoult test the multicall returns', async () => {
        const nonce = Number(await test.nonce());

        await expect(test.multicallTest([function2Data, function1Data, function2Data, function2Data]))
            .to.emit(test, 'Function2Called')
            .withArgs(nonce)
            .and.to.emit(test, 'Function1Called')
            .withArgs(nonce + 1)
            .and.to.emit(test, 'Function2Called')
            .withArgs(nonce + 2)
            .and.to.emit(test, 'Function2Called')
            .withArgs(nonce + 3);

        const lastReturns = await test.getLastMulticallReturns();

        for (let i = 0; i < lastReturns.length; i++) {
            const val = Number(defaultAbiCoder.decode(['uint256'], lastReturns[i]));
            expect(val).to.equal(nonce + i);
        }
    });

    it('Shoult revert if any of the calls fail', async () => {
        const nonce = Number(await test.nonce());

        await expect(test.multicall([function1Data, function2Data, function3Data, function1Data]))
            .to.emit(test, 'Function1Called')
            .withArgs(nonce)
            .and.to.emit(test, 'Function2Called')
            .withArgs(nonce + 1).to.be.reverted;
    });
});

describe('Pausable', () => {
    let test;
    before(async () => {
        test = await deployContract(ownerWallet, 'PausableTest');
    });

    it('Should calculate hardcoded constants correctly', async () => {
        await expect(deployContract(ownerWallet, `TestPausable`, [])).to.not.be.reverted;
    });

    it('Should be able to set paused to true or false', async () => {
        await expect(test.setPaused(true)).to.emit(test, 'PausedSet').withArgs(true);

        expect(await test.isPaused()).to.equal(true);

        await expect(test.setPaused(false)).to.emit(test, 'PausedSet').withArgs(false);

        expect(await test.isPaused()).to.equal(false);
    });

    it('Should be able to execute notPaused functions only when not paused', async () => {
        await expect(test.setPaused(false)).to.emit(test, 'PausedSet').withArgs(false);
        await expect(test.testPaused()).to.emit(test, 'TestEvent');

        await expect(test.setPaused(true)).to.emit(test, 'PausedSet').withArgs(true);
        await expectRevert((gasOptions) => test.testPaused(gasOptions), test, 'Paused');
    });
});

describe('StandardizedTokenDeployer', () => {
    let standardizedToken, standardizedTokenDeployer;
    const tokenManager = new Wallet(getRandomBytes32()).address;
    const mintTo = new Wallet(getRandomBytes32()).address;
    const name = 'tokenName';
    const symbol = 'tokenSymbol';
    const decimals = 18;
    const mintAmount = 123;
    const DISTRIBUTOR_ROLE = 0;

    before(async () => {
        standardizedToken = await deployContract(ownerWallet, 'StandardizedToken');
        standardizedTokenDeployer = await deployContract(ownerWallet, 'StandardizedTokenDeployer', [standardizedToken.address]);
    });

    it('Should revert on deployment with invalid implementation address', async () => {
        await expectRevert(
            (gasOptions) => deployContract(ownerWallet, 'StandardizedTokenDeployer', [AddressZero, gasOptions]),
            standardizedTokenDeployer,
            'AddressZero',
        );
    });

    it('Should deploy a mint burn token only once', async () => {
        const salt = getRandomBytes32();

        const tokenAddress = await standardizedTokenDeployer.deployedAddress(salt);

        const token = new Contract(tokenAddress, StandardizedToken.abi, ownerWallet);
        const tokenProxy = new Contract(tokenAddress, StandardizedTokenProxy.abi, ownerWallet);

        await expect(
            standardizedTokenDeployer.deployStandardizedToken(salt, tokenManager, tokenManager, name, symbol, decimals, mintAmount, mintTo),
        )
            .to.emit(token, 'Transfer')
            .withArgs(AddressZero, mintTo, mintAmount)
            .and.to.emit(token, 'RolesAdded')
            .withArgs(tokenManager, 1 << DISTRIBUTOR_ROLE)
            .to.emit(token, 'RolesAdded')
            .withArgs(tokenManager, 1 << DISTRIBUTOR_ROLE);

        expect(await tokenProxy.implementation()).to.equal(standardizedToken.address);
        expect(await token.name()).to.equal(name);
        expect(await token.symbol()).to.equal(symbol);
        expect(await token.decimals()).to.equal(decimals);
        expect(await token.balanceOf(mintTo)).to.equal(mintAmount);
        expect(await token.hasRole(tokenManager, DISTRIBUTOR_ROLE)).to.be.true;
        expect(await token.tokenManager()).to.equal(tokenManager);

        await expectRevert(
            (gasOptions) =>
                standardizedTokenDeployer.deployStandardizedToken(
                    salt,
                    tokenManager,
                    tokenManager,
                    name,
                    symbol,
                    decimals,
                    mintAmount,
                    mintTo,
                    gasOptions,
                ),
            standardizedTokenDeployer,
            'AlreadyDeployed',
        );
    });

    describe('AddressBytesUtils', () => {
        let addressBytesUtils;

        before(async () => {
            addressBytesUtils = await deployContract(ownerWallet, 'AddressBytesUtilsTest');
        });

        it('Should convert bytes address to address', async () => {
            const bytesAddress = arrayify(ownerWallet.address);
            const convertedAddress = await addressBytesUtils.toAddress(bytesAddress);
            expect(convertedAddress).to.eq(ownerWallet.address);
        });

        it('Should revert on invalid bytes length', async () => {
            const bytesAddress = defaultAbiCoder.encode(['bytes'], [toUtf8Bytes(ownerWallet.address)]);
            await expectRevert(
                (gasOptions) => addressBytesUtils.toAddress(bytesAddress, gasOptions),
                addressBytesUtils,
                'InvalidBytesLength',
            );
        });

        it('Should convert address to bytes address', async () => {
            const convertedAddress = await addressBytesUtils.toBytes(ownerWallet.address);
            expect(convertedAddress).to.eq(hexlify(ownerWallet.address));
        });
    });

    describe('NoReEntrancy', () => {
        let noReEntrancy;

        before(async () => {
            noReEntrancy = await deployContract(ownerWallet, 'NoReEntrancyTest');
        });

        it('Should calculate hardcoded constants correctly', async () => {
            await expect(deployContract(ownerWallet, `TestNoReEntrancy`, [])).to.not.be.reverted;
        });

        it('Should revert on reentrancy', async function () {
            await expect(noReEntrancy.testFunction()).to.be.revertedWithCustomError(noReEntrancy, 'ReEntrancy');
        });
    });
});
