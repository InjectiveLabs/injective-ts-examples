import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getEnvironmentVariable,
  getNumberEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";
import type { WalletStrategyArguments } from "@injectivelabs/wallet-base";

const feeGrantGranterPrivateKeyVariable = "FEE_GRANT_GRANTER_PRIVATE_KEY";
const feeGrantGranterSeedPhraseVariable = "FEE_GRANT_GRANTER_SEED_PHRASE";
const feeGrantGranteePrivateKeyVariable = "FEE_GRANT_GRANTEE_PRIVATE_KEY";
const feeGrantGranteeSeedPhraseVariable = "FEE_GRANT_GRANTEE_SEED_PHRASE";
const privateKeyVariable = "PRIVATE_KEY";
const seedPhraseVariable = "SEED_PHRASE";

type SigningMaterialType = "private-key" | "seed-phrase";

const privateKeyHexPattern = /^(0x)?[0-9a-fA-F]{64}$/;

interface SigningMaterial {
  readonly type: SigningMaterialType;
  readonly value: string;
  readonly environmentVariable: string;
}

interface GranterSigningMaterialInput {
  readonly feeGrantGranterPrivateKeyOrSeedPhrase?: string;
  readonly feeGrantGranterSeedPhrase?: string;
  readonly privateKey?: string;
  readonly seedPhrase?: string;
}

interface GranteeSigningMaterialInput {
  readonly feeGrantGranteePrivateKeyOrSeedPhrase?: string;
  readonly feeGrantGranteeSeedPhrase?: string;
}

interface SigningMaterialCandidate {
  readonly value?: string;
  readonly environmentVariable: string;
  readonly type?: SigningMaterialType;
}

interface SigningMaterialResolutionInput {
  readonly candidates: readonly SigningMaterialCandidate[];
  readonly missingMessage: string;
}

interface FeeGrantAddresses {
  readonly granterInjectiveAddress: string;
  readonly granteeInjectiveAddress: string;
}

interface ExpirationTimestampInput {
  readonly currentTimeMilliseconds: number;
  readonly secondsFromNow: number;
}

interface BalanceDeltaInput {
  readonly beforeAmount: string;
  readonly afterAmount: string;
}

interface TransactionFeeQueryInput {
  readonly restEndpoint: string;
  readonly transactionHash: string;
}

interface TransactionFeeDetails {
  readonly transactionHash: string;
  readonly queryUrl: string;
  readonly feePayer: string;
  readonly rawFeePayer: string;
  readonly feeGranter: string;
  readonly gasLimit: string;
  readonly amount: unknown;
}

interface FeegrantVerdictInput {
  readonly feeGranter: string;
  readonly expectedGranter: string;
}

type GrantAllowanceStatus =
  | "broadcasted"
  | "used-existing"
  | "replaced-existing";

interface GrantAllowanceResult {
  readonly status: GrantAllowanceStatus;
  readonly existingAllowanceError?: string;
  readonly revokeExistingResponse?: unknown;
  readonly grantResponse?: unknown;
}

export const metadata: ExampleMetadata = {
  id: "tx:testnet-fee-grant",
  category: "transactions",
  title: "Testnet fee grant",
  description:
    "Grant a testnet fee allowance and send INJ from grantee to granter using the grant.",
  requiresEnvironment: [
    "FEE_GRANT_GRANTEE_PRIVATE_KEY or FEE_GRANT_GRANTEE_SEED_PHRASE",
    "FEE_GRANT_GRANTER_PRIVATE_KEY, FEE_GRANT_GRANTER_SEED_PHRASE, PRIVATE_KEY, or SEED_PHRASE",
    "BROADCAST_TRANSACTIONS=true for the live grant/use flow",
  ],
  mayBroadcast: true,
};

export const inferSigningMaterialType = (value: string): SigningMaterialType =>
  privateKeyHexPattern.test(value.trim()) ? "private-key" : "seed-phrase";

