import { getNetworkInfo, Network } from "@injectivelabs/networks";
import {
  TxClient,
  PrivateKey,
  TxRestClient,
  ChainRestAuthApi,
  createTransaction,
} from "@injectivelabs/sdk-ts";
import { MsgSend } from "@injectivelabs/sdk-ts";
import { BigNumberInBase, DEFAULT_STD_FEE } from "@injectivelabs/utils";

/** MsgSend Example */
(async () => {
  const network = getNetworkInfo(Network.MainnetLB);
  const privateKeyHash = process.env.PRIVATE_KEY as string;
  const privateKey = PrivateKey.fromHex(privateKeyHash);
  const injectiveAddress = privateKey.toBech32();
  const publicKey = privateKey.toPublicKey().toBase64();

  /** Account Details **/
  const accountDetails = await new ChainRestAuthApi(network.rest).fetchAccount(
    injectiveAddress
  );

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

  /** Prepare the Transaction **/
  const { signBytes, txRaw } = createTransaction({
    message: msg,
    memo: "",
    fee: DEFAULT_STD_FEE,
    pubKey: publicKey,
    sequence: parseInt(accountDetails.account.base_account.sequence, 10),
    accountNumber: parseInt(
      accountDetails.account.base_account.account_number,
      10
    ),
    chainId: network.chainId,
  });

  /** Sign transaction */
  const signature = await privateKey.sign(Buffer.from(signBytes));

  /** Append Signatures */
  txRaw.signatures = [signature];

  /** Calculate hash of the transaction */
  console.log(`Transaction Hash: ${TxClient.hash(txRaw)}`);

  const txService = new TxRestClient(network.rest);

  try {
    /** Simulate transaction */
    const simulationResponse = await txService.simulate(txRaw);
    console.log(
      `Transaction simulation response: ${JSON.stringify(
        simulationResponse.gasInfo
      )}`
    );

    /** Broadcast transaction */
    const txResponse = await txService.broadcast(txRaw);

    if (txResponse.code !== 0) {
      console.log(`Transaction failed: ${txResponse.rawLog}`);
    } else {
      console.log(
        `Broadcasted transaction hash: ${JSON.stringify(txResponse.txHash)}`
      );
    }
  } catch (error) {
    console.log(`Transaction failed: ${error}`);
  }
})();
