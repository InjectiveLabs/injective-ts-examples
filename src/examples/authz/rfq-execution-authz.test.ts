import { describe, expect, it } from "vitest";
import {
  addDecimalStep,
  applyBasisPointOffset,
  assertArbPayloadReferencesExecutionInputs,
  assertQuoteVerification,
  buildDefaultAcceptQuotePayload,
  buildDerivativeLimitOrderPlans,
  buildSeedQuoteTemplates,
  defaultRfqContractAddress,
  extractQuotesFromAcceptQuotePayload,
  getAccountAddressFromEnvironment,
  getAccountCredentialEnvironment,
  getBasisPointStep,
  getOrderbookDepth,
  getOrderbookMidPrice,
  getOppositeOrderSide,
  hasGrantForContract,
  isPriceWithinBasisPoints,
  parseAuthzRfqMode,
  parseDerivativeOrderSide,
  parseExecutionPath,
  parseJsonArray,
  parseJsonRecord,
  recordContainsString,
  scaleOraclePriceToQuoteDecimals,
  selectIlliquidMarketCandidate,
  summarizeMarketCandidate,
  summarizeQuoteVerification,
  sumDecimalStrings,
} from "./rfq-execution-authz";

const withEnvironment = (values: Record<string, string>, run: () => void): void => {
  const previousValues = new Map(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  }
};

