// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import '@openzeppelin/contracts/access/AccessControl.sol';
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import './Constants.sol';

/**
* @title Heirloom Marketplace Escrow 
* @dev Contract for the heirloom dao marketplace that handles pull payments to license providers.
*/

contract HeirloomEscrow is Context, AccessControl, Constants {
    using SafeERC20 for IERC20;
    using Address for address payable;
    
    event Deposited(address indexed payee, uint256 indexed weiAmount); 
    event Withdrawn(address indexed payee, uint256 indexed weiAmount); 
    mapping(address => uint256) private _erc20Deposits;
    mapping(address => uint256) private _nativeDeposits;
    
    IERC20 private _hiloToken;
    
    constructor(address heirloomToken, address operator){
        _grantRole(ADMIN_ROLE, _msgSender());
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);
        _grantRole(ESCROW_ROLE, operator);
        _setRoleAdmin(ESCROW_ROLE, ADMIN_ROLE);
        _hiloToken = IERC20(heirloomToken);
    }
    
    function ERC20DepositsOf(address payee) public view returns (uint256) {
        return _erc20Deposits[payee];
    } 

    function nativeDepositsOf(address payee) public view returns (uint256) {
        return _nativeDeposits[payee];
    } 

    function withdrawERC20() public {
        require(_erc20Deposits[_msgSender()] > 0, "Heirloom Escrow: insufficient balance");
        uint256 amount = _erc20Deposits[_msgSender()];
        _erc20Deposits[_msgSender()] = 0;
        _hiloToken.safeTransfer(_msgSender(), amount);
        emit Withdrawn(_msgSender(), amount); 
    }

    function withdrawNative(address payable payee) public {
        require(_erc20Deposits[payee] > 0, "Heirloom Escrow: insufficient balance");
        uint256 amount = _erc20Deposits[payee];
        _nativeDeposits[payee] = 0;
        payee.sendValue(amount);
        emit Withdrawn(payee, amount);
    }

    function depositERC20(address payee, uint256 amount) external onlyRole(ESCROW_ROLE){
        _erc20Deposits[payee] += amount;
        emit Deposited(payee, amount); 
    }

    function depositNative(address payee) external payable onlyRole(ESCROW_ROLE){
        uint256 amount = msg.value;
        _nativeDeposits[payee] += amount;
        emit Deposited(payee, amount); 
    }
}