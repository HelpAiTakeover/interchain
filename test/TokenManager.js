'use strict';

const chai = require('chai');
const { ethers } = require('hardhat');
const {
    utils: { keccak256, toUtf8Bytes, defaultAbiCoder },
    constants: { AddressZero },
    getContractAt,
} = ethers;
const { expect } = chai;
const { expectRevert, getRandomBytes32, getEVMVersion } = require('./utils');
const { deployContract, deployAll } = require('../scripts/deploy');

describe('Token Manager', () => {
    const FLOW_LIMITER_ROLE = 2;
    let owner, user, token, service;
    let TestTokenManager, tokenManagerLockUnlock, tokenManagerMintBurn, tokenManagerLockUnlockFeeOnTransfer;

    before(async () => {
        [owner, user, token, service] = await ethers.getSigners();

        TestTokenManager = await deployContract(owner, `TestTokenManager`, [service.address]);
        tokenManagerLockUnlock = await deployContract(owner, `TokenManagerLockUnlock`, [service.address]);
        tokenManagerMintBurn = await deployContract(owner, `TokenManagerMintBurn`, [service.address]);
        tokenManagerLockUnlockFeeOnTransfer = await deployContract(owner, `TokenManagerLockUnlockFee`, [service.address]);
    });

    it('Should revert on token manager deployment with invalid service address', async () => {
        await expectRevert(
            (gasOptions) => deployContract(owner, `TestTokenManager`, [AddressZero, gasOptions]),
            TestTokenManager,
            'TokenLinkerZeroAddress',
        );
    });

    it('Should return the correct contract id', async () => {
        const expectedContractid = keccak256(toUtf8Bytes('token-manager'));
        const contractId = await TestTokenManager.contractId();
        expect(contractId).to.eq(expectedContractid);
    });

    it('Should revert on setup if not called by the proxy', async () => {
        const params = '0x';
        await expectRevert((gasOptions) => TestTokenManager.setup(params, gasOptions), TestTokenManager, 'NotProxy');
    });

    it('Should revert on transmitInterchainTransfer if not called by the token', async () => {
        const [service] = await deployAll(owner, 'Test');
        const salt = getRandomBytes32();
        const MINT_BURN = 0;

        const params = defaultAbiCoder.encode(['bytes', 'address'], [owner.address, token.address]);
        await service.deployTokenManager(salt, '', MINT_BURN, params, 0);
        const tokenManagerAddress = await service.tokenManagerAddress(await service.interchainTokenId(owner.address, salt));
        const tokenManager = await getContractAt('ITokenManager', tokenManagerAddress, owner);

        const sender = owner.address;
        const destinationChain = 'Dest Chain';
        const destinationAddress = toUtf8Bytes(user.address);
        const amount = 10;
        const metadata = '0x00000000';

        await expectRevert(
            (gasOptions) =>
                tokenManager.transmitInterchainTransfer(sender, destinationChain, destinationAddress, amount, metadata, gasOptions),
            tokenManagerLockUnlock,
            'NotToken',
            [sender],
        );
    });

    it('Should revert on giveToken if not called by the service', async () => {
        const destinationAddress = user.address;
        const amount = 10;

        await expectRevert(
            (gasOptions) => TestTokenManager.giveToken(destinationAddress, amount, gasOptions),
            TestTokenManager,
            'NotService',
            [owner.address],
        );
    });

    it('Should revert on takeToken if not called by the service', async () => {
        const sourceAddress = user.address;
        const amount = 10;

        await expectRevert((gasOptions) => TestTokenManager.takeToken(sourceAddress, amount, gasOptions), TestTokenManager, 'NotService', [
            owner.address,
        ]);
    });

    it('Should revert on setFlowLimit if not called by the operator', async () => {
        const flowLimit = 100;

        await expectRevert((gasOptions) => TestTokenManager.setFlowLimit(flowLimit, gasOptions), TestTokenManager, 'MissingRole', [
            owner.address,
            FLOW_LIMITER_ROLE,
        ]);
    });

    it('Should revert on addFlowLimiter if flow limiter address is invalid', async () => {
        await TestTokenManager.addOperator(owner.address).then((tx) => tx.wait());

        await expectRevert((gasOptions) => TestTokenManager.addFlowLimiter(AddressZero, gasOptions), TestTokenManager, 'ZeroAddress', []);
    });

    it('Should revert on removeFlowLimiter if flow limiter address is invalid', async () => {
        await TestTokenManager.addOperator(owner.address).then((tx) => tx.wait());

        await expectRevert(
            (gasOptions) => TestTokenManager.removeFlowLimiter(AddressZero, gasOptions),
            TestTokenManager,
            'ZeroAddress',
            [],
        );
    });

    it('Should return the correct parameters for lock/unlock token manager', async () => {
        const expectedParams = defaultAbiCoder.encode(['bytes', 'address'], [toUtf8Bytes(owner.address), token.address]);
        const params = await tokenManagerLockUnlock.params(toUtf8Bytes(owner.address), token.address);
        expect(expectedParams).to.eq(params);
    });

    it('Should return the correct parameters for mint/burn token manager', async () => {
        const expectedParams = defaultAbiCoder.encode(['bytes', 'address'], [toUtf8Bytes(owner.address), token.address]);
        const params = await tokenManagerMintBurn.params(toUtf8Bytes(owner.address), token.address);
        expect(expectedParams).to.eq(params);
    });

    it('Should return the correct parameters for fee on transfer token manager', async () => {
        const expectedParams = defaultAbiCoder.encode(['bytes', 'address'], [toUtf8Bytes(owner.address), token.address]);
        const params = await tokenManagerLockUnlockFeeOnTransfer.params(toUtf8Bytes(owner.address), token.address);
        expect(expectedParams).to.eq(params);
    });

    it('Should preserve the same proxy bytecode for each EVM [ @skip-on-coverage ]', async () => {
        const proxyFactory = await ethers.getContractFactory('TokenManagerProxy', owner);
        const proxyBytecode = proxyFactory.bytecode;
        const proxyBytecodeHash = keccak256(proxyBytecode);

        const expected = {
            istanbul: '0xce3ee5c04c84351d193a6e5dc52e34702039a6083437b077367bac26da57103c',
            berlin: '0xea7ab1f8727ce63dd60f1b7c6770723259b7ac2ce69a74046509e2a65cd4b899',
            london: '0x97da1989bb59bf727d23961f163900ce0dcab3dafa2b3fa0aec39f09c5bd233e',
        }[getEVMVersion()];

        expect(proxyBytecodeHash).to.be.equal(expected);
    });
});
