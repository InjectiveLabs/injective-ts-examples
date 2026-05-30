import type { ExampleMetadata } from "../types";
import { runDirectly } from "../../lib/direct-run";

export const metadata: ExampleMetadata = {
  id: "query:spot-markets",
  category: "queries",
  title: "Fetch spot markets",
  description: "Fetch spot markets from the Injective indexer.",
};

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } = await import("@injectivelabs/networks");
  const { IndexerGrpcSpotApi } = await import("@injectivelabs/sdk-ts");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Testnet
  );
  const endpoints = getNetworkEndpoints(network);
  const indexerGrpcSpotApi = new IndexerGrpcSpotApi(endpoints.indexer);
  const markets = await indexerGrpcSpotApi.fetchMarkets();

  console.log({
    network,
    endpoint: endpoints.indexer,
    marketCount: markets.length,
    markets,
  });
};

runDirectly(module, run);
