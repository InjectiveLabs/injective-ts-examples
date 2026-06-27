import { describe, expect, it } from "vitest";
import {
  buildNonActiveInsuranceFundReport,
  formatMicroAmount,
  type DenomOwner,
  type DerivativeMarket,
  type InsuranceFund,
} from "./non-active-insurance-fund-holders";

const usdcDepositDenom = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const usdtDepositDenom = "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7";
const insuranceModuleAddress =
  "inj1vn5fx74ud4cu7tf0pls9u5krxengsdzrg9ap2d";

const createFund = ({
  balance,
  depositDenom = usdtDepositDenom,
  marketId,
  shareDenom,
  ticker,
  totalShare,
}: {
  readonly balance: string;
  readonly depositDenom?: string;
  readonly marketId: string;
  readonly shareDenom: string;
  readonly ticker: string;
  readonly totalShare: string;
}): InsuranceFund => ({
  balance,
  deposit_denom: depositDenom,
  insurance_pool_token_denom: shareDenom,
  market_id: marketId,
  market_ticker: ticker,
  total_share: totalShare,
});

const createDerivativeMarket = ({
  marketId,
  status,
  ticker,
}: {
  readonly marketId: string;
  readonly status: string;
  readonly ticker: string;
}): DerivativeMarket => ({
  market_id: marketId,
  status,
  ticker,
});

const createOwner = ({
  address,
  amount,
  denom,
}: {
  readonly address: string;
  readonly amount: string;
  readonly denom: string;
}): DenomOwner => ({
  address,
  balance: {
    amount,
    denom,
  },
});

describe("non-active insurance fund report", () => {
  it("formats micro amounts with six decimals and grouping", () => {
    expect(formatMicroAmount(1234567890123n)).toBe("1,234,567.890123");
  });

  it("filters to non-active USDC/USDT funds and excludes the insurance module", () => {
    const funds: InsuranceFund[] = [
      createFund({
        balance: "110000000",
        marketId: "0xpaused-large",
        shareDenom: "share-paused-large",
        ticker: "PAUSED/USDT PERP",
        totalShare: "1100",
      }),
      createFund({
        balance: "20000000",
        depositDenom: usdcDepositDenom,
        marketId: "0xexpired",
        shareDenom: "share-expired",
        ticker: "EXPIRED/USDC PERP",
        totalShare: "100",
      }),
      createFund({
        balance: "15000000",
        marketId: "0xpaused-module-only",
        shareDenom: "share-paused-module-only",
        ticker: "MODULEONLY/USDT PERP",
        totalShare: "100",
      }),
      createFund({
        balance: "9000000",
        marketId: "0xdemolished-small",
        shareDenom: "share-demolished-small",
        ticker: "SMALL/USDT PERP",
        totalShare: "100",
      }),
      createFund({
        balance: "50000000",
        marketId: "0xactive",
        shareDenom: "share-active",
        ticker: "ACTIVE/USDT PERP",
        totalShare: "100",
      }),
    ];
    const derivativeMarkets: DerivativeMarket[] = [
      createDerivativeMarket({
        marketId: "0xpaused-large",
        status: "Paused",
        ticker: "PAUSED/USDT PERP",
      }),
      createDerivativeMarket({
        marketId: "0xexpired",
        status: "Expired",
        ticker: "EXPIRED/USDC PERP",
      }),
      createDerivativeMarket({
        marketId: "0xpaused-module-only",
        status: "Paused",
        ticker: "MODULEONLY/USDT PERP",
      }),
      createDerivativeMarket({
        marketId: "0xdemolished-small",
        status: "Demolished",
        ticker: "SMALL/USDT PERP",
      }),
      createDerivativeMarket({
        marketId: "0xactive",
        status: "Active",
        ticker: "ACTIVE/USDT PERP",
      }),
    ];
    const denomOwnersByDenom = new Map<string, DenomOwner[]>([
      [
        "share-paused-large",
        [
          createOwner({
            address: insuranceModuleAddress,
            amount: "100",
            denom: "share-paused-large",
          }),
          createOwner({
            address: "inj1usera",
            amount: "500",
            denom: "share-paused-large",
          }),
          createOwner({
            address: "inj1userb",
            amount: "300",
            denom: "share-paused-large",
          }),
          createOwner({
            address: "inj1userc",
            amount: "100",
            denom: "share-paused-large",
          }),
          createOwner({
            address: "inj1usere",
            amount: "100",
            denom: "share-paused-large",
          }),
        ],
      ],
      [
        "share-expired",
        [
          createOwner({
            address: "inj1userb",
            amount: "50",
            denom: "share-expired",
          }),
          createOwner({
            address: "inj1userd",
            amount: "50",
            denom: "share-expired",
          }),
        ],
      ],
      [
        "share-paused-module-only",
        [
          createOwner({
            address: insuranceModuleAddress,
            amount: "100",
            denom: "share-paused-module-only",
          }),
        ],
      ],
    ]);

    const report = buildNonActiveInsuranceFundReport({
      denomOwnersByDenom,
      derivativeMarkets,
      funds,
      fundsBlockHeight: "10",
      ownerBlockHeights: ["11", "12"],
    });

    expect(report.groups.map((group) => group.marketTicker)).toEqual([
      "PAUSED/USDT PERP",
      "EXPIRED/USDC PERP",
      "MODULEONLY/USDT PERP",
    ]);
    expect(report.includedStatusCounts).toEqual({
      Demolished: 0,
      Expired: 1,
      Paused: 2,
    });
    expect(report.source).toEqual({
      fundsBlockHeight: "10",
      ownerBlockHeightRange: "11-12",
    });
    expect(report.groups[0]).toMatchObject({
      excludedHolderAmountFormatted: "10.000000",
      excludedHolderAmountMicro: "10000000",
      rankedHolderBalanceFormatted: "100.000000",
      rankedHolderBalanceMicro: "100000000",
    });
    expect(report.groups[0]?.holderRows).toEqual([
      {
        address: "inj1usera",
        amountFormatted: "50.000000 USDT",
        amountMicro: "50000000",
        fundOwnershipPercent: "45.4545%",
        holderShare: "500",
        rank: 1,
        rankedOwnershipPercent: "50.0000%",
      },
      {
        address: "inj1userb",
        amountFormatted: "30.000000 USDT",
        amountMicro: "30000000",
        fundOwnershipPercent: "27.2727%",
        holderShare: "300",
        rank: 2,
        rankedOwnershipPercent: "30.0000%",
      },
      {
        address: "inj1userc",
        amountFormatted: "10.000000 USDT",
        amountMicro: "10000000",
        fundOwnershipPercent: "9.0909%",
        holderShare: "100",
        rank: 3,
        rankedOwnershipPercent: "10.0000%",
      },
    ]);
    expect(report.groups[2]?.holderRows).toEqual([]);
    expect(
      report.topHoldersAcrossIncludedFunds.map((holder) => holder.address)
    ).toEqual([
      "inj1usera",
      "inj1userb",
      "inj1userc",
      "inj1userd",
      "inj1usere",
    ]);
    expect(report.topHoldersAcrossIncludedFunds[1]).toMatchObject({
      address: "inj1userb",
      totalFormatted: "40.000000",
      usdcFormatted: "10.000000",
      usdtFormatted: "30.000000",
    });
  });
});
