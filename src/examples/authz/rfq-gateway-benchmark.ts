import { randomUUID } from "crypto";
import { dirname } from "path";
import { mkdir, writeFile } from "fs/promises";
import type {
  RFQQuoteType,
  RFQStreamErrorData,
  RFQTakerStreamAckData,
} from "@injectivelabs/sdk-ts";
import type { Network as InjectiveNetwork } from "@injectivelabs/networks";
import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getCsvEnvironmentVariable,
  getEnvironmentVariable,
  getNumberEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

export const defaultBenchmarkIterations = 20;
export const defaultBenchmarkMargin = "50";
export const defaultFeeGrantSpendLimitInj = "0.1";
export const defaultFeeGrantExpirationSeconds = 3600;
export const defaultBenchmarkSlippageBasisPoints = 500;
export const defaultQuotesWaitMilliseconds = 500;
export const defaultClientGatewayGasLimit = 2_500_000;
export const defaultBenchmarkDelayMilliseconds = 750;
export const defaultBenchmarkOutputPath =
  "data/rfq-gateway-benchmark-output.json";
export const defaultBenchmarkMarketId =
  "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515";

const decimalScale = 18;
const basisPointDivisor = 10_000n;
const maxSelectedQuotes = 25;
const defaultMinimumEarlyCloseQuotes = 1;
const defaultMinimumEarlyCloseQuantityRatio = "1";
const broadcastTransactionsVariable = "BROADCAST_TRANSACTIONS";
const feeGrantGranterSeedPhraseVariable = "RFQ_FEE_GRANT_GRANTER_SEED_PHRASE";
const feeGrantGranteeSeedPhraseVariable = "RFQ_FEE_GRANT_GRANTEE_SEED_PHRASE";
const allowedGatewayModes = ["server", "client"] as const;
const allowedDirections = ["long", "short"] as const;
const testnetRfqContractAddress =
  "inj1qw7jk82hjvf79tnjykux6zacuh9gl0z0wl3ruk";
const mainnetRfqContractAddress =
  "inj12stwq95jet57edcu4a65r48r46s9rzrs938n8k";
const devnetRfqContractAddress =
  "inj19g43wyj843ydkc845dcdea6su4mgfjwnpjz6h5";
const testnetRfqWsUrl = "wss://testnet.rfq.ws.injective.network";
const mainnetRfqWsUrl = "wss://rfq.ws.injective.network";
const devnetRfqWsUrl = "wss://devnet.api.injective.dev";
const mainnetRfqEvmChainId = 1776;
const testnetRfqEvmChainId = 1439;
const devnetRfqEvmChainId = 1337;
const mainnetRfqGatewayEndpoint =
  "https://rfq.gateway.grpc-web.injective.network/";
const testnetRfqGatewayEndpoint =
  "https://testnet.rfq.gateway.injective.network/";
const rfqSettlementMessageTypeUrl =
  "/injective.exchange.v2.MsgPrivilegedExecuteContract";
const bankSendMessageTypeUrl = "/cosmos.bank.v1beta1.MsgSend";
const rfqContractAuthzMessageTypeUrls = [
  rfqSettlementMessageTypeUrl,
  bankSendMessageTypeUrl,
] as const;

export type RfqGatewayBenchmarkMode = (typeof allowedGatewayModes)[number];
export type RfqGatewayBenchmarkDirection = (typeof allowedDirections)[number];
export type RfqGatewayBenchmarkStatus = "success" | "failed";

