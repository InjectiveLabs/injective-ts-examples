import { config } from "dotenv";
import { Network } from "@injectivelabs/networks";
import { PrivateKey } from "@injectivelabs/sdk-ts";
import { MsgSend } from "@injectivelabs/sdk-ts";
import { BigNumberInBase } from "@injectivelabs/utils";
import { MsgBroadcasterWithPk } from "@injectivelabs/sdk-ts";

config();

/** MsgSend Example */
(async () => {
  const privateKeyHash = process.env.PRIVATE_KEY as string;
  const privateKey = PrivateKey.fromHex(privateKeyHash);
  const injectiveAddress = privateKey.toBech32();

  /** Prepare the Message */
  const amount = {
    amount: new BigNumberInBase(0.001).toWei().toFixed(),
    denom: "inj",
  };

  const msg = MsgSend.fromJSON({
    amount,
    srcInjectiveAddress: injectiveAddress,
    dstInjectiveAddress: injectiveAddress,
  });

  const msgBroadcaster = new MsgBroadcasterWithPk({
    network: Network.Testnet,
    privateKey: privateKeyHash,
  });

  /** Prepare the Transaction **/
  const response = await msgBroadcaster.simulate({ msgs: msg });

  console.log(response.gasInfo);
})();