const resolveSigningMaterial = ({
  candidates,
  missingMessage,
}: SigningMaterialResolutionInput): SigningMaterial => {
  const signingMaterial = candidates.find(({ value }) => value?.trim());

  if (!signingMaterial?.value) {
    throw new Error(missingMessage);
  }

  const value = signingMaterial.value.trim();

  return {
    type: signingMaterial.type ?? inferSigningMaterialType(value),
    value,
    environmentVariable: signingMaterial.environmentVariable,
  };
};

export const resolveGranterSigningMaterial = (
  input: GranterSigningMaterialInput,
): SigningMaterial =>
  resolveSigningMaterial({
    candidates: [
      {
        value: input.feeGrantGranterPrivateKeyOrSeedPhrase,
        environmentVariable: feeGrantGranterPrivateKeyVariable,
      },
      {
        value: input.feeGrantGranterSeedPhrase,
        environmentVariable: feeGrantGranterSeedPhraseVariable,
        type: "seed-phrase",
      },
      {
        value: input.privateKey,
        environmentVariable: privateKeyVariable,
        type: "private-key",
      },
      {
        value: input.seedPhrase,
        environmentVariable: seedPhraseVariable,
        type: "seed-phrase",
      },
    ],
    missingMessage: `Set ${feeGrantGranterPrivateKeyVariable}, ${feeGrantGranterSeedPhraseVariable}, ${privateKeyVariable}, or ${seedPhraseVariable} in .env for the fee grant granter account.`,
  });

export const resolveGranteeSigningMaterial = (
  input: GranteeSigningMaterialInput,
): SigningMaterial =>
  resolveSigningMaterial({
    candidates: [
      {
        value: input.feeGrantGranteePrivateKeyOrSeedPhrase,
        environmentVariable: feeGrantGranteePrivateKeyVariable,
      },
      {
        value: input.feeGrantGranteeSeedPhrase,
        environmentVariable: feeGrantGranteeSeedPhraseVariable,
        type: "seed-phrase",
      },
    ],
    missingMessage: `Set ${feeGrantGranteePrivateKeyVariable} or ${feeGrantGranteeSeedPhraseVariable} in .env for the fee grant grantee account.`,
  });

export const ensureDifferentFeeGrantAddresses = ({
  granterInjectiveAddress,
  granteeInjectiveAddress,
}: FeeGrantAddresses): void => {
  if (granterInjectiveAddress !== granteeInjectiveAddress) {
    return;
  }

  throw new Error(
    "Fee grant granter and grantee must be different Injective accounts.",
  );
};

export const requirePositiveInteger = (name: string, value: number): number => {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new Error(
    `Invalid ${name}: expected a positive integer, got ${value}.`,
  );
};

export const calculateExpirationTimestamp = ({
  currentTimeMilliseconds,
  secondsFromNow,
}: ExpirationTimestampInput): number =>
  Math.floor(currentTimeMilliseconds / 1000) + secondsFromNow;

export const calculateBalanceDelta = ({
  beforeAmount,
  afterAmount,
}: BalanceDeltaInput): string =>
  (BigInt(afterAmount) - BigInt(beforeAmount)).toString();

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;

    if (typeof message === "string") {
      return message;
    }
  }

  return JSON.stringify(error) ?? String(error);
};

export const isFeeAllowanceAlreadyExistsError = (error: unknown): boolean =>
  getErrorMessage(error).toLowerCase().includes("fee allowance already exists");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getRecordProperty = (
  value: Record<string, unknown>,
  property: string,
): Record<string, unknown> => {
  const propertyValue = value[property];

  if (isRecord(propertyValue)) {
    return propertyValue;
  }

  throw new Error(
    `Expected transaction query response to include ${property}.`,
  );
};

const getStringProperty = (
  value: Record<string, unknown>,
  property: string,
): string => {
  const propertyValue = value[property];

  return typeof propertyValue === "string" ? propertyValue : "";
};

export const buildTransactionQueryUrl = ({
  restEndpoint,
  transactionHash,
}: TransactionFeeQueryInput): string =>
  `${restEndpoint.replace(/\/+$/, "")}/cosmos/tx/v1beta1/txs/${transactionHash}`;