export interface StageTiming {
  readonly name: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

export interface BroadcastTimingEvent {
  readonly name: string;
  readonly atMs: number;
}

export interface RfqGatewayBenchmarkAttempt {
  readonly mode: RfqGatewayBenchmarkMode;
  readonly status: RfqGatewayBenchmarkStatus;
  readonly iteration: number;
  readonly totalDurationMs: number;
  readonly stages: readonly StageTiming[];
  readonly broadcastEvents: readonly BroadcastTimingEvent[];
  readonly details: Record<string, unknown>;
  readonly error?: string;
}

export interface NumericSummary {
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
  readonly count: number;
  readonly average: number;
}

export interface RfqGatewayBenchmarkSummary {
  readonly totalAttempts: number;
  readonly modes: Record<
    RfqGatewayBenchmarkMode,
    {
      readonly failureCount: number;
      readonly successCount: number;
      readonly totalDurationMs: NumericSummary | undefined;
      readonly stages: Record<string, NumericSummary>;
      readonly quoteCount: NumericSummary | undefined;
      readonly selectedQuoteCount: NumericSummary | undefined;
    }
  >;
}

interface RfqGatewayOrderInput {
  readonly margin: string;
  readonly marketId: string;
  readonly quantity: string;
  readonly direction: RfqGatewayBenchmarkDirection;
  readonly worstPrice: string;
  readonly markPrice: string;
  readonly rawQuantity?: string;
  readonly rawWorstPrice?: string;
  readonly priceTickSize?: string;
  readonly quantityTickSize?: string;
  readonly source: string;
  readonly slippageBasisPoints: number;
  readonly ticker?: string;
}

interface RfqGatewayBenchmarkConfig {
  readonly modeOrder: readonly RfqGatewayBenchmarkMode[];
  readonly iterations: number;
  readonly network: InjectiveNetwork;
  readonly chainId: string;
  readonly evmChainId: number | undefined;
  readonly rfqWsUrl: string;
  readonly rfqGatewayEndpoint: string;
  readonly rfqContractAddress: string;
  readonly takerAddress: string;
  readonly autosignAddress: string;
  readonly autosignPrivateKey: string;
  readonly feeGrant: FeeGrantDetails;
  readonly order: RfqGatewayOrderInput;
  readonly quotesWaitMilliseconds: number;
  readonly broadcastTransactions: boolean;
  readonly feePayerPubKey: string | undefined;
  readonly outputPath: string;
  readonly clientSimulateTx: boolean;
  readonly delayBetweenAttemptsMilliseconds: number;
  readonly streamConnectionTimeoutMilliseconds: number;
}

interface StageRecorder {
  readonly stages: StageTiming[];
  measure<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface FeeGrantDetails {
  readonly source: "local-seed" | "skipped";
  readonly granterAddress?: string;
  readonly granterPrivateKey?: string;
}

interface FeeGrantSetupResult {
  readonly source: FeeGrantDetails["source"];
  readonly granterAddress?: string;
  readonly status?: "dry-run" | "skipped" | "broadcasted" | "used-existing";
  readonly spendLimit?: { readonly amount: string; readonly denom: string };
  readonly expirationTimestamp?: number;
  readonly grantResponse?: unknown;
  readonly existingAllowanceError?: string;
}

type ContractAuthzSetupStatus =
  | "dry-run"
  | "skipped"
  | "broadcasted"
  | "used-existing";

interface ContractAuthzGrantSetupResult {
  readonly msgTypeUrl: string;
  readonly status: ContractAuthzSetupStatus;
  readonly grantResponse?: unknown;
  readonly existingAuthzError?: string;
}

interface ContractAuthzSetupResult {
  readonly msgTypeUrl: string;
  readonly msgTypeUrls: readonly string[];
  readonly granterAddress?: string;
  readonly granteeAddress?: string;
  readonly status: ContractAuthzSetupStatus;
  readonly grants: readonly ContractAuthzGrantSetupResult[];
  readonly expirationTimestamp?: number;
}

interface ClientQuoteCollectionResult {
  readonly rfqId: number;
  readonly quotesWaitMs: number;
  readonly quoteCount: number;
  readonly quotes: RFQQuoteType[];
}

interface ClientQuoteSelectionResult {
  readonly expiredQuoteCount: number;
  readonly selectedQuotes: RFQQuoteType[];
}

interface ClientGatewayPreparedOrder {
  readonly authzMessage: unknown;
  readonly rfqId: number;
  readonly quoteCount: number;
  readonly selectedQuoteCount: number;
  readonly expiredQuoteCount: number;
  readonly quotesWaitMs: number;
}

interface ClientBroadcastContext {
  readonly latestHeight: string;
  readonly timeoutHeight: string;
  readonly accountDetails: unknown;
}

export const metadata: ExampleMetadata = {
  id: "authz:rfq-gateway-benchmark",
  category: "authz",
  title: "RFQ gateway benchmark",
  description:
    "Compare client-side and server-side RFQ gateway timing outside the UI.",
  requiresEnvironment: [
    "RFQ_FEE_GRANT_GRANTEE_SEED_PHRASE",
    "RFQ_FEE_GRANT_GRANTER_SEED_PHRASE for client fee-grant broadcasts",
  ],
  mayBroadcast: true,
};

const roundMilliseconds = (value: number): number =>
  Math.round(value * 100) / 100;

const createStageRecorder = (): StageRecorder => {
  const stages: StageTiming[] = [];

  return {
    stages,
    async measure<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const startedAt = performance.now();

      try {
        const result = await callback();
        stages.push({
          name,
          success: true,
          durationMs: roundMilliseconds(performance.now() - startedAt),
        });

        return result;
      } catch (error) {
        stages.push({
          name,
          success: false,
          error: formatError(error),
          durationMs: roundMilliseconds(performance.now() - startedAt),
        });

        throw error;
      }
    },
  };
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const assertAllowedValue = <AllowedValue extends string>(
  name: string,
  value: string,
  allowedValues: readonly AllowedValue[],
): AllowedValue => {
  const matchingValue = allowedValues.find(
    (allowedValue) => allowedValue.toLowerCase() === value.toLowerCase(),
  );

  if (!matchingValue) {
    throw new Error(
      `Invalid ${name}: expected one of ${allowedValues.join(", ")}, got "${value}".`,
    );
  }

  return matchingValue;
};

export const assertPositiveInteger = (name: string, value: number): number => {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  throw new Error(`Invalid ${name}: expected a positive integer, got ${value}.`);
};

export const assertNonNegativeInteger = (
  name: string,
  value: number,
): number => {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(
    `Invalid ${name}: expected a non-negative integer, got ${value}.`,
  );
};

export const calculateBenchmarkTimeoutHeight = ({
  latestHeight,
  txTimeoutInBlocks,
}: {
  readonly latestHeight: string;
  readonly txTimeoutInBlocks: number;
}): string => {
  assertPositiveInteger("txTimeoutInBlocks", txTimeoutInBlocks);

  return (BigInt(latestHeight) + BigInt(txTimeoutInBlocks)).toString();
};

export const parseGatewayBenchmarkModes = (
  values: readonly string[],
): RfqGatewayBenchmarkMode[] => {
  const modes = values.map((value) =>
    assertAllowedValue("RFQ_GATEWAY_BENCHMARK_MODES", value, allowedGatewayModes),
  );
  const uniqueModes = [...new Set(modes)];

  if (uniqueModes.length > 0) {
    return uniqueModes;
  }

  throw new Error("RFQ_GATEWAY_BENCHMARK_MODES must contain at least one mode.");
};

export const parseGatewayDirection = (
  value: string,
): RfqGatewayBenchmarkDirection =>
  assertAllowedValue("RFQ_GATEWAY_BENCHMARK_DIRECTION", value, allowedDirections);

export const getRfqContractAuthzMessageTypeUrls = (): readonly string[] => [
  ...rfqContractAuthzMessageTypeUrls,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getRecordString = (
  value: Record<string, unknown>,
  key: string,
): string | undefined => {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

const getRecordNumber = (
  value: Record<string, unknown>,
  key: string,
): number | undefined => {
  const property = value[key];

  return typeof property === "number" && Number.isFinite(property)
    ? property
    : undefined;
};

const parseDecimalUnits = (name: string, value: string): bigint => {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(-?)(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error(`${name} must be a decimal number.`);
  }

  const [, sign, wholePart, fractionalPart = ""] = match;

  if (fractionalPart.length > decimalScale) {
    throw new Error(`${name} supports at most ${decimalScale} decimal places.`);
  }

  const paddedFractionalPart = fractionalPart.padEnd(decimalScale, "0");
  const units = BigInt(`${wholePart}${paddedFractionalPart}`);

  return sign === "-" ? -units : units;
};

const formatDecimalUnits = (units: bigint): string => {
  const sign = units < 0n ? "-" : "";
  const absoluteUnits = units < 0n ? -units : units;
  const scale = 10n ** BigInt(decimalScale);
  const wholePart = absoluteUnits / scale;
  const fractionalPart = (absoluteUnits % scale)
    .toString()
    .padStart(decimalScale, "0")
    .replace(/0+$/, "");

  if (!fractionalPart) {
    return `${sign}${wholePart.toString()}`;
  }

  return `${sign}${wholePart.toString()}.${fractionalPart}`;
};

const assertPositiveDecimal = (name: string, value: string): string => {
  if (parseDecimalUnits(name, value) > 0n) {
    return value;
  }

  throw new Error(`${name} must be greater than 0.`);
};

export const quantizeDecimalDown = ({
  name,
  value,
  tickSize,
}: {
  readonly name: string;
  readonly value: string;
  readonly tickSize: string;
}): string => {
  const valueUnits = parseDecimalUnits(name, value);
  const tickSizeUnits = parseDecimalUnits(`${name}.tickSize`, tickSize);

  if (tickSizeUnits <= 0n) {
    throw new Error(`${name}.tickSize must be greater than 0.`);
  }

  return formatDecimalUnits((valueUnits / tickSizeUnits) * tickSizeUnits);
};

export const quantizeDecimalUp = ({
  name,
  value,
  tickSize,
}: {
  readonly name: string;
  readonly value: string;
  readonly tickSize: string;
}): string => {
  const valueUnits = parseDecimalUnits(name, value);
  const tickSizeUnits = parseDecimalUnits(`${name}.tickSize`, tickSize);

  if (tickSizeUnits <= 0n) {
    throw new Error(`${name}.tickSize must be greater than 0.`);
  }

  const remainder = valueUnits % tickSizeUnits;

  if (remainder === 0n) {
    return formatDecimalUnits(valueUnits);
  }

  return formatDecimalUnits(valueUnits + tickSizeUnits - remainder);
};

export const scaleDerivativePriceTickSize = ({
  quoteDecimals,
  minPriceTickSize,
}: {
  readonly quoteDecimals: number;
  readonly minPriceTickSize: string;
}): string => {
  assertNonNegativeInteger("quoteDecimals", quoteDecimals);

  return formatDecimalUnits(
    parseDecimalUnits("minPriceTickSize", minPriceTickSize) /
      10n ** BigInt(quoteDecimals),
  );
};

export const calculateOneTimesQuantity = ({
  margin,
  markPrice,
}: {
  readonly margin: string;
  readonly markPrice: string;
}): string => {
  const marginUnits = parseDecimalUnits("margin", margin);
  const markPriceUnits = parseDecimalUnits("markPrice", markPrice);
  const scale = 10n ** BigInt(decimalScale);

  if (marginUnits <= 0n) {
    throw new Error("margin must be greater than 0.");
  }

  if (markPriceUnits <= 0n) {
    throw new Error("markPrice must be greater than 0.");
  }

  return formatDecimalUnits((marginUnits * scale) / markPriceUnits);
};

export const calculateWorstPriceWithSlippage = ({
  direction,
  markPrice,
  slippageBasisPoints,
}: {
  readonly markPrice: string;
  readonly slippageBasisPoints: number;
  readonly direction: RfqGatewayBenchmarkDirection;
}): string => {
  assertNonNegativeInteger("slippageBasisPoints", slippageBasisPoints);

  const markPriceUnits = parseDecimalUnits("markPrice", markPrice);
  const slippageUnits = BigInt(slippageBasisPoints);
  const multiplier =
    direction === "long"
      ? basisPointDivisor + slippageUnits
      : basisPointDivisor - slippageUnits;

  if (markPriceUnits <= 0n) {
    throw new Error("markPrice must be greater than 0.");
  }

  if (multiplier <= 0n) {
    throw new Error("slippageBasisPoints is too large for short direction.");
  }

  return formatDecimalUnits((markPriceUnits * multiplier) / basisPointDivisor);
};

const compareDecimalStrings = (left: string, right: string): number => {
  const leftUnits = parseDecimalUnits("left", left);
  const rightUnits = parseDecimalUnits("right", right);

  if (leftUnits < rightUnits) {
    return -1;
  }

  if (leftUnits > rightUnits) {
    return 1;
  }

  return 0;
};

const removeDecimalTrailingZeros = (value: string): string => {
  if (!value.includes(".")) {
    return value;
  }

  const normalizedValue = value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

  return normalizedValue === "-0" ? "0" : normalizedValue;
};

const getDefaultRfqWsUrl = (network: string): string => {
  const normalizedNetwork = network.toLowerCase();

  if (normalizedNetwork.includes("mainnet")) {
    return mainnetRfqWsUrl;
  }

  if (normalizedNetwork.includes("testnet")) {
    return testnetRfqWsUrl;
  }

  return devnetRfqWsUrl;
};

const getDefaultRfqGatewayEndpoint = ({
  network,
  indexerEndpoint,
}: {
  readonly network: string;
  readonly indexerEndpoint: string;
}): string => {
  const normalizedNetwork = network.toLowerCase();

  if (normalizedNetwork.includes("mainnet")) {
    return mainnetRfqGatewayEndpoint;
  }

  if (normalizedNetwork.includes("testnet")) {
    return testnetRfqGatewayEndpoint;
  }

  return indexerEndpoint;
};

export const getDefaultRfqEvmChainId = ({
  network,
  fallbackEvmChainId,
}: {
  readonly network: string;
  readonly fallbackEvmChainId?: number;
}): number => {
  const normalizedNetwork = network.toLowerCase();

  if (normalizedNetwork.includes("mainnet")) {
    return mainnetRfqEvmChainId;
  }

  if (normalizedNetwork.includes("testnet")) {
    return testnetRfqEvmChainId;
  }

  if (normalizedNetwork.includes("devnet")) {
    return devnetRfqEvmChainId;
  }

  return fallbackEvmChainId ?? testnetRfqEvmChainId;
};

const getDefaultRfqContractAddress = (network: string): string => {
  const normalizedNetwork = network.toLowerCase();

  if (normalizedNetwork.includes("mainnet")) {
    return mainnetRfqContractAddress;
  }

  if (normalizedNetwork.includes("testnet")) {
    return testnetRfqContractAddress;
  }

  return devnetRfqContractAddress;
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const isFeeAllowanceAlreadyExistsError = (error: unknown): boolean =>
  getErrorMessage(error).toLowerCase().includes("fee allowance already exists");

const isAuthzGrantAlreadyExistsError = (error: unknown): boolean =>
  getErrorMessage(error).toLowerCase().includes("already exists");

const getFeeGrantExpirationTimestamp = (): number => {
  const secondsFromNow = assertPositiveInteger(
    "RFQ_FEE_GRANT_EXPIRATION_SECONDS_FROM_NOW",
    getNumberEnvironmentVariable(
      "RFQ_FEE_GRANT_EXPIRATION_SECONDS_FROM_NOW",
      defaultFeeGrantExpirationSeconds,
    ),
  );

  return Math.floor(Date.now() / 1000) + secondsFromNow;
};

const getContractAuthzExpirationTimestamp = (): number => {
  const secondsFromNow = assertPositiveInteger(
    "RFQ_GATEWAY_BENCHMARK_CONTRACT_AUTHZ_EXPIRATION_SECONDS_FROM_NOW",
    getNumberEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_CONTRACT_AUTHZ_EXPIRATION_SECONDS_FROM_NOW",
      defaultFeeGrantExpirationSeconds,
    ),
  );

  return Math.floor(Date.now() / 1000) + secondsFromNow;
};

const hasValidSignature = (signature: string): boolean => {
  const normalizedSignature = signature.startsWith("0x")
    ? signature.slice(2)
    : signature;

  return (
    normalizedSignature.length > 0 &&
    normalizedSignature.length % 2 === 0 &&
    /^[a-f0-9]+$/i.test(normalizedSignature)
  );
};

const getQuoteMinFillQuantityUnits = (quote: RFQQuoteType): bigint => {
  if (!quote.minFillQuantity) {
    return 0n;
  }

  return parseDecimalUnits("quote.minFillQuantity", quote.minFillQuantity);
};

const getQuoteFillQuantityUnits = ({
  quote,
  remainingQuantityUnits,
}: {
  readonly quote: RFQQuoteType;
  readonly remainingQuantityUnits: bigint;
}): bigint => {
  const quoteQuantityUnits = parseDecimalUnits("quote.quantity", quote.quantity);

  return quoteQuantityUnits > remainingQuantityUnits
    ? remainingQuantityUnits
    : quoteQuantityUnits;
};

const isQuoteExpired = ({
  quote,
  nowMs,
}: {
  readonly quote: RFQQuoteType;
  readonly nowMs: number;
}): boolean => {
  if (quote.expiry.timestamp !== undefined && nowMs > quote.expiry.timestamp) {
    return true;
  }

  return false;
};

const hasValidSignMode = ({
  quote,
  evmChainId,
}: {
  readonly quote: RFQQuoteType;
  readonly evmChainId: number | undefined;
}): boolean => {
  if (quote.signMode !== "v1" && quote.signMode !== "v2") {
    return false;
  }

  if (evmChainId === undefined) {
    return true;
  }

  if (quote.signMode === "v2") {
    return quote.evmChainId === evmChainId;
  }

  return quote.evmChainId === 0 || quote.evmChainId === evmChainId;
};

const hasValidMinFillQuantity = (quote: RFQQuoteType): boolean => {
  const minFillQuantityUnits = getQuoteMinFillQuantityUnits(quote);
  const quoteQuantityUnits = parseDecimalUnits("quote.quantity", quote.quantity);

  return minFillQuantityUnits >= 0n && minFillQuantityUnits <= quoteQuantityUnits;
};

const getSignatureFormat = (signature: string): string => {
  const normalizedSignature = signature.startsWith("0x")
    ? signature.slice(2)
    : signature;

  if (
    normalizedSignature.length > 0 &&
    normalizedSignature.length % 2 === 0 &&
    /^[a-f0-9]+$/i.test(normalizedSignature)
  ) {
    return "hex";
  }

  if (
    normalizedSignature.length > 0 &&
    normalizedSignature.length % 4 === 0 &&
    /^[a-z0-9+/]+={0,2}$/i.test(normalizedSignature)
  ) {
    return "base64";
  }

  return "unknown";
};

export const getQuoteInvalidReasons = ({
  quote,
  rfqId,
  order,
  chainId,
  evmChainId,
  takerAddress,
  contractAddress,
}: {
  readonly rfqId: number;
  readonly chainId: string;
  readonly quote: RFQQuoteType;
  readonly takerAddress: string;
  readonly contractAddress: string;
  readonly evmChainId: number | undefined;
  readonly order: RfqGatewayOrderInput;
}): string[] => {
  const reasons: string[] = [];

  if (quote.rfqId !== rfqId) {
    reasons.push("rfqId");
  }

  if (quote.chainId !== chainId) {
    reasons.push("chainId");
  }

  if (quote.marketId !== order.marketId) {
    reasons.push("marketId");
  }

  if (quote.taker !== takerAddress) {
    reasons.push("taker");
  }

  if (quote.takerDirection !== order.direction) {
    reasons.push("direction");
  }

  if (quote.contractAddress !== contractAddress) {
    reasons.push("contractAddress");
  }

  if (!hasValidSignature(quote.signature)) {
    reasons.push("signature");
  }

  if (!hasValidSignMode({ quote, evmChainId })) {
    reasons.push("signMode");
  }

  if (!hasValidMinFillQuantity(quote)) {
    reasons.push("minFillQuantity");
  }

  if (
    !Number.isInteger(quote.makerSubaccountNonce) ||
    quote.makerSubaccountNonce < 0
  ) {
    reasons.push("makerSubaccountNonce");
  }

  return reasons;
};

const isQuoteStructurallyValid = (
  params: Parameters<typeof getQuoteInvalidReasons>[0],
): boolean => getQuoteInvalidReasons(params).length === 0;

const getQuoteDiagnosticSample = (
  quote: RFQQuoteType,
): Record<string, unknown> => ({
  rfqId: quote.rfqId,
  chainId: quote.chainId,
  marketId: quote.marketId,
  taker: quote.taker,
  quantity: quote.quantity,
  signMode: quote.signMode,
  evmChainId: quote.evmChainId,
  takerDirection: quote.takerDirection,
  contractAddress: quote.contractAddress,
  minFillQuantity: quote.minFillQuantity,
  signatureFormat: getSignatureFormat(quote.signature),
  signatureLength: quote.signature.length,
  makerSubaccountNonce: quote.makerSubaccountNonce,
});

const compareQuoteQuantityDescending = (
  leftQuote: RFQQuoteType,
  rightQuote: RFQQuoteType,
): number => -compareDecimalStrings(leftQuote.quantity, rightQuote.quantity);

const sortQuotesByBestPrice = ({
  leftQuote,
  rightQuote,
  direction,
}: {
  readonly leftQuote: RFQQuoteType;
  readonly rightQuote: RFQQuoteType;
  readonly direction: RfqGatewayBenchmarkDirection;
}): number => {
  const priceComparison =
    direction === "long"
      ? compareDecimalStrings(leftQuote.price, rightQuote.price)
      : compareDecimalStrings(rightQuote.price, leftQuote.price);

  if (priceComparison !== 0) {
    return priceComparison;
  }

  return compareQuoteQuantityDescending(leftQuote, rightQuote);
};

const getLeastUsefulSelectedQuoteIndex = ({
  quotes,
  direction,
}: {
  readonly quotes: RFQQuoteType[];
  readonly direction: RfqGatewayBenchmarkDirection;
}): number =>
  quotes.reduce((removalIndex, quote, index) => {
    const removableQuote = quotes[removalIndex];

    if (!removableQuote) {
      return index;
    }

    const quantityComparison = compareDecimalStrings(
      quote.quantity,
      removableQuote.quantity,
    );

    if (quantityComparison < 0) {
      return index;
    }

    if (quantityComparison > 0) {
      return removalIndex;
    }

    return sortQuotesByBestPrice({
      direction,
      leftQuote: quote,
      rightQuote: removableQuote,
    }) > 0
      ? index
      : removalIndex;
  }, 0);

const removeLeastUsefulSelectedQuote = ({
  quotes,
  direction,
}: {
  readonly quotes: RFQQuoteType[];
  readonly direction: RfqGatewayBenchmarkDirection;
}): RFQQuoteType | undefined => {
  if (quotes.length === 0) {
    return undefined;
  }

  const removalIndex = getLeastUsefulSelectedQuoteIndex({ quotes, direction });
  const [removedQuote] = quotes.splice(removalIndex, 1);

  return removedQuote;
};

const selectFillableQuotes = ({
  order,
  quotes,
}: {
  readonly order: RfqGatewayOrderInput;
  readonly quotes: RFQQuoteType[];
}): RFQQuoteType[] => {
  let selectedQuotes: RFQQuoteType[] = [];
  let remainingQuantityUnits = parseDecimalUnits("order.quantity", order.quantity);

  for (const quote of quotes) {
    if (remainingQuantityUnits <= 0n) {
      break;
    }

    const minFillQuantityUnits = getQuoteMinFillQuantityUnits(quote);
    const candidateQuotes = [...selectedQuotes];
    let candidateRemainingQuantityUnits = remainingQuantityUnits;

    while (
      candidateQuotes.length >= maxSelectedQuotes ||
      candidateRemainingQuantityUnits < minFillQuantityUnits
    ) {
      const removedQuote = removeLeastUsefulSelectedQuote({
        quotes: candidateQuotes,
        direction: order.direction,
      });

      if (!removedQuote) {
        break;
      }

      candidateRemainingQuantityUnits += parseDecimalUnits(
        "removedQuote.quantity",
        removedQuote.quantity,
      );
    }

    if (
      candidateQuotes.length >= maxSelectedQuotes ||
      candidateRemainingQuantityUnits < minFillQuantityUnits
    ) {
      continue;
    }

    const fillQuantityUnits = getQuoteFillQuantityUnits({
      quote,
      remainingQuantityUnits: candidateRemainingQuantityUnits,
    });

    if (fillQuantityUnits <= 0n || fillQuantityUnits < minFillQuantityUnits) {
      continue;
    }

    selectedQuotes = candidateQuotes;
    selectedQuotes.push(quote);
    remainingQuantityUnits = candidateRemainingQuantityUnits - fillQuantityUnits;
  }

  return selectedQuotes;
};

const assertSelectedQuotesFillOrder = ({
  order,
  quotes,
}: {
  readonly order: RfqGatewayOrderInput;
  readonly quotes: readonly RFQQuoteType[];
}): void => {
  let remainingQuantityUnits = parseDecimalUnits("order.quantity", order.quantity);

  for (const quote of quotes) {
    if (remainingQuantityUnits <= 0n) {
      return;
    }

    const minFillQuantityUnits = getQuoteMinFillQuantityUnits(quote);
    const fillQuantityUnits = getQuoteFillQuantityUnits({
      quote,
      remainingQuantityUnits,
    });

    if (fillQuantityUnits < minFillQuantityUnits) {
      throw new Error("RFQ client gateway quote is below minimum fill quantity.");
    }

    remainingQuantityUnits -= fillQuantityUnits;
  }

  if (remainingQuantityUnits > 0n) {
    throw new Error("RFQ client gateway quotes could not fill order quantity.");
  }
};

const canSelectedQuotesFillOrder = ({
  order,
  quotes,
}: {
  readonly order: RfqGatewayOrderInput;
  readonly quotes: readonly RFQQuoteType[];
}): boolean => {
  try {
    assertSelectedQuotesFillOrder({ order, quotes });

    return true;
  } catch {
    return false;
  }
};

const shouldCloseQuoteCollectionEarly = ({
  rfqId,
  quotes,
  order,
  chainId,
  evmChainId,
  takerAddress,
  contractAddress,
}: {
  readonly rfqId: number;
  readonly chainId: string;
  readonly quotes: readonly RFQQuoteType[];
  readonly takerAddress: string;
  readonly contractAddress: string;
  readonly evmChainId: number | undefined;
  readonly order: RfqGatewayOrderInput;
}): boolean => {
  const structurallyValidQuotes = quotes.filter((quote) =>
    isQuoteStructurallyValid({
      quote,
      rfqId,
      order,
      chainId,
      evmChainId,
      takerAddress,
      contractAddress,
    }),
  );

  if (structurallyValidQuotes.length < defaultMinimumEarlyCloseQuotes) {
    return false;
  }

  const scaleUnits = 10n ** BigInt(decimalScale);
  const minTotalQuoteQuantity =
    (parseDecimalUnits("order.quantity", order.quantity) *
      parseDecimalUnits(
        "defaultMinimumEarlyCloseQuantityRatio",
        defaultMinimumEarlyCloseQuantityRatio,
      )) /
    scaleUnits;
  const totalQuoteQuantity = structurallyValidQuotes.reduce(
    (total, quote) => total + parseDecimalUnits("quote.quantity", quote.quantity),
    0n,
  );
  const selectedQuotes = selectFillableQuotes({
    order,
    quotes: [...structurallyValidQuotes].sort((leftQuote, rightQuote) =>
      sortQuotesByBestPrice({
        direction: order.direction,
        leftQuote,
        rightQuote,
      }),
    ),
  });

  return (
    totalQuoteQuantity >= minTotalQuoteQuantity &&
    canSelectedQuotesFillOrder({ order, quotes: selectedQuotes })
  );
};

const getClientQuoteSelectionDiagnostics = ({
  rfqId,
  quotes,
  order,
  chainId,
  evmChainId,
  takerAddress,
  contractAddress,
  nowMs = Date.now(),
}: {
  readonly rfqId: number;
  readonly nowMs?: number;
  readonly chainId: string;
  readonly quotes: readonly RFQQuoteType[];
  readonly takerAddress: string;
  readonly contractAddress: string;
  readonly evmChainId: number | undefined;
  readonly order: RfqGatewayOrderInput;
}): Record<string, unknown> => {
  const quotesWithReasons = quotes.map((quote) => ({
    quote,
    reasons: getQuoteInvalidReasons({
      quote,
      rfqId,
      order,
      chainId,
      evmChainId,
      takerAddress,
      contractAddress,
    }),
  }));
  const structurallyValidQuotes = quotesWithReasons
    .filter(({ reasons }) => reasons.length === 0)
    .map(({ quote }) => quote);
  const invalidQuoteReasonCounts = quotesWithReasons.reduce<
    Record<string, number>
  >((counts, { reasons }) => {
    for (const reason of reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }

    return counts;
  }, {});
  const firstInvalidQuote = quotesWithReasons.find(
    ({ reasons }) => reasons.length > 0,
  );
  const nonExpiredQuotes = structurallyValidQuotes.filter(
    (quote) => !isQuoteExpired({ quote, nowMs }),
  );
  const validQuoteQuantity = nonExpiredQuotes.reduce(
    (total, quote) => total + parseDecimalUnits("quote.quantity", quote.quantity),
    0n,
  );

  return {
    validQuoteCount: nonExpiredQuotes.length,
    invalidQuoteCount: quotes.length - structurallyValidQuotes.length,
    expiredQuoteCount: structurallyValidQuotes.length - nonExpiredQuotes.length,
    validQuoteQuantity: formatDecimalUnits(validQuoteQuantity),
    invalidQuoteReasonCounts,
    firstInvalidQuote: firstInvalidQuote
      ? {
          reasons: firstInvalidQuote.reasons,
          quote: getQuoteDiagnosticSample(firstInvalidQuote.quote),
        }
      : undefined,
  };
};

export const selectClientGatewayQuotes = ({
  rfqId,
  quotes,
  order,
  chainId,
  evmChainId,
  takerAddress,
  contractAddress,
  nowMs = Date.now(),
}: {
  readonly rfqId: number;
  readonly nowMs?: number;
  readonly chainId: string;
  readonly quotes: RFQQuoteType[];
  readonly takerAddress: string;
  readonly contractAddress: string;
  readonly evmChainId: number | undefined;
  readonly order: RfqGatewayOrderInput;
}): ClientQuoteSelectionResult => {
  const structurallyValidQuotes = quotes.filter((quote) =>
    isQuoteStructurallyValid({
      quote,
      rfqId,
      order,
      chainId,
      evmChainId,
      takerAddress,
      contractAddress,
    }),
  );
  const nonExpiredQuotes = structurallyValidQuotes.filter(
    (quote) => !isQuoteExpired({ quote, nowMs }),
  );
  const selectedQuotes = selectFillableQuotes({
    order,
    quotes: [...nonExpiredQuotes].sort((leftQuote, rightQuote) =>
      sortQuotesByBestPrice({
        direction: order.direction,
        leftQuote,
        rightQuote,
      }),
    ),
  });

  assertSelectedQuotesFillOrder({ order, quotes: selectedQuotes });

  return {
    selectedQuotes,
    expiredQuoteCount: structurallyValidQuotes.length - nonExpiredQuotes.length,
  };
};

export const summarizeDurations = (
  values: readonly number[],
): NumericSummary | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const total = sortedValues.reduce((sum, value) => sum + value, 0);
  const percentile = (rank: number): number => {
    const index = Math.ceil((rank / 100) * sortedValues.length) - 1;
    const boundedIndex = Math.min(Math.max(index, 0), sortedValues.length - 1);

    return roundMilliseconds(sortedValues[boundedIndex] ?? 0);
  };

  return {
    count: sortedValues.length,
    min: roundMilliseconds(sortedValues[0] ?? 0),
    max: roundMilliseconds(sortedValues[sortedValues.length - 1] ?? 0),
    p50: percentile(50),
    p75: percentile(75),
    p95: percentile(95),
    average: roundMilliseconds(total / sortedValues.length),
  };
};

const summarizeNumberDetails = (
  attempts: readonly RfqGatewayBenchmarkAttempt[],
  key: string,
): NumericSummary | undefined =>
  summarizeDurations(
    attempts
      .map((attempt) => attempt.details[key])
      .filter((value): value is number => typeof value === "number"),
  );

const summarizeStages = (
  attempts: readonly RfqGatewayBenchmarkAttempt[],
): Record<string, NumericSummary> => {
  const durationsByStage = new Map<string, number[]>();

  for (const attempt of attempts) {
    for (const stage of attempt.stages) {
      if (!stage.success) {
        continue;
      }

      durationsByStage.set(stage.name, [
        ...(durationsByStage.get(stage.name) ?? []),
        stage.durationMs,
      ]);
    }
  }

  return Object.fromEntries(
    [...durationsByStage.entries()].flatMap(([stageName, durations]) => {
      const summary = summarizeDurations(durations);

      return summary === undefined ? [] : [[stageName, summary]];
    }),
  );
};

export const summarizeBenchmarkResults = (
  attempts: readonly RfqGatewayBenchmarkAttempt[],
): RfqGatewayBenchmarkSummary => {
  const summarizeMode = (mode: RfqGatewayBenchmarkMode) => {
    const modeAttempts = attempts.filter((attempt) => attempt.mode === mode);
    const successfulAttempts = modeAttempts.filter(
      (attempt) => attempt.status === "success",
    );

    return {
      failureCount: modeAttempts.length - successfulAttempts.length,
      successCount: successfulAttempts.length,
      totalDurationMs: summarizeDurations(
        successfulAttempts.map((attempt) => attempt.totalDurationMs),
      ),
      stages: summarizeStages(successfulAttempts),
      quoteCount: summarizeNumberDetails(successfulAttempts, "quoteCount"),
      selectedQuoteCount: summarizeNumberDetails(
        successfulAttempts,
        "selectedQuoteCount",
      ),
    };
  };

  return {
    totalAttempts: attempts.length,
    modes: {
      client: summarizeMode("client"),
      server: summarizeMode("server"),
    },
  };
};

const getEventTime = (
  events: readonly BroadcastTimingEvent[],
  name: string,
): number | undefined => events.find((event) => event.name === name)?.atMs;

const addEventDurationStage = ({
  name,
  stages,
  events,
  endEvent,
  startEvent,
  success = true,
}: {
  readonly name: string;
  readonly success?: boolean;
  readonly endEvent: string;
  readonly startEvent: string;
  readonly stages: StageTiming[];
  readonly events: readonly BroadcastTimingEvent[];
}): void => {
  const startedAt = getEventTime(events, startEvent);
  const endedAt = getEventTime(events, endEvent);

  if (startedAt === undefined || endedAt === undefined || endedAt < startedAt) {
    return;
  }

  stages.push({
    name,
    success,
    durationMs: roundMilliseconds(endedAt - startedAt),
  });
};

const appendBroadcastEventStages = ({
  stages,
  events,
}: {
  readonly stages: StageTiming[];
  readonly events: readonly BroadcastTimingEvent[];
}): void => {
  addEventDurationStage({
    events,
    stages,
    name: "broadcast-preparation",
    startEvent: "transaction-preparation-start",
    endEvent: "transaction-preparation-end",
  });
  addEventDurationStage({
    events,
    stages,
    name: "broadcast-signing-gap",
    startEvent: "transaction-preparation-end",
    endEvent: "transaction-broadcast-start",
  });
  addEventDurationStage({
    events,
    stages,
    name: "broadcast-submit-to-synced",
    startEvent: "transaction-broadcast-start",
    endEvent: "transaction-broadcast-synced",
  });
  addEventDurationStage({
    events,
    stages,
    name: "broadcast-synced-to-included",
    startEvent: "transaction-broadcast-synced",
    endEvent: "transaction-broadcast-end",
  });
  addEventDurationStage({
    events,
    stages,
    name: "broadcast-start-to-included",
    startEvent: "transaction-broadcast-start",
    endEvent: "transaction-broadcast-end",
  });
  addEventDurationStage({
    events,
    stages,
    name: "broadcast-start-to-failure",
    success: false,
    startEvent: "transaction-broadcast-start",
    endEvent: "transaction-fail",
  });
};

const createBroadcastEventRecorder = ({
  eventTypes,
  walletStrategy,
}: {
  readonly walletStrategy: {
    on: (event: any, listener: () => void) => unknown;
    off: (event: any, listener: () => void) => unknown;
  };
  readonly eventTypes: Record<string, string>;
}): {
  readonly events: BroadcastTimingEvent[];
  dispose(): void;
} => {
  const startedAt = performance.now();
  const events: BroadcastTimingEvent[] = [];
  const eventNames = [
    eventTypes.TransactionFail,
    eventTypes.TransactionPreparationEnd,
    eventTypes.TransactionBroadcastEnd,
    eventTypes.TransactionBroadcastStart,
    eventTypes.TransactionBroadcastSynced,
    eventTypes.TransactionPreparationStart,
  ].filter((eventName): eventName is string => typeof eventName === "string");
  const listeners = eventNames.map((eventName) => {
    const listener = () => {
      events.push({
        name: eventName,
        atMs: roundMilliseconds(performance.now() - startedAt),
      });
    };

    walletStrategy.on(eventName, listener);

    return { eventName, listener };
  });

  return {
    events,
    dispose() {
      for (const { eventName, listener } of listeners) {
        walletStrategy.off(eventName, listener);
      }
    },
  };
};

const normalizePrivateKey = (privateKey: string): string =>
  privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;

const base64ToHex = (base64: string): string =>
  Buffer.from(base64, "base64").toString("hex");

interface BenchmarkPrivateKey {
  toBech32(): string;
  toPrivateKeyHex(): string;
  toPublicKey(): { toBase64(): string };
}

interface BenchmarkPrivateKeyFactory {
  fromMnemonic(seedPhrase: string): BenchmarkPrivateKey;
}

const getSeedPhrasePrivateKey = ({
  name,
  PrivateKey,
}: {
  readonly name: string;
  readonly PrivateKey: BenchmarkPrivateKeyFactory;
}): BenchmarkPrivateKey => {
  const seedPhrase = getEnvironmentVariable(name);

  if (!seedPhrase) {
    throw new Error(`Set ${name} in .env.`);
  }

  return PrivateKey.fromMnemonic(seedPhrase);
};

const getOptionalFeeGrant = (
  PrivateKey: BenchmarkPrivateKeyFactory,
): FeeGrantDetails => {
  const seedPhrase = getEnvironmentVariable(feeGrantGranterSeedPhraseVariable);

  if (!seedPhrase) {
    return { source: "skipped" };
  }

  const granterPrivateKey = PrivateKey.fromMnemonic(seedPhrase);

  return {
    source: "local-seed",
    granterAddress: granterPrivateKey.toBech32(),
    granterPrivateKey: normalizePrivateKey(granterPrivateKey.toPrivateKeyHex()),
  };
};

const parseFiniteNumber = (name: string, value: string): number => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return parsedValue;
};

const formatFiniteDecimal = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new Error("Cannot format a non-finite decimal number.");
  }