describe("rfq-execution-authz helpers", () => {
  it("parses enum-like environment values case-insensitively", () => {
    expect(parseAuthzRfqMode("SEED")).toBe("seed");
    expect(parseAuthzRfqMode("Verify")).toBe("verify");
    expect(parseExecutionPath("ArB")).toBe("arb");
    expect(parseDerivativeOrderSide("sell")).toBe("SELL");
  });

  it("rejects invalid enum-like environment values", () => {
    expect(() => parseAuthzRfqMode("setup")).toThrow(
      "Invalid AUTHZ_RFQ_MODE"
    );
    expect(() => parseExecutionPath("proxy")).toThrow(
      "Invalid AUTHZ_RFQ_EXECUTION_PATH"
    );
    expect(() => parseDerivativeOrderSide("bid")).toThrow(
      "Invalid AUTHZ_RFQ_ORDER_SIDE"
    );
  });

  it("builds opposite derivative order sides", () => {
    expect(getOppositeOrderSide("BUY")).toBe("SELL");
    expect(getOppositeOrderSide("SELL")).toBe("BUY");
  });

  it("adds decimal price steps without floating point drift", () => {
    expect(
      addDecimalStep({
        name: "AUTHZ_RFQ_ORDER_PRICE",
        value: "10.100000000000000001",
        step: "0.100000000000000001",
        stepCount: 2,
      })
    ).toBe("10.300000000000000003");
  });

  it("derives basis point price offsets and steps", () => {
    expect(applyBasisPointOffset({ price: "100", basisPoints: -10 })).toBe(
      "99.9"
    );
    expect(getBasisPointStep({ price: "100", basisPoints: 5 })).toBe("0.05");
    expect(getBasisPointStep({ price: "100", basisPoints: -5 })).toBe("-0.05");
  });

  it("checks whether prices are near a reference price", () => {
    expect(
      isPriceWithinBasisPoints({
        price: "100.99",
        referencePrice: "100",
        toleranceBasisPoints: 100,
      })
    ).toBe(true);
    expect(
      isPriceWithinBasisPoints({
        price: "101.01",
        referencePrice: "100",
        toleranceBasisPoints: 100,
      })
    ).toBe(false);
  });

  it("builds derivative order plans with stable cids and stepped prices", () => {
    const plans = buildDerivativeLimitOrderPlans({
      marketId: "0xmarket",
      subaccountId: "0xsubaccount",
      injectiveAddress: "inj1placer",
      orderSide: "BUY",
      feeRecipient: "inj1fee",
      price: "100",
      priceStep: "0.5",
      quantity: "0.01",
      margin: "1",
      orderCount: 3,
      cidPrefix: "seed",
    });

    expect(plans).toEqual([
      {
        marketId: "0xmarket",
        subaccountId: "0xsubaccount",
        injectiveAddress: "inj1placer",
        orderSide: "BUY",
        feeRecipient: "inj1fee",
        price: "100",
        quantity: "0.01",
        margin: "1",
        cid: "seed-1",
      },
      {
        marketId: "0xmarket",
        subaccountId: "0xsubaccount",
        injectiveAddress: "inj1placer",
        orderSide: "BUY",
        feeRecipient: "inj1fee",
        price: "100.5",
        quantity: "0.01",
        margin: "1",
        cid: "seed-2",
      },
      {
        marketId: "0xmarket",
        subaccountId: "0xsubaccount",
        injectiveAddress: "inj1placer",
        orderSide: "BUY",
        feeRecipient: "inj1fee",
        price: "101",
        quantity: "0.01",
        margin: "1",
        cid: "seed-3",
      },
    ]);
  });

  it("builds RFQ quote templates with long expiry metadata", () => {
    const quotes = buildSeedQuoteTemplates({
      chainId: "injective-888",
      contractAddress: "inj1rfq",
      marketId: "0xmarket",
      makerAddress: "inj1maker",
      takerAddress: "inj1taker",
      takerDirection: "long",
      price: "100",
      quantity: "0.01",
      margin: "1",
      rfqIdStart: 42,
      expiryTimestampMilliseconds: 1_800_000_000_000,
      quoteCount: 2,
    });

    expect(quotes).toEqual([
      {
        chainId: "injective-888",
        contractAddress: "inj1rfq",
        marketId: "0xmarket",
        rfqId: 42,
        takerDirection: "long",
        margin: "1",
        quantity: "0.01",
        price: "100",
        expiry: {
          timestamp: 1_800_000_000_000,
        },
        maker: "inj1maker",
        taker: "inj1taker",
        signature: "",
        status: "pending",
        minFillQuantity: "0.01",
        makerSubaccountNonce: 0,
        signMode: "v1",
      },
      {
        chainId: "injective-888",
        contractAddress: "inj1rfq",
        marketId: "0xmarket",
        rfqId: 43,
        takerDirection: "long",
        margin: "1",
        quantity: "0.01",
        price: "100",
        expiry: {
          timestamp: 1_800_000_000_000,
        },
        maker: "inj1maker",
        taker: "inj1taker",
        signature: "",
        status: "pending",
        minFillQuantity: "0.01",
        makerSubaccountNonce: 0,
        signMode: "v1",
      },
    ]);
  });

  it("wraps quotes in the RFQ accept_quote envelope", () => {
    const quotes = [{ maker: "inj1maker" }];

    expect(buildDefaultAcceptQuotePayload(quotes)).toEqual({
      accept_quote: {
        quotes,
      },
    });
    expect(
      extractQuotesFromAcceptQuotePayload({ accept_quote: { quotes } })
    ).toEqual(quotes);
    expect(extractQuotesFromAcceptQuotePayload({ quotes })).toEqual(quotes);
  });

  it("parses JSON records and arrays defensively", () => {
    expect(parseJsonRecord("VALUE", "{\"a\":1}")).toEqual({ a: 1 });
    expect(parseJsonArray("VALUE", "[1,2]")).toEqual([1, 2]);
    expect(() => parseJsonRecord("VALUE", "[1]")).toThrow(
      "VALUE must be a JSON object"
    );
    expect(() => parseJsonArray("VALUE", "{\"a\":1}")).toThrow(
      "VALUE must be a JSON array"
    );
  });

  it("builds account seed phrase environment names", () => {
    expect(getAccountCredentialEnvironment("A")).toEqual({
      addressEnvironmentVariable: "AUTHZ_RFQ_ACCOUNT_A_ADDRESS",
      seedPhraseEnvironmentVariable: "AUTHZ_RFQ_ACCOUNT_A_SEED_PHRASE",
      mnemonicEnvironmentVariable: "AUTHZ_RFQ_ACCOUNT_A_MNEMONIC",
      derivationPathEnvironmentVariable: "AUTHZ_RFQ_ACCOUNT_A_DERIVATION_PATH",
      privateKeyEnvironmentVariable: "AUTHZ_RFQ_ACCOUNT_A_PRIVATE_KEY",
    });
  });

  it("derives account addresses from seed phrases before private keys", () => {
    const fakePrivateKeyFactory = {
      fromHex: (privateKey: string) => ({
        toBech32: () => `hex:${privateKey}`,
      }),
      fromMnemonic: (seedPhrase: string, derivationPath?: string) => ({
        toBech32: () => `seed:${seedPhrase}:${derivationPath ?? "default"}`,
      }),
    };

    withEnvironment(
      {
        AUTHZ_RFQ_ACCOUNT_A_ADDRESS: "",
        AUTHZ_RFQ_ACCOUNT_A_SEED_PHRASE: "seed words",
        AUTHZ_RFQ_ACCOUNT_A_MNEMONIC: "",
        AUTHZ_RFQ_ACCOUNT_A_DERIVATION_PATH: "m/44'/60'/0'/0/9",
        AUTHZ_RFQ_ACCOUNT_A_PRIVATE_KEY: "private-key",
      },
      () => {
        expect(
          getAccountAddressFromEnvironment({
            PrivateKey: fakePrivateKeyFactory,
            ...getAccountCredentialEnvironment("A"),
          })
        ).toBe("seed:seed words:m/44'/60'/0'/0/9");
      }
    );
  });

  it("still supports private keys as an account credential fallback", () => {
    const fakePrivateKeyFactory = {
      fromHex: (privateKey: string) => ({
        toBech32: () => `hex:${privateKey}`,
      }),
      fromMnemonic: (seedPhrase: string) => ({
        toBech32: () => `seed:${seedPhrase}`,
      }),
    };

    withEnvironment(
      {
        AUTHZ_RFQ_ACCOUNT_B_ADDRESS: "",
        AUTHZ_RFQ_ACCOUNT_B_SEED_PHRASE: "",
        AUTHZ_RFQ_ACCOUNT_B_MNEMONIC: "",
        AUTHZ_RFQ_ACCOUNT_B_DERIVATION_PATH: "",
        AUTHZ_RFQ_ACCOUNT_B_PRIVATE_KEY: "private-key",
      },
      () => {
        expect(
          getAccountAddressFromEnvironment({
            PrivateKey: fakePrivateKeyFactory,
            ...getAccountCredentialEnvironment("B"),
          })
        ).toBe("hex:private-key");
      }
    );
  });

  it("scores and selects illiquid USDC perp market candidates", () => {
    const emptyBookMarket = {
      ticker: "BTC/USDC PERP",
      marketId: "0xempty",
      quoteDenom: "erc20:usdc",
      marketStatus: "active",
      isPerpetual: true,
    };
    const oneLevelMarket = {
      ticker: "ETH/USDC PERP",
      marketId: "0xone",
      quoteDenom: "erc20:usdc",
      marketStatus: "active",
      isPerpetual: true,
    };
    const emptySummary = summarizeMarketCandidate(emptyBookMarket, {
      buys: [],
      sells: [],
    });
    const oneLevelSummary = summarizeMarketCandidate(oneLevelMarket, {
      buys: [{ price: "100", quantity: "1" }],
      sells: [],
    });
    const candidateSummaries = [oneLevelSummary, emptySummary].filter(
      (summary): summary is NonNullable<typeof summary> => summary !== undefined
    );

    expect(getOrderbookDepth({ buys: [], sells: [{ price: "1" }] })).toEqual({
      buyCount: 0,
      sellCount: 1,
      totalOrderCount: 1,
    });
    expect(emptySummary?.totalOrderCount).toBe(0);
    expect(
      selectIlliquidMarketCandidate(candidateSummaries, 1)?.marketId
    ).toBe("0xempty");
  });

  it("derives fallback prices from orderbooks and scales oracle prices", () => {
    expect(
      getOrderbookMidPrice({
        buys: [{ price: "99" }],
        sells: [{ price: "101" }],
      })
    ).toBe("100");
    expect(
      scaleOraclePriceToQuoteDecimals({
        price: "61742.5",
        quoteDecimals: 6,
        oracleScaleFactor: 8,
      })
    ).toBe("6174250");
    expect(
      scaleOraclePriceToQuoteDecimals({
        price: "61742.5",
        quoteDecimals: 6,
        oracleScaleFactor: 6,
      })
    ).toBe("61742.5");
  });

  it("matches AuthZ grants by contract address recursively", () => {
    const grants = [
      {
        authorization: {
          typeUrl: "/injective.wasmx.v1.ContractExecutionAuthorization",
          grants: [{ contract: defaultRfqContractAddress }],
        },
      },
    ];

    expect(recordContainsString(grants[0], defaultRfqContractAddress)).toBe(true);
    expect(hasGrantForContract(grants, defaultRfqContractAddress)).toBe(true);
    expect(hasGrantForContract(grants, "inj1missing")).toBe(false);
  });

  it("summarizes quote verification and enforces signatures/quantity", () => {
    const quotes = [
      {
        maker: "inj1maker",
        taker: "inj1taker",
        marketId: "0xmarket",
        contractAddress: defaultRfqContractAddress,
        quantity: "0.1",
        signature: "0xsig1",
        expiry: { timestamp: 1_800_000_000_000 },
      },
      {
        maker: "inj1maker",
        taker: "inj1taker",
        marketId: "0xmarket",
        contractAddress: defaultRfqContractAddress,
        quantity: "0.2",
        signature: "0xsig2",
        expiry: { timestamp: 1_800_000_000_000 },
      },
    ];
    const summary = summarizeQuoteVerification({
      quotes,
      makerAddress: "inj1maker",
      takerAddress: "inj1taker",
      marketId: "0xmarket",
      contractAddress: defaultRfqContractAddress,
      expectedTotalQuantity: "0.3",
      minimumExpirySeconds: 60,
      nowMilliseconds: 1_700_000_000_000,
    });

    expect(sumDecimalStrings("quantity", ["0.1", "0.2"])).toBe("0.3");
    expect(summary).toMatchObject({
      quoteCount: 2,
      matchingMakerCount: 2,
      matchingTakerCount: 2,
      matchingMarketCount: 2,
      matchingContractCount: 2,
      longExpiryCount: 2,
      signedQuoteCount: 2,
      totalQuantity: "0.3",
      quantityMatchesExpected: true,
    });
    expect(() =>
      assertQuoteVerification({
        summary,
        requireSignatures: true,
        requireQuantityMatch: true,
      })
    ).not.toThrow();
  });

  it("rejects ARB payloads that do not reference RFQ contract and market", () => {
    expect(() =>
      assertArbPayloadReferencesExecutionInputs({
        payload: {
          execute: {
            rfq_contract: defaultRfqContractAddress,
            market_id: "0xmarket",
          },
        },
        rfqContractAddress: defaultRfqContractAddress,
        marketId: "0xmarket",
      })
    ).not.toThrow();
    expect(() =>
      assertArbPayloadReferencesExecutionInputs({
        payload: { execute: { market_id: "0xmarket" } },
        rfqContractAddress: defaultRfqContractAddress,
        marketId: "0xmarket",
      })
    ).toThrow("AUTHZ_RFQ_ARB_EXECUTE_JSON must reference");
  });
});
