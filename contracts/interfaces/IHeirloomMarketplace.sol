// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

interface IHeirloomMarketplace {
  /**
    @dev interface for the HeirloomDao market place
   */
  
  /**
    @notice represents a sale item object
    @dev The first time the sale Item is redeemed minted becomes true
    @dev The total balance of the token can never exceed the total suppy of the token 
   */
  struct SaleItem {
    uint256 saleId;
    address licenseProvider;
    uint256 tokenId;
    address nftContract;
    address refferer;
    uint256 soldLicenses;
    uint256 maxSupply;
    uint256 start;
    uint256 duration;
    uint256 price;
    bool active;
  }

  /**
    @notice represents a LicenseItem
    @dev used for lazyminting so that creators wont have to the minting price of the nft
  **/
  struct LicenseItem {
    uint256 licenseId;
    uint256 tokenId;
    address nftContract;
    address seller;
    uint256 price;
    uint256 amount;
    bool sold;
  }

  event SaleCreated(address indexed provider, uint256 indexed saleId);
  event SaleClosed(uint256 indexed SaleId);
  event BoughtFromSale(uint256 indexed saleId, uint256 indexed tokenId, address buyer, uint256 amount);
  event LicenseListed(
    uint256 indexed licenseId,
    uint256 indexed tokenId,
    address seller,
    uint256 price,
    uint256 amount
  );
  event LicenseSold(
    uint256 indexed itemId,
    uint256 indexed tokenId,
    address seller,
    address buyer,
    uint256 amount,
    uint256 price
  );
  event LicenseItemClosed(uint256 indexed licenseId, address seller, bool indexed closed);

  /**
    @notice sets the listing fee
  */
  function setListingFee(uint256 listingFee) external returns(uint256);

  /** 
    @notice creates a saleItem
    @param nftContract nft contract for minting license nft
    @param maxSupply token cap of license
    @param refferer address of the refferer
    @param start startDate of the sale
    @param duration duration of sale
    @param price of the item in the sale
    @param rbp royalty basis points, percentage of royalty to be collected by license creator
  */
  function createSale(
    address nftContract,
    uint256 maxSupply,
    address refferer,
    uint256 start,
    uint256 duration,
    uint256 price,
    uint96 rbp
  ) external returns (uint256);

  /**
    @notice gives the heirloom operator permission to sell an token amount on behalf of the user
    @param nftContract nft contract address of the license nft
    @param tokenId the tokenId of the Saas License nft
    @param amount the amount of nfts to be put up for sale
    @param price price to sell license for
  **/
  function listLicense(address nftContract, uint256 tokenId, uint256 price, uint256 amount) external returns (uint256);

  /**
    @notice allows creator of a sale to foricibly end a sale
    @param saleId id of the sale
  **/
  function forceCloseSale(uint256 saleId) external;


  /**
    @notice allows a user to participate in a license sale
    @dev erc20 transfer needs to be pre-approved
    @param saleId id of the ongoing sale
    @param amount number of licenses to buy
   */
  function participate(uint256 saleId, uint256 amount) external;

  /**
    @notice transfers license item to send on tokenTransfer
    @param licenseId id of the license to sell
    @param amount amount to purchase 
   */
  function purchaseLicense(uint256 licenseId, uint256 amount) external;
  
  /**
    @notice fetches all tokenIds listed for sale
  **/
  function fetchListedLicenses() external returns(LicenseItem [] memory);
  
  /**
    @notice fetches all of the active nft license sales on the platform
  **/
  function fetchActiveSales() external returns(SaleItem [] memory);
}