  return (Object.is(value, -0) ? 0 : value)
    .toFixed(decimalScale)
    .replace(/\.?0+$/, "");
};

const getRecordDecimalString = (
  value: Record<string, unknown>,
  key: string,
): string | undefined => {
  const property = value[key];

  if (typeof property === "number" && Number.isFinite(property)) {
    return formatFiniteDecimal(property);
  }

  return typeof property === "string" ? property : undefined;
};

const scaleOraclePriceToQuoteDecimals = ({
  price,
  quoteDecimals,
  oracleScaleFactor,
}: {
  readonly price: string;
  readonly oracleScaleFactor: number;
  readonly quoteDecimals: number | undefined;
}): string => {
  const numericPrice = parseFiniteNumber("oraclePrice", price);

  if (numericPrice === 0 || quoteDecimals === undefined) {
    return formatFiniteDecimal(numericPrice);
  }

  if (quoteDecimals === oracleScaleFactor) {
    return formatFiniteDecimal(numericPrice);
  }

  return formatFiniteDecimal(
    numericPrice * 10 ** (oracleScaleFactor - quoteDecimals),
  );
};

const getBenchmarkMargin = (): string => {
  const explicitMargin = getEnvironmentVariable("RFQ_GATEWAY_BENCHMARK_MARGIN");

  if (explicitMargin !== undefined) {
    return assertPositiveDecimal("RFQ_GATEWAY_BENCHMARK_MARGIN", explicitMargin);
  }

  if (
    getBooleanEnvironmentVariable("RFQ_GATEWAY_BENCHMARK_RANDOM_MARGIN", false)
  ) {
    return formatFiniteDecimal(50 + Math.random() * 50);
  }

  return defaultBenchmarkMargin;
};

