import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getEnvironmentVariable,
  getNumberEnvironmentVariable,
  requireEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

export const defaultRfqContractAddress =
  "inj1q47g4awqlc5z6waqztdtprqcr84l5r8dkqhftd";
export const defaultArbContractAddress =
  "inj1e2wajvxvaagyp94l5s45elmhal0qguw7d29pn9";
export const defaultQuoteDenom =
  "erc20:0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
export const discoveredEmptyBookMarketId =
  "0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515";

const defaultSeedOutputPath =
  "data/authz-rfq-seed-output.json";
const defaultVerificationOutputPath =
  "data/authz-rfq-verification-output.json";
const decimalScale = 18;
const basisPointDivisor = 10_000;
const allowedModes = ["seed", "verify", "execute"] as const;
const allowedOrderSides = ["BUY", "SELL"] as const;
const allowedExecutionPaths = ["direct", "arb"] as const;

export type AuthzRfqMode = (typeof allowedModes)[number];
export type DerivativeOrderSide = (typeof allowedOrderSides)[number];
export type ExecutionPath = (typeof allowedExecutionPaths)[number];

export const metadata: ExampleMetadata = {
  id: "authz:rfq-execution",
  category: "authz",
  title: "Seed and execute RFQ AuthZ flow",
  description:
    "Discover, verify, seed, and execute an AuthZ RFQ settlement flow.",
  requiresEnvironment: [
    "AUTHZ_RFQ_MODE",
    "AUTHZ_RFQ_ACCOUNT_A_SEED_PHRASE",
    "AUTHZ_RFQ_ACCOUNT_B_SEED_PHRASE",
    "AUTHZ_RFQ_ACCOUNT_C_SEED_PHRASE",
  ],
  mayBroadcast: true,
};

export interface DerivativeLimitOrderPlan {
  readonly marketId: string;
  readonly subaccountId: string;
  readonly injectiveAddress: string;
  readonly orderSide: DerivativeOrderSide;
  readonly feeRecipient: string;
  readonly price: string;
  readonly quantity: string;
  readonly margin: string;
  readonly cid: string;
}

export interface BuildDerivativeLimitOrderPlansOptions {
  readonly marketId: string;
  readonly subaccountId: string;
  readonly injectiveAddress: string;
  readonly orderSide: DerivativeOrderSide;
  readonly feeRecipient: string;
  readonly price: string;
  readonly priceStep: string;
  readonly quantity: string;
  readonly margin: string;
  readonly orderCount: number;
  readonly cidPrefix: string;
}

export interface SeedQuoteTemplateOptions {
  readonly chainId: string;
  readonly contractAddress: string;
  readonly marketId: string;
  readonly makerAddress: string;
  readonly takerAddress: string;
  readonly takerDirection: string;
  readonly price: string;
  readonly quantity: string;
  readonly margin: string;
  readonly rfqIdStart: number;
  readonly expiryTimestampMilliseconds: number;
  readonly quoteCount: number;
}

export interface SeedQuoteTemplate {
  readonly chainId: string;
  readonly contractAddress: string;
  readonly marketId: string;
  readonly rfqId: number;
  readonly takerDirection: string;
  readonly margin: string;
  readonly quantity: string;
  readonly price: string;
  readonly expiry: {
    readonly timestamp: number;
  };
  readonly maker: string;
  readonly taker: string;
  readonly signature: string;
  readonly status: string;
  readonly minFillQuantity: string;
  readonly makerSubaccountNonce: number;
  readonly signMode: "v1";
}

export interface MarketCandidateSummary {
  readonly ticker: string;
  readonly marketId: string;
  readonly quoteDenom: string;
  readonly marketStatus: string | undefined;
  readonly isPerpetual: boolean;
  readonly buyCount: number;
  readonly sellCount: number;
  readonly totalOrderCount: number;
}

export interface PriceReference {
  readonly price: string;
  readonly source: string;
}

export interface QuoteVerificationSummary {
  readonly quoteCount: number;
  readonly matchingMakerCount: number;
  readonly matchingTakerCount: number;
  readonly matchingMarketCount: number;
  readonly matchingContractCount: number;
  readonly longExpiryCount: number;
  readonly signedQuoteCount: number;
  readonly totalQuantity: string;
  readonly expectedTotalQuantity: string | undefined;
  readonly quantityMatchesExpected: boolean | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getRecordString = (
  value: Record<string, unknown>,
  key: string
): string | undefined => {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

const getRecordNumber = (
  value: Record<string, unknown>,
  key: string
): number | undefined => {
  const property = value[key];

  return typeof property === "number" && Number.isFinite(property)
    ? property
    : undefined;
};

const getRecordBoolean = (
  value: Record<string, unknown>,
  key: string
): boolean | undefined => {
  const property = value[key];

  return typeof property === "boolean" ? property : undefined;
};

const getRecordArray = (
  value: Record<string, unknown>,
  key: string
): unknown[] => {
  const property = value[key];

  return Array.isArray(property) ? property : [];
};

const assertAllowedValue = <AllowedValue extends string>(
  name: string,
  value: string,
  allowedValues: readonly AllowedValue[]
): AllowedValue => {
  const matchingValue = allowedValues.find(
    (allowedValue) => allowedValue.toLowerCase() === value.toLowerCase()
  );

  if (!matchingValue) {
    throw new Error(
      `Invalid ${name}: expected one of ${allowedValues.join(", ")}, got "${value}".`
    );
  }

  return matchingValue;
};

export const parseAuthzRfqMode = (value: string): AuthzRfqMode =>
  assertAllowedValue("AUTHZ_RFQ_MODE", value, allowedModes);

export const parseExecutionPath = (value: string): ExecutionPath =>
  assertAllowedValue("AUTHZ_RFQ_EXECUTION_PATH", value, allowedExecutionPaths);

export const parseDerivativeOrderSide = (
  value: string
): DerivativeOrderSide =>
  assertAllowedValue("AUTHZ_RFQ_ORDER_SIDE", value, allowedOrderSides);

export const getOppositeOrderSide = (
  orderSide: DerivativeOrderSide
): DerivativeOrderSide => (orderSide === "BUY" ? "SELL" : "BUY");

export const assertPositiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
};

const parseDecimalUnits = (name: string, value: string): bigint => {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(-?)(\d+)(?:\.(\d+))?$/);

  if (!match) {
    throw new Error(`${name} must be a decimal number.`);
  }

  const [, sign, wholePart, fractionalPart = ""] = match;

  if (fractionalPart.length > decimalScale) {
    throw new Error(
      `${name} supports at most ${decimalScale} decimal places.`
    );
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

export const addDecimalStep = ({
  name,
  value,
  step,
  stepCount,
}: {
  readonly name: string;
  readonly value: string;
  readonly step: string;
  readonly stepCount: number;
}): string => {
  const baseUnits = parseDecimalUnits(name, value);
  const stepUnits = parseDecimalUnits(`${name}_STEP`, step);

  return formatDecimalUnits(baseUnits + stepUnits * BigInt(stepCount));
};

const requirePositiveDecimalUnits = (name: string, value: string): bigint => {
  const units = parseDecimalUnits(name, value);

  if (units <= 0n) {
    throw new Error(`${name} must be greater than 0.`);
  }

  return units;
};

const sumDecimalUnits = (
  name: string,
  values: readonly string[]
): bigint =>
  values.reduce(
    (total, value, index) =>
      total + parseDecimalUnits(`${name}[${index}]`, value),
    0n
  );

export const sumDecimalStrings = (
  name: string,
  values: readonly string[]
): string => formatDecimalUnits(sumDecimalUnits(name, values));

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

  const normalizedValue = Object.is(value, -0) ? 0 : value;

  return normalizedValue
    .toFixed(decimalScale)
    .replace(/\.?0+$/, "");
};

const parseBasisPoints = (basisPoints: number): bigint => {
  if (!Number.isInteger(basisPoints)) {
    throw new Error("basisPoints must be an integer.");
  }

  return BigInt(basisPoints);
};

export const applyBasisPointOffset = ({
  price,
  basisPoints,
}: {
  readonly price: string;
  readonly basisPoints: number;
}): string => {
  const priceUnits = requirePositiveDecimalUnits("price", price);
  const basisPointUnits = parseBasisPoints(basisPoints);

  return formatDecimalUnits(
    (priceUnits * (BigInt(basisPointDivisor) + basisPointUnits)) /
      BigInt(basisPointDivisor)
  );
};

export const getBasisPointStep = ({
  price,
  basisPoints,
}: {
  readonly price: string;
  readonly basisPoints: number;
}): string => {
  const priceUnits = requirePositiveDecimalUnits("price", price);
  const basisPointUnits = parseBasisPoints(basisPoints);

  return formatDecimalUnits(
    (priceUnits * basisPointUnits) / BigInt(basisPointDivisor)
  );
};

export const isPriceWithinBasisPoints = ({
  price,
  referencePrice,
  toleranceBasisPoints,
}: {
  readonly price: string;
  readonly referencePrice: string;
  readonly toleranceBasisPoints: number;
}): boolean => {
  const priceNumber = parseFiniteNumber("price", price);
  const referencePriceNumber = parseFiniteNumber("referencePrice", referencePrice);

  if (referencePriceNumber <= 0 || toleranceBasisPoints < 0) {
    return false;
  }

  const distanceBasisPoints =
    (Math.abs(priceNumber - referencePriceNumber) / referencePriceNumber) *
    basisPointDivisor;

  return distanceBasisPoints <= toleranceBasisPoints;
};

export const parseJsonRecord = (
  name: string,
  value: string
): Record<string, unknown> => {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} must contain valid JSON: ${String(error)}`);
  }

  if (!isRecord(parsedValue)) {
    throw new Error(`${name} must be a JSON object.`);
  }

  return parsedValue;
};

export const parseJsonArray = (name: string, value: string): unknown[] => {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} must contain valid JSON: ${String(error)}`);
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error(`${name} must be a JSON array.`);
  }

  return parsedValue;
};

