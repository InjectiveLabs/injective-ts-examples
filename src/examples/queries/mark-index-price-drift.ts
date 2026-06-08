import type {
  DerivativeMarket,
  OraclePriceV2,
  OraclePriceV2Filter,
  PriceResponse,
  WsPriceOracleMarketPrice,
} from "@injectivelabs/sdk-ts";
import type { ExampleMetadata } from "../types";
import { runDirectly } from "../../lib/direct-run";

const defaultMainnetMarketIds = [
  "0x0ee7ca44147bab6ec81ac293b5fe7915488e612af59964b2d663d6008d861dee",
];

const marketPriceSnapshotChunkSize = 100;
const defaultSampleCount = 60;
const defaultSampleIntervalMilliseconds = 1000;
const defaultMainnetWsPriceOracleEndpoint =
  "https://ws-price-oracle.injective.tech/";
const defaultTestnetWsPriceOracleEndpoint =
  "https://testnet.ws-price-oracle.injective.tech/";

export const metadata: ExampleMetadata = {
  id: "query:mark-index-price-drift",
  category: "queries",
  title: "Investigate mark/index price drift",
  description:
    "Sample derivative mark prices and TrueCurrent index prices side by side.",
  requiresEnvironment: ["WS_PRICE_ORACLE_API_KEY"],
};

interface MarketWithOraclePair extends DerivativeMarket {
  readonly oracleBase: string;
  readonly oracleQuote: string;
  readonly oracleScaleFactor: number;
}

interface TrackedMarket {
  readonly market: MarketWithOraclePair;
  readonly priceDecimals: number;
  readonly quoteDecimals?: number;
}

export interface PriceComparison {
  readonly rawDifference?: number;
  readonly scaledDifference?: number;
  readonly scaledAbsoluteDifference?: number;
  readonly basisPointsDifference?: number;
  readonly displayEqual: boolean;
}

interface PriceSnapshot {
  readonly rawPrice?: string;
  readonly scaledPrice?: number;
  readonly displayPrice?: string;
}

interface SampleRecord {
  readonly sampleNumber: number;
  readonly sampledAt: string;
  readonly network: string;
  readonly endpoints: {
    readonly indexer: string;
    readonly wsPriceOracle: string;
  };
  readonly market: {
    readonly marketId: string;
    readonly ticker: string;
    readonly oracleType: string;
    readonly oracleBase: string;
    readonly oracleQuote: string;
    readonly oracleScaleFactor: number;
    readonly quoteDecimals?: number;
    readonly priceDecimals: number;
  };
  readonly markPriceV1: PriceSnapshot & {
    readonly response?: PriceResponse;
  };
  readonly markPriceV2: PriceSnapshot & {
    readonly response?: OraclePriceV2;
  };
  readonly indexPrice: PriceSnapshot & {
    readonly response?: WsPriceOracleMarketPrice;
    readonly timestampAgeMilliseconds?: number;
    readonly receivedAtAgeMilliseconds?: number;
    readonly sequence?: string;
  };
  readonly comparisons: {
    readonly indexVsMarkV1: PriceComparison;
    readonly indexVsMarkV2: PriceComparison;
  };
}

interface SummaryAccumulator {
  readonly marketId: string;
  readonly ticker: string;
  samples: number;
  markV1DisplayCollisions: number;
  markV2DisplayCollisions: number;
  markV1BasisPointsTotal: number;
  markV2BasisPointsTotal: number;
  markV1BasisPointsCount: number;
  markV2BasisPointsCount: number;
  markV1MaxAbsoluteBasisPoints: number;
  markV2MaxAbsoluteBasisPoints: number;
}

const isMarketWithOraclePair = (
  market: DerivativeMarket
): market is MarketWithOraclePair => {
  const candidate = market as Partial<MarketWithOraclePair>;

  return (
    typeof candidate.oracleBase === "string" &&
    candidate.oracleBase.length > 0 &&
    typeof candidate.oracleQuote === "string" &&
    candidate.oracleQuote.length > 0 &&
    typeof candidate.oracleScaleFactor === "number"
  );
};

