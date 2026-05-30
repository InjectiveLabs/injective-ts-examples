import type { ExampleMetadata } from "../types";
import {
  getEnvironmentVariable,
  requireEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

export const metadata: ExampleMetadata = {
  id: "tx:simulate-msg-send",
  category: "transactions",
  title: "Simulate MsgSend",
  description: "Build and simulate an Injective bank send transaction.",
  requiresEnvironment: ["PRIVATE_KEY"],
};

export const run = async (): Promise<void> => {
  const { Network } = await import("@injectivelabs/networks");
  const { MsgBroadcasterWithPk, MsgSend, PrivateKey } = await import(
    "@injectivelabs/sdk-ts"
  );
  const { BigNumberInBase } = await import("@injectivelabs/utils");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );
  const privateKeyHex = requireEnvironmentVariable("PRIVATE_KEY");
  const privateKey = PrivateKey.fromHex(privateKeyHex);
  const sourceInjectiveAddress = privateKey.toBech32();
  const destinationInjectiveAddress = getEnvironmentVariable(
    "DESTINATION_INJECTIVE_ADDRESS",
    sourceInjectiveAddress
  );
  const amountInInj = getEnvironmentVariable("SEND_AMOUNT_INJ", "0.001");
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Testnet
  );

  const amount = {
    amount: new BigNumberInBase(amountInInj).toWei().toFixed(),
    denom: "inj",
  };

  const message = MsgSend.fromJSON({
    amount,
    srcInjectiveAddress: sourceInjectiveAddress,
    dstInjectiveAddress: destinationInjectiveAddress,
  });

  const msgBroadcaster = new MsgBroadcasterWithPk({
    network,
    privateKey: privateKeyHex,
  });

  const response = await msgBroadcaster.simulate({ msgs: message });

  console.log({
    network,
    sourceInjectiveAddress,
    destinationInjectiveAddress,
    amount,
    gasInfo: response.gasInfo,
  });
};

runDirectly(module, run);
