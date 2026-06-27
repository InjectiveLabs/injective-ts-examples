import { describe, expect, it } from "vitest";
import type { RFQQuoteType } from "@injectivelabs/sdk-ts";
import {
  buildClientAcceptQuotePayload,
  calculateBenchmarkTimeoutHeight,
  calculateOneTimesQuantity,
  getLatestBlockHeight,
  calculateWorstPriceWithSlippage,
  getDefaultRfqEvmChainId,
  getQuoteInvalidReasons,
  getRfqContractAuthzMessageTypeUrls,
  parseGatewayBenchmarkModes,
  quantizeDecimalDown,
  quantizeDecimalUp,
  scaleDerivativePriceTickSize,
  selectClientGatewayQuotes,
  summarizeBenchmarkResults,
  summarizeDurations,
} from "./rfq-gateway-benchmark";

const chainId = "injective-888";
const marketId = "0xmarket";
const takerAddress = "inj1taker";
const contractAddress = "inj1rfq";

const order = {
  margin: "1",
  marketId,
  quantity: "10",
  direction: "long" as const,
  worstPrice: "120",
  markPrice: "100",
  source: "test",
  slippageBasisPoints: 500,
};

const makeQuote = (overrides: Partial<RFQQuoteType>): RFQQuoteType => ({
  rfqId: 1,
  price: "100",
  maker: "inj1maker",
  taker: takerAddress,
  margin: "1",
  status: "pending",
  height: 1,
  chainId,
  marketId,
  quantity: "1",
  clientId: "client-1",
  signature: "aa",
  createdAt: 0,
  updatedAt: 0,
  eventTime: 0,
  evmChainId: 0,
  priceCheck: false,
  signMode: "v1",
  expiry: {
    timestamp: 2_000_000_000_000,
  },
  takerDirection: "long",
  contractAddress,
  transactionTime: 0,
  minFillQuantity: "0",
  makerSubaccountNonce: 0,
  ...overrides,
});