export const getDefaultWsPriceOracleEndpoint = (network: string): string => {
  if (network.toLowerCase().includes("testnet")) {
    return defaultTestnetWsPriceOracleEndpoint;
  }

  return defaultMainnetWsPriceOracleEndpoint;
};

export const assertPositiveInteger = (name: string, value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
};

export const assertNonNegativeInteger = (
  name: string,
  value: number
): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return value;
};

export const chunkArray = <Value>(
  values: readonly Value[],
  chunkSize: number
): Value[][] => {
  const chunks: Value[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
};

export const parseTimestampToMilliseconds = (
  timestamp?: string
): number | undefined => {
  if (!timestamp) {
    return undefined;
  }

  const numericTimestamp = Number(timestamp);

  if (Number.isFinite(numericTimestamp)) {
    if (numericTimestamp >= 1e18) {
      return numericTimestamp / 1e6;
    }

    if (numericTimestamp >= 1e15) {
      return numericTimestamp / 1e3;
    }

    if (numericTimestamp >= 1e12) {
      return numericTimestamp;
    }

    if (numericTimestamp >= 1e9) {
      return numericTimestamp * 1000;
    }

    return undefined;
  }

  const parsedTimestamp = Date.parse(timestamp);

  if (!Number.isFinite(parsedTimestamp)) {
    return undefined;
  }

  return parsedTimestamp;
};

export const calculateTimestampAgeMilliseconds = ({
  nowMilliseconds,
  timestamp,
}: {
  nowMilliseconds: number;
  timestamp?: string;
}): number | undefined => {
  const timestampMilliseconds = parseTimestampToMilliseconds(timestamp);

  if (timestampMilliseconds === undefined) {
    return undefined;
  }

  return nowMilliseconds - timestampMilliseconds;
};

export const scaleOraclePrice = ({
  price,
  quoteDecimals,
  oracleScaleFactor,
}: {
  price?: string;
  quoteDecimals?: number;
  oracleScaleFactor: number;
}): number | undefined => {
  if (!price) {
    return undefined;
  }

  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) {
    return undefined;
  }

  if (numericPrice === 0 || quoteDecimals === undefined) {
    return numericPrice;
  }

  if (quoteDecimals === oracleScaleFactor) {
    return numericPrice;
  }

  return numericPrice * 10 ** (oracleScaleFactor - quoteDecimals);
};

export const truncateToFixed = (value: number, decimals: number): string => {
  const factor = 10 ** decimals;
  const truncatedValue = Math.trunc(value * factor) / factor;

  return truncatedValue.toFixed(decimals);
};

export const getPriceDecimals = ({
  minPriceTickSize,
  quoteDecimals,
}: {
  minPriceTickSize: number;
  quoteDecimals?: number;
}): number => {
  if (quoteDecimals === undefined) {
    return 8;
  }

  const scaledTickSize = minPriceTickSize * 10 ** -quoteDecimals;
  const fixedTickSize = scaledTickSize
    .toFixed(18)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const decimalIndex = fixedTickSize.indexOf(".");

  if (decimalIndex === -1) {
    return 0;
  }

  return fixedTickSize.length - decimalIndex - 1;
};

export const buildPriceSnapshot = ({
  price,
  priceDecimals,
  quoteDecimals,
  oracleScaleFactor,
}: {
  price?: string;
  priceDecimals: number;
  quoteDecimals?: number;
  oracleScaleFactor: number;
}): PriceSnapshot => {
  const scaledPrice = scaleOraclePrice({
    price,
    quoteDecimals,
    oracleScaleFactor,
  });

  return {
    rawPrice: price,
    scaledPrice,
    displayPrice:
      scaledPrice === undefined
        ? undefined
        : truncateToFixed(scaledPrice, priceDecimals),
  };
};

