const { ethers } = require('hardhat');
const { Contract } = ethers;
const { defaultAbiCoder } = ethers.utils;
const InterchainTokenServiceProxy = require('../artifacts/contracts/proxies/InterchainTokenServiceProxy.sol/InterchainTokenServiceProxy.json');
const Create3Deployer = require('@axelar-network/axelar-gmp-sdk-solidity/artifacts/contracts/deploy/Create3Deployer.sol/Create3Deployer.json');
const { create3DeployContract, getCreate3Address } = require('@axelar-network/axelar-gmp-sdk-solidity');

async function deployContract(wallet, contractName, args = []) {
    const factory = await ethers.getContractFactory(contractName, wallet);
    const contract = await factory.deploy(...args).then((d) => d.deployed());

    return contract;
}

async function deployRemoteAddressValidator(wallet, chainName, interchainTokenServiceAddress = '', evmChains = []) {
    const remoteAddressValidatorImpl = await deployContract(wallet, 'RemoteAddressValidator', [chainName]);
    const params = defaultAbiCoder.encode(['string[]', 'string[]'], [evmChains, evmChains.map(() => interchainTokenServiceAddress)]);

    const remoteAddressValidatorProxy = await deployContract(wallet, 'RemoteAddressValidatorProxy', [
        remoteAddressValidatorImpl.address,
        wallet.address,
        params,
    ]);
    const remoteAddressValidator = new Contract(remoteAddressValidatorProxy.address, remoteAddressValidatorImpl.interface, wallet);
    return remoteAddressValidator;
}

async function deployMockGateway(wallet) {
    const gateway = await deployContract(wallet, 'MockAxelarGateway');
    return gateway;
}

async function deployGasService(wallet) {
    const gasService = await deployContract(wallet, 'AxelarGasService', [wallet.address]);
    return gasService;
}

async function deployInterchainTokenService(
    wallet,
    create3DeployerAddress,
    tokenManagerDeployerAddress,
    standardizedTokenDeployerAddress,
    gatewayAddress,
    gasServiceAddress,
    remoteAddressValidatorAddress,
    tokenManagerImplementations,
    deploymentKey,
    operatorAddress = wallet.address,
) {
    const implementation = await deployContract(wallet, 'InterchainTokenService', [
        tokenManagerDeployerAddress,
        standardizedTokenDeployerAddress,
        gatewayAddress,
        gasServiceAddress,
        remoteAddressValidatorAddress,
        tokenManagerImplementations,
    ]);
    const proxy = await create3DeployContract(create3DeployerAddress, wallet, InterchainTokenServiceProxy, deploymentKey, [
        implementation.address,
        wallet.address,
        operatorAddress,
    ]);
    const service = new Contract(proxy.address, implementation.interface, wallet);
    return service;
}

async function deployTokenManagerImplementations(wallet, interchainTokenServiceAddress) {
    const implementations = [];

    for (const type of ['MintBurn', 'MintBurnFrom', 'LockUnlock', 'LockUnlockFee']) {
        const impl = await deployContract(wallet, `TokenManager${type}`, [interchainTokenServiceAddress]);
        implementations.push(impl);
    }

    return implementations;
}

async function deployAll(wallet, chainName, evmChains = [], deploymentKey = 'interchainTokenService') {
    const create3Deployer = await new ethers.ContractFactory(Create3Deployer.abi, Create3Deployer.bytecode, wallet)
        .deploy()
        .then((d) => d.deployed());
    const gateway = await deployMockGateway(wallet);
    const gasService = await deployGasService(wallet);
    const tokenManagerDeployer = await deployContract(wallet, 'TokenManagerDeployer', []);
    const standardizedToken = await deployContract(wallet, 'StandardizedToken');
    const standardizedTokenDeployer = await deployContract(wallet, 'StandardizedTokenDeployer', [standardizedToken.address]);
    const interchainTokenServiceAddress = await getCreate3Address(create3Deployer.address, wallet, deploymentKey);
    const remoteAddressValidator = await deployRemoteAddressValidator(wallet, chainName, interchainTokenServiceAddress, evmChains);
    const tokenManagerImplementations = await deployTokenManagerImplementations(wallet, interchainTokenServiceAddress);

    const service = await deployInterchainTokenService(
        wallet,
        create3Deployer.address,
        tokenManagerDeployer.address,
        standardizedTokenDeployer.address,
        gateway.address,
        gasService.address,
        remoteAddressValidator.address,
        tokenManagerImplementations.map((impl) => impl.address),
        deploymentKey,
    );

    return [service, gateway, gasService];
}

module.exports = {
    deployContract,
    deployRemoteAddressValidator,
    deployMockGateway,
    deployTokenManagerImplementations,
    deployGasService,
    deployInterchainTokenService,
    deployAll,
};
