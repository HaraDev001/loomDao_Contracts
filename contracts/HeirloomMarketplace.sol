// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IHeirloomMarketplace.sol";
import "./erc1155/HeirloomLicenseNFT.sol";
import "./utils/Constants.sol";
import "./utils/HeirloomEscrow.sol";
import "./libs/LibPart.sol";

contract HeirloomMarketplace is Context, IHeirloomMarketplace, ReentrancyGuard, AccessControl, Constants {
    using Address for address;
    using SafeERC20 for IERC20;

    uint256 public LISTING_FEE;
    IERC20 private _hiloToken;
    HeirloomEscrow private _escrow;
    address private _treasury;

    using Counters for Counters.Counter;
    Counters.Counter private _saleIds;
    Counters.Counter private _closedSales;
    Counters.Counter private _licenseItemIds;
    Counters.Counter private _closedLicenseItems;
    
    mapping(uint256 => SaleItem) private _idToSaleItem;
    mapping(uint256 => LicenseItem) private _idToLicenseItem;

    modifier onlyActive(uint256 saleId){
        require(_idToSaleItem[saleId].active == true, "Heirloom Marketplace: inactive sale");
        _;
    }
    modifier onlyLicenseProvider(uint256 saleId){
        require(_idToSaleItem[saleId].licenseProvider == _msgSender(), "Heirloom Marketplace: caller is not license provider"); 
        _;
    }

    constructor(
        address admin, 
        uint256 listingFee, 
        address hilo, 
        address treasury, 
        address escrow
        ) {
        _grantRole(ADMIN_ROLE, admin);
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);
        LISTING_FEE = listingFee;
        _hiloToken = IERC20(hilo); 
        _escrow = HeirloomEscrow(escrow);
        _treasury = treasury;
    }

    function setListingFee(uint256 newListingFee) external onlyRole(ADMIN_ROLE) returns (uint256){
        LISTING_FEE = newListingFee;
        return LISTING_FEE;
    }

    function createSale(
        address nftContract,
        uint256 maxSupply,
        address refferer,
        uint256 start,
        uint256 duration,
        uint256 price,
        uint96 rbp
    ) public override returns (uint256) {
        _saleIds.increment();
        uint256 saleId = _saleIds.current();
        HeirloomLicenseNFT nftInstance = HeirloomLicenseNFT(nftContract);
        uint256 tokenId = nftInstance.createLicense(_msgSender(), maxSupply, rbp);
        SaleItem memory saleItem = SaleItem({
            saleId: saleId,
            licenseProvider: _msgSender(),
            tokenId: tokenId,
            nftContract: nftContract,
            refferer: refferer,
            soldLicenses: 0,
            maxSupply: maxSupply,
            start: start,
            duration: duration,
            price: price,
            active: true
        });
        _idToSaleItem[saleId] = saleItem;
        emit SaleCreated(_msgSender(), saleId);
        return saleId;
    }

    function listLicense(
        address nftContract, 
        uint256 tokenId, 
        uint256 price, 
        uint256 amount
        ) public returns (uint256) {
        require(_hiloToken.allowance(_msgSender(), address(this)) == LISTING_FEE, "Heirloom Marketplace: HILO payment not approved"); 
        require(HeirloomLicenseNFT(nftContract).balanceOf(_msgSender(), tokenId) >= amount, "Heirloom Marketplace: insufficient 'nft' balance");
        _licenseItemIds.increment();
        uint256 licenseId = _licenseItemIds.current();
        LicenseItem memory licenseItem = LicenseItem({
            licenseId: licenseId,
            tokenId: tokenId,
            nftContract: nftContract,
            seller: _msgSender(),
            price: price,
            amount: amount,
            sold: false
        });
        _idToLicenseItem[licenseId] = licenseItem;
        _hiloToken.safeTransferFrom(_msgSender(), _treasury, LISTING_FEE);
        emit LicenseListed(licenseId, tokenId, _msgSender(), price, amount);
        return licenseId;
    }

    function forceCloseSale(uint256 saleId) public onlyActive(saleId) onlyLicenseProvider(saleId) {
        _idToSaleItem[saleId].active = false;
        emit SaleClosed(saleId);
    }

    function participate(uint256 saleId, uint256 amount) onlyActive(saleId) public {
        require(_hiloToken.allowance(_msgSender(), 
        address(this)) >= amount * _idToSaleItem[saleId].price, 
        "Heirloom Marketplace: HILO payment not approved");
        require(_idToSaleItem[saleId].soldLicenses + amount <= _idToSaleItem[saleId].maxSupply, "Heirloom Marketplace: amount cannot supercede max supply");
        _idToSaleItem[saleId].soldLicenses += amount; 
        _escrow.depositERC20(_idToSaleItem[saleId].licenseProvider, amount * _idToSaleItem[saleId].price);
        _hiloToken.safeTransferFrom(_msgSender(), address(_escrow), amount * _idToSaleItem[saleId].price);
        IERC1155 nftInstance = IERC1155(_idToSaleItem[saleId].nftContract);
        nftInstance.safeTransferFrom(_idToSaleItem[saleId].licenseProvider, _msgSender(), _idToSaleItem[saleId].tokenId, amount, "");
        emit BoughtFromSale(saleId, _idToSaleItem[saleId].tokenId, _msgSender(), amount);
        if(block.timestamp >= _idToSaleItem[saleId].start + _idToSaleItem[saleId].duration){
            _idToSaleItem[saleId].active = false;
            _closedSales.increment(); 
            emit SaleClosed(saleId);
        }
    }

    function fetchListedLicenses() external view returns (LicenseItem [] memory){
        uint256 toFetch = _licenseItemIds.current() - _closedLicenseItems.current();
        LicenseItem [] memory listedItems = new LicenseItem[](toFetch);
        uint count = 0;
        for(uint i = 0; i < _licenseItemIds.current(); i++){
            if(_idToLicenseItem[i+1].sold == false){
                listedItems[count] = _idToLicenseItem[i+1];
                count++; 
            }
        }
        return listedItems;
    }

    function fetchActiveSales() external view returns (SaleItem [] memory) {
        uint256 toFetch = _saleIds.current() - _closedSales.current();
        SaleItem [] memory activeSales = new SaleItem[](toFetch);
        uint count = 0; 
        for(uint i = 0; i < _saleIds.current(); i++){
            if(_idToSaleItem[i+1].active == true){
                activeSales[count] = _idToSaleItem[i+1];
                count++; 
            }
        }
        return activeSales;
    }

    function fetchSale(uint256 saleId) public view returns (SaleItem memory){
        return _idToSaleItem[saleId];
    }

    function purchaseLicense(uint256 licenseId, uint256 amount) public {
        require(_idToLicenseItem[licenseId].sold == false, "Heirloom Marketplace: item is unlisted");
        require(amount <= _idToLicenseItem[licenseId].amount, "Heirloom Marketplace: wrong purchase amount");
        require(_hiloToken.allowance(_msgSender(), address(this)) >= _idToLicenseItem[licenseId].price * amount, "Heirloom Marketplace: HILO payment not approved"); 
        LicenseItem memory item = _idToLicenseItem[licenseId];
        LibPart.Part[] memory royalties = HeirloomLicenseNFT(item.nftContract).getHeirloomV1Royalties(item.tokenId);
        uint256 royaltyFee = ((amount * item.price) / 10000) * royalties[0].value;
        _hiloToken.safeTransferFrom(_msgSender(), item.seller, (amount * item.price) - royaltyFee);
        _hiloToken.safeTransferFrom(_msgSender(), address(_escrow), royaltyFee);
        HeirloomLicenseNFT(item.nftContract).safeTransferFrom(item.seller, _msgSender(), item.tokenId, amount, "");
        _escrow.depositERC20(royalties[0].account, royaltyFee);
        emit LicenseSold(licenseId, item.tokenId, item.seller, _msgSender(), amount, item.price);
        if(item.amount - amount == 0){
            _closedLicenseItems.increment();
            _idToLicenseItem[licenseId].sold = true;
            emit LicenseItemClosed(licenseId, item.seller, true);
        }
    }
}  