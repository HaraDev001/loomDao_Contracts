// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

abstract contract Constants {
    bytes32 internal constant SNAPSHOT_ROLE = keccak256("HEIRLOOMDAO_SNAPSHOT_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("HEIRLOOMDAO_PAUSER_ROLE");
    bytes32 internal constant MINTER_ROLE = keccak256("HEIRLOOMDAO_MINTER_ROLE");
    bytes32 internal constant ADMIN_ROLE = keccak256("HEIRLOOMDAO_ADMIN_ROLE");
    bytes32 internal constant ESCROW_ROLE = keccak256("HEIRLOOMDAO_ESCROW_ROLE");
}