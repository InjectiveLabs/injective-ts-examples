import { config } from "dotenv";
import { getNetworkInfo, Network } from "@injectivelabs/networks";
import {
  PrivateKey,
  IndexerGrpcTransactionApi,
  getGasPriceBasedOnMessage,
  VoteOptionMap,
  ChainRestAuthApi,
  BaseAccount,
  ChainRestTendermintApi,
  getEip712TypedData,
} from "@injectivelabs/sdk-ts";
import { MsgVote } from "@injectivelabs/sdk-ts";
import { ChainId, EthereumChainId } from "@injectivelabs/ts-types";
import {
  BigNumberInBase,
  DEFAULT_BLOCK_TIMEOUT_HEIGHT,
  DEFAULT_STD_FEE,
} from "@injectivelabs/utils";

config();

const network = getNetworkInfo(Network.Mainnet);
const privateKeyHash = process.env.PRIVATE_KEY as string;
const privateKey = PrivateKey.fromHex(privateKeyHash);
const injectiveAddress = privateKey.toBech32();
const ethereumAddress = privateKey.toAddress().toHex();

/** Prepare the Message */
const msg = MsgVote.fromJSON({
  proposalId: 238,
  vote: VoteOptionMap.VOTE_OPTION_ABSTAIN,
  voter: injectiveAddress,
  metadata: "",
});

const msgVote = async () => {
  const transactionApi = new IndexerGrpcTransactionApi(network.indexerApi);
  const txResponse = await transactionApi.prepareTxRequest({
    memo: "",
    message: msg.toWeb3(),
    address: ethereumAddress,
    chainId: EthereumChainId.Goerli,
    gasLimit: getGasPriceBasedOnMessage([msg]),
    estimateGas: true,
  });

  console.log(txResponse.data);

  const eip712TypedData = JSON.parse(txResponse.data);

  /** Signing on Ethereum */
  const signature = await privateKey.signTypedData(eip712TypedData);

  // const response = await transactionApi.broadcastTxRequest({
  //   txResponse,
  //   signature: "0x" + Buffer.from(signature).toString("hex"),
  //   message: msg.toWeb3(),
  //   chainId: EthereumChainId.Goerli,
  // });

  console.log(signature);
};

const msgVoteClientSide = async () => {
  /** Account Details * */
  const chainRestAuthApi = new ChainRestAuthApi(network.rest);
  const accountDetailsResponse = await chainRestAuthApi.fetchAccount(
    injectiveAddress
  );
  const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);
  const accountDetails = baseAccount.toAccountDetails();

  /** Block Details */
  const chainRestTendermintApi = new ChainRestTendermintApi(network.rest);
  const latestBlock = await chainRestTendermintApi.fetchLatestBlock();
  const latestHeight = latestBlock.header.height;
  const timeoutHeight = new BigNumberInBase(latestHeight).plus(
    DEFAULT_BLOCK_TIMEOUT_HEIGHT
  );

  /** EIP712 for signing on Ethereum wallets */
  const eip712TypedData = getEip712TypedData({
    msgs: msg,
    fee: DEFAULT_STD_FEE,
    tx: {
      memo: "",
      accountNumber: accountDetails.accountNumber.toString(),
      sequence: accountDetails.sequence.toString(),
      timeoutHeight: timeoutHeight.toFixed(),
      chainId: ChainId.Mainnet,
    },
    ethereumChainId: EthereumChainId.Mainnet,
  });

  console.log(JSON.stringify(eip712TypedData));
};

(async () => {
  await msgVote();
  await msgVoteClientSide();
})();
