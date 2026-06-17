import { describe, expect, it } from "vitest";
import {
  buildFeeGrantAllowanceQueryUrl,
  confirmFeeGrantAllowance,
  metadata,
  normalizeWeb3GatewayFeeGrantResponse,
  requirePositiveInteger,
  waitForFeeGrantConfirmation,
} from "./web3gw-fee-grant";

describe("web3 gateway fee grant example", () => {
  it("documents that the example may broadcast", () => {
    expect(metadata).toMatchObject({
      id: "tx:web3gw-fee-grant",
      category: "transactions",
      mayBroadcast: true,
    });
  });

  it("requires positive integer configuration values", () => {
    expect(requirePositiveInteger("ATTEMPTS", 1)).toBe(1);
    expect(() => requirePositiveInteger("ATTEMPTS", 0)).toThrow(
      /positive integer/,
    );
    expect(() => requirePositiveInteger("ATTEMPTS", 1.5)).toThrow(
      /positive integer/,
    );
  });

  it("builds the fee grant allowance query URL", () => {
    expect(
      buildFeeGrantAllowanceQueryUrl({
        restEndpoint: "https://testnet.sentry.lcd.injective.network/",
        granterAddress: "inj1granter",
        granteeAddress: "inj1grantee",
      }),
    ).toBe(
      "https://testnet.sentry.lcd.injective.network/cosmos/feegrant/v1beta1/allowance/inj1granter/inj1grantee",
    );
  });

  it("normalizes the Web3 Gateway fee grant response", () => {
    expect(
      normalizeWeb3GatewayFeeGrantResponse({
        granterAddress: "inj1granter",
        granteeAddress: "inj1grantee",
        txHash: "ABC123",
        expiration: 1_700_000_000_000n,
        spendLimit: {
          denom: "inj",
          amount: "1000000000000000",
        },
        allowedMessages: ["/injective.exchange.v1beta1.MsgCreateSpotLimitOrder"],
      }),
    ).toEqual({
      granterAddress: "inj1granter",
      granteeAddress: "inj1grantee",
      txHash: "ABC123",
      expiration: "1700000000000",
      spendLimit: {
        denom: "inj",
        amount: "1000000000000000",
      },
      allowedMessages: ["/injective.exchange.v1beta1.MsgCreateSpotLimitOrder"],
    });
  });

  it("confirms a matching fee grant allowance query response", () => {
    const allowance = {
      "@type": "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      allowed_messages: ["/injective.exchange.v1beta1.MsgCreateSpotLimitOrder"],
    };

    expect(
      confirmFeeGrantAllowance({
        allowanceQueryResponse: {
          allowance: {
            granter: "inj1granter",
            grantee: "inj1grantee",
            allowance,
          },
        },
        expectedGranterAddress: "inj1granter",
        expectedGranteeAddress: "inj1grantee",
      }),
    ).toEqual({
      granterAddress: "inj1granter",
      granteeAddress: "inj1grantee",
      allowance,
    });
  });

  it("rejects a mismatched fee grant allowance query response", () => {
    expect(() =>
      confirmFeeGrantAllowance({
        allowanceQueryResponse: {
          allowance: {
            granter: "inj1other",
            grantee: "inj1grantee",
            allowance: {},
          },
        },
        expectedGranterAddress: "inj1granter",
        expectedGranteeAddress: "inj1grantee",
      }),
    ).toThrow(/did not match expected addresses/);
  });

  it("retries while waiting for the fee grant confirmation", async () => {
    let fetchCount = 0;
    let delayCount = 0;

    const confirmation = await waitForFeeGrantConfirmation({
      fetchAllowance: async () => {
        fetchCount += 1;

        if (fetchCount === 1) {
          throw new Error("not indexed yet");
        }

        return {
          allowance: {
            granter: "inj1granter",
            grantee: "inj1grantee",
            allowance: {},
          },
        };
      },
      expectedGranterAddress: "inj1granter",
      expectedGranteeAddress: "inj1grantee",
      attempts: 2,
      pollIntervalMilliseconds: 5,
      delay: async (milliseconds) => {
        delayCount += 1;
        expect(milliseconds).toBe(5);
      },
    });

    expect(confirmation).toEqual({
      granterAddress: "inj1granter",
      granteeAddress: "inj1grantee",
      allowance: {},
      attempts: 2,
    });
    expect(fetchCount).toBe(2);
    expect(delayCount).toBe(1);
  });
});