export const comparePrices = ({
  markPrice,
  indexPrice,
}: {
  markPrice: PriceSnapshot;
  indexPrice: PriceSnapshot;
}): PriceComparison => {
  const rawDifference =
    markPrice.rawPrice && indexPrice.rawPrice
      ? Number(indexPrice.rawPrice) - Number(markPrice.rawPrice)
      : undefined;
  const scaledDifference =
    markPrice.scaledPrice !== undefined && indexPrice.scaledPrice !== undefined
      ? indexPrice.scaledPrice - markPrice.scaledPrice
      : undefined;
  const basisPointsDifference =
    scaledDifference !== undefined &&
    markPrice.scaledPrice !== undefined &&
    markPrice.scaledPrice !== 0
      ? (scaledDifference / markPrice.scaledPrice) * 10000
      : undefined;

  return {
    rawDifference:
      rawDifference !== undefined && Number.isFinite(rawDifference)
        ? rawDifference
        : undefined,
    scaledDifference,
    scaledAbsoluteDifference:
      scaledDifference === undefined ? undefined : Math.abs(scaledDifference),
    basisPointsDifference,
    displayEqual:
      markPrice.displayPrice !== undefined &&
      markPrice.displayPrice === indexPrice.displayPrice,
  };
};

export const toJsonLine = (value: unknown): string =>
  `${JSON.stringify(
    value,
    (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)
  )}\n`;