export const recordContainsString = (
  value: unknown,
  target: string,
  seenValues = new Set<unknown>()
): boolean => {
  if (typeof value === "string") {
    return value === target;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seenValues.has(value)) {
    return false;
  }

  seenValues.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) =>
      recordContainsString(entry, target, seenValues)
    );
  }

  return Object.values(value).some((entry) =>
    recordContainsString(entry, target, seenValues)
  );
};

export const hasGrantForContract = (
  grants: readonly unknown[],
  contractAddress: string
): boolean =>
  grants.some((grant) => recordContainsString(grant, contractAddress));

export const getOrderbookDepth = (orderbook: unknown): {
  readonly buyCount: number;
  readonly sellCount: number;
  readonly totalOrderCount: number;
} => {
  if (!isRecord(orderbook)) {
    return {
      buyCount: 0,
      sellCount: 0,
      totalOrderCount: 0,
    };
  }

  const buyCount = getRecordArray(orderbook, "buys").length;
  const sellCount = getRecordArray(orderbook, "sells").length;

  return {
    buyCount,
    sellCount,
    totalOrderCount: buyCount + sellCount,
  };
};

export const summarizeMarketCandidate = (
  market: unknown,
  orderbook: unknown
): MarketCandidateSummary | undefined => {
  if (!isRecord(market)) {
    return undefined;
  }

  const ticker = getRecordString(market, "ticker");
  const marketId = getRecordString(market, "marketId");
  const quoteDenom = getRecordString(market, "quoteDenom");

  if (!ticker || !marketId || !quoteDenom) {
    return undefined;
  }

  const orderbookDepth = getOrderbookDepth(orderbook);

  return {
    ticker,
    marketId,
    quoteDenom,
    marketStatus: getRecordString(market, "marketStatus"),
    isPerpetual: getRecordBoolean(market, "isPerpetual") === true,
    ...orderbookDepth,
  };
};

export const isUsdcQuotedPerpetualMarket = (
  market: unknown,
  quoteDenom: string
): boolean => {
  if (!isRecord(market)) {
    return false;
  }

  return (
    getRecordString(market, "quoteDenom") === quoteDenom &&
    getRecordBoolean(market, "isPerpetual") === true &&
    getRecordString(market, "marketStatus")?.toLowerCase() === "active"
  );
};

export const selectIlliquidMarketCandidate = (
  candidates: readonly MarketCandidateSummary[],
  maxOrderbookLevels: number
): MarketCandidateSummary | undefined =>
  candidates
    .filter(
      (candidate) =>
        candidate.isPerpetual &&
        candidate.marketStatus?.toLowerCase() === "active" &&
        candidate.totalOrderCount <= maxOrderbookLevels
    )
    .sort((left, right) => {
      if (left.totalOrderCount !== right.totalOrderCount) {
        return left.totalOrderCount - right.totalOrderCount;
      }

      return left.ticker.localeCompare(right.ticker);
    })[0];

export const getOrderbookMidPrice = (orderbook: unknown): string | undefined => {
  if (!isRecord(orderbook)) {
    return undefined;
  }

  const buys = getRecordArray(orderbook, "buys");
  const sells = getRecordArray(orderbook, "sells");
  const buyPrices = buys
    .filter(isRecord)
    .map((level) => getRecordString(level, "price"))
    .filter((price): price is string => price !== undefined)
    .map((price) => parseFiniteNumber("orderbook.buys.price", price));
  const sellPrices = sells
    .filter(isRecord)
    .map((level) => getRecordString(level, "price"))
    .filter((price): price is string => price !== undefined)
    .map((price) => parseFiniteNumber("orderbook.sells.price", price));

  if (buyPrices.length === 0 || sellPrices.length === 0) {
    return undefined;
  }

  return formatFiniteDecimal(
    (Math.max(...buyPrices) + Math.min(...sellPrices)) / 2
  );
};

export const scaleOraclePriceToQuoteDecimals = ({
  price,
  quoteDecimals,
  oracleScaleFactor,
}: {
  readonly price: string;
  readonly quoteDecimals: number | undefined;
  readonly oracleScaleFactor: number;
}): string => {
  const numericPrice = parseFiniteNumber("oraclePrice", price);

  if (numericPrice === 0 || quoteDecimals === undefined) {
    return formatFiniteDecimal(numericPrice);
  }

  if (quoteDecimals === oracleScaleFactor) {
    return formatFiniteDecimal(numericPrice);
  }

  return formatFiniteDecimal(
    numericPrice * 10 ** (oracleScaleFactor - quoteDecimals)
  );
};

export const buildDefaultAcceptQuotePayload = (
  quotes: readonly unknown[]
): Record<string, unknown> => {
  if (quotes.length === 0) {
    throw new Error("At least one RFQ quote is required.");
  }

  return {
    accept_quote: {
      quotes,
    },
  };
};

export const extractQuotesFromAcceptQuotePayload = (
  payload: Record<string, unknown>
): unknown[] | undefined => {
  const directQuotes = payload.quotes;

  if (Array.isArray(directQuotes)) {
    return directQuotes;
  }

  const acceptQuote = payload.accept_quote;

  if (!isRecord(acceptQuote)) {
    return undefined;
  }

  const nestedQuotes = acceptQuote.quotes;

  return Array.isArray(nestedQuotes) ? nestedQuotes : undefined;
};

const getQuoteExpiryTimestampMilliseconds = (
  quote: Record<string, unknown>
): number | undefined => {
  const expiresAt = getRecordNumber(quote, "expiresAt");

  if (expiresAt !== undefined) {
    return expiresAt;
  }

  const expiry = quote.expiry;

  if (!isRecord(expiry)) {
    return undefined;
  }

  const timestamp = getRecordNumber(expiry, "timestamp");

  if (timestamp === undefined) {
    return undefined;
  }

  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
};

export const summarizeQuoteVerification = ({
  quotes,
  makerAddress,
  takerAddress,
  marketId,
  contractAddress,
  expectedTotalQuantity,
  minimumExpirySeconds,
  nowMilliseconds,
}: {
  readonly quotes: readonly unknown[];
  readonly makerAddress: string | undefined;
  readonly takerAddress: string | undefined;
  readonly marketId: string;
  readonly contractAddress: string;
  readonly expectedTotalQuantity: string | undefined;
  readonly minimumExpirySeconds: number;
  readonly nowMilliseconds: number;
}): QuoteVerificationSummary => {
  const quoteRecords = quotes.filter(isRecord);
  const quantityValues = quoteRecords
    .map((quote) => getRecordString(quote, "quantity"))
    .filter((quantity): quantity is string => quantity !== undefined);
  const totalQuantity = sumDecimalStrings("quotes.quantity", quantityValues);
  const expectedTotalQuantityUnits =
    expectedTotalQuantity === undefined
      ? undefined
      : parseDecimalUnits("expectedTotalQuantity", expectedTotalQuantity);
  const totalQuantityUnits = parseDecimalUnits("quotes.totalQuantity", totalQuantity);

  return {
    quoteCount: quoteRecords.length,
    matchingMakerCount:
      makerAddress === undefined
        ? quoteRecords.length
        : quoteRecords.filter(
            (quote) => getRecordString(quote, "maker") === makerAddress
          ).length,
    matchingTakerCount:
      takerAddress === undefined
        ? quoteRecords.length
        : quoteRecords.filter(
            (quote) => getRecordString(quote, "taker") === takerAddress
          ).length,
    matchingMarketCount: quoteRecords.filter(
      (quote) => getRecordString(quote, "marketId") === marketId
    ).length,
    matchingContractCount: quoteRecords.filter(
      (quote) => getRecordString(quote, "contractAddress") === contractAddress
    ).length,
    longExpiryCount: quoteRecords.filter((quote) => {
      const expiryTimestampMilliseconds =
        getQuoteExpiryTimestampMilliseconds(quote);

      return (
        expiryTimestampMilliseconds !== undefined &&
        expiryTimestampMilliseconds - nowMilliseconds >=
          minimumExpirySeconds * 1000
      );
    }).length,
    signedQuoteCount: quoteRecords.filter((quote) => {
      const signature = getRecordString(quote, "signature");

      return signature !== undefined && signature.length > 0;
    }).length,
    totalQuantity,
    expectedTotalQuantity,
    quantityMatchesExpected:
      expectedTotalQuantityUnits === undefined
        ? undefined
        : totalQuantityUnits === expectedTotalQuantityUnits,
  };
};

