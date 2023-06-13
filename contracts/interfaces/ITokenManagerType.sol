// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface ITokenManagerType {
    enum TokenManagerType {
        LOCK_UNLOCK,
        MINT_BURN,
        LIQUIDITY_POOL
    }
}
