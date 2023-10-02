'use strict';

require('dotenv').config();
const chai = require('chai');
const { ethers } = require('hardhat');
const {
    constants: { AddressZero },
    utils: { defaultAbiCoder, keccak256, toUtf8Bytes },
} = ethers;
const { expect } = chai;
const { deployRemoteAddressValidator, deployContract } = require('../scripts/deploy');
const { expectRevert } = require('../scripts/utils');

describe('RemoteAddressValidator', () => {
    let ownerWallet, otherWallet, remoteAddressValidator, interchainTokenServiceAddress;

    const otherRemoteAddress = 'any string as an address';
    const otherChain = 'Chain Name';
    const chainName = 'Chain Name';

    before(async () => {
        const wallets = await ethers.getSigners();
        ownerWallet = wallets[0];
        otherWallet = wallets[1];
        interchainTokenServiceAddress = wallets[2].address;
        remoteAddressValidator = await deployRemoteAddressValidator(ownerWallet, interchainTokenServiceAddress, chainName);
    });

    it('Should revert on RemoteAddressValidator deployment with invalid interchain token service address', async () => {
        const remoteAddressValidatorFactory = await ethers.getContractFactory('RemoteAddressValidator');
        await expectRevert(
            (gasOptions) => remoteAddressValidatorFactory.deploy(AddressZero, chainName, gasOptions),
            remoteAddressValidator,
            'ZeroAddress',
        );
    });

    it('Should revert on RemoteAddressValidator deployment with invalid chain name', async () => {
        const remoteAddressValidatorFactory = await ethers.getContractFactory('RemoteAddressValidator');
        await expectRevert(
            (gasOptions) => remoteAddressValidatorFactory.deploy(interchainTokenServiceAddress, '', gasOptions),
            remoteAddressValidator,
            'ZeroStringLength',
        );
    });

    it('Should revert on RemoteAddressValidator deployment with length mismatch between chains and trusted addresses arrays', async () => {
        const remoteAddressValidatorImpl = await deployContract(ownerWallet, 'RemoteAddressValidator', [
            interchainTokenServiceAddress,
            chainName,
        ]);
        const remoteAddressValidatorProxyFactory = await ethers.getContractFactory('RemoteAddressValidatorProxy');
        const params = defaultAbiCoder.encode(['string[]', 'string[]'], [['Chain A'], []]);
        await expectRevert(
            (gasOptions) =>
                remoteAddressValidatorProxyFactory.deploy(remoteAddressValidatorImpl.address, ownerWallet.address, params, gasOptions),
            remoteAddressValidator,
            'SetupFailed',
        );
    });

    it('Should deploy RemoteAddressValidator and add trusted addresses', async () => {
        const otherRemoteAddressValidator = await deployRemoteAddressValidator(
            ownerWallet,
            interchainTokenServiceAddress,
            chainName,
            [otherChain],
            [otherRemoteAddress],
        );

        const remoteAddress = await otherRemoteAddressValidator.remoteAddresses(otherChain);
        const remoteAddressHash = await otherRemoteAddressValidator.remoteAddressHashes(otherChain);

        expect(remoteAddress).to.eq(otherRemoteAddress);
        expect(remoteAddressHash).to.eq(keccak256(toUtf8Bytes(otherRemoteAddress.toLowerCase())));
    });

    it('Should get the correct remote address for unregistered chains', async () => {
        const remoteAddress = await remoteAddressValidator.getRemoteAddress(otherChain);
        expect(remoteAddress).to.equal(interchainTokenServiceAddress.toLowerCase());
    });

    it('Should get the correct interchain token service address', async () => {
        const itsAddress = await remoteAddressValidator.interchainTokenServiceAddress();
        expect(itsAddress).to.equal(interchainTokenServiceAddress);

        const itsAddressHash = await remoteAddressValidator.interchainTokenServiceAddressHash();
        expect(itsAddressHash).to.equal(keccak256(toUtf8Bytes(interchainTokenServiceAddress.toLowerCase())));
    });

    it('Should be able to validate remote addresses properly', async () => {
        expect(await remoteAddressValidator.validateSender(otherChain, otherRemoteAddress)).to.equal(false);
        expect(await remoteAddressValidator.validateSender(otherChain, interchainTokenServiceAddress)).to.equal(true);
    });

    it('Should not be able to add a custom remote address as not the owner', async () => {
        await expectRevert(
            (gasOptions) => remoteAddressValidator.connect(otherWallet).addTrustedAddress(otherChain, otherRemoteAddress, gasOptions),
            remoteAddressValidator,
            'NotOwner',
        );
    });

    it('Should be able to add a custom remote address as the owner', async () => {
        await expect(remoteAddressValidator.addTrustedAddress(otherChain, otherRemoteAddress))
            .to.emit(remoteAddressValidator, 'TrustedAddressAdded')
            .withArgs(otherChain, otherRemoteAddress);
        expect(await remoteAddressValidator.getRemoteAddress(otherChain)).to.equal(otherRemoteAddress);
    });

    it('Should revert on adding a custom remote address with an empty chain name', async () => {
        await expectRevert(
            (gasOptions) => remoteAddressValidator.addTrustedAddress('', otherRemoteAddress, gasOptions),
            remoteAddressValidator,
            'ZeroStringLength',
        );
    });

    it('Should revert on adding a custom remote address with an invalid remote address', async () => {
        await expectRevert(
            (gasOptions) => remoteAddressValidator.addTrustedAddress(otherChain, '', gasOptions),
            remoteAddressValidator,
            'ZeroStringLength',
        );
    });

    it('Should be able to validate remote addresses properly.', async () => {
        expect(await remoteAddressValidator.validateSender(otherChain, otherRemoteAddress)).to.equal(true);
    });

    it('Should not be able to remove a custom remote address as not the owner', async () => {
        await expectRevert(
            (gasOptions) => remoteAddressValidator.connect(otherWallet).removeTrustedAddress(otherChain, gasOptions),
            remoteAddressValidator,
            'NotOwner',
        );
    });

    it('Should be able to remove a custom remote address as the owner', async () => {
        await expect(remoteAddressValidator.removeTrustedAddress(otherChain))
            .to.emit(remoteAddressValidator, 'TrustedAddressRemoved')
            .withArgs(otherChain);
        expect(await remoteAddressValidator.getRemoteAddress(otherChain)).to.equal(interchainTokenServiceAddress.toLowerCase());
    });

    it('Should revert on removing a custom remote address with an empty chain name', async () => {
        await expectRevert(
            (gasOptions) => remoteAddressValidator.removeTrustedAddress('', gasOptions),
            remoteAddressValidator,
            'ZeroStringLength',
        );
    });

    it('Should be able to validate remote addresses properly.', async () => {
        expect(await remoteAddressValidator.validateSender(otherChain, otherRemoteAddress)).to.equal(false);
        expect(await remoteAddressValidator.validateSender(otherChain, interchainTokenServiceAddress)).to.equal(true);
    });
});