export const assertQuoteVerification = ({
  summary,
  requireSignatures,
  requireQuantityMatch,
}: {
  readonly summary: QuoteVerificationSummary;
  readonly requireSignatures: boolean;
  readonly requireQuantityMatch: boolean;
}): void => {
  if (summary.quoteCount === 0) {
    throw new Error("No RFQ quotes were available to verify.");
  }

  if (
    summary.matchingMakerCount !== summary.quoteCount ||
    summary.matchingTakerCount !== summary.quoteCount ||
    summary.matchingMarketCount !== summary.quoteCount ||
    summary.matchingContractCount !== summary.quoteCount
  ) {
    throw new Error("RFQ quotes do not all match the expected maker, taker, market, and contract.");
  }

  if (summary.longExpiryCount !== summary.quoteCount) {
    throw new Error("RFQ quotes do not all have the required long expiry.");
  }

  if (requireSignatures && summary.signedQuoteCount !== summary.quoteCount) {
    throw new Error("RFQ quotes do not all include signatures.");
  }

  if (requireQuantityMatch && summary.quantityMatchesExpected !== true) {
    throw new Error("RFQ quote quantity does not match the resting derivative order quantity.");
  }
};

export const assertArbPayloadReferencesExecutionInputs = ({
  payload,
  rfqContractAddress,
  marketId,
}: {
  readonly payload: Record<string, unknown>;
  readonly rfqContractAddress: string;
  readonly marketId: string;
}): void => {
  if (!recordContainsString(payload, rfqContractAddress)) {
    throw new Error(
      "AUTHZ_RFQ_ARB_EXECUTE_JSON must reference AUTHZ_RFQ_CONTRACT_ADDRESS."
    );
  }

  if (!recordContainsString(payload, marketId)) {
    throw new Error("AUTHZ_RFQ_ARB_EXECUTE_JSON must reference AUTHZ_RFQ_MARKET_ID.");
  }
};

export const buildDerivativeLimitOrderPlans = ({
  marketId,
  subaccountId,
  injectiveAddress,
  orderSide,
  feeRecipient,
  price,
  priceStep,
  quantity,
  margin,
  orderCount,
  cidPrefix,
}: BuildDerivativeLimitOrderPlansOptions): DerivativeLimitOrderPlan[] => {
  assertPositiveInteger("AUTHZ_RFQ_ORDER_COUNT", orderCount);

  return Array.from({ length: orderCount }, (_, index) => ({
    marketId,
    subaccountId,
    injectiveAddress,
    orderSide,
    feeRecipient,
    price: addDecimalStep({
      name: "AUTHZ_RFQ_ORDER_PRICE",
      value: price,
      step: priceStep,
      stepCount: index,
    }),
    quantity,
    margin,
    cid: `${cidPrefix}-${index + 1}`,
  }));
};

export const buildSeedQuoteTemplates = ({
  chainId,
  contractAddress,
  marketId,
  makerAddress,
  takerAddress,
  takerDirection,
  price,
  quantity,
  margin,
  rfqIdStart,
  expiryTimestampMilliseconds,
  quoteCount,
}: SeedQuoteTemplateOptions): SeedQuoteTemplate[] => {
  assertPositiveInteger("AUTHZ_RFQ_QUOTE_COUNT", quoteCount);
  assertPositiveInteger("AUTHZ_RFQ_RFQ_ID_START", rfqIdStart);

  return Array.from({ length: quoteCount }, (_, index) => ({
    chainId,
    contractAddress,
    marketId,
    rfqId: rfqIdStart + index,
    takerDirection,
    margin,
    quantity,
    price,
    expiry: {
      timestamp: expiryTimestampMilliseconds,
    },
    maker: makerAddress,
    taker: takerAddress,
    signature: "",
    status: "pending",
    minFillQuantity: quantity,
    makerSubaccountNonce: 0,
    signMode: "v1",
  }));
};

interface DerivativesApiLike {
  fetchMarkets(params?: {
    quoteDenom?: string;
    marketStatus?: string;
  }): Promise<unknown[]>;
  fetchMarket(marketId: string): Promise<unknown>;
  fetchOrderbookV2(marketId: string): Promise<unknown>;
  fetchOrders(params?: {
    marketId?: string;
    subaccountId?: string;
    isConditional?: boolean;
  }): Promise<{ orders: unknown[] }>;
}

interface OracleApiLike {
  fetchOraclePrice(params: {
    baseSymbol: string;
    quoteSymbol: string;
    oracleType: string;
    oracleScaleFactor?: number;
  }): Promise<unknown>;
}

interface BankApiLike {
  fetchBalance(params: {
    accountAddress: string;
    denom: string;
  }): Promise<unknown>;
}

interface AccountApiLike {
  fetchSubaccountBalance(
    subaccountId: string,
    denom: string
  ): Promise<unknown>;
}

interface AuthzApiLike {
  fetchGrants(params: {
    granter: string;
    grantee: string;
  }): Promise<{ grants: unknown[] }>;
}

interface RfqApiLike {
  listConditionalOrders(params?: {
    status?: string[];
    perPage?: number;
    marketId?: string;
    requestAddress?: string;
  }): Promise<{ orders: unknown[] }>;
}

interface AccountPrivateKeyLike {
  toBech32(): string;
}

interface PrivateKeyFactoryLike<PrivateKeyValue extends AccountPrivateKeyLike> {
  fromHex(privateKey: string): PrivateKeyValue;
  fromMnemonic(words: string, path?: string): PrivateKeyValue;
}

interface MarketContext {
  readonly market: unknown;
  readonly orderbook: unknown;
  readonly summary: MarketCandidateSummary;
  readonly referencePrice: PriceReference;
}

export interface AccountCredentialEnvironment {
  readonly addressEnvironmentVariable: string;
  readonly seedPhraseEnvironmentVariable: string;
  readonly mnemonicEnvironmentVariable: string;
  readonly derivationPathEnvironmentVariable: string;
  readonly privateKeyEnvironmentVariable: string;
}

interface AccountAddresses {
  readonly accountAAddress: string;
  readonly accountBAddress: string;
  readonly accountCAddress: string;
}

export const getAccountCredentialEnvironment = (
  accountName: "A" | "B" | "C"
): AccountCredentialEnvironment => ({
  addressEnvironmentVariable: `AUTHZ_RFQ_ACCOUNT_${accountName}_ADDRESS`,
  seedPhraseEnvironmentVariable: `AUTHZ_RFQ_ACCOUNT_${accountName}_SEED_PHRASE`,
  mnemonicEnvironmentVariable: `AUTHZ_RFQ_ACCOUNT_${accountName}_MNEMONIC`,
  derivationPathEnvironmentVariable: `AUTHZ_RFQ_ACCOUNT_${accountName}_DERIVATION_PATH`,
  privateKeyEnvironmentVariable: `AUTHZ_RFQ_ACCOUNT_${accountName}_PRIVATE_KEY`,
});

const getSeedPhraseFromEnvironment = ({
  seedPhraseEnvironmentVariable,
  mnemonicEnvironmentVariable,
}: {
  readonly seedPhraseEnvironmentVariable: string;
  readonly mnemonicEnvironmentVariable: string;
}): string | undefined =>
  getEnvironmentVariable(seedPhraseEnvironmentVariable) ??
  getEnvironmentVariable(mnemonicEnvironmentVariable);

const getAccountPrivateKeyFromEnvironment = <
  PrivateKeyValue extends AccountPrivateKeyLike,
>({
  PrivateKey,
  seedPhraseEnvironmentVariable,
  mnemonicEnvironmentVariable,
  derivationPathEnvironmentVariable,
  privateKeyEnvironmentVariable,
}: {
  readonly PrivateKey: PrivateKeyFactoryLike<PrivateKeyValue>;
  readonly seedPhraseEnvironmentVariable: string;
  readonly mnemonicEnvironmentVariable: string;
  readonly derivationPathEnvironmentVariable: string;
  readonly privateKeyEnvironmentVariable: string;
}): PrivateKeyValue => {
  const seedPhrase = getSeedPhraseFromEnvironment({
    seedPhraseEnvironmentVariable,
    mnemonicEnvironmentVariable,
  });

  if (seedPhrase !== undefined) {
    return PrivateKey.fromMnemonic(
      seedPhrase,
      getEnvironmentVariable(derivationPathEnvironmentVariable)
    );
  }

  const privateKeyHex = getEnvironmentVariable(privateKeyEnvironmentVariable);

  if (privateKeyHex !== undefined) {
    return PrivateKey.fromHex(privateKeyHex);
  }

  throw new Error(
    `Set ${seedPhraseEnvironmentVariable} or ${mnemonicEnvironmentVariable}. ${privateKeyEnvironmentVariable} is still supported as a fallback.`
  );
};

export const getAccountAddressFromEnvironment = <
  PrivateKeyValue extends AccountPrivateKeyLike,
>({
  PrivateKey,
  addressEnvironmentVariable,
  seedPhraseEnvironmentVariable,
  mnemonicEnvironmentVariable,
  derivationPathEnvironmentVariable,
  privateKeyEnvironmentVariable,
}: {
  readonly PrivateKey: PrivateKeyFactoryLike<PrivateKeyValue>;
  readonly addressEnvironmentVariable: string;
  readonly seedPhraseEnvironmentVariable: string;
  readonly mnemonicEnvironmentVariable: string;
  readonly derivationPathEnvironmentVariable: string;
  readonly privateKeyEnvironmentVariable: string;
}): string => {
  const explicitAddress = getEnvironmentVariable(addressEnvironmentVariable);

  if (explicitAddress !== undefined) {
    return explicitAddress;
  }

  return getAccountPrivateKeyFromEnvironment({
    PrivateKey,
    seedPhraseEnvironmentVariable,
    mnemonicEnvironmentVariable,
    derivationPathEnvironmentVariable,
    privateKeyEnvironmentVariable,
  }).toBech32();
};

