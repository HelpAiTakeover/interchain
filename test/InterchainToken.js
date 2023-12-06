'use strict';

const { ethers } = require('hardhat');
const {
    constants: { AddressZero, HashZero, MaxUint256 },
    getContractAt,
} = ethers;
const { expect } = require('chai');
const { getRandomBytes32, expectRevert } = require('./utils');
const { deployContract } = require('../scripts/deploy');

describe('InterchainToken', () => {
    let interchainToken, interchainTokenDeployer;

    const name = 'tokenName';
    const symbol = 'tokenSymbol';
    const decimals = 18;
    const mintAmount = 123;

    let token;
    let tokenTest;
    let owner;
    let user;

    before(async () => {
        const wallets = await ethers.getSigners();
        owner = wallets[0];
        user = wallets[1];

        interchainToken = await deployContract(owner, 'InterchainToken', [owner.address]);
        interchainTokenDeployer = await deployContract(owner, 'InterchainTokenDeployer', [interchainToken.address]);

        const salt = getRandomBytes32();
        const tokenId = getRandomBytes32();

        const tokenAddress = await interchainTokenDeployer.deployedAddress(salt);

        token = await getContractAt('InterchainToken', tokenAddress, owner);

        await interchainTokenDeployer.deployInterchainToken(salt, tokenId, owner.address, name, symbol, decimals).then((tx) => tx.wait());

        await (await token.mint(owner.address, mintAmount)).wait();
        expect(await token.interchainTokenId()).to.equal(tokenId);
    });

    describe('Interchain Token', () => {
        it('Should calculate hardcoded constants correctly', async () => {
            await expect(deployContract(owner, `TestInterchainToken`, [])).to.not.be.reverted;
        });

        it('revert on init if not called by the proxy', async () => {
            const implementationAddress = await interchainTokenDeployer.implementationAddress();
            const implementation = await getContractAt('InterchainToken', implementationAddress, owner);

            const tokenId = getRandomBytes32();
            const minter = owner.address;
            const tokenName = 'name';
            const tokenSymbol = 'symbol';
            const tokenDecimals = 7;
            await expectRevert(
                (gasOptions) => implementation.init(tokenId, minter, tokenName, tokenSymbol, tokenDecimals, gasOptions),
                implementation,
                'AlreadyInitialized',
            );
        });

        it('revert on init if service is address(0)', async () => {
            await expectRevert(
                (gasOptions) => deployContract(owner, 'InterchainToken', [AddressZero, gasOptions]),
                interchainToken,
                'InterchainTokenServiceAddressZero',
            );
        });

        it('revert on init if tokenId is 0', async () => {
            const implementationAddress = await interchainTokenDeployer.implementationAddress();
            const implementation = await getContractAt('InterchainToken', implementationAddress, owner);

            const salt = getRandomBytes32();
            const minter = owner.address;
            await expectRevert(
                (gasOptions) => interchainTokenDeployer.deployInterchainToken(salt, HashZero, minter, name, symbol, decimals, gasOptions),
                implementation,
                'TokenIdZero',
            );
        });

        it('revert on init if token name is invalid', async () => {
            const implementationAddress = await interchainTokenDeployer.implementationAddress();
            const implementation = await getContractAt('InterchainToken', implementationAddress, owner);

            const salt = getRandomBytes32();
            const tokenId = getRandomBytes32();
            const minter = owner.address;
            await expectRevert(
                (gasOptions) => interchainTokenDeployer.deployInterchainToken(salt, tokenId, minter, '', symbol, decimals, gasOptions),
                implementation,
                'TokenNameEmpty',
            );
        });

        it('should subtract from the spender allowance', async () => {
            tokenTest = await deployContract(owner, 'TestInterchainToken', []);

            const sender = owner.address;
            const spender = user.address;
            const amount = 100;

            await tokenTest.approve(spender, amount).then((tx) => tx.wait());
            const initialAllowance = await tokenTest.allowance(sender, spender);
            expect(initialAllowance).to.eq(amount);

            await expect(tokenTest.spendAllowance(sender, spender, amount)).to.emit(tokenTest, 'Approval').withArgs(sender, spender, 0);

            const finalAllowance = await tokenTest.allowance(sender, spender);
            expect(finalAllowance).to.eq(0);
        });

        it('should not subtract from the spender allowance if allowance is max uint', async () => {
            tokenTest = await deployContract(owner, 'TestInterchainToken', []);

            const sender = owner.address;
            const spender = user.address;
            const amount = MaxUint256;

            await tokenTest.approve(spender, amount).then((tx) => tx.wait());
            const initialAllowance = await tokenTest.allowance(sender, spender);
            expect(initialAllowance).to.eq(amount);

            await expect(tokenTest.spendAllowance(sender, spender, amount)).to.not.emit(tokenTest, 'Approval');

            const finalAllowance = await tokenTest.allowance(sender, spender);
            expect(finalAllowance).to.eq(initialAllowance);
        });
    });
});