const getMarketOracleDetails = (
  market: unknown,
): {
  readonly ticker?: string;
  readonly oracleType: string;
  readonly oracleBase: string;
  readonly oracleQuote: string;
  readonly oracleScaleFactor: number;
  readonly minPriceTickSize: string;
  readonly minQuantityTickSize: string;
  readonly quoteDecimals: number;
} => {
  if (!isRecord(market)) {
    throw new Error("Market response was not an object.");
  }

  const oracleType = getRecordString(market, "oracleType");
  const oracleBase = getRecordString(market, "oracleBase");
  const oracleQuote = getRecordString(market, "oracleQuote");
  const oracleScaleFactor = getRecordNumber(market, "oracleScaleFactor");
  const minPriceTickSize = getRecordDecimalString(market, "minPriceTickSize");
  const minQuantityTickSize = getRecordDecimalString(
    market,
    "minQuantityTickSize",
  );
  const quoteToken = market.quoteToken;
  const quoteDecimals = isRecord(quoteToken)
    ? getRecordNumber(quoteToken, "decimals")
    : undefined;

  if (
    oracleType === undefined ||
    oracleBase === undefined ||
    oracleQuote === undefined ||
    quoteDecimals === undefined ||
    minPriceTickSize === undefined ||
    minQuantityTickSize === undefined ||
    oracleScaleFactor === undefined
  ) {
    throw new Error(
      "Selected market does not expose oracle fields and tick sizes required for benchmark order derivation.",
    );
  }

  return {
    oracleType,
    oracleBase,
    oracleQuote,
    quoteDecimals,
    minPriceTickSize,
    oracleScaleFactor,
    minQuantityTickSize,
    ticker: getRecordString(market, "ticker"),
  };
};