const getVerificationAccountAddresses = <
  PrivateKeyValue extends AccountPrivateKeyLike,
>(
  PrivateKey: PrivateKeyFactoryLike<PrivateKeyValue>
): AccountAddresses => ({
  accountAAddress: getAccountAddressFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("A"),
  }),
  accountBAddress: getAccountAddressFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("B"),
  }),
  accountCAddress: getAccountAddressFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("C"),
  }),
});

const fetchOptionalSubaccountBalance = async ({
  accountApi,
  subaccountId,
  denom,
}: {
  readonly accountApi: AccountApiLike;
  readonly subaccountId: string;
  readonly denom: string;
}): Promise<unknown | undefined> => {
  try {
    return await accountApi.fetchSubaccountBalance(subaccountId, denom);
  } catch {
    return undefined;
  }
};

const getCoinAmount = (coin: unknown): string => {
  if (!isRecord(coin)) {
    return "0";
  }

  return getRecordString(coin, "amount") ?? "0";
};

const getSubaccountAvailableBalance = (subaccountBalance: unknown): string => {
  if (!isRecord(subaccountBalance)) {
    return "0";
  }

  const deposit = subaccountBalance.deposit;

  if (!isRecord(deposit)) {
    return "0";
  }

  return getRecordString(deposit, "availableBalance") ?? "0";
};

const verifyAccountAFunds = async ({
  bankApi,
  accountApi,
  accountAddress,
  subaccountId,
  quoteDenom,
}: {
  readonly bankApi: BankApiLike;
  readonly accountApi: AccountApiLike;
  readonly accountAddress: string;
  readonly subaccountId: string;
  readonly quoteDenom: string;
}): Promise<Record<string, unknown>> => {
  const bankBalance = await bankApi.fetchBalance({
    accountAddress,
    denom: quoteDenom,
  });
  const subaccountBalance = await fetchOptionalSubaccountBalance({
    accountApi,
    subaccountId,
    denom: quoteDenom,
  });
  const bankAmount = getCoinAmount(bankBalance);
  const subaccountAvailableBalance =
    getSubaccountAvailableBalance(subaccountBalance);
  const requireSubaccountFunds = getBooleanEnvironmentVariable(
    "AUTHZ_RFQ_REQUIRE_SUBACCOUNT_FUNDS",
    true
  );

  if (
    requireSubaccountFunds &&
    parseDecimalUnits("accountA.subaccountAvailableBalance", subaccountAvailableBalance) <=
      0n
  ) {
    throw new Error(
      "Account A does not have available funds in the derivative subaccount for the quote denom."
    );
  }

  if (
    !requireSubaccountFunds &&
    parseDecimalUnits("accountA.bankAmount", bankAmount) <= 0n &&
    parseDecimalUnits(
      "accountA.subaccountAvailableBalance",
      subaccountAvailableBalance
    ) <= 0n
  ) {
    throw new Error("Account A does not have funds for the quote denom.");
  }

  return {
    accountAddress,
    subaccountId,
    quoteDenom,
    bankAmount,
    subaccountAvailableBalance,
    requireSubaccountFunds,
  };
};

const getMarketOracleDetails = (
  market: unknown
): {
  readonly oracleType: string;
  readonly oracleBase: string;
  readonly oracleQuote: string;
  readonly oracleScaleFactor: number;
  readonly quoteDecimals: number | undefined;
} => {
  if (!isRecord(market)) {
    throw new Error("Market response was not an object.");
  }

  const oracleType = getRecordString(market, "oracleType");
  const oracleBase = getRecordString(market, "oracleBase");
  const oracleQuote = getRecordString(market, "oracleQuote");
  const oracleScaleFactor = getRecordNumber(market, "oracleScaleFactor");
  const quoteToken = market.quoteToken;
  const quoteDecimals = isRecord(quoteToken)
    ? getRecordNumber(quoteToken, "decimals")
    : undefined;

  if (
    oracleType === undefined ||
    oracleBase === undefined ||
    oracleQuote === undefined ||
    oracleScaleFactor === undefined
  ) {
    throw new Error(
      "Selected market does not expose oracle fields required for mark price lookup."
    );
  }

  return {
    oracleType,
    oracleBase,
    oracleQuote,
    oracleScaleFactor,
    quoteDecimals,
  };
};

