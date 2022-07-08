require('dotenv').config();
const HeirloomMarketplace = artifacts.require("HeirloomMarketplace");
const HeirloomLicenseNFT = artifacts.require("HeirloomLicenseNFT");
const HeirloomToken =  artifacts.require("HeirloomToken");
const HeirloomEscrow = artifacts.require("HeirloomEscrow");
const { roles } = require('../test/roles');


module.exports = async (deployer, networks, accounts) => {
    const uri = "http://localhost:3001/license/metadata/"; 
    const admin = accounts[0];
    const treasury = networks === 'development' || networks === 'develop' ? accounts[1] : process.env.TREASURY;
    const LISTING_FEE = web3.utils.toWei("0.1", "ether");
    
    
    // first token
    const supply = new web3.utils.BN(web3.utils.toWei('10000000', 'ether'));
    await deployer.deploy(HeirloomToken, treasury, supply, {from: admin}); 
    const token = await HeirloomToken.deployed(); 
    
    // then escrow 
    await deployer.deploy(HeirloomEscrow, token.address, admin, { from: admin }); 
    const escrow = await HeirloomEscrow.deployed();
    
    // then marketplace
    await deployer.deploy(HeirloomMarketplace, admin, LISTING_FEE, token.address, treasury, escrow.address, {from: admin}); 
    const marketplace = await HeirloomMarketplace.deployed();

    // set market to have escrow role
    await escrow.revokeRole(roles.Escrow, admin, {from: admin});
    await escrow.grantRole(roles.Escrow, marketplace.address, {from: admin});
    
    // then erc1155
    await deployer.deploy(HeirloomLicenseNFT, uri, marketplace.address, admin, {from: admin}); 

    console.log(`contracts successfully deployed to: ${networks}`);
}