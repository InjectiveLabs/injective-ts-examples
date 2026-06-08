import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getEnvironmentVariable,
  requireEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

const privateKeyVariable = "PRIVATE_KEY";
const seedPhraseVariable = "SEED_PHRASE";

type SourceSigningMaterialType = "private-key" | "seed-phrase";

interface SourceSigningMaterial {
  readonly type: SourceSigningMaterialType;
  readonly value: string;
  readonly environmentVariable: string;
}

interface SourceSigningMaterialInput {
  readonly privateKey?: string;
  readonly seedPhrase?: string;
}

interface TransferAmountInput {
  readonly balanceAmount: string;
  readonly feeAmount: string;
}

export const resolveSourceSigningMaterial = (
  input: SourceSigningMaterialInput
): SourceSigningMaterial => {
  if (input.privateKey) {
    return {
      type: "private-key",
      value: input.privateKey,
      environmentVariable: privateKeyVariable,
    };
  }

  if (input.seedPhrase) {
    return {
      type: "seed-phrase",
      value: input.seedPhrase,
      environmentVariable: seedPhraseVariable,
    };
  }

  throw new Error(
    `Set ${privateKeyVariable} or ${seedPhraseVariable} in .env to control the source account.`
  );
};

export const calculateTransferAmount = ({
  balanceAmount,
  feeAmount,
}: TransferAmountInput): string => {
  const balance = BigInt(balanceAmount);
  const fee = BigInt(feeAmount);

  if (balance <= 0n) {
    throw new Error("Source account has no INJ balance to send.");
  }

  if (balance <= fee) {
    throw new Error(
      `Source INJ balance ${balanceAmount} is not enough to pay the estimated fee ${feeAmount}.`
    );
  }

  return (balance - fee).toString();
};

const getSourceSigningMaterialFromEnvironment = (): SourceSigningMaterial =>
  resolveSourceSigningMaterial({
    privateKey: getEnvironmentVariable(privateKeyVariable),
    seedPhrase: getEnvironmentVariable(seedPhraseVariable),
  });

export const metadata: ExampleMetadata = {
  id: "tx:send-funds",
  category: "transactions",
  title: "Send funds",
  description: "Send the available INJ balance from a source signer in .env.",
  requiresEnvironment: [
    "PRIVATE_KEY or SEED_PHRASE",
    "DESTINATION_INJECTIVE_ADDRESS",
  ],
  mayBroadcast: true,
};

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } = await import(
    "@injectivelabs/networks"
  );
  const {
    ChainGrpcBankApi,
    MsgBroadcasterWithPk,
    MsgSend,
    PrivateKey,
  } = await import("@injectivelabs/sdk-ts");
  const { DEFAULT_GAS_LIMIT, DEFAULT_GAS_PRICE, INJ_DENOM } = await import(
    "@injectivelabs/utils"
  );
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const sourceSigningMaterial = getSourceSigningMaterialFromEnvironment();
  const sourcePrivateKey =
    sourceSigningMaterial.type === "private-key"
      ? PrivateKey.fromHex(sourceSigningMaterial.value)
      : PrivateKey.fromMnemonic(sourceSigningMaterial.value);
  const sourceInjectiveAddress = sourcePrivateKey.toBech32();
  const destinationInjectiveAddress = requireEnvironmentVariable(
    "DESTINATION_INJECTIVE_ADDRESS"
  );
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Testnet
  );
  const broadcastTransactions = getBooleanEnvironmentVariable(
    "BROADCAST_TRANSACTIONS",
    false
  );
  const endpoints = getNetworkEndpoints(network);
  const bankApi = new ChainGrpcBankApi(endpoints.grpc);
  const sourceBalance = await bankApi.fetchBalance({
    accountAddress: sourceInjectiveAddress,
    denom: INJ_DENOM,
  });
  const feeAmount = (
    BigInt(DEFAULT_GAS_LIMIT) * BigInt(DEFAULT_GAS_PRICE)
  ).toString();
  const transferAmount = calculateTransferAmount({
    balanceAmount: sourceBalance.amount,
    feeAmount,
  });

  const amount = {
    amount: transferAmount,
    denom: INJ_DENOM,
  };

  const message = MsgSend.fromJSON({
    amount,
    srcInjectiveAddress: sourceInjectiveAddress,
    dstInjectiveAddress: destinationInjectiveAddress,
  });

  const broadcaster = new MsgBroadcasterWithPk({
    network,
    privateKey: sourcePrivateKey,
  });
  const response = broadcastTransactions
    ? await broadcaster.broadcast({ msgs: message })
    : await broadcaster.simulate({ msgs: message });

  console.log({
    network,
    broadcastTransactions,
    signingMaterialVariable: sourceSigningMaterial.environmentVariable,
    sourceInjectiveAddress,
    destinationInjectiveAddress,
    sourceBalance,
    estimatedFee: {
      amount: feeAmount,
      denom: INJ_DENOM,
    },
    amount,
    response,
  });
};

runDirectly(module, run);