const fetchBenchmarkMarkPrice = async ({
  market,
  oracleApi,
}: {
  readonly market: unknown;
  readonly oracleApi: {
    fetchOraclePrice(params: {
      baseSymbol: string;
      quoteSymbol: string;
      oracleType: string;
      oracleScaleFactor?: number;
    }): Promise<unknown>;
  };
}): Promise<{ readonly price: string; readonly source: string }> => {
  const {
    oracleType,
    oracleBase,
    oracleQuote,
    quoteDecimals,
    oracleScaleFactor,
  } = getMarketOracleDetails(market);
  const oraclePriceResponse = await oracleApi.fetchOraclePrice({
    oracleType,
    baseSymbol: oracleBase,
    quoteSymbol: oracleQuote,
  });

  if (!isRecord(oraclePriceResponse)) {
    throw new Error("Oracle price response was not an object.");
  }

  const rawPrice = getRecordString(oraclePriceResponse, "price");

  if (rawPrice === undefined) {
    throw new Error("Oracle price response did not include price.");
  }

  return {
    price: scaleOraclePriceToQuoteDecimals({
      price: rawPrice,
      quoteDecimals,
      oracleScaleFactor,
    }),
    source: `indexer-oracle:${oracleType}:${oracleBase}/${oracleQuote}`,
  };
};

const resolveBenchmarkOrder = async ({
  direction,
  derivativesApi,
  oracleApi,
}: {
  readonly direction: RfqGatewayBenchmarkDirection;
  readonly derivativesApi: { fetchMarket(marketId: string): Promise<unknown> };
  readonly oracleApi: {
    fetchOraclePrice(params: {
      baseSymbol: string;
      quoteSymbol: string;
      oracleType: string;
      oracleScaleFactor?: number;
    }): Promise<unknown>;
  };
}): Promise<RfqGatewayOrderInput> => {
  const marketId = getEnvironmentVariable(
    "RFQ_GATEWAY_BENCHMARK_MARKET_ID",
    defaultBenchmarkMarketId,
  );
  const market = await derivativesApi.fetchMarket(marketId);
  const marketDetails = getMarketOracleDetails(market);
  const markPrice = await fetchBenchmarkMarkPrice({ market, oracleApi });
  const margin = getBenchmarkMargin();
  const slippageBasisPoints = assertNonNegativeInteger(
    "RFQ_GATEWAY_BENCHMARK_SLIPPAGE_BPS",
    getNumberEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_SLIPPAGE_BPS",
      defaultBenchmarkSlippageBasisPoints,
    ),
  );
  const quantityOverride = getEnvironmentVariable(
    "RFQ_GATEWAY_BENCHMARK_QUANTITY",
  );
  const worstPriceOverride = getEnvironmentVariable(
    "RFQ_GATEWAY_BENCHMARK_WORST_PRICE",
  );
  const priceTickSize = scaleDerivativePriceTickSize({
    quoteDecimals: marketDetails.quoteDecimals,
    minPriceTickSize: marketDetails.minPriceTickSize,
  });
  const quantityTickSize = marketDetails.minQuantityTickSize;
  const rawQuantity =
    quantityOverride ??
    calculateOneTimesQuantity({
      margin,
      markPrice: markPrice.price,
    });
  const rawWorstPrice =
    worstPriceOverride ??
    calculateWorstPriceWithSlippage({
      direction,
      slippageBasisPoints,
      markPrice: markPrice.price,
    });
  const quantity =
    quantityOverride ??
    quantizeDecimalDown({
      name: "RFQ_GATEWAY_BENCHMARK_QUANTITY",
      tickSize: quantityTickSize,
      value: rawQuantity,
    });
  const worstPrice =
    worstPriceOverride ??
    (direction === "long"
      ? quantizeDecimalDown({
          name: "RFQ_GATEWAY_BENCHMARK_WORST_PRICE",
          tickSize: priceTickSize,
          value: rawWorstPrice,
        })
      : quantizeDecimalUp({
          name: "RFQ_GATEWAY_BENCHMARK_WORST_PRICE",
          tickSize: priceTickSize,
          value: rawWorstPrice,
        }));

  return {
    margin,
    marketId,
    quantity: assertPositiveDecimal("RFQ_GATEWAY_BENCHMARK_QUANTITY", quantity),
    direction,
    markPrice: markPrice.price,
    priceTickSize,
    quantityTickSize,
    rawQuantity,
    rawWorstPrice,
    worstPrice: assertPositiveDecimal(
      "RFQ_GATEWAY_BENCHMARK_WORST_PRICE",
      worstPrice,
    ),
    source: markPrice.source,
    slippageBasisPoints,
    ticker: marketDetails.ticker,
  };
};

const loadBenchmarkConfig = async ({
  PrivateKey,
  network,
  networkInfo,
  oracleApi,
  indexerEndpoint,
  derivativesApi,
}: {
  readonly PrivateKey: {
    fromMnemonic(seedPhrase: string): BenchmarkPrivateKey;
  };
  readonly network: InjectiveNetwork;
  readonly networkInfo: {
    readonly chainId: string;
    readonly evmChainId?: number;
  };
  readonly indexerEndpoint: string;
  readonly derivativesApi: { fetchMarket(marketId: string): Promise<unknown> };
  readonly oracleApi: {
    fetchOraclePrice(params: {
      baseSymbol: string;
      quoteSymbol: string;
      oracleType: string;
      oracleScaleFactor?: number;
    }): Promise<unknown>;
  };
}): Promise<RfqGatewayBenchmarkConfig> => {
  const autosign = getSeedPhrasePrivateKey({
    PrivateKey,
    name: feeGrantGranteeSeedPhraseVariable,
  });
  const autosignAddress = autosign.toBech32();
  const autosignPrivateKey = normalizePrivateKey(autosign.toPrivateKeyHex());
  const direction = parseGatewayDirection(
    getEnvironmentVariable("RFQ_GATEWAY_BENCHMARK_DIRECTION", "long"),
  );
  const outputPath = getEnvironmentVariable(
    "RFQ_GATEWAY_BENCHMARK_OUTPUT_PATH",
    defaultBenchmarkOutputPath,
  );

  return {
    network,
    outputPath,
    autosignAddress,
    autosignPrivateKey,
    feeGrant: getOptionalFeeGrant(PrivateKey),
    chainId: networkInfo.chainId,
    evmChainId: assertPositiveInteger(
      "RFQ_GATEWAY_BENCHMARK_EVM_CHAIN_ID",
      getNumberEnvironmentVariable(
        "RFQ_GATEWAY_BENCHMARK_EVM_CHAIN_ID",
        getDefaultRfqEvmChainId({
          network,
          fallbackEvmChainId: networkInfo.evmChainId,
        }),
      ),
    ),
    takerAddress: getEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_TAKER_ADDRESS",
      autosignAddress,
    ),
    modeOrder: parseGatewayBenchmarkModes(
      getCsvEnvironmentVariable("RFQ_GATEWAY_BENCHMARK_MODES", [
        "server",
        "client",
      ]),
    ),
    iterations: assertPositiveInteger(
      "RFQ_GATEWAY_BENCHMARK_ITERATIONS",
      getNumberEnvironmentVariable(
        "RFQ_GATEWAY_BENCHMARK_ITERATIONS",
        defaultBenchmarkIterations,
      ),
    ),
    rfqWsUrl: getEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_RFQ_WS_URL",
      getDefaultRfqWsUrl(network),
    ),
    rfqGatewayEndpoint: getEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_RFQ_GATEWAY_ENDPOINT",
      getDefaultRfqGatewayEndpoint({
        network,
        indexerEndpoint,
      }),
    ),
    rfqContractAddress: getEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_RFQ_CONTRACT_ADDRESS",
      getDefaultRfqContractAddress(network),
    ),
    quotesWaitMilliseconds: assertPositiveInteger(
      "RFQ_GATEWAY_BENCHMARK_QUOTES_WAIT_MS",
      getNumberEnvironmentVariable(
        "RFQ_GATEWAY_BENCHMARK_QUOTES_WAIT_MS",
        defaultQuotesWaitMilliseconds,
      ),
    ),
    broadcastTransactions: getBooleanEnvironmentVariable(
      broadcastTransactionsVariable,
      false,
    ),
    clientSimulateTx: getBooleanEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_CLIENT_SIMULATE_TX",
      true,
    ),
    feePayerPubKey: getEnvironmentVariable(
      "RFQ_GATEWAY_BENCHMARK_FEE_PAYER_PUB_KEY",
    ),
    delayBetweenAttemptsMilliseconds: assertNonNegativeInteger(
      "RFQ_GATEWAY_BENCHMARK_DELAY_MS",
      getNumberEnvironmentVariable(
        "RFQ_GATEWAY_BENCHMARK_DELAY_MS",
        defaultBenchmarkDelayMilliseconds,
      ),
    ),
    streamConnectionTimeoutMilliseconds: assertPositiveInteger(
      "RFQ_GATEWAY_BENCHMARK_STREAM_CONNECT_TIMEOUT_MS",
      getNumberEnvironmentVariable(
        "RFQ_GATEWAY_BENCHMARK_STREAM_CONNECT_TIMEOUT_MS",
        10_000,
      ),
    ),
    order: await resolveBenchmarkOrder({
      direction,
      oracleApi,
      derivativesApi,
    }),
  };
};

const buildRedactedConfig = (
  config: RfqGatewayBenchmarkConfig,
): Record<string, unknown> => ({
  network: config.network,
  chainId: config.chainId,
  evmChainId: config.evmChainId,
  modeOrder: config.modeOrder,
  iterations: config.iterations,
  rfqWsUrl: config.rfqWsUrl,
  rfqGatewayEndpoint: config.rfqGatewayEndpoint,
  rfqContractAddress: config.rfqContractAddress,
  takerAddress: config.takerAddress,
  autosignAddress: config.autosignAddress,
  quotesWaitMilliseconds: config.quotesWaitMilliseconds,
  broadcastTransactions: config.broadcastTransactions,
  clientSimulateTx: config.clientSimulateTx,
  feeGrant: {
    source: config.feeGrant.source,
    granterAddress: config.feeGrant.granterAddress,
  },
  outputPath: config.outputPath,
  delayBetweenAttemptsMilliseconds: config.delayBetweenAttemptsMilliseconds,
  order: config.order,
});

