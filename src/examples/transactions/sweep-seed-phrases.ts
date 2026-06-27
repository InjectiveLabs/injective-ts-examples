import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getEnvironmentVariable,
  requireEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

const seedPhrasesVariable = "SEED_PHRASES";
const destinationInjectiveAddressVariable = "DESTINATION_INJECTIVE_ADDRESS";
const sweepGasReserveInjVariable = "SWEEP_GAS_RESERVE_INJ";
const defaultSweepGasReserveInj = "0.01";

type SweepStatus =
  | "simulated"
  | "broadcasted"
  | "skipped-insufficient-balance";

interface SweepTransferAmountInput {
  readonly balanceAmount: string;
  readonly gasReserveAmount: string;
}

interface InjectiveAddressPair {
  readonly sourceInjectiveAddress: string;
  readonly destinationInjectiveAddress: string;
}

interface SweepResult {
  readonly seedPhraseIndex: number;
  readonly sourceInjectiveAddress: string;
  readonly sourceBalance: {
    readonly amount: string;
    readonly denom: string;
  };
  readonly status: SweepStatus;
  readonly amount?: {
    readonly amount: string;
    readonly denom: string;
  };
  readonly simulationGasInfo?: unknown;
  readonly transactionHash?: string;
  readonly skipReason?: string;
}

export const metadata: ExampleMetadata = {
  id: "tx:sweep-seed-phrases",
  category: "transactions",
  title: "Sweep seed phrase balances",
  description:
    "Simulate and optionally sweep INJ balances from comma-separated seed phrases.",
  requiresEnvironment: [
    "SEED_PHRASES",
    "DESTINATION_INJECTIVE_ADDRESS",
    "BROADCAST_TRANSACTIONS=true to broadcast after simulation",
  ],
  mayBroadcast: true,
};

export const parseSeedPhrases = (value: string): string[] => {
  const seedPhrases = value
    .split(",")
    .map((seedPhrase) => seedPhrase.trim())
    .filter(Boolean);

  if (seedPhrases.length > 0) {
    return seedPhrases;
  }

  throw new Error(
    `Set ${seedPhrasesVariable} to one or more comma-separated seed phrases.`
  );
};

export const calculateSweepTransferAmount = ({
  balanceAmount,
  gasReserveAmount,
}: SweepTransferAmountInput): string | undefined => {
  const balance = BigInt(balanceAmount);
  const gasReserve = BigInt(gasReserveAmount);

  if (gasReserve <= 0n) {
    throw new Error(
      `Invalid ${sweepGasReserveInjVariable}: reserve must be greater than zero.`
    );
  }

  if (balance <= gasReserve) {
    return undefined;
  }

  return (balance - gasReserve).toString();
};

export const ensureDifferentInjectiveAddresses = ({
  sourceInjectiveAddress,
  destinationInjectiveAddress,
}: InjectiveAddressPair): void => {
  if (sourceInjectiveAddress !== destinationInjectiveAddress) {
    return;
  }

  throw new Error(
    "Source and destination Injective addresses must be different for a sweep."
  );
};

export const extractTransactionHash = (response: unknown): string => {
  if (!response || typeof response !== "object") {
    throw new Error("Broadcast response did not include a transaction hash.");
  }

  const transactionHash = (response as { readonly txHash?: unknown }).txHash;

  if (typeof transactionHash === "string" && transactionHash.trim()) {
    return transactionHash;
  }

  throw new Error("Broadcast response did not include a transaction hash.");
};

const getSeedPhrasesFromEnvironment = (): readonly string[] =>
  parseSeedPhrases(requireEnvironmentVariable(seedPhrasesVariable));

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } = await import(
    "@injectivelabs/networks"
  );
  const { ChainGrpcBankApi, MsgBroadcasterWithPk, MsgSend, PrivateKey } =
    await import("@injectivelabs/sdk-ts");
  const { BigNumberInBase, INJ_DENOM } = await import("@injectivelabs/utils");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const seedPhrases = getSeedPhrasesFromEnvironment();
  const destinationInjectiveAddress = requireEnvironmentVariable(
    destinationInjectiveAddressVariable
  );
  const gasReserveInj = getEnvironmentVariable(
    sweepGasReserveInjVariable,
    defaultSweepGasReserveInj
  );
  const gasReserveAmount = new BigNumberInBase(gasReserveInj)
    .toWei()
    .toFixed();
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
  const results: SweepResult[] = [];

  for (const [seedPhraseIndex, seedPhrase] of seedPhrases.entries()) {
    const privateKey = PrivateKey.fromMnemonic(seedPhrase);
    const sourceInjectiveAddress = privateKey.toBech32();

    ensureDifferentInjectiveAddresses({
      sourceInjectiveAddress,
      destinationInjectiveAddress,
    });

    const sourceBalance = await bankApi.fetchBalance({
      accountAddress: sourceInjectiveAddress,
      denom: INJ_DENOM,
    });
    const transferAmount = calculateSweepTransferAmount({
      balanceAmount: sourceBalance.amount,
      gasReserveAmount,
    });

    if (!transferAmount) {
      results.push({
        seedPhraseIndex,
        sourceInjectiveAddress,
        sourceBalance,
        status: "skipped-insufficient-balance",
        skipReason: `INJ balance ${sourceBalance.amount} is not greater than gas reserve ${gasReserveAmount}.`,
      });
      continue;
    }

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
      privateKey,
    });
    let simulationGasInfo: unknown;

    try {
      const simulationResponse = await broadcaster.simulate({ msgs: message });
      simulationGasInfo = simulationResponse.gasInfo;
    } catch (error) {
      throw new Error(
        `Failed to simulate sweep transaction for ${sourceInjectiveAddress}.`,
        { cause: error }
      );
    }

    let transactionHash: string | undefined;

    if (broadcastTransactions) {
      try {
        const broadcastResponse = await broadcaster.broadcast({ msgs: message });
        transactionHash = extractTransactionHash(broadcastResponse);
      } catch (error) {
        throw new Error(
          `Failed to broadcast sweep transaction for ${sourceInjectiveAddress}.`,
          { cause: error }
        );
      }
    }

    results.push({
      seedPhraseIndex,
      sourceInjectiveAddress,
      sourceBalance,
      status: broadcastTransactions ? "broadcasted" : "simulated",
      amount,
      simulationGasInfo,
      transactionHash,
    });
  }

  const transactionHashes = results.flatMap((result) => {
    return result.transactionHash ? [result.transactionHash] : [];
  });

  console.log({
    network,
    broadcastTransactions,
    destinationInjectiveAddress,
    gasReserve: {
      amount: gasReserveAmount,
      amountInInj: gasReserveInj,
      denom: INJ_DENOM,
    },
    results,
    transactionHashes,
  });
};

runDirectly(module, run);