describe("rfq gateway benchmark helpers", () => {
  it("parses benchmark modes case-insensitively and removes duplicates", () => {
    expect(parseGatewayBenchmarkModes(["CLIENT", "server", "client"])).toEqual([
      "client",
      "server",
    ]);
  });

  it("summarizes duration percentiles", () => {
    expect(summarizeDurations([10, 30, 20, 40])).toEqual({
      count: 4,
      min: 10,
      max: 40,
      p50: 20,
      p75: 30,
      p95: 40,
      average: 25,
    });
  });

  it("calculates 1x quantity from margin and mark price", () => {
    expect(
      calculateOneTimesQuantity({
        margin: "50",
        markPrice: "100000",
      }),
    ).toBe("0.0005");
  });

  it("calculates timeout height from latest height and timeout blocks", () => {
    expect(
      calculateBenchmarkTimeoutHeight({
        latestHeight: "1781741000",
        txTimeoutInBlocks: 10,
      }),
    ).toBe("1781741010");
  });

  it("normalizes bigint latest block heights", () => {
    expect(
      getLatestBlockHeight({
        header: {
          height: 1781741000n,
        },
      }),
    ).toBe("1781741000");
  });

  it("calculates worst price with directional slippage", () => {
    expect(
      calculateWorstPriceWithSlippage({
        direction: "long",
        markPrice: "100",
        slippageBasisPoints: 500,
      }),
    ).toBe("105");
    expect(
      calculateWorstPriceWithSlippage({
        direction: "short",
        markPrice: "100",
        slippageBasisPoints: 500,
      }),
    ).toBe("95");
  });

  it("uses Injective EVM chain ids for RFQ quote validation", () => {
    expect(
      getDefaultRfqEvmChainId({
        network: "testnet",
        fallbackEvmChainId: 11155111,
      }),
    ).toBe(1439);
    expect(
      getDefaultRfqEvmChainId({
        network: "mainnet",
        fallbackEvmChainId: 1,
      }),
    ).toBe(1776);
  });

  it("grants the RFQ contract all message types used during settlement", () => {
    expect(getRfqContractAuthzMessageTypeUrls()).toEqual([
      "/injective.exchange.v2.MsgPrivilegedExecuteContract",
      "/cosmos.bank.v1beta1.MsgSend",
    ]);
  });

  it("quantizes derived decimals to gateway tick sizes", () => {
    const priceTickSize = scaleDerivativePriceTickSize({
      quoteDecimals: 6,
      minPriceTickSize: "1000000",
    });

    expect(priceTickSize).toBe("1");
    expect(
      quantizeDecimalDown({
        name: "quantity",
        tickSize: "0.0001",
        value: "0.000776985183840137",
      }),
    ).toBe("0.0007");
    expect(
      quantizeDecimalUp({
        name: "shortWorstPrice",
        tickSize: priceTickSize,
        value: "94.91",
      }),
    ).toBe("95");
  });

  it("reports invalid quote reasons", () => {
    expect(
      getQuoteInvalidReasons({
        rfqId: 1,
        chainId,
        evmChainId: 1439,
        takerAddress,
        contractAddress,
        order,
        quote: makeQuote({
          signature: "AQID",
          contractAddress: "inj1wrong",
        }),
      }),
    ).toEqual(["contractAddress", "signature"]);
  });

  it("omits zero maker nonce from client accept quote payload", () => {
    const payload = buildClientAcceptQuotePayload({
      order,
      rfqId: 1,
      cid: "cid",
      hexToBase64: (signature) => signature,
      selectedQuotes: [
        makeQuote({
          signMode: "v2",
          evmChainId: 1439,
          makerSubaccountNonce: 0,
        }),
      ],
    });

    expect(payload.accept_quote.quotes[0]).toEqual(
      expect.not.objectContaining({ nonce: expect.anything() }),
    );
    expect(payload.accept_quote.quotes[0]).toEqual(
      expect.objectContaining({
        evm_chain_id: 1439,
        sign_mode: "v2",
      }),
    );
  });

  it("rejects selections that would partially fill below min fill", () => {
    expect(() =>
      selectClientGatewayQuotes({
        rfqId: 1,
        chainId,
        evmChainId: 1439,
        takerAddress,
        contractAddress,
        nowMs: 1_700_000_000_000,
        order,
        quotes: [
          makeQuote({
            maker: "inj1maker1",
            price: "100",
            quantity: "9",
            minFillQuantity: "9",
          }),
          makeQuote({
            maker: "inj1maker2",
            price: "101",
            quantity: "2",
            minFillQuantity: "2",
          }),
        ],
      }),
    ).toThrow("could not fill order quantity");
  });

  it("does not let tiny top-ranked quotes crowd out deeper fillable liquidity", () => {
    const tinyQuotes = Array.from({ length: 25 }, (_, index) =>
      makeQuote({
        maker: `inj1tiny${index}`,
        price: "99",
        quantity: "0.1",
      }),
    );
    const deepQuote = makeQuote({
      maker: "inj1deep",
      price: "100",
      quantity: "10",
    });
    const result = selectClientGatewayQuotes({
      rfqId: 1,
      chainId,
      evmChainId: 1439,
      takerAddress,
      contractAddress,
      nowMs: 1_700_000_000_000,
      order,
      quotes: [...tinyQuotes, deepQuote],
    });

    expect(result.selectedQuotes.some((quote) => quote.maker === "inj1deep")).toBe(
      true,
    );
    expect(result.selectedQuotes.length).toBeLessThanOrEqual(25);
  });

  it("summarizes benchmark attempts by gateway mode", () => {
    const summary = summarizeBenchmarkResults([
      {
        mode: "server",
        status: "success",
        iteration: 1,
        totalDurationMs: 100,
        broadcastEvents: [],
        details: {
          quoteCount: 2,
          selectedQuoteCount: 2,
        },
        stages: [
          {
            name: "server-fetch-prepare-autosign",
            success: true,
            durationMs: 80,
          },
        ],
      },
      {
        mode: "client",
        status: "failed",
        iteration: 1,
        totalDurationMs: 50,
        broadcastEvents: [],
        details: {},
        stages: [],
      },
    ]);

    expect(summary.modes.server.successCount).toBe(1);
    expect(summary.modes.client.failureCount).toBe(1);
    expect(summary.modes.server.stages["server-fetch-prepare-autosign"]?.p50).toBe(
      80,
    );
  });
});