const createWalletStrategy = async ({
  Wallet,
  chainId,
  network,
  evmChainId,
  privateKey,
  WalletStrategy,
}: {
  readonly chainId: string;
  readonly network: InjectiveNetwork;
  readonly evmChainId?: number;
  readonly privateKey: string;
  readonly Wallet: Record<string, string>;
  readonly WalletStrategy: any;
}): Promise<unknown> => {
  const wallet = Wallet.PrivateKeyCosmos ?? Wallet.PrivateKey;
  const walletStrategy = new WalletStrategy({
    wallet,
    chainId,
    network,
    metadata: { privateKey: { privateKey } },
    evmOptions: evmChainId === undefined ? undefined : { evmChainId },
  });

  await walletStrategy.setWallet(wallet);
  await walletStrategy.setMetadata({ privateKey: { privateKey } });

  return walletStrategy;
};

const resolveClientFeeGrant = async ({
  config,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
}): Promise<FeeGrantDetails> => config.feeGrant;

const setupBenchmarkFeeGrant = async ({
  config,
  dependencies,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly dependencies: {
    readonly INJ_DENOM: string;
    readonly endpoints: Record<string, unknown>;
    readonly BigNumberInBase: new (value: string) => {
      toWei(): { toFixed(): string };
    };
    readonly MsgGrantAllowance: any;
    readonly MsgBroadcasterWithPk: any;
  };
}): Promise<FeeGrantSetupResult> => {
  if (!config.modeOrder.includes("client")) {
    return {
      status: "skipped",
      source: config.feeGrant.source,
    };
  }

  if (!config.feeGrant.granterAddress || !config.feeGrant.granterPrivateKey) {
    if (config.broadcastTransactions) {
      throw new Error(
        `Client broadcast mode requires ${feeGrantGranterSeedPhraseVariable}.`,
      );
    }

    return {
      status: "skipped",
      source: "skipped",
    };
  }

  const expirationTimestamp = getFeeGrantExpirationTimestamp();
  const spendLimit = {
    denom: dependencies.INJ_DENOM,
    amount: new dependencies.BigNumberInBase(
      getEnvironmentVariable(
        "RFQ_FEE_GRANT_SPEND_LIMIT_INJ",
        defaultFeeGrantSpendLimitInj,
      ),
    )
      .toWei()
      .toFixed(),
  };

  if (!config.broadcastTransactions) {
    return {
      spendLimit,
      status: "dry-run",
      expirationTimestamp,
      source: "local-seed",
      granterAddress: config.feeGrant.granterAddress,
    };
  }

  const grantAllowanceMessage = dependencies.MsgGrantAllowance.fromJSON({
    granter: config.feeGrant.granterAddress,
    grantee: config.autosignAddress,
    allowance: {
      spendLimit: [spendLimit],
      expiration: expirationTimestamp,
    },
  });
  const granterBroadcaster = new dependencies.MsgBroadcasterWithPk({
    network: config.network,
    endpoints: dependencies.endpoints,
    privateKey: config.feeGrant.granterPrivateKey,
    simulateTx: true,
  });

  try {
    const grantResponse = await granterBroadcaster.broadcast({
      msgs: grantAllowanceMessage,
      memo: "rfq-gateway-benchmark: grant fee allowance",
    });

    return {
      spendLimit,
      grantResponse,
      status: "broadcasted",
      expirationTimestamp,
      source: "local-seed",
      granterAddress: config.feeGrant.granterAddress,
    };
  } catch (error) {
    if (!isFeeAllowanceAlreadyExistsError(error)) {
      throw error;
    }

    return {
      spendLimit,
      status: "used-existing",
      expirationTimestamp,
      source: "local-seed",
      granterAddress: config.feeGrant.granterAddress,
      existingAllowanceError: getErrorMessage(error),
    };
  }
};

const getContractAuthzSetupStatus = (
  grants: readonly ContractAuthzGrantSetupResult[],
): ContractAuthzSetupStatus => {
  if (grants.some((grant) => grant.status === "broadcasted")) {
    return "broadcasted";
  }

  if (grants.every((grant) => grant.status === "used-existing")) {
    return "used-existing";
  }

  if (grants.every((grant) => grant.status === "dry-run")) {
    return "dry-run";
  }

  return grants[0]?.status ?? "skipped";
};

const setupBenchmarkContractAuthz = async ({
  config,
  dependencies,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly dependencies: {
    readonly endpoints: Record<string, unknown>;
    readonly MsgGrant: any;
    readonly MsgBroadcasterWithPk: any;
  };
}): Promise<ContractAuthzSetupResult> => {
  const expirationTimestamp = getContractAuthzExpirationTimestamp();
  const messageTypeUrls = getRfqContractAuthzMessageTypeUrls();
  const resultBase = {
    expirationTimestamp,
    msgTypeUrl: rfqSettlementMessageTypeUrl,
    msgTypeUrls: messageTypeUrls,
    granteeAddress: config.rfqContractAddress,
    granterAddress: config.takerAddress,
  };

  if (!config.broadcastTransactions) {
    return {
      ...resultBase,
      status: "dry-run",
      grants: messageTypeUrls.map(
        (msgTypeUrl): ContractAuthzGrantSetupResult => ({
          msgTypeUrl,
          status: "dry-run",
        }),
      ),
    };
  }

  if (config.takerAddress !== config.autosignAddress) {
    throw new Error(
      "RFQ contract authz setup requires RFQ_GATEWAY_BENCHMARK_TAKER_ADDRESS to match RFQ_FEE_GRANT_GRANTEE_SEED_PHRASE.",
    );
  }

  const broadcaster = new dependencies.MsgBroadcasterWithPk({
    network: config.network,
    endpoints: dependencies.endpoints,
    privateKey: config.autosignPrivateKey,
    simulateTx: true,
  });
  const grants: ContractAuthzGrantSetupResult[] = [];

  for (const msgTypeUrl of messageTypeUrls) {
    const grantMessage = dependencies.MsgGrant.fromJSON({
      expiration: expirationTimestamp,
      granter: config.takerAddress,
      grantee: config.rfqContractAddress,
      messageType: msgTypeUrl,
    });

    try {
      const grantResponse = await broadcaster.broadcast({
        msgs: grantMessage,
        memo: `rfq-gateway-benchmark: grant RFQ contract authz ${msgTypeUrl}`,
        gas: config.feeGrant.granterAddress
          ? { granter: config.feeGrant.granterAddress }
          : undefined,
      });

      grants.push({
        msgTypeUrl,
        grantResponse,
        status: "broadcasted",
      });
    } catch (error) {
      if (!isAuthzGrantAlreadyExistsError(error)) {
        throw error;
      }

      grants.push({
        msgTypeUrl,
        status: "used-existing",
        existingAuthzError: getErrorMessage(error),
      });
    }
  }

  return {
    ...resultBase,
    grants,
    status: getContractAuthzSetupStatus(grants),
  };
};

const collectClientQuotes = async ({
  config,
  recorder,
  IndexerWsTakerStream,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly recorder: StageRecorder;
  readonly IndexerWsTakerStream: new (config: {
    url: string;
    requestAddress: string;
    connectionTimeoutMs?: number;
  }) => {
    connect(): Promise<void>;
    destroy(): void;
    sendRequest(request: {
      expiry: number;
      margin: string;
      clientId: string;
      marketId: string;
      quantity: string;
      direction: string;
      priceCheck: boolean;
      worstPrice: string;
    }): void;
    on(event: "quote", listener: (data: { quote: RFQQuoteType }) => void): void;
    on(event: "error", listener: (data: RFQStreamErrorData) => void): void;
    on(event: "request_ack", listener: (data: RFQTakerStreamAckData) => void): void;
  };
}): Promise<ClientQuoteCollectionResult> => {
  const clientId = randomUUID();
  const quotes: RFQQuoteType[] = [];
  const stream = new IndexerWsTakerStream({
    url: config.rfqWsUrl,
    requestAddress: config.takerAddress,
    connectionTimeoutMs: config.streamConnectionTimeoutMilliseconds,
  });
  let activeRfqId: number | undefined;
  let collectionStartedAt = 0;
  let collectionDeadlineMs = 0;
  let lastQuoteReceivedAt: number | undefined;
  let closeQuoteCollection: (() => void) | undefined;
  let rejectAcknowledgement: ((error: Error) => void) | undefined;

  const maybeCloseQuoteCollectionEarly = () => {
    if (
      activeRfqId === undefined ||
      collectionDeadlineMs === 0 ||
      closeQuoteCollection === undefined
    ) {
      return;
    }

    if (
      shouldCloseQuoteCollectionEarly({
        quotes,
        order: config.order,
        rfqId: activeRfqId,
        chainId: config.chainId,
        evmChainId: config.evmChainId,
        takerAddress: config.takerAddress,
        contractAddress: config.rfqContractAddress,
      })
    ) {
      closeQuoteCollection();
    }
  };

  stream.on("quote", ({ quote }) => {
    if (
      activeRfqId === undefined ||
      quote.rfqId !== activeRfqId ||
      quote.taker !== config.takerAddress
    ) {
      return;
    }

    quotes.push(quote);
    lastQuoteReceivedAt = Date.now();
    maybeCloseQuoteCollectionEarly();
  });
  stream.on("error", (streamError) => {
    rejectAcknowledgement?.(
      new Error(`RFQ stream error ${streamError.code}: ${streamError.message}`),
    );
  });

  try {
    await recorder.measure("client-stream-connect", () => stream.connect());

    const acknowledgement = await recorder.measure(
      "client-firm-request-ack",
      () =>
        new Promise<RFQTakerStreamAckData>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(
              new Error(
                `RFQ taker request was not acknowledged within ${config.quotesWaitMilliseconds} ms.`,
              ),
            );
          }, config.quotesWaitMilliseconds + 5000);

          rejectAcknowledgement = (error) => {
            clearTimeout(timeoutId);
            reject(error);
          };

          stream.on("request_ack", (acknowledgementData) => {
            if (acknowledgementData.clientId !== clientId) {
              return;
            }

            clearTimeout(timeoutId);
            resolve(acknowledgementData);
          });

          stream.sendRequest({
            clientId,
            expiry: 0,
            priceCheck: false,
            marketId: config.order.marketId,
            direction: config.order.direction,
            margin: removeDecimalTrailingZeros(config.order.margin),
            quantity: removeDecimalTrailingZeros(config.order.quantity),
            worstPrice: removeDecimalTrailingZeros(config.order.worstPrice),
          });
        }),
    );

    activeRfqId = acknowledgement.rfqId;
    collectionStartedAt = Date.now();
    collectionDeadlineMs = collectionStartedAt + config.quotesWaitMilliseconds;

    await recorder.measure(
      "client-quote-collection",
      () =>
        new Promise<void>((resolve) => {
          const timeoutId = setTimeout(resolve, config.quotesWaitMilliseconds);

          closeQuoteCollection = () => {
            clearTimeout(timeoutId);
            resolve();
          };

          maybeCloseQuoteCollectionEarly();
        }),
    );

    return {
      quotes,
      quoteCount: quotes.length,
      rfqId: acknowledgement.rfqId,
      quotesWaitMs:
        lastQuoteReceivedAt !== undefined &&
        lastQuoteReceivedAt >= collectionStartedAt
          ? lastQuoteReceivedAt - collectionStartedAt
          : Date.now() - collectionStartedAt,
    };
  } finally {
    stream.destroy();
  }
};

