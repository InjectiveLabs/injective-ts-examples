import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getNumberEnvironmentVariable,
  requireEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

const granteeAddressVariable = "WEB3GW_FEE_GRANT_GRANTEE_ADDRESS";
const broadcastTransactionsVariable = "BROADCAST_TRANSACTIONS";
const confirmationAttemptsVariable = "WEB3GW_FEE_GRANT_CONFIRMATION_ATTEMPTS";
const confirmationPollIntervalVariable =
  "WEB3GW_FEE_GRANT_CONFIRMATION_POLL_INTERVAL_MS";

interface FeeGrantAllowanceQueryInput {
  readonly restEndpoint: string;
  readonly granterAddress: string;
  readonly granteeAddress: string;
}

interface Web3GatewayFeeGrantResponseInput {
  readonly granterAddress: unknown;
  readonly granteeAddress: unknown;
  readonly txHash: unknown;
  readonly expiration: unknown;
  readonly spendLimit?: unknown;
  readonly allowedMessages?: unknown;
}

interface NormalizedWeb3GatewayFeeGrantResponse {
  readonly granterAddress: string;
  readonly granteeAddress: string;
  readonly txHash: string;
  readonly expiration: string;
  readonly spendLimit?: unknown;
  readonly allowedMessages: readonly string[];
}

interface FeeGrantConfirmationInput {
  readonly allowanceQueryResponse: unknown;
  readonly expectedGranterAddress: string;
  readonly expectedGranteeAddress: string;
}

interface FeeGrantConfirmation {
  readonly granterAddress: string;
  readonly granteeAddress: string;
  readonly allowance: Record<string, unknown>;
}

interface WaitForFeeGrantConfirmationInput {
  readonly fetchAllowance: () => Promise<unknown>;
  readonly expectedGranterAddress: string;
  readonly expectedGranteeAddress: string;
  readonly attempts: number;
  readonly pollIntervalMilliseconds: number;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface FeeGrantConfirmationResult extends FeeGrantConfirmation {
  readonly attempts: number;
}

export const metadata: ExampleMetadata = {
  id: "tx:web3gw-fee-grant",
  category: "transactions",
  title: "Web3 Gateway fee grant",
  description:
    "Request a testnet Web3 Gateway fee grant and confirm the resulting allowance.",
  requiresEnvironment: [
    "WEB3GW_FEE_GRANT_GRANTEE_ADDRESS",
    "BROADCAST_TRANSACTIONS=true to request the live grant",
  ],
  mayBroadcast: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (isRecord(value)) {
    return value;
  }

  throw new Error(`Expected ${label} to be an object.`);
};

const requireNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new Error(`Expected ${label} to be a non-empty string.`);
};

const normalizeStringArray = (
  value: unknown,
  label: string,
): readonly string[] => {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }

  throw new Error(`Expected ${label} to be an array of strings.`);
};

const normalizeExpiration = (expiration: unknown): string => {
  if (typeof expiration === "bigint") {
    return expiration.toString();
  }

  if (typeof expiration === "number" && Number.isFinite(expiration)) {
    return expiration.toString();
  }

  return requireNonEmptyString(expiration, "fee grant response expiration");
};

export const requirePositiveInteger = (name: string, value: number): number => {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new Error(
    `Invalid ${name}: expected a positive integer, got ${value}.`,
  );
};

export const buildFeeGrantAllowanceQueryUrl = ({
  restEndpoint,
  granterAddress,
  granteeAddress,
}: FeeGrantAllowanceQueryInput): string =>
  `${restEndpoint.replace(/\/+$/, "")}/cosmos/feegrant/v1beta1/allowance/${encodeURIComponent(
    granterAddress,
  )}/${encodeURIComponent(granteeAddress)}`;

export const normalizeWeb3GatewayFeeGrantResponse = (
  response: Web3GatewayFeeGrantResponseInput,
): NormalizedWeb3GatewayFeeGrantResponse => ({
  granterAddress: requireNonEmptyString(
    response.granterAddress,
    "fee grant response granterAddress",
  ),
  granteeAddress: requireNonEmptyString(
    response.granteeAddress,
    "fee grant response granteeAddress",
  ),
  txHash: requireNonEmptyString(response.txHash, "fee grant response txHash"),
  expiration: normalizeExpiration(response.expiration),
  spendLimit: response.spendLimit,
  allowedMessages: normalizeStringArray(
    response.allowedMessages,
    "fee grant response allowedMessages",
  ),
});