export const extractTransactionFeeDetails = (
  transactionQueryResponse: unknown,
  queryInput: TransactionFeeQueryInput,
): TransactionFeeDetails => {
  if (!isRecord(transactionQueryResponse)) {
    throw new Error("Expected transaction query response to be an object.");
  }

  const transaction = getRecordProperty(transactionQueryResponse, "tx");
  const authInfo = getRecordProperty(transaction, "auth_info");
  const fee = getRecordProperty(authInfo, "fee");
  const rawFeePayer = getStringProperty(fee, "payer");
  const feeGranter = getStringProperty(fee, "granter");

  return {
    transactionHash: queryInput.transactionHash,
    queryUrl: buildTransactionQueryUrl(queryInput),
    feePayer: feeGranter || rawFeePayer,
    rawFeePayer,
    feeGranter,
    gasLimit: getStringProperty(fee, "gas_limit"),
    amount: fee.amount,
  };
};

export const getFeegrantVerdict = ({
  feeGranter,
  expectedGranter,
}: FeegrantVerdictInput): string =>
  feeGranter === expectedGranter ? "feegrant WORKS" : "feegrant DOES NOT WORK";

const getGranterSigningMaterialFromEnvironment = (): SigningMaterial =>
  resolveGranterSigningMaterial({
    feeGrantGranterPrivateKeyOrSeedPhrase: getEnvironmentVariable(
      feeGrantGranterPrivateKeyVariable,
    ),
    feeGrantGranterSeedPhrase: getEnvironmentVariable(
      feeGrantGranterSeedPhraseVariable,
    ),
    privateKey: getEnvironmentVariable(privateKeyVariable),
    seedPhrase: getEnvironmentVariable(seedPhraseVariable),
  });

