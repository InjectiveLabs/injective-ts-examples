import { describe, expect, it } from "vitest";
import {
  calculateTransferAmount,
  metadata,
  resolveSourceSigningMaterial,
} from "./send-funds";

describe("send funds example", () => {
  it("documents that the example may broadcast", () => {
    expect(metadata).toMatchObject({
      id: "tx:send-funds",
      category: "transactions",
      mayBroadcast: true,
    });
  });

  it("prefers a private key over a seed phrase", () => {
    expect(
      resolveSourceSigningMaterial({
        privateKey: "private-key",
        seedPhrase: "seed phrase",
      })
    ).toEqual({
      type: "private-key",
      value: "private-key",
      environmentVariable: "PRIVATE_KEY",
    });
  });

  it("uses a seed phrase when no private key is configured", () => {
    expect(resolveSourceSigningMaterial({ seedPhrase: "seed phrase" })).toEqual({
      type: "seed-phrase",
      value: "seed phrase",
      environmentVariable: "SEED_PHRASE",
    });
  });

  it("requires one source signing material value", () => {
    expect(() => resolveSourceSigningMaterial({})).toThrow(
      /Set PRIVATE_KEY or SEED_PHRASE/
    );
  });

  it("calculates the transferable amount after reserving the fee", () => {
    expect(
      calculateTransferAmount({
        balanceAmount: "1000",
        feeAmount: "300",
      })
    ).toBe("700");
  });

  it("rejects an empty source balance", () => {
    expect(() =>
      calculateTransferAmount({
        balanceAmount: "0",
        feeAmount: "300",
      })
    ).toThrow(/no INJ balance/);
  });

  it("rejects balances that cannot pay the estimated fee", () => {
    expect(() =>
      calculateTransferAmount({
        balanceAmount: "300",
        feeAmount: "300",
      })
    ).toThrow(/not enough to pay the estimated fee/);
  });
});
