import { config } from "dotenv";
import { IndexerGrpcSpotApi } from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { readFile } from "fs/promises";

config();

/** Querying Example */
(async () => {
  const endpoints = getNetworkEndpoints(Network.Testnet);
  const indexerGrpcSpotApi = new IndexerGrpcSpotApi(endpoints.indexer);

  const markets = await indexerGrpcSpotApi.fetchMarkets();

  console.log(markets);

  const metadata = JSON.parse(await readFile("./mainnet.json", "utf8")) as {
    denom: string;
    address: string;
    decimals: string;
    logo: string;
    name: string;
    tokenType: string;
    coinGeckoId: string;
  }[];
  const marketsWithMetadata = markets.map((market) => {
    const baseTokenMetadata = metadata.find(
      (m) => m.denom === market.baseDenom
    );
    const quoteTokenMetadata = metadata.find(
      (m) => m.denom === market.quoteDenom
    );

    return {
      ...market,
      baseTokenMetadata,
      quoteTokenMetadata,
    };
  });

  console.log(marketsWithMetadata);
})();