const getGranteeSigningMaterialFromEnvironment = (): SigningMaterial =>
  resolveGranteeSigningMaterial({
    feeGrantGranteePrivateKeyOrSeedPhrase: getEnvironmentVariable(
      feeGrantGranteePrivateKeyVariable,
    ),
    feeGrantGranteeSeedPhrase: getEnvironmentVariable(
      feeGrantGranteeSeedPhraseVariable,
    ),
  });

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } =
    await import("@injectivelabs/networks");
  const { ChainId } = await import("@injectivelabs/ts-types");
  const {
    ChainGrpcBankApi,
    MsgBroadcasterWithPk,
    MsgGrantAllowance,
    MsgRevokeAllowance,
    MsgSend,
    PrivateKey,
  } = await import("@injectivelabs/sdk-ts");
  const { Wallet } = await import("@injectivelabs/wallet-base/light");
  const { BaseWalletStrategy, MsgBroadcaster } =
    await import("@injectivelabs/wallet-core");
  const { PrivateKeyCosmosWalletStrategy } =
    await import("@injectivelabs/wallet-private-key");
  const { BigNumberInBase, INJ_DENOM } = await import("@injectivelabs/utils");
  const { getInjectiveNetworkFromEnvironment } =
    await import("../../lib/networks");

  const granterSigningMaterial = getGranterSigningMaterialFromEnvironment();
  const granteeSigningMaterial = getGranteeSigningMaterialFromEnvironment();
  const createPrivateKey = (signingMaterial: SigningMaterial) => {
    if (signingMaterial.type === "private-key") {
      return PrivateKey.fromHex(signingMaterial.value);
    }

    return PrivateKey.fromMnemonic(signingMaterial.value);
  };
  const granterPrivateKey = createPrivateKey(granterSigningMaterial);
  const granteePrivateKey = createPrivateKey(granteeSigningMaterial);
  const granterInjectiveAddress = granterPrivateKey.toBech32();
  const granteeInjectiveAddress = granteePrivateKey.toBech32();
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK_FEE_GRANT",
    Network.Testnet,
  );
  const broadcastTransactions = getBooleanEnvironmentVariable(
    "BROADCAST_TRANSACTIONS",
    false,
  );
  const revokeAfterUse = getBooleanEnvironmentVariable(
    "FEE_GRANT_REVOKE_AFTER",
    false,
  );
  const replaceExistingAllowance = getBooleanEnvironmentVariable(
    "FEE_GRANT_REPLACE_EXISTING",
    false,
  );
  const expirationSecondsFromNow = requirePositiveInteger(
    "FEE_GRANT_EXPIRATION_SECONDS_FROM_NOW",
    getNumberEnvironmentVariable("FEE_GRANT_EXPIRATION_SECONDS_FROM_NOW", 3600),
  );
  const spendLimitInInj = getEnvironmentVariable(
    "FEE_GRANT_SPEND_LIMIT_INJ",
    "0.001",
  );
  const sendAmountInInj = getEnvironmentVariable(
    "FEE_GRANT_SEND_AMOUNT_INJ",
    "0.000001",
  );
  const expirationTimestamp = calculateExpirationTimestamp({
    currentTimeMilliseconds: Date.now(),
    secondsFromNow: expirationSecondsFromNow,
  });
  const spendLimit = {
    amount: new BigNumberInBase(spendLimitInInj).toWei().toFixed(),
    denom: INJ_DENOM,
  };
  const sendAmount = {
    amount: new BigNumberInBase(sendAmountInInj).toWei().toFixed(),
    denom: INJ_DENOM,
  };

  ensureDifferentFeeGrantAddresses({
    granterInjectiveAddress,
    granteeInjectiveAddress,
  });

  const endpoints = getNetworkEndpoints(network);
  const bankApi = new ChainGrpcBankApi(endpoints.grpc);
  const queryTransactionFeeDetails = async (
    transactionHash: string,
  ): Promise<TransactionFeeDetails> => {
    const queryInput = {
      restEndpoint: endpoints.rest,
      transactionHash,
    };
    const queryUrl = buildTransactionQueryUrl(queryInput);
    const response = await fetch(queryUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to query transaction ${transactionHash}: ${response.status} ${response.statusText}`,
      );
    }

    return extractTransactionFeeDetails(await response.json(), queryInput);
  };
  const fetchFeeGrantBalances = async () => {
    const [granterBalance, granteeBalance] = await Promise.all([
      bankApi.fetchBalance({
        accountAddress: granterInjectiveAddress,
        denom: INJ_DENOM,
      }),
      bankApi.fetchBalance({
        accountAddress: granteeInjectiveAddress,
        denom: INJ_DENOM,
      }),
    ]);

    return {
      granterBalance,
      granteeBalance,
    };
  };
  const { granterBalance, granteeBalance } = await fetchFeeGrantBalances();

  const grantAllowanceMessage = MsgGrantAllowance.fromJSON({
    granter: granterInjectiveAddress,
    grantee: granteeInjectiveAddress,
    allowance: {
      spendLimit: [spendLimit],
      expiration: expirationTimestamp,
    },
  });
  const proofMessage = MsgSend.fromJSON({
    amount: sendAmount,
    srcInjectiveAddress: granteeInjectiveAddress,
    dstInjectiveAddress: granterInjectiveAddress,
  });
  const revokeAllowanceMessage = MsgRevokeAllowance.fromJSON({
    granter: granterInjectiveAddress,
    grantee: granteeInjectiveAddress,
  });

  const granterBroadcaster = new MsgBroadcasterWithPk({
    network,
    privateKey: granterPrivateKey,
    simulateTx: true,
  });

  const strategyArgs: WalletStrategyArguments = {
    chainId: ChainId.Testnet,
    wallet: Wallet.PrivateKeyCosmos,
    strategies: {
      [Wallet.PrivateKeyCosmos]: new PrivateKeyCosmosWalletStrategy({
        chainId: ChainId.Testnet,
        metadata: {
          privateKey: {
            privateKey: granteePrivateKey.toPrivateKeyHex(),
          },
        },
      }),
    },
  };

  const walletStrategy = new BaseWalletStrategy(strategyArgs);

  const granteeBroadcaster = new MsgBroadcaster({
    network,
    simulateTx: true,
    walletStrategy,
  });

  const grantTransaction = {
    msgs: grantAllowanceMessage,
    memo: "feegrant: grant test allowance",
  };
  const proofTransaction = {
    msgs: proofMessage,
    injectiveAddress: granteeInjectiveAddress,
    memo: "feegrant: grantee sends to granter with granter-paid gas",
    gas: {
      granter: granterInjectiveAddress,
    },
  };

  if (!broadcastTransactions) {
    let grantSimulationGasInfo: unknown;
    let grantSimulationError: string | undefined;

    try {
      const grantSimulation =
        await granterBroadcaster.simulate(grantTransaction);
      grantSimulationGasInfo = grantSimulation.gasInfo;
    } catch (error) {
      if (!isFeeAllowanceAlreadyExistsError(error)) {
        throw error;
      }

      grantSimulationError = getErrorMessage(error);
    }

    console.log({
      network,
      broadcastTransactions,
      dryRun: true,
      note: "Grant creation was simulated only. If an allowance already exists, the live path will use it unless FEE_GRANT_REPLACE_EXISTING=true.",
      replaceExistingAllowance,
      granterSigningMaterialVariable:
        granterSigningMaterial.environmentVariable,
      granterInjectiveAddress,
      granteeInjectiveAddress,
      granterBalance,
      granteeBalance,
      spendLimit,
      sendAmount,
      expirationTimestamp,
      proofMessageType: "/cosmos.bank.v1beta1.MsgSend",
      proofTransfer: {
        source: granteeInjectiveAddress,
        destination: granterInjectiveAddress,
        amount: sendAmount,
      },
      proofTransactionGas: proofTransaction.gas,
      granterSigningMaterialType: granterSigningMaterial.type,
      granteeSigningMaterialVariable:
        granteeSigningMaterial.environmentVariable,
      granteeSigningMaterialType: granteeSigningMaterial.type,
      grantSimulationGasInfo,
      grantSimulationError,
    });
    return;
  }

  let grantAllowanceResult: GrantAllowanceResult;

  try {
    const grantResponse = await granterBroadcaster.broadcast(grantTransaction);

    grantAllowanceResult = {
      status: "broadcasted",
      grantResponse,
    };
  } catch (error) {
    if (!isFeeAllowanceAlreadyExistsError(error)) {
      throw error;
    }

    if (!replaceExistingAllowance) {
      grantAllowanceResult = {
        status: "used-existing",
        existingAllowanceError: getErrorMessage(error),
      };
    } else {
      const revokeExistingResponse = await granterBroadcaster.broadcast({
        msgs: revokeAllowanceMessage,
        memo: "feegrant: replace existing allowance",
      });
      const grantResponse =
        await granterBroadcaster.broadcast(grantTransaction);

      grantAllowanceResult = {
        status: "replaced-existing",
        existingAllowanceError: getErrorMessage(error),
        revokeExistingResponse,
        grantResponse,
      };
    }
  }

  const proofResponse = await granteeBroadcaster.broadcastV2(proofTransaction);
  const proofTransactionFee = await queryTransactionFeeDetails(
    proofResponse.txHash,
  );
  const feegrantResult = getFeegrantVerdict({
    feeGranter: proofTransactionFee.feeGranter,
    expectedGranter: granterInjectiveAddress,
  });
  const revokeResponse = revokeAfterUse
    ? await granterBroadcaster.broadcast({
        msgs: revokeAllowanceMessage,
        memo: "feegrant: revoke test allowance",
      })
    : undefined;

  console.log({
    network,
    broadcastTransactions,
    revokeAfterUse,
    replaceExistingAllowance,
    granterSigningMaterialVariable: granterSigningMaterial.environmentVariable,
    granterInjectiveAddress,
    granteeInjectiveAddress,
    proofMessageType: "/cosmos.bank.v1beta1.MsgSend",
    proofTransfer: {
      source: granteeInjectiveAddress,
      destination: granterInjectiveAddress,
      amount: sendAmount,
    },
    proofTransactionGas: proofTransaction.gas,
    granterSigningMaterialType: granterSigningMaterial.type,
    granteeSigningMaterialVariable: granteeSigningMaterial.environmentVariable,
    granteeSigningMaterialType: granteeSigningMaterial.type,
    grantAllowanceResult,
    proofTransactionHash: proofResponse.txHash,
    proofTransactionFee,
    feegrantResult,
    revokeResponse,
  });

  console.log(feegrantResult);
};

runDirectly(module, run);