const fetchLatestIndexerMarkPrice = async ({
  oracleApi,
  market,
}: {
  readonly oracleApi: OracleApiLike;
  readonly market: unknown;
}): Promise<PriceReference> => {
  const {
    oracleType,
    oracleBase,
    oracleQuote,
    oracleScaleFactor,
    quoteDecimals,
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

const resolveReferencePrice = async ({
  oracleApi,
  market,
  orderbook,
}: {
  readonly oracleApi: OracleApiLike;
  readonly market: unknown;
  readonly orderbook: unknown;
}): Promise<PriceReference> => {
  try {
    return await fetchLatestIndexerMarkPrice({
      oracleApi,
      market,
    });
  } catch (error) {
    const explicitMarkPrice = getEnvironmentVariable("AUTHZ_RFQ_MARK_PRICE");

    if (explicitMarkPrice !== undefined) {
      requirePositiveDecimalUnits("AUTHZ_RFQ_MARK_PRICE", explicitMarkPrice);

      return {
        price: explicitMarkPrice,
        source: `AUTHZ_RFQ_MARK_PRICE-after-indexer-error:${String(error)}`,
      };
    }

    const orderbookMidPrice = getOrderbookMidPrice(orderbook);

    if (orderbookMidPrice !== undefined) {
      return {
        price: orderbookMidPrice,
        source: `orderbook-mid-after-indexer-error:${String(error)}`,
      };
    }

    throw error;
  }
};

const fetchExplicitMarketContext = async ({
  derivativesApi,
  oracleApi,
  marketId,
  quoteDenom,
}: {
  readonly derivativesApi: DerivativesApiLike;
  readonly oracleApi: OracleApiLike;
  readonly marketId: string;
  readonly quoteDenom: string;
}): Promise<MarketContext> => {
  const market = await derivativesApi.fetchMarket(marketId);

  if (!isUsdcQuotedPerpetualMarket(market, quoteDenom)) {
    throw new Error(
      `Market ${marketId} is not an active perpetual market quoted in ${quoteDenom}.`
    );
  }

  const orderbook = await derivativesApi.fetchOrderbookV2(marketId);
  const summary = summarizeMarketCandidate(market, orderbook);

  if (summary === undefined) {
    throw new Error(`Unable to summarize market ${marketId}.`);
  }

  return {
    market,
    orderbook,
    summary,
    referencePrice: await resolveReferencePrice({
      oracleApi,
      market,
      orderbook,
    }),
  };
};

const discoverMarketContext = async ({
  derivativesApi,
  oracleApi,
  quoteDenom,
}: {
  readonly derivativesApi: DerivativesApiLike;
  readonly oracleApi: OracleApiLike;
  readonly quoteDenom: string;
}): Promise<MarketContext> => {
  const maxOrderbookLevels = getNumberEnvironmentVariable(
    "AUTHZ_RFQ_MAX_DISCOVERY_ORDERBOOK_LEVELS",
    0
  );
  const markets = await derivativesApi.fetchMarkets({
    quoteDenom,
    marketStatus: "active",
  });
  const marketCandidates: MarketCandidateSummary[] = [];
  const candidateRecords: {
    readonly market: unknown;
    readonly orderbook: unknown;
    readonly summary: MarketCandidateSummary;
  }[] = [];

  for (const market of markets) {
    if (!isUsdcQuotedPerpetualMarket(market, quoteDenom)) {
      continue;
    }

    if (!isRecord(market)) {
      continue;
    }

    const marketId = getRecordString(market, "marketId");

    if (marketId === undefined) {
      continue;
    }

    const orderbook = await derivativesApi.fetchOrderbookV2(marketId);
    const summary = summarizeMarketCandidate(market, orderbook);

    if (summary === undefined) {
      continue;
    }

    marketCandidates.push(summary);
    candidateRecords.push({ market, orderbook, summary });
  }

  const selectedSummary = selectIlliquidMarketCandidate(
    marketCandidates,
    maxOrderbookLevels
  );

  if (selectedSummary === undefined) {
    throw new Error(
      `No active USDC perpetual market had ${maxOrderbookLevels} or fewer orderbook levels.`
    );
  }

  const selectedCandidate = candidateRecords.find(
    (candidate) => candidate.summary.marketId === selectedSummary.marketId
  );

  if (selectedCandidate === undefined) {
    throw new Error(`Unable to resolve selected market ${selectedSummary.marketId}.`);
  }

  return {
    ...selectedCandidate,
    referencePrice: await resolveReferencePrice({
      oracleApi,
      market: selectedCandidate.market,
      orderbook: selectedCandidate.orderbook,
    }),
  };
};

const resolveMarketContext = async ({
  derivativesApi,
  oracleApi,
  quoteDenom,
  seedOutputPath,
}: {
  readonly derivativesApi: DerivativesApiLike;
  readonly oracleApi: OracleApiLike;
  readonly quoteDenom: string;
  readonly seedOutputPath?: string;
}): Promise<MarketContext> => {
  const explicitMarketId = getEnvironmentVariable("AUTHZ_RFQ_MARKET_ID");
  const seedOutputMarketId =
    explicitMarketId === undefined && seedOutputPath !== undefined
      ? await readSeedOutputMarketId(seedOutputPath)
      : undefined;
  const marketId = explicitMarketId ?? seedOutputMarketId;

  if (marketId !== undefined) {
    return fetchExplicitMarketContext({
      derivativesApi,
      oracleApi,
      marketId,
      quoteDenom,
    });
  }

  return discoverMarketContext({
    derivativesApi,
    oracleApi,
    quoteDenom,
  });
};

const getOrderRemainingQuantity = (
  order: Record<string, unknown>
): string | undefined => {
  const unfilledQuantity = getRecordString(order, "unfilledQuantity");

  if (
    unfilledQuantity !== undefined &&
    parseDecimalUnits("order.unfilledQuantity", unfilledQuantity) > 0n
  ) {
    return unfilledQuantity;
  }

  return getRecordString(order, "quantity");
};

const verifyAccountAOrders = async ({
  derivativesApi,
  accountAddress,
  subaccountId,
  marketId,
  referencePrice,
}: {
  readonly derivativesApi: DerivativesApiLike;
  readonly accountAddress: string;
  readonly subaccountId: string;
  readonly marketId: string;
  readonly referencePrice: string;
}): Promise<Record<string, unknown>> => {
  const minimumOrderCount = assertPositiveInteger(
    "AUTHZ_RFQ_MIN_ORDER_COUNT",
    getNumberEnvironmentVariable("AUTHZ_RFQ_MIN_ORDER_COUNT", 3)
  );
  const toleranceBasisPoints = getNumberEnvironmentVariable(
    "AUTHZ_RFQ_MARK_PRICE_TOLERANCE_BPS",
    100
  );
  const { orders } = await derivativesApi.fetchOrders({
    marketId,
    subaccountId,
    isConditional: false,
  });
  const matchingOrders = orders.filter(isRecord).filter((order) => {
    const orderAccountAddress = getRecordString(order, "accountAddress");

    return (
      orderAccountAddress === undefined || orderAccountAddress === accountAddress
    );
  });
  const ordersAroundReferencePrice = matchingOrders.filter((order) => {
    const price = getRecordString(order, "price");

    return (
      price !== undefined &&
      isPriceWithinBasisPoints({
        price,
        referencePrice,
        toleranceBasisPoints,
      })
    );
  });

  if (ordersAroundReferencePrice.length < minimumOrderCount) {
    throw new Error(
      `Account A has ${ordersAroundReferencePrice.length} derivative limit orders around the reference price; expected at least ${minimumOrderCount}.`
    );
  }

  const remainingQuantities = ordersAroundReferencePrice
    .map(getOrderRemainingQuantity)
    .filter((quantity): quantity is string => quantity !== undefined);
  const totalRemainingQuantity = sumDecimalStrings(
    "accountA.orders.remainingQuantity",
    remainingQuantities
  );

  return {
    accountAddress,
    subaccountId,
    marketId,
    referencePrice,
    toleranceBasisPoints,
    matchingOrderCount: matchingOrders.length,
    ordersAroundReferencePriceCount: ordersAroundReferencePrice.length,
    totalRemainingQuantity,
    orders: ordersAroundReferencePrice.map((order) => ({
      cid: getRecordString(order, "cid"),
      orderHash: getRecordString(order, "orderHash"),
      orderSide: getRecordString(order, "orderSide"),
      orderType: getRecordString(order, "orderType"),
      price: getRecordString(order, "price"),
      quantity: getRecordString(order, "quantity"),
      unfilledQuantity: getRecordString(order, "unfilledQuantity"),
    })),
  };
};

const verifyContractGrant = async ({
  authzApi,
  label,
  granter,
  grantee,
  contractAddress,
}: {
  readonly authzApi: AuthzApiLike;
  readonly label: string;
  readonly granter: string;
  readonly grantee: string;
  readonly contractAddress: string;
}): Promise<Record<string, unknown>> => {
  const { grants } = await authzApi.fetchGrants({
    granter,
    grantee,
  });
  const matchingGrantCount = grants.filter((grant) =>
    recordContainsString(grant, contractAddress)
  ).length;

  if (matchingGrantCount === 0) {
    throw new Error(
      `${label} is missing an AuthZ grant for contract ${contractAddress}.`
    );
  }

  return {
    label,
    granter,
    grantee,
    contractAddress,
    matchingGrantCount,
    totalGrantCount: grants.length,
  };
};

const getJsonRecordEnvironmentVariable = (
  name: string
): Record<string, unknown> | undefined => {
  const value = getEnvironmentVariable(name);

  if (value === undefined) {
    return undefined;
  }

  return parseJsonRecord(name, value);
};

const getJsonArrayEnvironmentVariable = (
  name: string
): unknown[] | undefined => {
  const value = getEnvironmentVariable(name);

  if (value === undefined) {
    return undefined;
  }

  return parseJsonArray(name, value);
};

const getFunds = (): { amount: string; denom: string }[] | undefined => {
  const funds = getJsonArrayEnvironmentVariable("AUTHZ_RFQ_EXECUTE_FUNDS_JSON");

  if (funds === undefined) {
    return undefined;
  }

  return funds.map((fund, index) => {
    if (!isRecord(fund)) {
      throw new Error(`AUTHZ_RFQ_EXECUTE_FUNDS_JSON[${index}] must be an object.`);
    }

    const amount = fund.amount;
    const denom = fund.denom;

    if (typeof amount !== "string" || typeof denom !== "string") {
      throw new Error(
        `AUTHZ_RFQ_EXECUTE_FUNDS_JSON[${index}] must include string amount and denom.`
      );
    }

    return { amount, denom };
  });
};

const writeJsonFile = async (
  outputPath: string,
  value: unknown
): Promise<void> => {
  const [{ mkdir, writeFile }, { dirname }] = await Promise.all([
    import("fs/promises"),
    import("path"),
  ]);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
};

const readSeedOutput = async (
  seedOutputPath: string
): Promise<Record<string, unknown> | undefined> => {
  const { readFile } = await import("fs/promises");
  let rawSeedOutput: string;

  try {
    rawSeedOutput = await readFile(seedOutputPath, "utf8");
  } catch {
    return undefined;
  }

  return parseJsonRecord(seedOutputPath, rawSeedOutput);
};

const readSeedOutputMarketId = async (
  seedOutputPath: string
): Promise<string | undefined> => {
  const seedOutput = await readSeedOutput(seedOutputPath);

  if (seedOutput === undefined) {
    return undefined;
  }

  const market = seedOutput.market;

  if (isRecord(market)) {
    const marketId = getRecordString(market, "marketId");

    if (marketId !== undefined) {
      return marketId;
    }
  }

  const orderPlans = seedOutput.orderPlans;

  if (!Array.isArray(orderPlans)) {
    return undefined;
  }

  const firstOrderPlan = orderPlans.find(isRecord);

  return firstOrderPlan === undefined
    ? undefined
    : getRecordString(firstOrderPlan, "marketId");
};

const readSeedOutputAcceptQuotePayload = async (
  seedOutputPath: string
): Promise<Record<string, unknown> | undefined> => {
  const seedOutput = await readSeedOutput(seedOutputPath);

  if (seedOutput === undefined) {
    return undefined;
  }

  const acceptQuotePayload = seedOutput.acceptQuotePayload;

  if (!isRecord(acceptQuotePayload)) {
    return undefined;
  }

  return acceptQuotePayload;
};

const readSeedOutputQuotes = async (
  seedOutputPath: string
): Promise<unknown[] | undefined> => {
  const acceptQuotePayload = await readSeedOutputAcceptQuotePayload(seedOutputPath);

  if (acceptQuotePayload === undefined) {
    return undefined;
  }

  return extractQuotesFromAcceptQuotePayload(acceptQuotePayload);
};

const getAcceptQuotePayload = async (
  seedOutputPath: string
): Promise<Record<string, unknown>> => {
  const explicitPayload = getJsonRecordEnvironmentVariable(
    "AUTHZ_RFQ_ACCEPT_QUOTE_JSON"
  );

  if (explicitPayload) {
    return explicitPayload;
  }

  const quotes = getJsonArrayEnvironmentVariable("AUTHZ_RFQ_QUOTES_JSON");

  if (quotes) {
    return buildDefaultAcceptQuotePayload(quotes);
  }

  const seedOutputPayload = await readSeedOutputAcceptQuotePayload(seedOutputPath);

  if (seedOutputPayload) {
    return seedOutputPayload;
  }

  throw new Error(
    "Set AUTHZ_RFQ_ACCEPT_QUOTE_JSON or AUTHZ_RFQ_QUOTES_JSON, or run seed mode first."
  );
};

const getQuotesForVerification = async (
  seedOutputPath: string
): Promise<{ readonly source: string; readonly quotes: unknown[] } | undefined> => {
  const explicitPayload = getJsonRecordEnvironmentVariable(
    "AUTHZ_RFQ_ACCEPT_QUOTE_JSON"
  );

  if (explicitPayload !== undefined) {
    const quotes = extractQuotesFromAcceptQuotePayload(explicitPayload);

    if (quotes === undefined) {
      throw new Error("AUTHZ_RFQ_ACCEPT_QUOTE_JSON did not include quotes.");
    }

    return {
      source: "AUTHZ_RFQ_ACCEPT_QUOTE_JSON",
      quotes,
    };
  }

  const explicitQuotes = getJsonArrayEnvironmentVariable("AUTHZ_RFQ_QUOTES_JSON");

  if (explicitQuotes !== undefined) {
    return {
      source: "AUTHZ_RFQ_QUOTES_JSON",
      quotes: explicitQuotes,
    };
  }

  if (
    !getBooleanEnvironmentVariable("AUTHZ_RFQ_VERIFY_SEED_OUTPUT_QUOTES", false)
  ) {
    return undefined;
  }

  const seedOutputQuotes = await readSeedOutputQuotes(seedOutputPath);

  if (seedOutputQuotes === undefined) {
    return undefined;
  }

  return {
    source: seedOutputPath,
    quotes: seedOutputQuotes,
  };
};

const verifyConditionalOrders = async ({
  rfqApi,
  marketId,
  takerAddress,
  expectedTotalQuantity,
}: {
  readonly rfqApi: RfqApiLike;
  readonly marketId: string;
  readonly takerAddress: string;
  readonly expectedTotalQuantity: string | undefined;
}): Promise<Record<string, unknown>> => {
  const minimumExpirySeconds = assertPositiveInteger(
    "AUTHZ_RFQ_MIN_QUOTE_EXPIRY_SECONDS",
    getNumberEnvironmentVariable(
      "AUTHZ_RFQ_MIN_QUOTE_EXPIRY_SECONDS",
      60 * 60
    )
  );
  const { orders } = await rfqApi.listConditionalOrders({
    marketId,
    requestAddress: takerAddress,
    status: ["active", "pending", "open"],
    perPage: 100,
  });
  const nowMilliseconds = Date.now();
  const matchingOrders = orders.filter(isRecord).filter((order) => {
    const quantity = getRecordString(order, "quantity");
    const expiresAt = getRecordNumber(order, "expiresAt");

    return (
      quantity !== undefined &&
      expiresAt !== undefined &&
      expiresAt - nowMilliseconds >= minimumExpirySeconds * 1000
    );
  });
  const totalQuantity = sumDecimalStrings(
    "conditionalOrders.quantity",
    matchingOrders
      .map((order) => getRecordString(order, "quantity"))
      .filter((quantity): quantity is string => quantity !== undefined)
  );
  const quantityMatchesExpected =
    expectedTotalQuantity === undefined
      ? undefined
      : parseDecimalUnits("conditionalOrders.totalQuantity", totalQuantity) ===
        parseDecimalUnits("expectedTotalQuantity", expectedTotalQuantity);

  if (matchingOrders.length === 0) {
    throw new Error("No long-expiry RFQ conditional orders were available.");
  }

  if (
    getBooleanEnvironmentVariable(
      "AUTHZ_RFQ_REQUIRE_QUOTE_QUANTITY_MATCH",
      true
    ) &&
    quantityMatchesExpected !== true
  ) {
    throw new Error(
      "RFQ conditional order quantity does not match the resting derivative order quantity."
    );
  }

  return {
    source: "rfq-indexer-conditional-orders",
    marketId,
    requestAddress: takerAddress,
    minimumExpirySeconds,
    orderCount: matchingOrders.length,
    totalQuantity,
    expectedTotalQuantity,
    quantityMatchesExpected,
    note:
      "Conditional orders prove usable indexed RFQ conditionals, but not raw maker quote ownership.",
  };
};

const verifyRfqQuotes = async ({
  rfqApi,
  seedOutputPath,
  makerAddress,
  takerAddress,
  marketId,
  contractAddress,
  expectedTotalQuantity,
}: {
  readonly rfqApi: RfqApiLike;
  readonly seedOutputPath: string;
  readonly makerAddress: string;
  readonly takerAddress: string;
  readonly marketId: string;
  readonly contractAddress: string;
  readonly expectedTotalQuantity: string | undefined;
}): Promise<Record<string, unknown>> => {
  const minimumExpirySeconds = assertPositiveInteger(
    "AUTHZ_RFQ_MIN_QUOTE_EXPIRY_SECONDS",
    getNumberEnvironmentVariable(
      "AUTHZ_RFQ_MIN_QUOTE_EXPIRY_SECONDS",
      60 * 60
    )
  );
  const suppliedQuotes = await getQuotesForVerification(seedOutputPath);

  if (suppliedQuotes !== undefined) {
    const summary = summarizeQuoteVerification({
      quotes: suppliedQuotes.quotes,
      makerAddress,
      takerAddress,
      marketId,
      contractAddress,
      expectedTotalQuantity,
      minimumExpirySeconds,
      nowMilliseconds: Date.now(),
    });

    assertQuoteVerification({
      summary,
      requireSignatures: getBooleanEnvironmentVariable(
        "AUTHZ_RFQ_REQUIRE_QUOTE_SIGNATURES",
        true
      ),
      requireQuantityMatch: getBooleanEnvironmentVariable(
        "AUTHZ_RFQ_REQUIRE_QUOTE_QUANTITY_MATCH",
        true
      ),
    });

    return {
      source: suppliedQuotes.source,
      minimumExpirySeconds,
      ...summary,
    };
  }

  if (
    getBooleanEnvironmentVariable(
      "AUTHZ_RFQ_ALLOW_CONDITIONAL_ORDER_VERIFICATION",
      false
    )
  ) {
    return verifyConditionalOrders({
      rfqApi,
      marketId,
      takerAddress,
      expectedTotalQuantity,
    });
  }

  throw new Error(
    "Set AUTHZ_RFQ_QUOTES_JSON or AUTHZ_RFQ_ACCEPT_QUOTE_JSON with signed account B quotes. Set AUTHZ_RFQ_ALLOW_CONDITIONAL_ORDER_VERIFICATION=true only if indexed RFQ conditional orders are sufficient for this run."
  );
};

const getOrderType = (
  orderSide: DerivativeOrderSide,
  orderTypeMap: { readonly BUY: number; readonly SELL: number }
): number => (orderSide === "BUY" ? orderTypeMap.BUY : orderTypeMap.SELL);

const runVerifyMode = async (): Promise<Record<string, unknown>> => {
  const { getNetworkEndpoints, Network } = await import("@injectivelabs/networks");
  const {
    ChainGrpcAuthZApi,
    ChainGrpcBankApi,
    IndexerGrpcAccountApi,
    IndexerGrpcDerivativesApi,
    IndexerGrpcOracleApi,
    IndexerGrpcRFQApi,
    PrivateKey,
    getSubaccountId,
  } = await import("@injectivelabs/sdk-ts");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Testnet
  );
  const endpoints = getNetworkEndpoints(network);
  const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);
  const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
  const accountApi = new IndexerGrpcAccountApi(endpoints.indexer);
  const rfqApi = new IndexerGrpcRFQApi(endpoints.indexer);
  const bankApi = new ChainGrpcBankApi(endpoints.grpc);
  const authzApi = new ChainGrpcAuthZApi(endpoints.grpc);
  const quoteDenom = getEnvironmentVariable("AUTHZ_RFQ_QUOTE_DENOM", defaultQuoteDenom);
  const rfqContractAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_CONTRACT_ADDRESS",
    defaultRfqContractAddress
  );
  const arbContractAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_ARB_CONTRACT_ADDRESS",
    defaultArbContractAddress
  );
  const seedOutputPath = getEnvironmentVariable(
    "AUTHZ_RFQ_SEED_OUTPUT_PATH",
    defaultSeedOutputPath
  );
  const verificationOutputPath = getEnvironmentVariable(
    "AUTHZ_RFQ_VERIFICATION_OUTPUT_PATH",
    defaultVerificationOutputPath
  );
  const accountAddresses = getVerificationAccountAddresses(PrivateKey);
  const accountASubaccountIndex = getNumberEnvironmentVariable(
    "AUTHZ_RFQ_ACCOUNT_A_SUBACCOUNT_INDEX",
    0
  );
  const accountASubaccountId = getEnvironmentVariable(
    "AUTHZ_RFQ_ACCOUNT_A_SUBACCOUNT_ID",
    getSubaccountId(accountAddresses.accountAAddress, accountASubaccountIndex)
  );
  const marketContext = await resolveMarketContext({
    derivativesApi,
    oracleApi,
    quoteDenom,
    seedOutputPath,
  });
  const accountAFunds = await verifyAccountAFunds({
    bankApi,
    accountApi,
    accountAddress: accountAddresses.accountAAddress,
    subaccountId: accountASubaccountId,
    quoteDenom,
  });
  const accountAOrders = await verifyAccountAOrders({
    derivativesApi,
    accountAddress: accountAddresses.accountAAddress,
    subaccountId: accountASubaccountId,
    marketId: marketContext.summary.marketId,
    referencePrice: marketContext.referencePrice.price,
  });
  const expectedTotalQuantity =
    typeof accountAOrders.totalRemainingQuantity === "string"
      ? accountAOrders.totalRemainingQuantity
      : undefined;
  const accountBGrantGrantee = getEnvironmentVariable(
    "AUTHZ_RFQ_ACCOUNT_B_GRANTEE_ADDRESS",
    accountAddresses.accountCAddress
  );
  const accountCGrantGranter =
    getEnvironmentVariable("AUTHZ_RFQ_ACCOUNT_C_GRANTER_ADDRESS") ??
    getEnvironmentVariable("AUTHZ_RFQ_GRANTER_ADDRESS");

  if (accountCGrantGranter === undefined) {
    throw new Error(
      "Set AUTHZ_RFQ_ACCOUNT_C_GRANTER_ADDRESS or AUTHZ_RFQ_GRANTER_ADDRESS to verify account C AuthZ grants."
    );
  }

  const accountCGrantGrantee = getEnvironmentVariable(
    "AUTHZ_RFQ_ACCOUNT_C_GRANTEE_ADDRESS",
    accountAddresses.accountCAddress
  );
  const accountBGrant = await verifyContractGrant({
    authzApi,
    label: "account B -> account C RFQ grant",
    granter: accountAddresses.accountBAddress,
    grantee: accountBGrantGrantee,
    contractAddress: rfqContractAddress,
  });
  const accountCToRfqGrant = await verifyContractGrant({
    authzApi,
    label: "account C RFQ grant",
    granter: accountCGrantGranter,
    grantee: accountCGrantGrantee,
    contractAddress: rfqContractAddress,
  });
  const accountCToArbGrant = await verifyContractGrant({
    authzApi,
    label: "account C ARB grant",
    granter: accountCGrantGranter,
    grantee: accountCGrantGrantee,
    contractAddress: arbContractAddress,
  });
  const quoteTakerAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_QUOTE_TAKER_ADDRESS",
    accountAddresses.accountCAddress
  );
  const accountBQuotes = await verifyRfqQuotes({
    rfqApi,
    seedOutputPath,
    makerAddress: accountAddresses.accountBAddress,
    takerAddress: quoteTakerAddress,
    marketId: marketContext.summary.marketId,
    contractAddress: rfqContractAddress,
    expectedTotalQuantity,
  });
  const verificationOutput = {
    network,
    endpoints: {
      indexer: endpoints.indexer,
      grpc: endpoints.grpc,
    },
    quoteDenom,
    contracts: {
      rfq: rfqContractAddress,
      arb: arbContractAddress,
    },
    accounts: {
      accountA: accountAddresses.accountAAddress,
      accountB: accountAddresses.accountBAddress,
      accountC: accountAddresses.accountCAddress,
      accountBGrantGrantee,
      accountCGrantGranter,
      accountCGrantGrantee,
    },
    market: {
      ...marketContext.summary,
      referencePrice: marketContext.referencePrice,
    },
    accountAFunds,
    accountAOrders,
    authzGrants: {
      accountBGrant,
      accountCToRfqGrant,
      accountCToArbGrant,
    },
    accountBQuotes,
    verificationOutputPath,
  };

  await writeJsonFile(verificationOutputPath, verificationOutput);

  console.log(verificationOutput);

  return verificationOutput;
};

