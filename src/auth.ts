import { config } from "dotenv";
import { ChainGrpcAuthApi, PublicKey } from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";

config();

(async () => {
  const endpoints = getNetworkEndpoints(Network.MainnetSentry);
  const chainGrpcAuthApi = new ChainGrpcAuthApi(endpoints.grpc);

  const injectiveAddress = "inj...";
  const account = await chainGrpcAuthApi.fetchAccount(injectiveAddress);
  const hex = Buffer.from(
    account.baseAccount.pubKey?.key || "",
    "base64"
  ).toString("hex");
  const base64 = account.baseAccount.pubKey?.key || "";

  console.log({ base64 });

  console.log({
    hex,
    base64,
    pubBech32: PublicKey.fromBase64(base64).toBech32(),
  });
})();
