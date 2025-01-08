// yarn tsx src/invalid_w3gw.ts

import { getNetworkChainInfo, getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { getInjectiveAddress, getSubaccountId, MsgBroadcasterWithPk, MsgCreateSpotMarketOrder, OrderTypeMap } from "@injectivelabs/sdk-ts";
import { MsgBroadcaster, Wallet, WalletStrategy } from "@injectivelabs/wallet-ts";
import { config } from "dotenv";


config();

if (!process.env.PRIVATE_KEY || !process.env.ETH_ADDRESS) {
  console.error("PRIVATE_KEY and ETH_ADDRESS must be set");
}

const privateKey = process.env.PRIVATE_KEY!;
const ethAddress = process.env.ETH_ADDRESS!;
const address = getInjectiveAddress(ethAddress);

const network = Network.Mainnet;
const networkInfo = getNetworkChainInfo(network);
const endpoints = getNetworkEndpoints(network);



const msg = MsgCreateSpotMarketOrder.fromJSON({
    marketId:
      "0xa508cb32923323679f29a032c70342c147c17d0145625922b0ef22e955c844c0",
    feeRecipient: address,
    injectiveAddress: address,
    orderType: OrderTypeMap.SELL,
    quantity: "50000000000000000.000000000000000000",
    price: "0.000000000020880000",
    subaccountId: getSubaccountId(address),
  });


      const wallet = new WalletStrategy({
        chainId: networkInfo.chainId,
        wallet: Wallet.PrivateKey,
        ethereumOptions: {
          ethereumChainId: networkInfo.ethereumChainId!,
        },
        options: {
          privateKey
        }
    });

    const msgBroadcaster = new MsgBroadcaster({
      walletStrategy: wallet,
      network: network,
      endpoints: endpoints,
      simulateTx: true,
      });

      const msgBroadcasterPrivateKey = new MsgBroadcasterWithPk({
        privateKey,
        network,
        endpoints,
        simulateTx: true,
        chainId: networkInfo.chainId,
        ethereumChainId: networkInfo.ethereumChainId!,
      });


      (async () => {
          console.log('msgBroadcaster: ')
          const tx = await msgBroadcaster.broadcastWithFeeDelegation({
              msgs: [msg],
              address
            }).catch((e) => {
              console.log(JSON.stringify(e, null, 2))
              return 'FAILED'
            })
          console.log(tx);
          
        console.log('msgBroadcasterWithPK: ')
        const pkTx = await msgBroadcasterPrivateKey.broadcastWithFeeDelegation({
            msgs: [msg],
          }).catch((e) => {
            console.log(JSON.stringify(e, null, 2))
            return 'FAILED'
          })
        console.log(pkTx);

      })()
