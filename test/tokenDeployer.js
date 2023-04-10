'use strict';

const chai = require('chai');
const { getDefaultProvider, Contract, Wallet } = require('ethers');
const { expect } = chai;
const { keccak256, defaultAbiCoder } = require('ethers/lib/utils');
require('dotenv').config();
const Token = require('../artifacts/contracts/interfaces/IERC20BurnableMintable.sol/IERC20BurnableMintable.json');
const Create3Deployer = require('@axelar-network/axelar-gmp-sdk-solidity/artifacts/contracts/deploy/Create3Deployer.sol/Create3Deployer.json');

const { createAndExport, stopAll } = require('@axelar-network/axelar-local-dev');

let chain;
let wallet;
let otherWallet;
let tokenDeployer;

async function setupLocal(toFund) {
    await createAndExport({
        chainOutputPath: './info/local.json',
        accountsToFund: toFund,
        relayInterval: 100,
        chains: ['Ethereum'],
    });
    chain = require('../info/local.json')[0];
}

before(async () => {
    const deployerKey = keccak256(defaultAbiCoder.encode(['string'], [process.env.PRIVATE_KEY_GENERATOR]));
    const otherKey = keccak256(defaultAbiCoder.encode(['string'], ['another key']));
    const deployerAddress = new Wallet(deployerKey).address;
    const otherAddress = new Wallet(otherKey).address;
    const toFund = [deployerAddress, otherAddress];
    await setupLocal(toFund);
    const provider = getDefaultProvider(chain.rpc);
    wallet = new Wallet(deployerKey, provider);
    otherWallet = new Wallet(otherKey, provider);
    const { deployTokenDeployer } = require('../scripts/deploy.js');

    tokenDeployer = await deployTokenDeployer(chain, wallet);
});

after(async () => {
    await stopAll();
});

describe('Token', () => {
    let token;
    const name = 'Test Token';
    const symbol = 'TT';
    const decimals = 13;
    const key = `tokenDeployerKey`;
    const salt = keccak256(defaultAbiCoder.encode(['string'], [key]));
    const amount = 12345;

    before(async () => {
        const deployerKey = keccak256(defaultAbiCoder.encode(['string'], [process.env.PRIVATE_KEY_GENERATOR]));
        const otherKey = keccak256(defaultAbiCoder.encode(['string'], ['another key']));
        const deployerAddress = new Wallet(deployerKey).address;
        const otherAddress = new Wallet(otherKey).address;
        const toFund = [deployerAddress, otherAddress];
        await setupLocal(toFund);
        const provider = getDefaultProvider(chain.rpc);
        wallet = new Wallet(deployerKey, provider);
        otherWallet = new Wallet(otherKey, provider);
        const { deployTokenDeployer } = require('../scripts/deploy.js');
    
        tokenDeployer = await deployTokenDeployer(chain, wallet);

        await tokenDeployer.deployToken(name, symbol, decimals, wallet.address, salt);
        const deployer = new Contract(chain.create3Deployer, Create3Deployer.abi, wallet);
        const tokenAddress = await deployer.deployedAddress(tokenDeployer.address, salt);
        token = new Contract(tokenAddress, Token.abi, wallet);
    });

    it('Should Test that the token has the correct name, symbol, decimals and owner', async () => {
        expect(await token.name()).to.equal(name);
        expect(await token.symbol()).to.equal(symbol);
        expect(await token.decimals()).to.equal(decimals);
    });

    it('Should be able to mint as the owner', async () => {
        await token.mint(wallet.address, amount);

        expect(Number(await token.balanceOf(wallet.address))).to.equal(amount);
    });

    it('Should not be able to mint as not the owner', async () => {
        await expect(token.connect(otherWallet).mint(wallet.address, amount)).to.be.reverted;
    });

    it('Should not be able to burn as not the owner', async () => {
        await token.approve(otherWallet.address, amount);
        await expect(token.connect(otherWallet).burnFrom(wallet.address, amount)).to.be.reverted;
    });

    it('Should not be able to burn without approval', async () => {
        await expect(token.burnFrom(wallet.address, amount)).to.be.reverted;
    });

    it('Should be able to burn as the owner with approval', async () => {
        await token.approve(wallet.address, amount);
        await token.burnFrom(wallet.address, amount);

        expect(Number(await token.balanceOf(wallet.address))).to.equal(0);
    });
});
