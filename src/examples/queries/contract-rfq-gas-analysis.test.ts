import { describe, expect, it } from "vitest";
import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  chunkArray,
  countAcceptQuoteQuotes,
  getNextCursorToken,
  normalizeMaximumTransactions,
  summarizeGasByQuoteCount,
  type TransactionGasRecord,
} from "./contract-rfq-gas-analysis";

const contractAddress = "inj12stwq95jet57edcu4a65r48r46s9rzrs938n8k";

const createGasRecord = ({
  gasUsed,
  gasWanted,
  quoteCount,
  txHash,
}: {
  readonly gasUsed: number;
  readonly gasWanted: number;
  readonly quoteCount: number;
  readonly txHash: string;
}): TransactionGasRecord => ({
  txHash,
  height: 1,
  blockTimeUnixMilliseconds: 1780931197632,
  quoteCount,
  gasUsed,
  gasWanted,
  gasFeeAmounts: [{ amount: "1", denom: "inj" }],
  code: 0,
});

describe("contract RFQ gas analysis helpers", () => {
  it("selects the first explorer cursor token as the next page", () => {
    expect(
      getNextCursorToken({
        next: ["immediate-next-page", "later-page"],
      })
    ).toBe("immediate-next-page");
    expect(getNextCursorToken(undefined)).toBeUndefined();
    expect(getNextCursorToken({ next: [] })).toBeUndefined();
  });

  it("validates integer configuration values", () => {
    expect(assertPositiveInteger("PAGE_SIZE", 1)).toBe(1);
    expect(assertNonNegativeInteger("MAX_TRANSACTIONS", 0)).toBe(0);
    expect(normalizeMaximumTransactions(0)).toBeUndefined();
    expect(normalizeMaximumTransactions(25)).toBe(25);
    expect(() => assertPositiveInteger("PAGE_SIZE", 0)).toThrow(
      "PAGE_SIZE must be a positive integer."
    );
    expect(() => assertNonNegativeInteger("MAX_TRANSACTIONS", -1)).toThrow(
      "MAX_TRANSACTIONS must be a non-negative integer."
    );
  });

  it("chunks arrays without mutating the source values", () => {
    const values = [1, 2, 3, 4, 5];

    expect(chunkArray(values, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts quotes in a nested MsgExec execute-contract payload", () => {
    const messages = [
      {
        type: "/cosmos.authz.v1beta1.MsgExec",
        value: {
          grantee: "inj1grantee",
          msgs: [
            {
              "@type": "/injective.exchange.v2.MsgCreateDerivativeMarketOrder",
              sender: "inj1sender",
            },
            {
              "@type": "/injective.wasmx.v1.MsgExecuteContractCompat",
              sender: "inj1sender",
              contract: contractAddress,
              msg: JSON.stringify({
                accept_quote: {
                  quotes: [
                    { maker: "inj1maker1" },
                    { maker: "inj1maker2" },
                    { maker: "inj1maker3" },
                  ],
                },
              }),
              funds: "",
            },
          ],
        },
      },
    ];

    expect(countAcceptQuoteQuotes({ contractAddress, messages })).toBe(3);
  });

  it("counts quotes when the execute-contract msg is already parsed", () => {
    const messages = [
      {
        type: "/injective.wasmx.v1.MsgExecuteContractCompat",
        message: {
          sender: "inj1sender",
          contract: contractAddress,
          msg: {
            accept_quote: {
              quotes: [{ maker: "inj1maker" }],
            },
          },
        },
      },
    ];

    expect(countAcceptQuoteQuotes({ contractAddress, messages })).toBe(1);
  });

  it("ignores accept_quote payloads for other contracts", () => {
    const messages = [
      {
        type: "/injective.wasmx.v1.MsgExecuteContractCompat",
        value: {
          sender: "inj1sender",
          contract: "inj1other",
          msg: {
            accept_quote: {
              quotes: [{ maker: "inj1maker" }],
            },
          },
        },
      },
    ];

    expect(countAcceptQuoteQuotes({ contractAddress, messages })).toBe(0);
  });

  it("summarizes gas usage by quote count", () => {
    const records = [
      createGasRecord({
        txHash: "0x1",
        quoteCount: 1,
        gasUsed: 100,
        gasWanted: 120,
      }),
      createGasRecord({
        txHash: "0x2",
        quoteCount: 1,
        gasUsed: 300,
        gasWanted: 360,
      }),
      createGasRecord({
        txHash: "0x3",
        quoteCount: 3,
        gasUsed: 500,
        gasWanted: 600,
      }),
    ];

    expect(summarizeGasByQuoteCount(records)).toEqual([
      {
        quoteCount: 1,
        transactionCount: 2,
        totalGasUsed: 400,
        averageGasUsed: 200,
        minimumGasUsed: {
          txHash: "0x1",
          gasUsed: 100,
        },
        maximumGasUsed: {
          txHash: "0x2",
          gasUsed: 300,
        },
        totalGasWanted: 480,
        averageGasWanted: 240,
        minimumGasWanted: 120,
        maximumGasWanted: 360,
      },
      {
        quoteCount: 3,
        transactionCount: 1,
        totalGasUsed: 500,
        averageGasUsed: 500,
        minimumGasUsed: {
          txHash: "0x3",
          gasUsed: 500,
        },
        maximumGasUsed: {
          txHash: "0x3",
          gasUsed: 500,
        },
        totalGasWanted: 600,
        averageGasWanted: 600,
        minimumGasWanted: 600,
        maximumGasWanted: 600,
      },
    ]);
  });
});
