import { describe, expect, it } from "vitest";
import {
  buildTransactionQueryUrl,
  calculateBalanceDelta,
  calculateExpirationTimestamp,
  ensureDifferentFeeGrantAddresses,
  extractTransactionFeeDetails,
  getErrorMessage,
  getFeegrantVerdict,
  inferSigningMaterialType,
  isFeeAllowanceAlreadyExistsError,
  metadata,
  requirePositiveInteger,
  resolveGranteeSigningMaterial,
  resolveGranterSigningMaterial,
} from "./testnet-fee-grant";

const privateKeyHex =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const seedPhrase = "test test test test test test test test test test test junk";

describe("testnet fee grant example", () => {
  it("documents that the example may broadcast", () => {
    expect(metadata).toMatchObject({
      id: "tx:testnet-fee-grant",
      category: "transactions",
      mayBroadcast: true,
    });
  });

  it("detects private keys and seed phrases", () => {
    expect(inferSigningMaterialType(privateKeyHex)).toBe("private-key");
    expect(inferSigningMaterialType(`0x${privateKeyHex}`)).toBe("private-key");
    expect(inferSigningMaterialType(seedPhrase)).toBe("seed-phrase");
  });

  it("prefers the fee grant granter signing value over shared signing material", () => {
    expect(
      resolveGranterSigningMaterial({
        feeGrantGranterPrivateKeyOrSeedPhrase: privateKeyHex,
        feeGrantGranterSeedPhrase: seedPhrase,
        privateKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        seedPhrase: "shared shared shared shared shared shared shared shared shared shared shared shared",
      })
    ).toEqual({
      type: "private-key",
      value: privateKeyHex,
      environmentVariable: "FEE_GRANT_GRANTER_PRIVATE_KEY",
    });
  });

  it("allows the fee grant granter private key variable to hold a seed phrase", () => {
    expect(
      resolveGranterSigningMaterial({
        feeGrantGranterPrivateKeyOrSeedPhrase: seedPhrase,
      })
    ).toEqual({
      type: "seed-phrase",
      value: seedPhrase,
      environmentVariable: "FEE_GRANT_GRANTER_PRIVATE_KEY",
    });
  });

  it("uses the fee grant granter seed phrase alias", () => {
    expect(
      resolveGranterSigningMaterial({
        feeGrantGranterSeedPhrase: seedPhrase,
      })
    ).toEqual({
      type: "seed-phrase",
      value: seedPhrase,
      environmentVariable: "FEE_GRANT_GRANTER_SEED_PHRASE",
    });
  });

  it("uses the shared seed phrase when no fee grant granter value is configured", () => {
    expect(resolveGranterSigningMaterial({ seedPhrase })).toEqual({
      type: "seed-phrase",
      value: seedPhrase,
      environmentVariable: "SEED_PHRASE",
    });
  });

  it("uses the shared private key when no fee grant granter value is configured", () => {
    expect(
      resolveGranterSigningMaterial({
        privateKey: privateKeyHex,
      })
    ).toEqual({
      type: "private-key",
      value: privateKeyHex,
      environmentVariable: "PRIVATE_KEY",
    });
  });

  it("requires granter signing material", () => {
    expect(() => resolveGranterSigningMaterial({})).toThrow(
      /Set FEE_GRANT_GRANTER_PRIVATE_KEY/
    );
  });

  it("allows the fee grant grantee private key variable to hold a seed phrase", () => {
    expect(
      resolveGranteeSigningMaterial({
        feeGrantGranteePrivateKeyOrSeedPhrase: seedPhrase,
      })
    ).toEqual({
      type: "seed-phrase",
      value: seedPhrase,
      environmentVariable: "FEE_GRANT_GRANTEE_PRIVATE_KEY",
    });
  });

  it("uses the fee grant grantee seed phrase alias", () => {
    expect(
      resolveGranteeSigningMaterial({
        feeGrantGranteeSeedPhrase: seedPhrase,
      })
    ).toEqual({
      type: "seed-phrase",
      value: seedPhrase,
      environmentVariable: "FEE_GRANT_GRANTEE_SEED_PHRASE",
    });
  });

  it("requires grantee signing material", () => {
    expect(() => resolveGranteeSigningMaterial({})).toThrow(
      /Set FEE_GRANT_GRANTEE_PRIVATE_KEY/
    );
  });

  it("rejects matching granter and grantee addresses", () => {
    expect(() =>
      ensureDifferentFeeGrantAddresses({
        granterInjectiveAddress: "inj1same",
        granteeInjectiveAddress: "inj1same",
      })
    ).toThrow(/must be different/);
  });

  it("allows different granter and grantee addresses", () => {
    expect(() =>
      ensureDifferentFeeGrantAddresses({
        granterInjectiveAddress: "inj1granter",
        granteeInjectiveAddress: "inj1grantee",
      })
    ).not.toThrow();
  });

  it("requires positive integer configuration values", () => {
    expect(requirePositiveInteger("SECONDS", 60)).toBe(60);
    expect(() => requirePositiveInteger("SECONDS", 0)).toThrow(
      /positive integer/
    );
    expect(() => requirePositiveInteger("SECONDS", 1.5)).toThrow(
      /positive integer/
    );
  });

  it("calculates the expiration timestamp from the current time", () => {
    expect(
      calculateExpirationTimestamp({
        currentTimeMilliseconds: 1_700_000_000_900,
        secondsFromNow: 3600,
      })
    ).toBe(1_700_003_600);
  });

  it("calculates balance deltas as signed integer strings", () => {
    expect(
      calculateBalanceDelta({
        beforeAmount: "1000",
        afterAmount: "1250",
      })
    ).toBe("250");
    expect(
      calculateBalanceDelta({
        beforeAmount: "1000",
        afterAmount: "750",
      })
    ).toBe("-250");
  });

  it("extracts error messages from common thrown values", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("plain failure")).toBe("plain failure");
    expect(getErrorMessage({ message: "object failure" })).toBe(
      "object failure"
    );
  });

  it("detects existing fee allowance errors", () => {
    expect(
      isFeeAllowanceAlreadyExistsError(
        "fee allowance already exists: invalid request"
      )
    ).toBe(true);
    expect(isFeeAllowanceAlreadyExistsError("insufficient funds")).toBe(false);
  });

  it("builds the transaction query URL", () => {
    expect(
      buildTransactionQueryUrl({
        restEndpoint: "https://lcd.testnet.injective.network/",
        transactionHash: "ABC123",
      })
    ).toBe("https://lcd.testnet.injective.network/cosmos/tx/v1beta1/txs/ABC123");
  });

  it("extracts fee payer fields from a transaction query response", () => {
    const feeDetails = extractTransactionFeeDetails(
      {
        tx: {
          auth_info: {
            fee: {
              amount: [{ denom: "inj", amount: "24000000000000" }],
              gas_limit: "150000",
              payer: "",
              granter: "inj1granter",
            },
          },
        },
      },
      {
        restEndpoint: "https://lcd.testnet.injective.network",
        transactionHash: "ABC123",
      }
    );

    expect(feeDetails).toEqual({
      transactionHash: "ABC123",
      queryUrl:
        "https://lcd.testnet.injective.network/cosmos/tx/v1beta1/txs/ABC123",
      feePayer: "inj1granter",
      rawFeePayer: "",
      feeGranter: "inj1granter",
      gasLimit: "150000",
      amount: [{ denom: "inj", amount: "24000000000000" }],
    });
  });

  it("prints a clear feegrant verdict", () => {
    expect(
      getFeegrantVerdict({
        feeGranter: "inj1granter",
        expectedGranter: "inj1granter",
      })
    ).toBe("feegrant WORKS");
    expect(
      getFeegrantVerdict({
        feeGranter: "",
        expectedGranter: "inj1granter",
      })
    ).toBe("feegrant DOES NOT WORK");
  });
});
