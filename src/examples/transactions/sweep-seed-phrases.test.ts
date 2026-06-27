import { describe, expect, it } from "vitest";
import {
  calculateSweepTransferAmount,
  ensureDifferentInjectiveAddresses,
  extractTransactionHash,
  metadata,
  parseSeedPhrases,
} from "./sweep-seed-phrases";

describe("sweep seed phrases example", () => {
  it("documents that the example may broadcast", () => {
    expect(metadata).toMatchObject({
      id: "tx:sweep-seed-phrases",
      category: "transactions",
      mayBroadcast: true,
    });
  });

  it("parses comma-separated seed phrases", () => {
    expect(
      parseSeedPhrases("first seed phrase, second seed phrase,, third")
    ).toEqual(["first seed phrase", "second seed phrase", "third"]);
  });

  it("requires at least one seed phrase", () => {
    expect(() => parseSeedPhrases(" , , ")).toThrow(/SEED_PHRASES/);
  });

  it("calculates the sweep amount after reserving gas", () => {
    expect(
      calculateSweepTransferAmount({
        balanceAmount: "1000000000000000000",
        gasReserveAmount: "10000000000000000",
      })
    ).toBe("990000000000000000");
  });

  it("skips balances that cannot cover the gas reserve", () => {
    expect(
      calculateSweepTransferAmount({
        balanceAmount: "10000000000000000",
        gasReserveAmount: "10000000000000000",
      })
    ).toBeUndefined();
  });

  it("requires a positive gas reserve", () => {
    expect(() =>
      calculateSweepTransferAmount({
        balanceAmount: "100",
        gasReserveAmount: "0",
      })
    ).toThrow(/reserve must be greater than zero/);
  });

  it("rejects sweeps back to the source account", () => {
    expect(() =>
      ensureDifferentInjectiveAddresses({
        sourceInjectiveAddress: "inj1same",
        destinationInjectiveAddress: "inj1same",
      })
    ).toThrow(/must be different/);
  });

  it("allows sweeps to a different destination account", () => {
    expect(() =>
      ensureDifferentInjectiveAddresses({
        sourceInjectiveAddress: "inj1source",
        destinationInjectiveAddress: "inj1destination",
      })
    ).not.toThrow();
  });

  it("extracts a broadcast transaction hash", () => {
    expect(extractTransactionHash({ txHash: "ABC123" })).toBe("ABC123");
  });

  it("requires a broadcast transaction hash", () => {
    expect(() => extractTransactionHash({})).toThrow(/transaction hash/);
  });
});