export const buildClientAcceptQuotePayload = ({
  cid,
  rfqId,
  order,
  selectedQuotes,
  hexToBase64,
}: {
  readonly cid: string;
  readonly rfqId: number;
  readonly order: RfqGatewayOrderInput;
  readonly selectedQuotes: readonly RFQQuoteType[];
  readonly hexToBase64: (hex: string) => string;
}) => ({
  accept_quote: {
    cid,
    rfq_id: rfqId,
    margin: order.margin,
    quantity: order.quantity,
    market_id: order.marketId,
    direction: order.direction,
    worst_price: removeDecimalTrailingZeros(order.worstPrice),
    quotes: selectedQuotes.map((quote) => ({
      maker: quote.maker,
      price: quote.price,
      margin: quote.margin,
      quantity: quote.quantity,
      signature: hexToBase64(quote.signature),
      sign_mode:
        quote.signMode === "v1" || quote.signMode === "v2"
          ? quote.signMode
          : "auto",
      ...(quote.signMode === "v2" || quote.evmChainId > 0
        ? { evm_chain_id: quote.evmChainId }
        : {}),
      ...(quote.makerSubaccountNonce > 0
        ? { nonce: quote.makerSubaccountNonce }
        : {}),
      ...(quote.minFillQuantity
        ? { min_fill_quantity: quote.minFillQuantity }
        : {}),
      expiry: {
        h: quote.expiry.height,
        ts: quote.expiry.timestamp,
      },
    })),
  },
});

const prepareClientGatewayOrder = async ({
  config,
  details,
  recorder,
  dependencies,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly details: Record<string, unknown>;
  readonly recorder: StageRecorder;
  readonly dependencies: {
    readonly hexToBase64: (hex: string) => string;
    readonly IndexerWsTakerStream: any;
    readonly MsgAuthzExec: any;
    readonly MsgExecuteContractCompat: any;
  };
}): Promise<ClientGatewayPreparedOrder> => {
  const collection = await collectClientQuotes({
    config,
    recorder,
    IndexerWsTakerStream: dependencies.IndexerWsTakerStream,
  });
  Object.assign(details, {
    rfqId: collection.rfqId,
    quoteCount: collection.quoteCount,
    quotesWaitMs: collection.quotesWaitMs,
    ...getClientQuoteSelectionDiagnostics({
      quotes: collection.quotes,
      rfqId: collection.rfqId,
      order: config.order,
      chainId: config.chainId,
      evmChainId: config.evmChainId,
      takerAddress: config.takerAddress,
      contractAddress: config.rfqContractAddress,
    }),
  });
  const selection = await recorder.measure("client-quote-selection", async () =>
    selectClientGatewayQuotes({
      quotes: collection.quotes,
      rfqId: collection.rfqId,
      order: config.order,
      chainId: config.chainId,
      evmChainId: config.evmChainId,
      takerAddress: config.takerAddress,
      contractAddress: config.rfqContractAddress,
    }),
  );
  const authzMessage = await recorder.measure("client-authz-message-build", async () => {
    const executeMessage = dependencies.MsgExecuteContractCompat.fromJSON({
      funds: [],
      sender: config.takerAddress,
      contractAddress: config.rfqContractAddress,
      msg: buildClientAcceptQuotePayload({
        cid: randomUUID(),
        order: config.order,
        rfqId: collection.rfqId,
        hexToBase64: dependencies.hexToBase64,
        selectedQuotes: selection.selectedQuotes,
      }),
    });

    return dependencies.MsgAuthzExec.fromJSON({
      grantee: config.autosignAddress,
      msgs: [executeMessage],
    });
  });

  return {
    authzMessage,
    rfqId: collection.rfqId,
    quoteCount: collection.quoteCount,
    quotesWaitMs: collection.quotesWaitMs,
    selectedQuoteCount: selection.selectedQuotes.length,
    expiredQuoteCount: selection.expiredQuoteCount,
  };
};

export const getLatestBlockHeight = (latestBlock: unknown): string => {
  if (!isRecord(latestBlock) || !isRecord(latestBlock.header)) {
    throw new Error("Latest block response is missing header height.");
  }

  const height = latestBlock.header.height;

  if (typeof height === "string") {
    return height;
  }

  if (typeof height === "number" && Number.isInteger(height)) {
    return height.toString();
  }

  if (typeof height === "bigint") {
    return height.toString();
  }

  throw new Error("Latest block response has an invalid header height.");
};

const prefetchClientBroadcastContext = async ({
  config,
  txTimeoutInBlocks,
  dependencies,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly txTimeoutInBlocks: number;
  readonly dependencies: {
    readonly authApi: {
      fetchAccount(address: string): Promise<{ baseAccount?: unknown }>;
    };
    readonly tendermintApi: {
      fetchLatestBlock(): Promise<unknown>;
    };
  };
}): Promise<ClientBroadcastContext> => {
  const [accountDetails, latestBlock] = await Promise.all([
    dependencies.authApi.fetchAccount(config.autosignAddress),
    dependencies.tendermintApi.fetchLatestBlock(),
  ]);
  const latestHeight = getLatestBlockHeight(latestBlock);
  const timeoutHeight = calculateBenchmarkTimeoutHeight({
    latestHeight,
    txTimeoutInBlocks,
  });

  if (!accountDetails.baseAccount) {
    throw new Error("Client broadcast account details missing base account.");
  }

  return {
    latestHeight,
    timeoutHeight,
    accountDetails: accountDetails.baseAccount,
  };
};

const runClientGatewayAttempt = async ({
  config,
  details,
  recorder,
  dependencies,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly recorder: StageRecorder;
  readonly details: Record<string, unknown>;
  readonly dependencies: {
    readonly Wallet: Record<string, string>;
    readonly MsgBroadcaster: any;
    readonly WalletStrategy: any;
    readonly endpoints: Record<string, unknown>;
    readonly TxInclusionStrategy: Record<string, string>;
    readonly WalletStrategyEmitterEventType: Record<string, string>;
    readonly authApi: {
      fetchAccount(address: string): Promise<{ baseAccount?: unknown }>;
    };
    readonly tendermintApi: {
      fetchLatestBlock(): Promise<unknown>;
    };
  } & Parameters<typeof prepareClientGatewayOrder>[0]["dependencies"];
}): Promise<BroadcastTimingEvent[]> => {
  const txTimeoutInBlocks = 10;
  const feeGrant = await recorder.measure("client-feegrant-resolve", () =>
    resolveClientFeeGrant({
      config,
    }),
  );
  const broadcastContextPromise = config.broadcastTransactions
    ? recorder
        .measure("client-broadcast-context-prefetch", () =>
          prefetchClientBroadcastContext({
            config,
            dependencies,
            txTimeoutInBlocks,
          }),
        )
        .then(
          (value) => ({ status: "fulfilled" as const, value }),
          (error) => ({ status: "rejected" as const, error }),
        )
    : undefined;
  const preparedOrder = await recorder.measure("client-prepare-total", () =>
    prepareClientGatewayOrder({
      config,
      details,
      recorder,
      dependencies,
    }),
  );

  details.rfqId = preparedOrder.rfqId;
  details.quoteCount = preparedOrder.quoteCount;
  details.quotesWaitMs = preparedOrder.quotesWaitMs;
  details.feeGrantSource = feeGrant.source;
  details.selectedQuoteCount = preparedOrder.selectedQuoteCount;
  details.expiredQuoteCount = preparedOrder.expiredQuoteCount;

  if (!config.broadcastTransactions) {
    return [];
  }

  if (!feeGrant.granterAddress) {
    throw new Error(
      `Client gateway broadcast requires a fee grant granter. Set ${feeGrantGranterSeedPhraseVariable}.`,
    );
  }

  const broadcastContextResult = await broadcastContextPromise;

  if (!broadcastContextResult) {
    throw new Error("Client gateway broadcast context was not prefetched.");
  }

  if (broadcastContextResult.status === "rejected") {
    details.clientBroadcastContextPrefetchError = getErrorMessage(
      broadcastContextResult.error,
    );

    throw broadcastContextResult.error;
  }

  details.clientBroadcastLatestHeight = broadcastContextResult.value.latestHeight;
  details.clientBroadcastTimeoutHeight =
    broadcastContextResult.value.timeoutHeight;
  if (isRecord(broadcastContextResult.value.accountDetails)) {
    details.clientBroadcastAccountNumber =
      broadcastContextResult.value.accountDetails.accountNumber;
    details.clientBroadcastAccountSequence =
      broadcastContextResult.value.accountDetails.sequence;
  }

  const walletStrategy = (await createWalletStrategy({
    Wallet: dependencies.Wallet,
    chainId: config.chainId,
    network: config.network,
    evmChainId: config.evmChainId,
    WalletStrategy: dependencies.WalletStrategy,
    privateKey: config.autosignPrivateKey,
  })) as {
    on: (event: any, listener: () => void) => unknown;
    off: (event: any, listener: () => void) => unknown;
  };
  const broadcastRecorder = createBroadcastEventRecorder({
    walletStrategy,
    eventTypes: dependencies.WalletStrategyEmitterEventType,
  });
  const broadcaster = new dependencies.MsgBroadcaster({
    walletStrategy,
    endpoints: dependencies.endpoints,
    network: config.network,
    chainId: config.chainId,
    evmChainId: config.evmChainId,
    simulateTx: config.clientSimulateTx,
    gasBufferCoefficient: 1.2,
    useDynamicBaseFee: false,
    feePayerPubKey: config.feePayerPubKey,
  });

  try {
    const response = (await recorder.measure("client-broadcast-total", () =>
      broadcaster.broadcastV2({
        msgs: [preparedOrder.authzMessage],
        injectiveAddress: config.autosignAddress,
        txTimeoutInBlocks,
        timeoutHeight: broadcastContextResult.value.timeoutHeight,
        accountDetails: broadcastContextResult.value.accountDetails,
        txInclusion: {
          pollingInterval: 100,
          inclusionStrategy: dependencies.TxInclusionStrategy.Poll,
        },
        gas: {
          granter: feeGrant.granterAddress,
          gas: defaultClientGatewayGasLimit,
        },
      }),
    )) as { txHash?: string };

    details.txHash = response.txHash;

    return broadcastRecorder.events;
  } finally {
    broadcastRecorder.dispose();
  }
};

