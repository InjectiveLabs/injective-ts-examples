import { describe, expect, it } from "vitest";
import {
  assertNonNegativeInteger,
  assertPositiveInteger,
  buildPriceSnapshot,
  chunkArray,
  comparePrices,
  getDefaultWsPriceOracleEndpoint,
  getPriceDecimals,
  parseTimestampToMilliseconds,
  scaleOraclePrice,
  toJsonLine,
  truncateToFixed,
} from "./mark-index-price-drift";

describe("mark/index price drift helpers", () => {
  it("selects the TrueCurrent ws price oracle endpoint by network", () => {
    expect(getDefaultWsPriceOracleEndpoint("mainnet")).toBe(
      "https://ws-price-oracle.injective.tech/"
    );
    expect(getDefaultWsPriceOracleEndpoint("mainnetSentry")).toBe(
      "https://ws-price-oracle.injective.tech/"
    );
    expect(getDefaultWsPriceOracleEndpoint("testnet")).toBe(
      "https://testnet.ws-price-oracle.injective.tech/"
    );
  });

  it("validates integer configuration values", () => {
    expect(assertPositiveInteger("SAMPLE_COUNT", 1)).toBe(1);
    expect(assertNonNegativeInteger("INTERVAL_MS", 0)).toBe(0);
    expect(() => assertPositiveInteger("SAMPLE_COUNT", 0)).toThrow(
      "SAMPLE_COUNT must be a positive integer."
    );
    expect(() => assertNonNegativeInteger("INTERVAL_MS", -1)).toThrow(
      "INTERVAL_MS must be a non-negative integer."
    );
  });

  it("chunks arrays without mutating the original values", () => {
    const values = [1, 2, 3, 4, 5];

    expect(chunkArray(values, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses timestamp strings into milliseconds", () => {
    expect(parseTimestampToMilliseconds("1710000000")).toBe(1710000000000);
    expect(parseTimestampToMilliseconds("1710000000123")).toBe(1710000000123);
    expect(parseTimestampToMilliseconds("1710000000123456")).toBe(
      1710000000123.456
    );
    expect(parseTimestampToMilliseconds("1710000000123456789")).toBe(
      1710000000123.4568
    );
    expect(parseTimestampToMilliseconds("2024-03-09T16:00:00.000Z")).toBe(
      1710000000000
    );
    expect(parseTimestampToMilliseconds("not-a-timestamp")).toBeUndefined();
  });

  it("scales oracle prices using quote decimals and oracle scale factor", () => {
    expect(
      scaleOraclePrice({
        price: "73370",
        quoteDecimals: 6,
        oracleScaleFactor: 6,
      })
    ).toBe(73370);
    expect(
      scaleOraclePrice({
        price: "73370",
        quoteDecimals: 18,
        oracleScaleFactor: 6,
      })
    ).toBe(0.00000007337);
    expect(
      scaleOraclePrice({
        price: "0",
        quoteDecimals: 18,
        oracleScaleFactor: 6,
      })
    ).toBe(0);
    expect(
      scaleOraclePrice({
        price: "not-a-number",
        quoteDecimals: 6,
        oracleScaleFactor: 6,
      })
    ).toBeUndefined();
  });

  it("builds display prices with round-down behavior", () => {
    expect(truncateToFixed(73370.1299, 2)).toBe("73370.12");
    expect(
      buildPriceSnapshot({
        price: "73370.1299",
        priceDecimals: 2,
        quoteDecimals: 6,
        oracleScaleFactor: 6,
      })
    ).toEqual({
      rawPrice: "73370.1299",
      scaledPrice: 73370.1299,
      displayPrice: "73370.12",
    });
  });

  it("derives display decimals from derivative market tick size", () => {
    expect(
      getPriceDecimals({
        minPriceTickSize: 1000,
        quoteDecimals: 6,
      })
    ).toBe(3);
    expect(
      getPriceDecimals({
        minPriceTickSize: 1,
        quoteDecimals: undefined,
      })
    ).toBe(8);
  });

  it("calculates index-vs-mark drift metrics", () => {
    const markPrice = buildPriceSnapshot({
      price: "73370",
      priceDecimals: 2,
      quoteDecimals: 6,
      oracleScaleFactor: 6,
    });
    const indexPrice = buildPriceSnapshot({
      price: "73404",
      priceDecimals: 2,
      quoteDecimals: 6,
      oracleScaleFactor: 6,
    });

    expect(comparePrices({ markPrice, indexPrice })).toEqual({
      rawDifference: 34,
      scaledDifference: 34,
      scaledAbsoluteDifference: 34,
      basisPointsDifference: (34 / 73370) * 10000,
      displayEqual: false,
    });
  });

  it("serializes bigint values to JSONL", () => {
    expect(toJsonLine({ sequence: 123n })).toBe('{"sequence":"123"}\n');
  });
});
