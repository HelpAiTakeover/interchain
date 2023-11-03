'use strict';

const chai = require('chai');
const { ethers } = require('hardhat');
const {
    Contract,
    utils: { keccak256, toUtf8Bytes },
} = ethers;
const { expect } = chai;
const { getRandomBytes32, expectRevert, getGasOptions } = require('./utils');
const { deployContract } = require('../scripts/deploy');

const InterchainToken = require('../artifacts/contracts/token-implementations/InterchainToken.sol/InterchainToken.json');
const InterchainTokenProxy = require('../artifacts/contracts/proxies/InterchainTokenProxy.sol/InterchainTokenProxy.json');

describe('InterchainToken', () => {
    let interchainToken, interchainTokenDeployer;

    const name = 'tokenName';
    const symbol = 'tokenSymbol';
    const decimals = 18;
    const mintAmount = 123;

    let token;
    let tokenProxy;

    let owner;

    before(async () => {
        const wallets = await ethers.getSigners();
        owner = wallets[0];

        interchainToken = await deployContract(owner, 'InterchainToken');
        interchainTokenDeployer = await deployContract(owner, 'InterchainTokenDeployer', [interchainToken.address]);

        const salt = getRandomBytes32();

        const tokenAddress = await interchainTokenDeployer.deployedAddress(salt);

        token = new Contract(tokenAddress, InterchainToken.abi, owner);
        tokenProxy = new Contract(tokenAddress, InterchainTokenProxy.abi, owner);

        await interchainTokenDeployer
            .deployInterchainToken(salt, owner.address, owner.address, name, symbol, decimals)
            .then((tx) => tx.wait());

        await (await token.mint(owner.address, mintAmount)).wait();
    });

    describe('Interchain Token Proxy', () => {
        it('should revert if interchain token implementation is invalid', async () => {
            const invalidInterchainToken = await deployContract(owner, 'InvalidInterchainToken');
            interchainTokenDeployer = await deployContract(owner, 'InterchainTokenDeployer', [invalidInterchainToken.address]);

            const salt = getRandomBytes32();

            await expect(
                interchainTokenDeployer.deployInterchainToken(salt, owner.address, owner.address, name, symbol, decimals, getGasOptions()),
            ).to.be.reverted;
        });

        it('should revert if interchain token setup fails', async () => {
            const params = '0x1234';
            await expectRevert(
                (gasOptions) => deployContract(owner, 'InterchainTokenProxy', [interchainToken.address, params, gasOptions]),
                tokenProxy,
                'SetupFailed',
            );
        });

        it('should return the correct contract ID', async () => {
            const contractID = await token.contractId();
            const hash = keccak256(toUtf8Bytes('interchain-token'));
            expect(contractID).to.equal(hash);
        });
    });

    describe('Interchain Token', () => {
        it('revert on setup if not called by the proxy', async () => {
            const implementationAddress = await tokenProxy.implementation();
            const implementation = new Contract(implementationAddress, InterchainToken.abi, owner);

            const params = '0x';
            await expectRevert((gasOptions) => implementation.setup(params, gasOptions), token, 'NotProxy');
        });
    });
});
