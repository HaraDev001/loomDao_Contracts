const chai = require('chai');
const HeirloomMarketplace = artifacts.require("HeirloomMarketplace.sol");
const HeirloomToken = artifacts.require("HeirloomToken.sol");
const HeirloomLicenseNFT = artifacts.require("HeirloomLicenseNFT.sol");
const HeirloomEscrow = artifacts.require("HeirloomEscrow.sol");

const should = chai.should();
const expect = chai.expect;
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const { roles } = require('./roles.js');

contract('HeirloomMarketplace', (accounts) => {
    const uri = "http://localhost:3001/license/metadata/"
    const admin = accounts[0];
    const treasury = accounts[1];
    const supply = new web3.utils.BN(web3.utils.toWei('10000000', 'ether'));


    const LISTING_FEE = web3.utils.toWei("0.1", "ether");
    var marketplace, nft, token, escrow;

    beforeEach(async () => {
        token = await HeirloomToken.new(treasury, supply, { from: admin });
        escrow = await HeirloomEscrow.new(token.address, admin, { from: admin })
        marketplace = await HeirloomMarketplace.new(admin, LISTING_FEE, token.address, treasury, escrow.address, { from: admin });
        await escrow.revokeRole(roles.Escrow, admin);
        await escrow.grantRole(roles.Escrow, marketplace.address);
        nft =  await HeirloomLicenseNFT.new(uri, marketplace.address, admin, { from: admin });
    });
    context('Initialization ...', () => {
        it('sets the correct lsiting fee', async () => {
            let listingFee = await marketplace.LISTING_FEE.call();
            expect(listingFee.toString()).to.equal(LISTING_FEE);
        });
        it('sets the correct roles', async () => {
            const msgSenderIsAdmin = await marketplace.hasRole(roles.Admin, admin);
            expect(msgSenderIsAdmin).to.be.true;
        });
    })

    context('Security tests ...', () => {
        const [, , bob] = accounts; 
        it('rejects operations from unassigned roles', async () => {
            await expect(marketplace.setListingFee(LISTING_FEE, { from: bob })).to.be.rejected;
        }); 
        it('allows operations only from assigned roles', async () => {
            const newFee = web3.utils.toWei("1", "ether");
            await marketplace.setListingFee(newFee, { from: admin });
            let listingFee = await marketplace.LISTING_FEE.call();
            expect(listingFee.toString()).to.equal(newFee);
        });
    })

    context('Core functionality ...', () => {
        const [, , bob, alice, ed, fred] = accounts;
        it('allows for resetting of listing fee', async () => {
            const newFee = web3.utils.toWei("2", "ether");
            await marketplace.setListingFee(newFee, { from: admin });
            let listingFee = await marketplace.LISTING_FEE.call();
            expect(listingFee.toString()).to.equal(newFee);
        });
        it('creates sale', async () => {
            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                10, 
                bob,
                new web3.utils.BN(String(new Date().getTime() / 1000)), // start date 
                new web3.utils.BN(String((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000)), // end dateTime 
                new web3.utils.BN(web3.utils.toWei('0.01', 'ether')),
                900, 
                { from: alice }
            );
            expect(provider).to.equal(alice);
            expect(saleId.toNumber()).to.equal(1);
        });
        it('allows users to participate in sale', async () => {
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 5;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );
            await token.approve(marketplace.address, toPay, { from: treasury }); // approve tokenspend
            const { logs: [{ args: { tokenId } }] } = await marketplace.participate(saleId, toBuy, { from: treasury }); // participate 
            const nftBalance = await nft.balanceOf(treasury, tokenId); 
            expect(nftBalance.toNumber()).to.equal(toBuy); // user owns the correct token balance
        });
        it('inactivates sale after duration and after force close', async () => {
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 3;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const durationOne = String((new Date().getTime() / 1000) + 15) - (new Date().getTime() / 1000);
            const durationTwo = String((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000);
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { saleId: idOne } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(durationOne), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
            );
            
            await new Promise(resolve => {
                setTimeout(async () => {
                    await token.transfer(alice, new web3.utils.BN(web3.utils.toWei("2", "ether")), { from: treasury });
                    await token.approve(marketplace.address, toPay, { from: alice }); // approve tokenspend
                    await token.transfer(bob, new web3.utils.BN(web3.utils.toWei("2", "ether")), { from: treasury });
                    await token.approve(marketplace.address, toPay, { from: bob }); // approve tokenspend
                    await marketplace.participate(idOne, toBuy, { from: alice });
                    await expect(marketplace.participate(idOne, toBuy, { from: bob })).to.be.rejected;
                    resolve("resolved"); 
                }, (durationOne * 1000) + 10)
            });

            const { logs: [ { args: { saleId: idTwo } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                alice,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(durationTwo), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
                );
            await marketplace.forceCloseSale(idTwo, { from: treasury } )
                
            const saleOne = await marketplace.fetchSale(idOne);
            const saleTwo = await marketplace.fetchSale(idTwo);
            expect(saleOne.active).to.equal(false);
            expect(saleTwo.active).to.equal(false);
        })
        it('disallows users to participate in inactive sales', async () =>{
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 3;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String((new Date().getTime() / 1000) + 15) - (new Date().getTime() / 1000);
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy * 2)));
            
            const { logs: [ { args: { saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );

            await token.approve(marketplace.address, toPay, { from: treasury }); // approve tokenspend
            await new Promise(resolve => {
                setTimeout(async () => {
                    await token.transfer(alice, new web3.utils.BN(web3.utils.toWei("1", "ether")), { from: treasury });
                    resolve(await marketplace.participate(saleId, toBuy, { from: treasury })); // participate 
                }, (duration * 1000) + 5)
            })
            await expect(marketplace.participate(saleId, toBuy, { from: treasury })).to.be.rejected; // rejected since sale is inactive
        });
        it('disallows users to buy more than maximum supply', async () =>{
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 11;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 15) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );
            await token.approve(marketplace.address, toPay, { from: treasury }); // approve tokenspend
            await expect(marketplace.participate(saleId, toBuy, { from: treasury })).to.be.rejected 
        })
        it('allows only provider to force close of sale', async () => {
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 3;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 15) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
            );
            await token.approve(marketplace.address, toPay, { from: treasury }); // approve tokenspend
            await expect(marketplace.forceCloseSale(saleId, { from: alice } )).to.be.rejected; // forces close of sale
        })
        it('lists license NFT', async () =>{
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 5;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
            );

            await token.transfer(alice, new web3.utils.BN(web3.utils.toWei("1", "ether")), { from: treasury }); 
            await token.approve(marketplace.address, toPay, { from: alice }); // approve tokenspend
            const { logs: [{ args: { tokenId } }] } = await marketplace.participate(saleId, toBuy, { from: alice }); // participate 
            
            // list license
            await token.approve(marketplace.address, LISTING_FEE, { from: alice }); // approve tokenspend
            const { logs: [ { args: { licenseId, seller, price: licensePrice , amount } } ]} = await marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: alice })
            expect(licenseId.toNumber()).to.equal(1);
            expect(seller).to.equal(alice);
            expect(licensePrice.toString()).to.equal(price.toString());
            expect(amount.toNumber()).to.equal(toBuy);
        });
        it('dissalows nft listing without listing fee payment', async () =>{
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 5;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
            );

            await token.transfer(alice, new web3.utils.BN(web3.utils.toWei("1", "ether")), { from: treasury }); 
            await token.approve(marketplace.address, toPay, { from: alice }); // approve tokenspend
            const { logs: [{ args: { tokenId } }] } = await marketplace.participate(saleId, toBuy, { from: alice }); // participate 
            
            // list license
            await expect(marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: alice })).to.be.rejected;
        });
        it('dissalows nft listing if buyer does not own or has insufficient balance', async () =>{
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 5;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
            );

            await token.transfer(alice, new web3.utils.BN(web3.utils.toWei("1", "ether")), { from: treasury }); 
            await token.approve(marketplace.address, toPay, { from: alice }); // approve tokenspend
            const { logs: [{ args: { tokenId } }] } = await marketplace.participate(saleId, toBuy, { from: alice }); // participate 
            
            // list license
            await token.approve(marketplace.address, LISTING_FEE, { from: alice }); // approve tokenspend
            await expect(marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                6
            , { from: alice })).to.be.rejected; // insufficient balance
            await expect(marketplace.listLicense(
                nft.address,
                2,
                price,
                5
            , { from: alice })).to.be.rejected; // user does not own nft a
        });
        it('allows users to purchase licenses', async () =>{
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 5;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));
            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );
            // participate in sale
            await token.approve(marketplace.address, toPay, { from: treasury }); // approve tokenspend
            const { logs: [{ args: { tokenId } }] } = await marketplace.participate(saleId, toBuy, { from: treasury }); // participate 
            
            // list license
            await token.approve(marketplace.address, LISTING_FEE, { from: treasury }); // approve token spend for listing fee
            await nft.setApprovalForAll(marketplace.address, true, {from: treasury}) // in application check first if is approved
            const { logs: [ { args: { licenseId, seller, price: licensePrice , amount } } ]} = await marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: treasury }); // list the license 

            // buy from listed license
            await token.transfer(bob, new web3.utils.BN(web3.utils.toWei('1', 'ether')), { from: treasury });
            await token.approve(marketplace.address, toPay, { from: bob});
            await marketplace.purchaseLicense(licenseId, toBuy, { from: bob });
            
            // check balance
            const bobBalance = await nft.balanceOf(bob, tokenId);
            expect(bobBalance.toNumber()).to.equal(toBuy);
        });
        it('fetches the correct number of listed licenses', async () => {
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 2;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String(Math.floor((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000));
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));

            // tranfer tokens to buyers
            await token.transfer(alice, new web3.utils.BN(web3.utils.toWei('1', 'ether')), { from: treasury });
            await token.transfer(bob, new web3.utils.BN(web3.utils.toWei('1', 'ether')), { from: treasury });
            await token.transfer(ed, new web3.utils.BN(web3.utils.toWei('1', 'ether')), { from: treasury });
            await token.transfer(fred, new web3.utils.BN(web3.utils.toWei('1', 'ether')), { from: treasury });

            const { logs: [ { args: { provider, saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: treasury }
            );

            // participate in sale
            await token.approve(marketplace.address, toPay, { from: alice }); // approve tokenspend
            await token.approve(marketplace.address, toPay, { from: bob }); // approve tokenspend
            await token.approve(marketplace.address, toPay, { from: ed }); // approve tokenspend
            await token.approve(marketplace.address, toPay, { from: fred }); // approve tokenspend
            
            const { logs: [ { args: { tokenId } } ] } = await marketplace.participate(saleId, toBuy, { from: alice }); // participate 
            await marketplace.participate(saleId, toBuy, { from: bob }); // participate 
            await marketplace.participate(saleId, toBuy, { from: ed }); // participate 
            await marketplace.participate(saleId, toBuy, { from: fred }); // participate 
            
            // list license
            await token.approve(marketplace.address, LISTING_FEE, { from: alice }); // approve token spend for listing fee
            await token.approve(marketplace.address, LISTING_FEE, { from: bob }); // approve token spend for listing fee
            await token.approve(marketplace.address, LISTING_FEE, { from: ed }); // approve token spend for listing fee
            await token.approve(marketplace.address, LISTING_FEE, { from: fred }); // approve token spend for listing fee
            
            await nft.setApprovalForAll(marketplace.address, true, {from: alice}) // in application check first if is approved
            await nft.setApprovalForAll(marketplace.address, true, {from: bob}) // in application check first if is approved
            await nft.setApprovalForAll(marketplace.address, true, {from: ed}) // in application check first if is approved
            await nft.setApprovalForAll(marketplace.address, true, {from: fred}) // in application check first if is approved

            const { logs: [ { args: { licenseId: licenseIdOne } } ] } = await marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: alice }); // list the license 
            const { logs: [ { args: { licenseId: licenseIdTwo } } ] } = await marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: bob }); // list the license 
            await marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: ed }); // list the license 
            await marketplace.listLicense(
                nft.address,
                tokenId,
                price,
                toBuy
            , { from: fred }); // list the license 
            
            const toPayEd = new web3.utils.BN(web3.utils.toWei(String(Number(price) * 3))); 

            await token.approve(marketplace.address, toPay, { from: fred});
            await token.approve(marketplace.address, toPayEd, { from: ed });

            await marketplace.purchaseLicense(licenseIdOne, toBuy, { from: fred });
            await expect(marketplace.purchaseLicense(licenseIdTwo, 3, { from: ed })).to.be.rejected; // rejects if amount is higher then listed

            const listedLicenses = await marketplace.fetchListedLicenses();
            expect(listedLicenses.length).to.equal(3);

         });
        it('fetches the correct number of active sales', async () =>{
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 2;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000);
            const durationSlow = String((new Date().getTime() / 1000) + 15) - (new Date().getTime() / 1000);
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));

            const { logs: [ { args: { provider: providerOne, saleId: saleIdOne } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(durationSlow), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );

            await new Promise(resolve => {
                setTimeout(async () => {
                    await token.transfer(ed, new web3.utils.BN(web3.utils.toWei("2", "ether")), { from: treasury });
                    await token.approve(marketplace.address, toPay, { from: ed }); // approve tokenspend
                    await marketplace.participate(saleIdOne, toBuy, { from: ed }); // participate to deactivate the sale
                    resolve("resolved"); 
                }, (durationSlow * 1000) + 10); 
            }); 

            const { logs: [ { args: { provider: providerTwo, saleId: saleIdTwo } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: bob }
            );
            const { logs: [ { args: { provider: providerThree, saleId: saleIdthree } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: ed }
            );
            const { logs: [ { args: { provider: providerFour, saleId: saleIdFour } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: fred }
            );

            const activeSales = await marketplace.fetchActiveSales();
            expect(activeSales.length).to.equal(3);
        });
    })
    
    context('Royalties', ()=> {
        const [, , bob, alice, ed, fred] = accounts;
        it('assigns the correct royalties to users', async () => {
            // create sale
            const price = web3.utils.toWei('0.01', 'ether');
            const maxSupply = 10;
            const toBuy = 2;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000);
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));

            const { logs: [ { args: { saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );
            const sale = await marketplace.fetchSale(saleId, { from: ed });  
            // check if royalties is set to correct owner and correct rbp
            const [royalty] = await nft.getHeirloomV1Royalties(sale.tokenId, { from: ed });
            expect(royalty.account).to.equal(alice);
            expect(Number(royalty.value)).to.equal(900);
        })
        it('allows escrow contract to store payee tokens correctly', async () => {
            // create sale
            const price = web3.utils.toWei('0.1', 'ether');
            const maxSupply = 10;
            const toBuy = 2;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000);
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Number(price) * toBuy)));

            const { logs: [ { args: { saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );

            // participate
            await token.transfer(bob, new web3.utils.BN(web3.utils.toWei('2', 'ether')), { from: treasury });
            await token.approve(marketplace.address, toPay, {from: bob }); 
            await marketplace.participate(saleId, toBuy, { from: bob }); 
            
            // list license
            await token.approve(marketplace.address, LISTING_FEE, { from: bob });
            const sale = await marketplace.fetchSale(saleId);
            await nft.setApprovalForAll(marketplace.address, true, { from: bob });
            const { logs: [ { args: { licenseId } } ] } = await marketplace.listLicense(nft.address, new web3.utils.BN(sale.tokenId), price, toBuy, { from: bob });
            
            // buy license
            await token.transfer(ed, new web3.utils.BN(web3.utils.toWei('2', 'ether')), { from: treasury });
            await token.approve(marketplace.address, toPay, { from: ed });
            await marketplace.purchaseLicense(licenseId, toBuy, { from: ed }); 

            // check escrow
            const [royalty] = await nft.getHeirloomV1Royalties(sale.tokenId, { from: ed });
            const participated = toBuy * 0.1; 
            const purchased = ((toBuy * 0.1) / 10000) * royalty.value; 
            const feeToReceive = await escrow.ERC20DepositsOf(alice, { from: alice });
            expect(web3.utils.fromWei(feeToReceive.toString())).to.equal(String((participated + purchased).toFixed(3)));

        });
        it('allows provider to withdraw from escrow', async () => {
            // create sale
            const price = web3.utils.toWei('0.1', 'ether');
            const maxSupply = 10;
            const toBuy = 2;
            const start = String(Math.floor(new Date().getTime() / 1000));
            const duration = String((new Date().getTime() / 1000) + 3600 * 24) - (new Date().getTime() / 1000);
            const toPay = new web3.utils.BN(web3.utils.toWei(String(Math.floor(Number(price) * toBuy))));

            const { logs: [ { args: { saleId } } ] } = await marketplace.createSale(
                nft.address,
                maxSupply, 
                bob,
                new web3.utils.BN(start), // start date 
                new web3.utils.BN(duration), // end dateTime 
                new web3.utils.BN(price),
                900, 
                { from: alice }
            );

            // participate
            await token.transfer(bob, new web3.utils.BN(web3.utils.toWei('2', 'ether')), { from: treasury });
            await token.approve(marketplace.address, toPay, {from: bob }); 
            await marketplace.participate(saleId, toBuy, { from: bob }); 
            
            // list license
            await token.approve(marketplace.address, LISTING_FEE, { from: bob });
            const sale = await marketplace.fetchSale(saleId);
            await nft.setApprovalForAll(marketplace.address, true, { from: bob });
            const { logs: [ { args: { licenseId } } ] } = await marketplace.listLicense(nft.address, new web3.utils.BN(sale.tokenId), price, toBuy, { from: bob });
            
            // buy license
            await token.transfer(ed, new web3.utils.BN(web3.utils.toWei('2', 'ether')), { from: treasury });
            await token.approve(marketplace.address, toPay, { from: ed });
            await marketplace.purchaseLicense(licenseId, toBuy, { from: ed }); 

            // check escrow
            const [royalty] = await nft.getHeirloomV1Royalties(sale.tokenId, { from: ed });
            const participated = toBuy * 0.1; 
            const purchased = ((toBuy * 0.1) / 10000) * royalty.value; 
            await escrow.withdrawERC20({from: alice });
            const providerBalance = await token.balanceOf(alice, {from: alice});
            expect(web3.utils.fromWei(providerBalance.toString())).to.equal(String((participated + purchased).toFixed(3)));
        });
    });
});