const runSeedMode = async (): Promise<void> => {
  const { getNetworkChainInfo, getNetworkEndpoints, Network } = await import(
    "@injectivelabs/networks"
  );
  const {
    ChainGrpcBankApi,
    IndexerGrpcAccountApi,
    IndexerGrpcDerivativesApi,
    IndexerGrpcOracleApi,
    MsgBroadcasterWithPk,
    MsgCreateDerivativeLimitOrder,
    OrderTypeMap,
    PrivateKey,
    getSubaccountId,
  } = await import("@injectivelabs/sdk-ts");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const accountAPrivateKey = getAccountPrivateKeyFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("A"),
  });
  const accountBPrivateKey = getAccountPrivateKeyFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("B"),
  });
  const accountCPrivateKey = getAccountPrivateKeyFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("C"),
  });
  const accountAAddress = accountAPrivateKey.toBech32();
  const accountBAddress = accountBPrivateKey.toBech32();
  const accountCAddress = accountCPrivateKey.toBech32();
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Testnet
  );
  const endpoints = getNetworkEndpoints(network);
  const chainInfo = getNetworkChainInfo(network);
  const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);
  const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
  const accountApi = new IndexerGrpcAccountApi(endpoints.indexer);
  const bankApi = new ChainGrpcBankApi(endpoints.grpc);
  const quoteDenom = getEnvironmentVariable("AUTHZ_RFQ_QUOTE_DENOM", defaultQuoteDenom);
  const marketContext = await resolveMarketContext({
    derivativesApi,
    oracleApi,
    quoteDenom,
  });
  const orderSide = parseDerivativeOrderSide(
    getEnvironmentVariable("AUTHZ_RFQ_ORDER_SIDE", "BUY")
  );
  const accountASubaccountIndex = getNumberEnvironmentVariable(
    "AUTHZ_RFQ_ACCOUNT_A_SUBACCOUNT_INDEX",
    0
  );
  const orderCount = assertPositiveInteger(
    "AUTHZ_RFQ_ORDER_COUNT",
    getNumberEnvironmentVariable("AUTHZ_RFQ_ORDER_COUNT", 3)
  );
  const quoteCount = assertPositiveInteger(
    "AUTHZ_RFQ_QUOTE_COUNT",
    getNumberEnvironmentVariable("AUTHZ_RFQ_QUOTE_COUNT", orderCount)
  );
  const quoteExpirySeconds = assertPositiveInteger(
    "AUTHZ_RFQ_QUOTE_EXPIRY_SECONDS",
    getNumberEnvironmentVariable("AUTHZ_RFQ_QUOTE_EXPIRY_SECONDS", 60 * 60 * 24)
  );
  const rfqIdStart = assertPositiveInteger(
    "AUTHZ_RFQ_RFQ_ID_START",
    getNumberEnvironmentVariable("AUTHZ_RFQ_RFQ_ID_START", 1)
  );
  const seedOutputPath = getEnvironmentVariable(
    "AUTHZ_RFQ_SEED_OUTPUT_PATH",
    defaultSeedOutputPath
  );
  const marketId = marketContext.summary.marketId;
  const orderPrice = getEnvironmentVariable("AUTHZ_RFQ_ORDER_PRICE") ??
    applyBasisPointOffset({
      price: marketContext.referencePrice.price,
      basisPoints: getNumberEnvironmentVariable(
        "AUTHZ_RFQ_ORDER_PRICE_OFFSET_BPS",
        orderSide === "BUY" ? -10 : 10
      ),
    });
  const orderQuantity = requireEnvironmentVariable("AUTHZ_RFQ_ORDER_QUANTITY");
  const orderMargin = requireEnvironmentVariable("AUTHZ_RFQ_ORDER_MARGIN");
  const orderPriceStep = getEnvironmentVariable("AUTHZ_RFQ_ORDER_PRICE_STEP") ??
    getBasisPointStep({
      price: marketContext.referencePrice.price,
      basisPoints:
        orderSide === "BUY"
          ? getNumberEnvironmentVariable("AUTHZ_RFQ_ORDER_PRICE_STEP_BPS", 5)
          : -getNumberEnvironmentVariable("AUTHZ_RFQ_ORDER_PRICE_STEP_BPS", 5),
    });
  const orderSubaccountId = getEnvironmentVariable(
    "AUTHZ_RFQ_ACCOUNT_A_SUBACCOUNT_ID",
    getSubaccountId(accountAAddress, accountASubaccountIndex)
  );
  const accountAFunds = getBooleanEnvironmentVariable(
    "AUTHZ_RFQ_SKIP_SEED_PREFLIGHT_VERIFY",
    false
  )
    ? undefined
    : await verifyAccountAFunds({
        bankApi,
        accountApi,
        accountAddress: accountAAddress,
        subaccountId: orderSubaccountId,
        quoteDenom,
      });
  const feeRecipient = getEnvironmentVariable(
    "AUTHZ_RFQ_FEE_RECIPIENT",
    accountAAddress
  );
  const cidPrefix = getEnvironmentVariable(
    "AUTHZ_RFQ_CID_PREFIX",
    `authz-rfq-${Date.now()}`
  );
  const rfqContractAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_CONTRACT_ADDRESS",
    defaultRfqContractAddress
  );
  const quotePrice = getEnvironmentVariable("AUTHZ_RFQ_QUOTE_PRICE", orderPrice);
  const quoteQuantity = getEnvironmentVariable(
    "AUTHZ_RFQ_QUOTE_QUANTITY",
    orderQuantity
  );
  const quoteMargin = getEnvironmentVariable("AUTHZ_RFQ_QUOTE_MARGIN", orderMargin);
  const quoteTakerAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_QUOTE_TAKER_ADDRESS",
    accountCAddress
  );
  const quoteDirection = getEnvironmentVariable(
    "AUTHZ_RFQ_QUOTE_TAKER_DIRECTION",
    orderSide === "BUY" ? "long" : "short"
  );
  const simulateTx = !getBooleanEnvironmentVariable(
    "BROADCAST_TRANSACTIONS",
    false
  );
  const orderPlans = buildDerivativeLimitOrderPlans({
    marketId,
    subaccountId: orderSubaccountId,
    injectiveAddress: accountAAddress,
    orderSide,
    feeRecipient,
    price: orderPrice,
    priceStep: orderPriceStep,
    quantity: orderQuantity,
    margin: orderMargin,
    orderCount,
    cidPrefix,
  });
  const orderMessages = orderPlans.map((orderPlan) =>
    MsgCreateDerivativeLimitOrder.fromJSON({
      marketId: orderPlan.marketId,
      subaccountId: orderPlan.subaccountId,
      injectiveAddress: orderPlan.injectiveAddress,
      orderType: getOrderType(orderPlan.orderSide, OrderTypeMap),
      feeRecipient: orderPlan.feeRecipient,
      price: orderPlan.price,
      quantity: orderPlan.quantity,
      margin: orderPlan.margin,
      cid: orderPlan.cid,
    })
  );
  const seedOrderResponse = await new MsgBroadcasterWithPk({
    network,
    privateKey: accountAPrivateKey,
    simulateTx,
  }).broadcast({ msgs: orderMessages });
  const quoteTemplates = buildSeedQuoteTemplates({
    chainId: chainInfo.chainId,
    contractAddress: rfqContractAddress,
    marketId,
    makerAddress: accountBAddress,
    takerAddress: quoteTakerAddress,
    takerDirection: quoteDirection,
    price: quotePrice,
    quantity: quoteQuantity,
    margin: quoteMargin,
    rfqIdStart,
    expiryTimestampMilliseconds: Date.now() + quoteExpirySeconds * 1000,
    quoteCount,
  });
  const acceptQuotePayload = buildDefaultAcceptQuotePayload(quoteTemplates);
  const seedOutput = {
    network,
    endpoints: {
      indexer: endpoints.indexer,
      grpc: endpoints.grpc,
    },
    quoteDenom,
    market: {
      ...marketContext.summary,
      referencePrice: marketContext.referencePrice,
    },
    accountAFunds,
    simulateTx,
    accounts: {
      orderPlacer: accountAAddress,
      maker: accountBAddress,
      executor: accountCAddress,
    },
    contracts: {
      rfq: rfqContractAddress,
      arb: getEnvironmentVariable(
        "AUTHZ_RFQ_ARB_CONTRACT_ADDRESS",
        defaultArbContractAddress
      ),
    },
    orderPlans,
    quoteTemplates,
    acceptQuotePayload,
    seedOrderResponse,
  };
  await writeJsonFile(seedOutputPath, seedOutput);

  console.log({
    ...seedOutput,
    seedOutputPath,
  });
};

