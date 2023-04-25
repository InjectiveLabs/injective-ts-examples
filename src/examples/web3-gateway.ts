import { config } from "dotenv";
import { getNetworkInfo, Network } from "@injectivelabs/networks";
import {
  PrivateKey,
  IndexerGrpcTransactionApi,
  getGasPriceBasedOnMessage,
  MsgCreateSpotLimitOrder,
  spotPriceToChainPriceToFixed,
  spotQuantityToChainQuantityToFixed,
  IndexerGrpcSpotApi,
} from "@injectivelabs/sdk-ts";
import { MsgSend } from "@injectivelabs/sdk-ts";
import { EthereumChainId } from "@injectivelabs/ts-types";
import { BigNumberInBase } from "@injectivelabs/utils";

config();

const network = getNetworkInfo(Network.Devnet1);
const privateKeyHash = process.env.PRIVATE_KEY as string;
const privateKey = PrivateKey.fromHex(privateKeyHash);
const injectiveAddress = privateKey.toBech32();
const ethereumAddress = privateKey.toAddress().toHex();

const msgSend = async () => {
  /** Prepare the Message */
  const amount = {
    amount: new BigNumberInBase(0.01).toWei().toFixed(),
    denom: "inj",
  };

  const msg = MsgSend.fromJSON({
    amount,
    srcInjectiveAddress: injectiveAddress,
    dstInjectiveAddress: injectiveAddress,
  });

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

  const response = await transactionApi.broadcastTxRequest({
    txResponse,
    signature: "0x" + Buffer.from(signature).toString("hex"),
    message: msg.toWeb3(),
    chainId: EthereumChainId.Goerli,
  });

  console.log(response.txHash);
};

const msgCreateSpotLimitOrder = async () => {
  const subaccountId = privateKey.toAddress().getSubaccountId();
  const indexerSpotApi = new IndexerGrpcSpotApi(network.indexer);
  const markets = await indexerSpotApi.fetchMarkets();
  const injUsdtMarket = markets.find((m) => m.ticker.includes("INJ/USDT"));

  if (!injUsdtMarket) {
    throw new Error(`The INJ/USDT market not found`);
  }

  /* 1 - buy, 2 - sell, 3 - stop_buy, 4 - stop_sell, 5 - take_buy, 6 - take_sell, 7 - buy post-only, 8 - sell post-only */
  const orderType = 1;
  const price = 1.2; /* This is the maximum price you are willing to accept for your market order */
  const quantity = 1;

  /** Prepare the Message */
  const msg = MsgCreateSpotLimitOrder.fromJSON({
    orderType,
    injectiveAddress,
    price: spotPriceToChainPriceToFixed({
      value: price,
      baseDecimals: 18,
      quoteDecimals: 6 /* USDT has 6 decimals */,
    }),
    quantity: spotQuantityToChainQuantityToFixed({
      value: quantity,
      baseDecimals: 18,
    }),
    marketId: injUsdtMarket.marketId,
    feeRecipient: injectiveAddress,
    subaccountId: subaccountId,
  });

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

  const response = await transactionApi.broadcastTxRequest({
    txResponse,
    signature: "0x" + Buffer.from(signature).toString("hex"),
    message: msg.toWeb3(),
    chainId: EthereumChainId.Goerli,
  });

  console.log(response.txHash);
};

(async () => {
  await msgSend();
  await msgCreateSpotLimitOrder();
})();