const runServerGatewayAttempt = async ({
  config,
  details,
  recorder,
  dependencies,
}: {
  readonly config: RfqGatewayBenchmarkConfig;
  readonly recorder: StageRecorder;
  readonly details: Record<string, unknown>;
  readonly dependencies: {
    readonly Wallet: Record<string, string>;
    readonly MsgBroadcaster: any;
    readonly WalletStrategy: any;
    readonly endpoints: Record<string, unknown>;
    readonly PrivateKey: {
      fromHex(privateKey: string): {
        toBech32(): string;
        toPublicKey(): { toBase64(): string };
      };
    };
    readonly TxInclusionStrategy: Record<string, string>;
    readonly WalletStrategyEmitterEventType: Record<string, string>;
    readonly authApi: {
      fetchAccount(address: string): Promise<{
        baseAccount?: { accountNumber: number; sequence: number };
      }>;
    };
    readonly rfqGatewayApi: {
      fetchPrepareAutoSign(params: Record<string, unknown>): Promise<{
        tx: Uint8Array;
        rfqId: number;
        quotes?: unknown[];
        feePayerSig: string;
        quotesWaitMs: number;
        expiredQuotesCount: number;
        autosignAccountNumber: number;
        autosignAccountSequence: number;
      }>;
    };
  };
}): Promise<BroadcastTimingEvent[]> => {
  const response = await recorder.measure("server-prepare-total", async () => {
    const granteeDetails = await recorder.measure(
      "server-autosign-grantee-details",
      async () => {
        const privateKey = dependencies.PrivateKey.fromHex(
          config.autosignPrivateKey,
        );

        return {
          injectiveAddress: privateKey.toBech32(),
          pubKey: base64ToHex(privateKey.toPublicKey().toBase64()),
        };
      },
    );
    const accountDetails = await recorder.measure(
      "server-prepare-dependencies",
      async () => {
        try {
          return await dependencies.authApi.fetchAccount(
            granteeDetails.injectiveAddress,
          );
        } catch (error) {
          details.accountLookupError = getErrorMessage(error);

          return undefined;
        }
      },
    );

    return recorder.measure("server-fetch-prepare-autosign", () =>
      dependencies.rfqGatewayApi.fetchPrepareAutoSign({
        cid: randomUUID(),
        clientId: randomUUID(),
        margin: config.order.margin,
        quantity: config.order.quantity,
        marketId: config.order.marketId,
        direction: config.order.direction,
        takerAddress: config.takerAddress,
        autosignAddress: config.autosignAddress,
        autosignPubKey: granteeDetails.pubKey,
        quotesWaitTimeMs: config.quotesWaitMilliseconds,
        worstPrice: removeDecimalTrailingZeros(config.order.worstPrice),
        autosignAccountNumber: accountDetails?.baseAccount?.accountNumber,
        autosignAccountSequence: accountDetails?.baseAccount?.sequence,
      }),
    );
  });

  details.rfqId = response.rfqId;
  details.quotesWaitMs = response.quotesWaitMs;
  details.quoteCount = response.quotes?.length ?? 0;
  details.txByteLength = response.tx.length;
  details.expiredQuoteCount = response.expiredQuotesCount;
  details.selectedQuoteCount = response.quotes?.length ?? 0;
  details.autosignAccountNumber = response.autosignAccountNumber;
  details.autosignAccountSequence = response.autosignAccountSequence;

  if (!config.broadcastTransactions) {
    return [];
  }

  const walletStrategy = (await createWalletStrategy({
    Wallet: dependencies.Wallet,
    chainId: config.chainId,
    network: config.network,
    evmChainId: config.evmChainId,
    WalletStrategy: dependencies.WalletStrategy,
    privateKey: config.autosignPrivateKey,
  })) as {
    on: (event: any, listener: () => void) => unknown;
    off: (event: any, listener: () => void) => unknown;
  };
  const broadcastRecorder = createBroadcastEventRecorder({
    walletStrategy,
    eventTypes: dependencies.WalletStrategyEmitterEventType,
  });
  const broadcaster = new dependencies.MsgBroadcaster({
    walletStrategy,
    endpoints: dependencies.endpoints,
    network: config.network,
    chainId: config.chainId,
    evmChainId: config.evmChainId,
    simulateTx: true,
    gasBufferCoefficient: 1.2,
    feePayerPubKey: config.feePayerPubKey,
  });

  try {
    const txResponse = (await recorder.measure("server-broadcast-total", () =>
      broadcaster.broadcastWithFeePayerSig({
        tx: response.tx,
        privateKey: config.autosignPrivateKey,
        feePayerSig: response.feePayerSig,
        accountNumber: response.autosignAccountNumber,
        txTimeoutInBlocks: 10,
        txInclusion: {
          pollingInterval: 100,
          inclusionStrategy: dependencies.TxInclusionStrategy.Poll,
        },
      }),
    )) as { txHash?: string };

    details.txHash = txResponse.txHash;

    return broadcastRecorder.events;
  } finally {
    broadcastRecorder.dispose();
  }
};

const runGatewayAttempt = async ({
  mode,
  config,
  iteration,
  dependencies,
}: {
  readonly mode: RfqGatewayBenchmarkMode;
  readonly iteration: number;
  readonly config: RfqGatewayBenchmarkConfig;
  readonly dependencies: Parameters<typeof runClientGatewayAttempt>[0]["dependencies"] &
    Parameters<typeof runServerGatewayAttempt>[0]["dependencies"];
}): Promise<RfqGatewayBenchmarkAttempt> => {
  const recorder = createStageRecorder();
  const details: Record<string, unknown> = {};
  const startedAt = performance.now();
  let broadcastEvents: readonly BroadcastTimingEvent[] = [];

  try {
    broadcastEvents =
      mode === "client"
        ? await runClientGatewayAttempt({
            config,
            details,
            recorder,
            dependencies,
          })
        : await runServerGatewayAttempt({
            config,
            details,
            recorder,
            dependencies,
          });

    appendBroadcastEventStages({
      events: broadcastEvents,
      stages: recorder.stages,
    });

    return {
      mode,
      details,
      iteration,
      broadcastEvents,
      status: "success",
      stages: recorder.stages,
      totalDurationMs: roundMilliseconds(performance.now() - startedAt),
    };
  } catch (error) {
    appendBroadcastEventStages({
      events: broadcastEvents,
      stages: recorder.stages,
    });

    return {
      mode,
      details,
      iteration,
      broadcastEvents,
      status: "failed",
      error: formatError(error),
      stages: recorder.stages,
      totalDurationMs: roundMilliseconds(performance.now() - startedAt),
    };
  }
};

const formatInvalidQuoteReasonCounts = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const parts = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([reason, count]) => `${reason}:${count}`);

  return parts.length > 0 ? parts.join(",") : undefined;
};

const formatAttemptLine = (attempt: RfqGatewayBenchmarkAttempt): string => {
  const prepareStage = attempt.stages.find(
    (stage) =>
      stage.name === "client-prepare-total" ||
      stage.name === "server-prepare-total",
  );
  const broadcastStage = attempt.stages.find((stage) =>
    stage.name.endsWith("broadcast-total"),
  );
  const invalidQuoteReasons = formatInvalidQuoteReasonCounts(
    attempt.details.invalidQuoteReasonCounts,
  );
  const parts = [
    `iteration=${attempt.iteration}`,
    `mode=${attempt.mode}`,
    `status=${attempt.status}`,
    `total=${attempt.totalDurationMs}ms`,
    prepareStage ? `prepare=${prepareStage.durationMs}ms` : undefined,
    broadcastStage ? `broadcast=${broadcastStage.durationMs}ms` : undefined,
    typeof attempt.details.quoteCount === "number"
      ? `quotes=${attempt.details.quoteCount}`
      : undefined,
    typeof attempt.details.selectedQuoteCount === "number"
      ? `selected=${attempt.details.selectedQuoteCount}`
      : undefined,
    typeof attempt.details.validQuoteCount === "number"
      ? `valid=${attempt.details.validQuoteCount}`
      : undefined,
    typeof attempt.details.invalidQuoteCount === "number"
      ? `invalid=${attempt.details.invalidQuoteCount}`
      : undefined,
    typeof attempt.details.expiredQuoteCount === "number"
      ? `expired=${attempt.details.expiredQuoteCount}`
      : undefined,
    typeof attempt.details.validQuoteQuantity === "string"
      ? `validQty=${attempt.details.validQuoteQuantity}`
      : undefined,
    invalidQuoteReasons ? `invalidReasons=${invalidQuoteReasons}` : undefined,
  ].filter((part): part is string => part !== undefined);

  return parts.join(" ");
};

const writeBenchmarkOutput = async ({
  path,
  output,
}: {
  readonly path: string;
  readonly output: unknown;
}): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(output, null, 2)}\n`);
};

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, getNetworkInfo, Network } = await import(
    "@injectivelabs/networks"
  );
  const {
    ChainGrpcAuthApi,
    ChainGrpcTendermintApi,
    IndexerGrpcOracleApi,
    MsgGrant,
    MsgGrantAllowance,
    IndexerGrpcRfqGwApi,
    IndexerGrpcDerivativesApi,
    MsgBroadcasterWithPk,
    MsgAuthzExec,
    MsgExecuteContractCompat,
    PrivateKey,
    hexToBase64,
  } = await import("@injectivelabs/sdk-ts");
  const { IndexerWsTakerStream, TxInclusionStrategy } = await import(
    "@injectivelabs/sdk-ts"
  );
  const { Wallet, WalletStrategyEmitterEventType } = await import(
    "@injectivelabs/wallet-base"
  );
  const { MsgBroadcaster } = await import("@injectivelabs/wallet-core");
  const { WalletStrategy } = await import("@injectivelabs/wallet-strategy");
  const { BigNumberInBase, INJ_DENOM } = await import("@injectivelabs/utils");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const network = getInjectiveNetworkFromEnvironment(
    "RFQ_GATEWAY_BENCHMARK_NETWORK",
    Network.Testnet,
  );
  const networkInfo = getNetworkInfo(network);
  const endpoints = getNetworkEndpoints(network);
  const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);
  const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
  const config = await loadBenchmarkConfig({
    network,
    oracleApi,
    networkInfo,
    PrivateKey,
    derivativesApi,
    indexerEndpoint: endpoints.indexer,
  });
  const dependencies = {
    Wallet,
    endpoints,
    PrivateKey,
    INJ_DENOM,
    hexToBase64,
    MsgBroadcaster,
    WalletStrategy,
    MsgAuthzExec,
    MsgGrant,
    BigNumberInBase,
    TxInclusionStrategy,
    MsgGrantAllowance,
    IndexerWsTakerStream,
    MsgBroadcasterWithPk,
    MsgExecuteContractCompat,
    WalletStrategyEmitterEventType,
    authApi: new ChainGrpcAuthApi(endpoints.grpc),
    tendermintApi: new ChainGrpcTendermintApi(endpoints.grpc),
    rfqGatewayApi: new IndexerGrpcRfqGwApi(config.rfqGatewayEndpoint),
  };
  const attempts: RfqGatewayBenchmarkAttempt[] = [];
  const feeGrantSetup = await setupBenchmarkFeeGrant({
    config,
    dependencies,
  });
  const contractAuthzSetup = await setupBenchmarkContractAuthz({
    config,
    dependencies,
  });

  console.log({
    dryRun: !config.broadcastTransactions,
    note: config.broadcastTransactions
      ? "Broadcasting is enabled. This will submit RFQ settlement transactions."
      : `Broadcasting is disabled. Set ${broadcastTransactionsVariable}=true for full E2E submit-to-inclusion timing.`,
    feeGrantSetup,
    contractAuthzSetup,
    config: buildRedactedConfig(config),
  });

  for (let iteration = 1; iteration <= config.iterations; iteration += 1) {
    for (const mode of config.modeOrder) {
      const attempt = await runGatewayAttempt({
        mode,
        config,
        iteration,
        dependencies,
      });

      attempts.push(attempt);
      console.log(formatAttemptLine(attempt));

      if (attempt.error) {
        console.error(attempt.error);
      }

      if (config.delayBetweenAttemptsMilliseconds > 0) {
        await delay(config.delayBetweenAttemptsMilliseconds);
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    config: buildRedactedConfig(config),
    feeGrantSetup,
    contractAuthzSetup,
    summary: summarizeBenchmarkResults(attempts),
    attempts,
  };

  await writeBenchmarkOutput({
    output,
    path: config.outputPath,
  });

  console.log({
    outputPath: config.outputPath,
    summary: output.summary,
  });
};

runDirectly(module, run);