export const confirmFeeGrantAllowance = ({
  allowanceQueryResponse,
  expectedGranterAddress,
  expectedGranteeAddress,
}: FeeGrantConfirmationInput): FeeGrantConfirmation => {
  const response = requireRecord(
    allowanceQueryResponse,
    "fee grant allowance query response",
  );
  const grant = requireRecord(
    response.allowance,
    "fee grant allowance query response allowance",
  );
  const granterAddress = requireNonEmptyString(
    grant.granter,
    "fee grant allowance granter",
  );
  const granteeAddress = requireNonEmptyString(
    grant.grantee,
    "fee grant allowance grantee",
  );

  if (
    granterAddress !== expectedGranterAddress ||
    granteeAddress !== expectedGranteeAddress
  ) {
    throw new Error(
      `Confirmed fee grant did not match expected addresses. Expected ${expectedGranterAddress} -> ${expectedGranteeAddress}, got ${granterAddress} -> ${granteeAddress}.`,
    );
  }

  return {
    granterAddress,
    granteeAddress,
    allowance: requireRecord(grant.allowance, "fee grant allowance details"),
  };
};

export const waitForFeeGrantConfirmation = async ({
  fetchAllowance,
  expectedGranterAddress,
  expectedGranteeAddress,
  attempts,
  pollIntervalMilliseconds,
  delay = (milliseconds) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
}: WaitForFeeGrantConfirmationInput): Promise<FeeGrantConfirmationResult> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const confirmation = confirmFeeGrantAllowance({
        allowanceQueryResponse: await fetchAllowance(),
        expectedGranterAddress,
        expectedGranteeAddress,
      });

      return {
        ...confirmation,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      await delay(pollIntervalMilliseconds);
    }
  }

  throw new Error(`Fee grant was not confirmed after ${attempts} attempts.`, {
    cause: lastError,
  });
};

const fetchFeeGrantAllowance = async (queryUrl: string): Promise<unknown> => {
  const response = await fetch(queryUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to query fee grant allowance: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
};

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } =
    await import("@injectivelabs/networks");
  const { IndexerGrpcWeb3GwApi } = await import("@injectivelabs/sdk-ts");

  const network = Network.Testnet;
  const endpoints = getNetworkEndpoints(network);
  const web3GatewayEndpoint = endpoints.web3gw ?? endpoints.indexer;
  const granteeAddress = requireEnvironmentVariable(granteeAddressVariable);
  const broadcastTransactions = getBooleanEnvironmentVariable(
    broadcastTransactionsVariable,
    false,
  );
  const confirmationAttempts = requirePositiveInteger(
    confirmationAttemptsVariable,
    getNumberEnvironmentVariable(confirmationAttemptsVariable, 10),
  );
  const confirmationPollIntervalMilliseconds = requirePositiveInteger(
    confirmationPollIntervalVariable,
    getNumberEnvironmentVariable(confirmationPollIntervalVariable, 1000),
  );

  if (!broadcastTransactions) {
    console.log({
      network,
      broadcastTransactions,
      dryRun: true,
      note: `Set ${broadcastTransactionsVariable}=true to request the Web3 Gateway fee grant on testnet.`,
      web3GatewayEndpoint,
      granteeAddress,
      confirmationAttempts,
      confirmationPollIntervalMilliseconds,
    });
    return;
  }

  const web3GatewayApi = new IndexerGrpcWeb3GwApi(web3GatewayEndpoint);
  const feeGrantResponse = normalizeWeb3GatewayFeeGrantResponse(
    await web3GatewayApi.prepareFeeGrantRequest({
      granteeAddress,
    }),
  );
  const allowanceQueryUrl = buildFeeGrantAllowanceQueryUrl({
    restEndpoint: endpoints.rest,
    granterAddress: feeGrantResponse.granterAddress,
    granteeAddress: feeGrantResponse.granteeAddress,
  });
  const confirmation = await waitForFeeGrantConfirmation({
    fetchAllowance: async () => fetchFeeGrantAllowance(allowanceQueryUrl),
    expectedGranterAddress: feeGrantResponse.granterAddress,
    expectedGranteeAddress: feeGrantResponse.granteeAddress,
    attempts: confirmationAttempts,
    pollIntervalMilliseconds: confirmationPollIntervalMilliseconds,
  });

  console.log({
    network,
    broadcastTransactions,
    web3GatewayEndpoint,
    requestedGranteeAddress: granteeAddress,
    feeGrantResponse,
    allowanceQueryUrl,
    confirmation,
    result: "web3 gateway fee grant confirmed",
  });
};

runDirectly(module, run);

