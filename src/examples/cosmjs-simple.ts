import { config } from "dotenv";
import {
  PrivateKey,
  injectiveAccountParser,
  InjectiveDirectEthSecp256k1Wallet,
} from "@injectivelabs/sdk-ts";
import { OfflineDirectSigner } from "@cosmjs/proto-signing";
import { SigningStargateClient } from "@cosmjs/stargate";
import { Network, getNetworkInfo } from "@injectivelabs/networks";
import { getStdFee } from "@injectivelabs/utils";

config();

(async () => {
  const network = getNetworkInfo(Network.Devnet1);
  const privateKeyHash = process.env.PRIVATE_KEY as string;
  const privateKey = PrivateKey.fromHex(privateKeyHash);
  const injectiveAddress = privateKey.toBech32();
  const wallet = (await InjectiveDirectEthSecp256k1Wallet.fromKey(
    Buffer.from(privateKeyHash, "hex")
  )) as OfflineDirectSigner;
  const [firstAccount] = await wallet.getAccounts();

  const client = await SigningStargateClient.connectWithSigner(
    network.rpc as string,
    wallet,
    { accountParser: injectiveAccountParser }
  );

  const recipient = injectiveAddress;
  const amount = {
    denom: "inj",
    amount: "1000000000",
  };
  const txResponse = await client.sendTokens(
    firstAccount.address,
    recipient,
    [amount],
    getStdFee(),
    "Have fun with your star coins"
  );

  if (txResponse.code !== 0) {
    console.log(`Transaction failed: ${txResponse.rawLog}`);
  } else {
    console.log(
      `Broadcasted transaction hash: ${JSON.stringify(
        txResponse.transactionHash
      )}`
    );
  }
})();