const wait = async (milliseconds: number): Promise<void> => {
  if (milliseconds === 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const createOutputPath = (): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `/private/tmp/injective-ts-examples/mark-index-price-drift-${timestamp}.jsonl`;
};

const resolveTrackedMarkets = ({
  markets,
  marketIds,
}: {
  markets: readonly DerivativeMarket[];
  marketIds: readonly string[];
}): TrackedMarket[] => {
  const marketById = new Map(markets.map((market) => [market.marketId, market]));
  const missingMarketIds = marketIds.filter((marketId) => !marketById.has(marketId));

  if (missingMarketIds.length > 0) {
    throw new Error(
      `Could not find derivative markets: ${missingMarketIds.join(", ")}.`
    );
  }

  return marketIds.map((marketId) => {
    const market = marketById.get(marketId);

    if (!market || !isMarketWithOraclePair(market)) {
      throw new Error(
        `Market ${marketId} does not expose oracleBase/oracleQuote and cannot be sampled.`
      );
    }

    const quoteDecimals = market.quoteToken?.decimals;

    return {
      market,
      quoteDecimals,
      priceDecimals: getPriceDecimals({
        minPriceTickSize: market.minPriceTickSize,
        quoteDecimals,
      }),
    };
  });
};

const createOraclePriceV2Filters = (
  trackedMarkets: readonly TrackedMarket[]
): OraclePriceV2Filter[] =>
  trackedMarkets.map(({ market }) => ({
    oracleType: market.oracleType,
    baseSymbol: market.oracleBase,
    quoteSymbol: market.oracleQuote,
    oracleScaleFactor: market.oracleScaleFactor,
  }));

const mapByMarketId = <Value extends { readonly marketId?: string }>(
  values: readonly Value[]
): Map<string, Value> => {
  const valueByMarketId = new Map<string, Value>();

  for (const value of values) {
    if (!value.marketId) {
      continue;
    }

    valueByMarketId.set(value.marketId, value);
  }

  return valueByMarketId;
};

const createSummaryAccumulator = (
  trackedMarket: TrackedMarket
): SummaryAccumulator => ({
  marketId: trackedMarket.market.marketId,
  ticker: trackedMarket.market.ticker,
  samples: 0,
  markV1DisplayCollisions: 0,
  markV2DisplayCollisions: 0,
  markV1BasisPointsTotal: 0,
  markV2BasisPointsTotal: 0,
  markV1BasisPointsCount: 0,
  markV2BasisPointsCount: 0,
  markV1MaxAbsoluteBasisPoints: 0,
  markV2MaxAbsoluteBasisPoints: 0,
});

const updateSummary = ({
  summary,
  record,
}: {
  summary: SummaryAccumulator;
  record: SampleRecord;
}): void => {
  summary.samples += 1;

  if (record.comparisons.indexVsMarkV1.displayEqual) {
    summary.markV1DisplayCollisions += 1;
  }

  if (record.comparisons.indexVsMarkV2.displayEqual) {
    summary.markV2DisplayCollisions += 1;
  }

  const markV1BasisPoints =
    record.comparisons.indexVsMarkV1.basisPointsDifference;
  const markV2BasisPoints =
    record.comparisons.indexVsMarkV2.basisPointsDifference;

  if (markV1BasisPoints !== undefined) {
    const absoluteBasisPoints = Math.abs(markV1BasisPoints);

    summary.markV1BasisPointsTotal += absoluteBasisPoints;
    summary.markV1BasisPointsCount += 1;
    summary.markV1MaxAbsoluteBasisPoints = Math.max(
      summary.markV1MaxAbsoluteBasisPoints,
      absoluteBasisPoints
    );
  }

  if (markV2BasisPoints !== undefined) {
    const absoluteBasisPoints = Math.abs(markV2BasisPoints);

    summary.markV2BasisPointsTotal += absoluteBasisPoints;
    summary.markV2BasisPointsCount += 1;
    summary.markV2MaxAbsoluteBasisPoints = Math.max(
      summary.markV2MaxAbsoluteBasisPoints,
      absoluteBasisPoints
    );
  }
};

const formatNumber = (value?: number, decimals = 6): string => {
  if (value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(decimals);
};

const formatConsoleRow = (record: SampleRecord): string =>
  [
    record.sampleNumber.toString().padStart(3, " "),
    record.market.ticker.padEnd(18, " "),
    (record.markPriceV1.displayPrice ?? "-").padStart(14, " "),
    (record.markPriceV2.displayPrice ?? "-").padStart(14, " "),
    (record.indexPrice.displayPrice ?? "-").padStart(14, " "),
    formatNumber(record.comparisons.indexVsMarkV1.scaledDifference, 6).padStart(
      14,
      " "
    ),
    formatNumber(
      record.comparisons.indexVsMarkV1.basisPointsDifference,
      4
    ).padStart(12, " "),
    formatNumber(record.comparisons.indexVsMarkV2.scaledDifference, 6).padStart(
      14,
      " "
    ),
    formatNumber(
      record.comparisons.indexVsMarkV2.basisPointsDifference,
      4
    ).padStart(12, " "),
    formatNumber(record.indexPrice.timestampAgeMilliseconds, 0).padStart(10, " "),
    record.comparisons.indexVsMarkV1.displayEqual ? "yes" : "no",
    record.comparisons.indexVsMarkV2.displayEqual ? "yes" : "no",
  ].join("  ");

const printHeader = (): void => {
  console.log(
    [
      " # ",
      "market            ",
      "mark_v1       ",
      "mark_v2       ",
      "index         ",
      "idx-v1        ",
      "v1 bps    ",
      "idx-v2        ",
      "v2 bps    ",
      "age_ms  ",
      "v1_eq",
      "v2_eq",
    ].join("  ")
  );
};

const printSummary = (summaries: readonly SummaryAccumulator[]): void => {
  console.log("");
  console.log("Summary:");

  for (const summary of summaries) {
    const averageMarkV1BasisPoints =
      summary.markV1BasisPointsCount === 0
        ? undefined
        : summary.markV1BasisPointsTotal / summary.markV1BasisPointsCount;
    const averageMarkV2BasisPoints =
      summary.markV2BasisPointsCount === 0
        ? undefined
        : summary.markV2BasisPointsTotal / summary.markV2BasisPointsCount;

    console.log({
      marketId: summary.marketId,
      ticker: summary.ticker,
      samples: summary.samples,
      markV1DisplayCollisions: summary.markV1DisplayCollisions,
      markV2DisplayCollisions: summary.markV2DisplayCollisions,
      averageMarkV1AbsoluteBasisPoints: averageMarkV1BasisPoints,
      averageMarkV2AbsoluteBasisPoints: averageMarkV2BasisPoints,
      maxMarkV1AbsoluteBasisPoints: summary.markV1MaxAbsoluteBasisPoints,
      maxMarkV2AbsoluteBasisPoints: summary.markV2MaxAbsoluteBasisPoints,
    });
  }
};

export const run = async (): Promise<void> => {
  const { mkdir, appendFile } = await import("fs/promises");
  const { dirname } = await import("path");
  const { getNetworkEndpoints, Network } = await import(
    "@injectivelabs/networks"
  );
  const {
    IndexerGrpcDerivativesApi,
    IndexerGrpcOracleApi,
    IndexerGrpcWsPriceOracleApi,
  } = await import("@injectivelabs/sdk-ts");
  const {
    getCsvEnvironmentVariable,
    getEnvironmentVariable,
    getNumberEnvironmentVariable,
    requireEnvironmentVariable,
  } = await import("../../lib/env");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Mainnet
  );
  const endpoints = getNetworkEndpoints(network);
  const indexerEndpoint = getEnvironmentVariable(
    "INJECTIVE_INDEXER_ENDPOINT",
    endpoints.indexer
  );
  const wsPriceOracleEndpoint = getEnvironmentVariable(
    "WS_PRICE_ORACLE_ENDPOINT",
    getDefaultWsPriceOracleEndpoint(network)
  );
  const wsPriceOracleApiKey = requireEnvironmentVariable(
    "WS_PRICE_ORACLE_API_KEY"
  );
  const marketIds = getCsvEnvironmentVariable(
    "PRICE_DRIFT_MARKET_IDS",
    defaultMainnetMarketIds
  );

  if (marketIds.length === 0) {
    throw new Error("PRICE_DRIFT_MARKET_IDS must include at least one market id.");
  }

  const sampleCount = assertPositiveInteger(
    "PRICE_DRIFT_SAMPLE_COUNT",
    getNumberEnvironmentVariable("PRICE_DRIFT_SAMPLE_COUNT", defaultSampleCount)
  );
  const sampleIntervalMilliseconds = assertNonNegativeInteger(
    "PRICE_DRIFT_SAMPLE_INTERVAL_MS",
    getNumberEnvironmentVariable(
      "PRICE_DRIFT_SAMPLE_INTERVAL_MS",
      defaultSampleIntervalMilliseconds
    )
  );
  const outputJsonlPath = getEnvironmentVariable(
    "PRICE_DRIFT_OUTPUT_JSONL",
    createOutputPath()
  );

  await mkdir(dirname(outputJsonlPath), { recursive: true });

  const derivativesApi = new IndexerGrpcDerivativesApi(indexerEndpoint);
  const oracleApi = new IndexerGrpcOracleApi(indexerEndpoint);
  const wsPriceOracleApi = new IndexerGrpcWsPriceOracleApi(
    wsPriceOracleEndpoint
  );
  wsPriceOracleApi.setMetadata({
    "x-api-key": wsPriceOracleApiKey,
  });

  const markets = await derivativesApi.fetchMarkets();
  const trackedMarkets = resolveTrackedMarkets({ markets, marketIds });
  const marketIdsToSample = trackedMarkets.map(({ market }) => market.marketId);
  const summaries = trackedMarkets.map(createSummaryAccumulator);
  const summaryByMarketId = new Map(
    summaries.map((summary) => [summary.marketId, summary])
  );

  console.log({
    network,
    indexerEndpoint,
    wsPriceOracleEndpoint,
    marketIds: marketIdsToSample,
    sampleCount,
    sampleIntervalMilliseconds,
    outputJsonlPath,
  });
  printHeader();

  for (let sampleNumber = 1; sampleNumber <= sampleCount; sampleNumber += 1) {
    const sampledAtDate = new Date();
    const sampledAtMilliseconds = sampledAtDate.getTime();
    const filters = createOraclePriceV2Filters(trackedMarkets);

    const [markPriceV1Responses, markPriceV2Responses, indexPriceResponses] =
      await Promise.all([
        Promise.all(
          trackedMarkets.map(async ({ market }) => ({
            marketId: market.marketId,
            response: await oracleApi.fetchOraclePrice({
              oracleType: market.oracleType,
              baseSymbol: market.oracleBase,
              quoteSymbol: market.oracleQuote,
            }),
          }))
        ),
        Promise.all(
          chunkArray(filters, marketPriceSnapshotChunkSize).map((filtersChunk) =>
            oracleApi.fetchOraclePriceV2(filtersChunk)
          )
        ).then((responses) => responses.flat()),
        Promise.all(
          chunkArray(marketIdsToSample, marketPriceSnapshotChunkSize).map(
            async (marketIdsChunk) =>
              wsPriceOracleApi.fetchLatestMarketPrices({
                marketIds: marketIdsChunk,
              })
          )
        ).then((responses) => responses.flatMap((response) => response.prices)),
      ]);

    const markPriceV1ResponseByMarketId = new Map(
      markPriceV1Responses.map(({ marketId, response }) => [marketId, response])
    );
    const markPriceV2ResponseByMarketId = mapByMarketId(markPriceV2Responses);
    const indexPriceResponseByMarketId = mapByMarketId(indexPriceResponses);

    for (const trackedMarket of trackedMarkets) {
      const { market, priceDecimals, quoteDecimals } = trackedMarket;
      const markPriceV1Response = markPriceV1ResponseByMarketId.get(
        market.marketId
      );
      const markPriceV2Response = markPriceV2ResponseByMarketId.get(
        market.marketId
      );
      const indexPriceResponse = indexPriceResponseByMarketId.get(
        market.marketId
      );
      const markPriceV1 = buildPriceSnapshot({
        price: markPriceV1Response?.price,
        priceDecimals,
        quoteDecimals,
        oracleScaleFactor: market.oracleScaleFactor,
      });
      const markPriceV2 = buildPriceSnapshot({
        price: markPriceV2Response?.price,
        priceDecimals,
        quoteDecimals,
        oracleScaleFactor: market.oracleScaleFactor,
      });
      const indexPrice = buildPriceSnapshot({
        price: indexPriceResponse?.price,
        priceDecimals,
        quoteDecimals,
        oracleScaleFactor: market.oracleScaleFactor,
      });
      const record: SampleRecord = {
        sampleNumber,
        sampledAt: sampledAtDate.toISOString(),
        network: String(network),
        endpoints: {
          indexer: indexerEndpoint,
          wsPriceOracle: wsPriceOracleEndpoint,
        },
        market: {
          marketId: market.marketId,
          ticker: market.ticker,
          oracleType: market.oracleType,
          oracleBase: market.oracleBase,
          oracleQuote: market.oracleQuote,
          oracleScaleFactor: market.oracleScaleFactor,
          quoteDecimals,
          priceDecimals,
        },
        markPriceV1: {
          ...markPriceV1,
          response: markPriceV1Response,
        },
        markPriceV2: {
          ...markPriceV2,
          response: markPriceV2Response,
        },
        indexPrice: {
          ...indexPrice,
          response: indexPriceResponse,
          timestampAgeMilliseconds: calculateTimestampAgeMilliseconds({
            nowMilliseconds: sampledAtMilliseconds,
            timestamp: indexPriceResponse?.timestamp,
          }),
          receivedAtAgeMilliseconds: calculateTimestampAgeMilliseconds({
            nowMilliseconds: sampledAtMilliseconds,
            timestamp: indexPriceResponse?.receivedAt,
          }),
          sequence:
            indexPriceResponse?.sequence === undefined
              ? undefined
              : String(indexPriceResponse.sequence),
        },
        comparisons: {
          indexVsMarkV1: comparePrices({
            markPrice: markPriceV1,
            indexPrice,
          }),
          indexVsMarkV2: comparePrices({
            markPrice: markPriceV2,
            indexPrice,
          }),
        },
      };
      const summary = summaryByMarketId.get(market.marketId);

      if (summary) {
        updateSummary({ summary, record });
      }

      console.log(formatConsoleRow(record));
      await appendFile(outputJsonlPath, toJsonLine(record), "utf8");
    }

    if (sampleNumber < sampleCount) {
      await wait(sampleIntervalMilliseconds);
    }
  }

  printSummary(summaries);
};

runDirectly(module, run);