const runExecuteMode = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } = await import("@injectivelabs/networks");
  const {
    IndexerGrpcDerivativesApi,
    IndexerGrpcOracleApi,
    MsgAuthzExec,
    MsgBroadcasterWithPk,
    MsgCreateDerivativeLimitOrder,
    MsgExecuteContractCompat,
    OrderTypeMap,
    PrivateKey,
    getSubaccountId,
  } = await import("@injectivelabs/sdk-ts");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const accountCPrivateKey = getAccountPrivateKeyFromEnvironment({
    PrivateKey,
    ...getAccountCredentialEnvironment("C"),
  });
  const accountCAddress = accountCPrivateKey.toBech32();
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Testnet
  );
  const endpoints = getNetworkEndpoints(network);
  const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);
  const oracleApi = new IndexerGrpcOracleApi(endpoints.indexer);
  const quoteDenom = getEnvironmentVariable(
    "AUTHZ_RFQ_QUOTE_DENOM",
    defaultQuoteDenom
  );
  const seedOutputPath = getEnvironmentVariable(
    "AUTHZ_RFQ_SEED_OUTPUT_PATH",
    defaultSeedOutputPath
  );
  const marketContext = await resolveMarketContext({
    derivativesApi,
    oracleApi,
    quoteDenom,
    seedOutputPath,
  });
  const executionPath = parseExecutionPath(
    getEnvironmentVariable("AUTHZ_RFQ_EXECUTION_PATH", "direct")
  );
  const preflightVerification = getBooleanEnvironmentVariable(
    "AUTHZ_RFQ_VERIFY_BEFORE_EXECUTE",
    true
  )
    ? await runVerifyMode()
    : undefined;
  const executeWithAuthz = getBooleanEnvironmentVariable(
    "AUTHZ_RFQ_EXECUTE_WITH_AUTHZ",
    true
  );
  const executionSender = executeWithAuthz
    ? requireEnvironmentVariable("AUTHZ_RFQ_GRANTER_ADDRESS")
    : accountCAddress;
  const executeSubaccountIndex = getNumberEnvironmentVariable(
    "AUTHZ_RFQ_EXECUTE_SUBACCOUNT_INDEX",
    0
  );
  const executeSubaccountId = getEnvironmentVariable(
    "AUTHZ_RFQ_EXECUTE_SUBACCOUNT_ID",
    getSubaccountId(executionSender, executeSubaccountIndex)
  );
  const rfqContractAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_CONTRACT_ADDRESS",
    defaultRfqContractAddress
  );
  const arbContractAddress = getEnvironmentVariable(
    "AUTHZ_RFQ_ARB_CONTRACT_ADDRESS",
    defaultArbContractAddress
  );
  const funds = getFunds();
  const arbExecutePayload =
    executionPath === "arb"
      ? getJsonRecordEnvironmentVariable("AUTHZ_RFQ_ARB_EXECUTE_JSON") ??
        (() => {
          throw new Error(
            "AUTHZ_RFQ_ARB_EXECUTE_JSON is required when AUTHZ_RFQ_EXECUTION_PATH=arb."
          );
        })()
      : undefined;

  if (
    executionPath === "arb" &&
    arbExecutePayload !== undefined &&
    !getBooleanEnvironmentVariable("AUTHZ_RFQ_SKIP_ARB_PAYLOAD_VALIDATION", false)
  ) {
    assertArbPayloadReferencesExecutionInputs({
      payload: arbExecutePayload,
      rfqContractAddress,
      marketId: marketContext.summary.marketId,
    });
  }

  const innerMessages =
    executionPath === "arb"
      ? [
          MsgExecuteContractCompat.fromJSON({
            contractAddress: arbContractAddress,
            sender: executionSender,
            msg: arbExecutePayload,
            funds,
          }),
        ]
      : [
          MsgCreateDerivativeLimitOrder.fromJSON({
            marketId: marketContext.summary.marketId,
            subaccountId: executeSubaccountId,
            injectiveAddress: executionSender,
            orderType: getOrderType(
              parseDerivativeOrderSide(
                getEnvironmentVariable(
                  "AUTHZ_RFQ_EXECUTE_ORDER_SIDE",
                  getOppositeOrderSide(
                    parseDerivativeOrderSide(
                      getEnvironmentVariable("AUTHZ_RFQ_ORDER_SIDE", "BUY")
                    )
                  )
                )
              ),
              OrderTypeMap
            ),
            feeRecipient: getEnvironmentVariable(
              "AUTHZ_RFQ_FEE_RECIPIENT",
              executionSender
            ),
            price: requireEnvironmentVariable("AUTHZ_RFQ_EXECUTE_PRICE"),
            quantity: requireEnvironmentVariable("AUTHZ_RFQ_EXECUTE_QUANTITY"),
            margin: requireEnvironmentVariable("AUTHZ_RFQ_EXECUTE_MARGIN"),
            cid: getEnvironmentVariable(
              "AUTHZ_RFQ_EXECUTE_CID",
              `authz-rfq-execute-${Date.now()}`
            ),
          }),
          MsgExecuteContractCompat.fromJSON({
            contractAddress: rfqContractAddress,
            sender: executionSender,
            msg: await getAcceptQuotePayload(seedOutputPath),
            funds,
          }),
        ];
  const msgs = executeWithAuthz
    ? MsgAuthzExec.fromJSON({
        grantee: accountCAddress,
        msgs: innerMessages,
      })
    : innerMessages;
  const simulateTx = !getBooleanEnvironmentVariable(
    "BROADCAST_TRANSACTIONS",
    false
  );
  const gasLimit = getNumberEnvironmentVariable(
    "AUTHZ_RFQ_GAS_LIMIT",
    executionPath === "arb" ? 2_500_000 : 3_500_000
  );
  const executeResponse = await new MsgBroadcasterWithPk({
    network,
    privateKey: accountCPrivateKey,
    simulateTx,
  }).broadcast({
    msgs,
    gas: {
      gas: gasLimit,
    },
  });

  console.log({
    network,
    simulateTx,
    executionPath,
    executeWithAuthz,
    quoteDenom,
    market: {
      ...marketContext.summary,
      referencePrice: marketContext.referencePrice,
    },
    contracts: {
      rfq: rfqContractAddress,
      arb: arbContractAddress,
    },
    executionSender,
    grantee: accountCAddress,
    executeSubaccountId,
    preflightVerificationPath:
      typeof preflightVerification?.verificationOutputPath !== "string"
        ? undefined
        : preflightVerification.verificationOutputPath,
    executeResponse,
  });
};

export const run = async (): Promise<void> => {
  const mode = parseAuthzRfqMode(getEnvironmentVariable("AUTHZ_RFQ_MODE", "seed"));

  if (mode === "seed") {
    await runSeedMode();
    return;
  }

  if (mode === "verify") {
    await runVerifyMode();
    return;
  }

  await runExecuteMode();
};

runDirectly(module, run);
