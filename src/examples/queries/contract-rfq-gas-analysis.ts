import type { ContractTransaction, Transaction } from "@injectivelabs/sdk-ts";
import type { ExampleMetadata } from "../types";
import { runDirectly } from "../../lib/direct-run";

const defaultContractAddress = "inj12stwq95jet57edcu4a65r48r46s9rzrs938n8k";
const defaultPageSize = 50;
const defaultHydrationConcurrency = 4;
const unlimitedTransactions = 0;

export const metadata: ExampleMetadata = {
  id: "query:contract-rfq-gas-analysis",
  category: "queries",
  title: "Analyze RFQ contract gas usage",
  description:
    "Fetch RFQ contract transactions and summarize gas used by quote count.",
};

interface CursorPagination {
  readonly next?: readonly string[];
}

interface ContractTransactionPage {
  readonly data: readonly ContractTransaction[];
  readonly paging?: CursorPagination;
}

interface ContractTransactionPageRequest {
  readonly contractAddress: string;
  readonly perPage: number;
  readonly token?: string;
  readonly status?: string;
}

interface ContractTransactionReader {
  fetchContractTxsV2(
    request: ContractTransactionPageRequest
  ): Promise<ContractTransactionPage>;
  fetchTxByHash(hash: string, isEvmHash?: boolean): Promise<Transaction>;
}

interface FetchContractTransactionsOptions {
  readonly explorerApi: ContractTransactionReader;
  readonly contractAddress: string;
  readonly pageSize: number;
  readonly maximumTransactions?: number;
  readonly status?: string;
  readonly onProgress?: (message: string) => void;
}

interface HydrateTransactionsOptions {
  readonly explorerApi: ContractTransactionReader;
  readonly contractAddress: string;
  readonly contractTransactions: readonly ContractTransaction[];
  readonly concurrency: number;
  readonly onProgress?: (message: string) => void;
}

export interface TransactionGasRecord {
  readonly txHash: string;
  readonly height: number;
  readonly blockTimeUnixMilliseconds: number;
  readonly quoteCount: number;
  readonly gasUsed: number;
  readonly gasWanted: number;
  readonly gasFeeAmounts: readonly {
    readonly amount: string;
    readonly denom: string;
  }[];
  readonly code: number;
}

export interface GasUsedExtreme {
  readonly txHash: string;
  readonly gasUsed: number;
}

export interface GasSummary {
  readonly transactionCount: number;
  readonly totalGasUsed: number;
  readonly averageGasUsed: number;
  readonly minimumGasUsed: GasUsedExtreme;
  readonly maximumGasUsed: GasUsedExtreme;
  readonly totalGasWanted: number;
  readonly averageGasWanted: number;
  readonly minimumGasWanted: number;
  readonly maximumGasWanted: number;
}

export interface QuoteCountGasSummary extends GasSummary {
  readonly quoteCount: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

const getMessagePayload = (message: Record<string, unknown>): unknown => {
  if ("message" in message) {
    return message.message;
  }

  if ("value" in message) {
    return message.value;
  }

  return undefined;
};

const getAcceptQuote = (value: unknown): Record<string, unknown> | undefined => {
  const parsedValue = parseJsonValue(value);

  if (!isRecord(parsedValue)) {
    return undefined;
  }

  const acceptQuote = parsedValue.accept_quote;

  if (!isRecord(acceptQuote)) {
    return undefined;
  }

  return acceptQuote;
};

const countQuotes = (acceptQuote: Record<string, unknown>): number => {
  if (!Array.isArray(acceptQuote.quotes)) {
    return 0;
  }

  return acceptQuote.quotes.length;
};

const visitMessageForQuoteCount = ({
  contractAddress,
  message,
}: {
  readonly contractAddress: string;
  readonly message: unknown;
}): number => {
  if (!isRecord(message)) {
    return 0;
  }

  const payload = getMessagePayload(message);

  if (payload !== undefined) {
    return visitMessageForQuoteCount({ contractAddress, message: payload });
  }

  const nestedMessages = message.msgs;
  const nestedQuoteCount = Array.isArray(nestedMessages)
    ? nestedMessages.reduce<number>(
        (totalQuotes, nestedMessage) =>
          totalQuotes +
          visitMessageForQuoteCount({ contractAddress, message: nestedMessage }),
        0
      )
    : 0;

  if (message.contract !== contractAddress) {
    return nestedQuoteCount;
  }

  const acceptQuote = getAcceptQuote(message.msg);

  if (!acceptQuote) {
    return nestedQuoteCount;
  }

  return nestedQuoteCount + countQuotes(acceptQuote);
};

export const countAcceptQuoteQuotes = ({
  contractAddress,
  messages,
}: {
  readonly contractAddress: string;
  readonly messages: readonly unknown[] | undefined;
}): number => {
  if (!messages) {
    return 0;
  }

  return messages.reduce<number>(
    (totalQuotes, message) =>
      totalQuotes +
      visitMessageForQuoteCount({
        contractAddress,
        message,
      }),
    0
  );
};

export const getNextCursorToken = (
  pagination: CursorPagination | undefined
): string | undefined => {
  const [nextToken] = pagination?.next ?? [];

  return nextToken;
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

export const normalizeMaximumTransactions = (
  maximumTransactions: number
): number | undefined => {
  const normalizedMaximumTransactions = assertNonNegativeInteger(
    "CONTRACT_GAS_ANALYSIS_MAX_TRANSACTIONS",
    maximumTransactions
  );

  if (normalizedMaximumTransactions === unlimitedTransactions) {
    return undefined;
  }

  return normalizedMaximumTransactions;
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

export const buildTransactionGasRecord = ({
  contractAddress,
  contractTransaction,
  transaction,
}: {
  readonly contractAddress: string;
  readonly contractTransaction: ContractTransaction;
  readonly transaction: Transaction;
}): TransactionGasRecord => {
  const messages = Array.isArray(transaction.messages)
    ? transaction.messages
    : [];

  return {
    txHash: contractTransaction.txHash,
    height: contractTransaction.height,
    blockTimeUnixMilliseconds: contractTransaction.time,
    quoteCount: countAcceptQuoteQuotes({
      contractAddress,
      messages,
    }),
    gasUsed: transaction.gasUsed,
    gasWanted: transaction.gasWanted,
    gasFeeAmounts: transaction.gasFee.amounts.map((amount) => ({
      amount: amount.amount,
      denom: amount.denom,
    })),
    code: transaction.code,
  };
};

const roundToTwoDecimals = (value: number): number => Number(value.toFixed(2));

export const buildGasSummary = (
  records: readonly TransactionGasRecord[]
): GasSummary | undefined => {
  const [firstRecord] = records;

  if (!firstRecord) {
    return undefined;
  }

  let totalGasUsed = 0;
  let totalGasWanted = 0;
  let minimumGasUsedRecord = firstRecord;
  let maximumGasUsedRecord = firstRecord;
  let minimumGasWanted = firstRecord.gasWanted;
  let maximumGasWanted = firstRecord.gasWanted;

  for (const record of records) {
    totalGasUsed += record.gasUsed;
    totalGasWanted += record.gasWanted;

    if (record.gasUsed < minimumGasUsedRecord.gasUsed) {
      minimumGasUsedRecord = record;
    }

    if (record.gasUsed > maximumGasUsedRecord.gasUsed) {
      maximumGasUsedRecord = record;
    }

    minimumGasWanted = Math.min(minimumGasWanted, record.gasWanted);
    maximumGasWanted = Math.max(maximumGasWanted, record.gasWanted);
  }

  return {
    transactionCount: records.length,
    totalGasUsed,
    averageGasUsed: roundToTwoDecimals(totalGasUsed / records.length),
    minimumGasUsed: {
      txHash: minimumGasUsedRecord.txHash,
      gasUsed: minimumGasUsedRecord.gasUsed,
    },
    maximumGasUsed: {
      txHash: maximumGasUsedRecord.txHash,
      gasUsed: maximumGasUsedRecord.gasUsed,
    },
    totalGasWanted,
    averageGasWanted: roundToTwoDecimals(totalGasWanted / records.length),
    minimumGasWanted,
    maximumGasWanted,
  };
};

export const summarizeGasByQuoteCount = (
  records: readonly TransactionGasRecord[]
): QuoteCountGasSummary[] => {
  const recordsByQuoteCount = new Map<number, TransactionGasRecord[]>();

  for (const record of records) {
    const recordsForQuoteCount =
      recordsByQuoteCount.get(record.quoteCount) ?? [];
    recordsForQuoteCount.push(record);
    recordsByQuoteCount.set(record.quoteCount, recordsForQuoteCount);
  }

  return [...recordsByQuoteCount.entries()]
    .map(([quoteCount, quoteCountRecords]) => {
      const summary = buildGasSummary(quoteCountRecords);

      if (!summary) {
        throw new Error(`Missing gas summary for quote count ${quoteCount}.`);
      }

      return {
        quoteCount,
        ...summary,
      };
    })
    .sort((left, right) => left.quoteCount - right.quoteCount);
};

export const fetchContractTransactions = async ({
  explorerApi,
  contractAddress,
  pageSize,
  maximumTransactions,
  status,
  onProgress,
}: FetchContractTransactionsOptions): Promise<readonly ContractTransaction[]> => {
  const transactions: ContractTransaction[] = [];
  const seenCursorTokens = new Set<string>();
  let nextCursorToken: string | undefined;
  let shouldFetchNextPage = true;

  while (shouldFetchNextPage) {
    const page = await explorerApi.fetchContractTxsV2({
      contractAddress,
      perPage: pageSize,
      token: nextCursorToken,
      status,
    });

    const remainingTransactionCount =
      maximumTransactions === undefined
        ? page.data.length
        : Math.max(maximumTransactions - transactions.length, 0);
    transactions.push(...page.data.slice(0, remainingTransactionCount));
    onProgress?.(
      `Fetched ${transactions.length} contract transaction summaries.`
    );

    if (page.data.length === 0) {
      shouldFetchNextPage = false;
      continue;
    }

    if (
      maximumTransactions !== undefined &&
      transactions.length >= maximumTransactions
    ) {
      return transactions;
    }

    const candidateCursorToken = getNextCursorToken(page.paging);

    if (!candidateCursorToken) {
      shouldFetchNextPage = false;
      continue;
    }

    if (seenCursorTokens.has(candidateCursorToken)) {
      shouldFetchNextPage = false;
      continue;
    }

    seenCursorTokens.add(candidateCursorToken);
    nextCursorToken = candidateCursorToken;
  }

  return transactions;
};

export const hydrateTransactionGasRecords = async ({
  explorerApi,
  contractAddress,
  contractTransactions,
  concurrency,
  onProgress,
}: HydrateTransactionsOptions): Promise<readonly TransactionGasRecord[]> => {
  const records: TransactionGasRecord[] = [];
  const transactionChunks = chunkArray(contractTransactions, concurrency);

  for (const transactionChunk of transactionChunks) {
    const chunkRecords = await Promise.all(
      transactionChunk.map(async (contractTransaction) => {
        const transaction = await explorerApi.fetchTxByHash(
          contractTransaction.txHash
        );

        return buildTransactionGasRecord({
          contractAddress,
          contractTransaction,
          transaction,
        });
      })
    );

    records.push(...chunkRecords);
    onProgress?.(
      `Hydrated ${records.length}/${contractTransactions.length} transactions with gas details.`
    );
  }

  return records;
};

export const run = async (): Promise<void> => {
  const { getNetworkEndpoints, Network } = await import(
    "@injectivelabs/networks"
  );
  const { IndexerGrpcExplorerApi } = await import("@injectivelabs/sdk-ts");
  const {
    getEnvironmentVariable,
    getNumberEnvironmentVariable,
  } = await import("../../lib/env");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );

  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.Mainnet
  );
  const endpoints = getNetworkEndpoints(network);
  const explorerApi = new IndexerGrpcExplorerApi(endpoints.indexer);
  const contractAddress = getEnvironmentVariable(
    "CONTRACT_GAS_ANALYSIS_CONTRACT_ADDRESS",
    defaultContractAddress
  );
  const pageSize = assertPositiveInteger(
    "CONTRACT_GAS_ANALYSIS_PAGE_SIZE",
    getNumberEnvironmentVariable(
      "CONTRACT_GAS_ANALYSIS_PAGE_SIZE",
      defaultPageSize
    )
  );
  const hydrationConcurrency = assertPositiveInteger(
    "CONTRACT_GAS_ANALYSIS_CONCURRENCY",
    getNumberEnvironmentVariable(
      "CONTRACT_GAS_ANALYSIS_CONCURRENCY",
      defaultHydrationConcurrency
    )
  );
  const maximumTransactions = normalizeMaximumTransactions(
    getNumberEnvironmentVariable(
      "CONTRACT_GAS_ANALYSIS_MAX_TRANSACTIONS",
      unlimitedTransactions
    )
  );
  const status = getEnvironmentVariable("CONTRACT_GAS_ANALYSIS_STATUS");

  const contractTransactions = await fetchContractTransactions({
    explorerApi,
    contractAddress,
    pageSize,
    maximumTransactions,
    status,
    onProgress: (message) => console.log(message),
  });

  if (contractTransactions.length === 0) {
    console.log({
      network,
      endpoint: endpoints.indexer,
      contractAddress,
      contractTransactions: 0,
      gasUsedByQuoteCount: [],
    });
    return;
  }

  const gasRecords = await hydrateTransactionGasRecords({
    explorerApi,
    contractAddress,
    contractTransactions,
    concurrency: hydrationConcurrency,
    onProgress: (message) => console.log(message),
  });
  const acceptQuoteRecords = gasRecords.filter(
    (record) => record.quoteCount > 0
  );

  console.log(
    JSON.stringify(
      {
        network,
        endpoint: endpoints.indexer,
        contractAddress,
        status: status ?? "all",
        pageSize,
        hydrationConcurrency,
        maximumTransactions: maximumTransactions ?? "unlimited",
        totals: {
          contractTransactions: contractTransactions.length,
          hydratedTransactions: gasRecords.length,
          acceptQuoteTransactions: acceptQuoteRecords.length,
          transactionsWithoutAcceptQuote:
            gasRecords.length - acceptQuoteRecords.length,
        },
        overallGasUsed: buildGasSummary(gasRecords),
        acceptQuoteGasUsed: buildGasSummary(acceptQuoteRecords),
        gasUsedByQuoteCount: summarizeGasByQuoteCount(gasRecords),
      },
      null,
      2
    )
  );
};

runDirectly(module, run);
