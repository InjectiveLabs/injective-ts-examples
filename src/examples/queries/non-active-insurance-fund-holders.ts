import type { ExampleMetadata } from "../types";
import { runDirectly } from "../../lib/direct-run";

const defaultLcdEndpoint = "https://sentry.lcd.injective.network";
const insuranceModuleAddress =
  "inj1vn5fx74ud4cu7tf0pls9u5krxengsdzrg9ap2d";
const microDenominator = 1_000_000n;
const defaultMinimumPoolBalanceMicro = 10n * microDenominator;
const defaultTopHolderCount = 3;
const topAggregateHolderCount = 5;
const denomOwnerPageLimit = 1000;

const usdcDepositDenom = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const usdtDepositDenom = "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7";

export const nonActiveDerivativeMarketStatuses = [
  "Paused",
  "Demolished",
  "Expired",
] as const;

type QuoteSymbol = "USDC" | "USDT";
type NonActiveDerivativeMarketStatus =
  (typeof nonActiveDerivativeMarketStatuses)[number];

export interface InsuranceFund {
  readonly deposit_denom: string;
  readonly insurance_pool_token_denom: string;
  readonly balance: string;
  readonly total_share: string;
  readonly market_id: string;
  readonly market_ticker: string;
}

export interface DerivativeMarket {
  readonly market_id: string;
  readonly status: string;
  readonly ticker: string;
}

export interface DenomOwner {
  readonly address: string;
  readonly balance: {
    readonly denom: string;
    readonly amount: string;
  };
}

export interface HolderReportRow {
  readonly address: string;
  readonly amountFormatted: string;
  readonly amountMicro: string;
  readonly fundOwnershipPercent: string;
  readonly holderShare: string;
  readonly rank: number;
  readonly rankedOwnershipPercent: string;
}

export interface InsuranceFundReportGroup {
  readonly excludedHolderAmountFormatted: string;
  readonly excludedHolderAmountMicro: string;
  readonly holderRows: readonly HolderReportRow[];
  readonly marketId: string;
  readonly marketStatus: NonActiveDerivativeMarketStatus;
  readonly marketTicker: string;
  readonly poolBalanceFormatted: string;
  readonly poolBalanceMicro: string;
  readonly quote: QuoteSymbol;
  readonly rankedHolderBalanceFormatted: string;
  readonly rankedHolderBalanceMicro: string;
  readonly shareDenom: string;
}

export interface AggregateHolderReportRow {
  readonly address: string;
  readonly rank: number;
  readonly totalFormatted: string;
  readonly totalMicro: string;
  readonly usdcFormatted: string;
  readonly usdcMicro: string;
  readonly usdtFormatted: string;
  readonly usdtMicro: string;
}

export interface NonActiveInsuranceFundReport {
  readonly groups: readonly InsuranceFundReportGroup[];
  readonly includedStatusCounts: Readonly<
    Record<NonActiveDerivativeMarketStatus, number>
  >;
  readonly minimumPoolBalanceFormatted: string;
  readonly source: {
    readonly fundsBlockHeight?: string;
    readonly ownerBlockHeightRange?: string;
  };
  readonly topHoldersAcrossIncludedFunds: readonly AggregateHolderReportRow[];
  readonly totalDerivativeMarketsByStatus: Readonly<
    Record<NonActiveDerivativeMarketStatus, number>
  >;
  readonly totalFundsChecked: number;
}

interface BuildReportInput {
  readonly denomOwnersByDenom: ReadonlyMap<string, readonly DenomOwner[]>;
  readonly derivativeMarkets: readonly DerivativeMarket[];
  readonly excludedHolderAddresses?: ReadonlySet<string>;
  readonly funds: readonly InsuranceFund[];
  readonly fundsBlockHeight?: string;
  readonly minimumPoolBalanceMicro?: bigint;
  readonly ownerBlockHeights?: readonly string[];
  readonly topHolderCount?: number;
}

interface IncludedInsuranceFund {
  readonly fund: InsuranceFund;
  readonly marketStatus: NonActiveDerivativeMarketStatus;
  readonly owners: readonly DenomOwner[];
  readonly poolBalance: bigint;
  readonly quote: QuoteSymbol;
}

interface HolderPoolAmount {
  readonly address: string;
  readonly holderPoolAmount: bigint;
  readonly holderShare: bigint;
}

interface FetchJsonResponse<T> {
  readonly blockHeight?: string;
  readonly json: T;
}

interface InsuranceFundsResponse {
  readonly funds: readonly InsuranceFund[];
}

interface DerivativeMarketsResponse {
  readonly markets: readonly {
    readonly market: DerivativeMarket;
  }[];
}

interface DenomOwnersResponse {
  readonly denom_owners: readonly DenomOwner[];
  readonly pagination?: {
    readonly next_key?: string | null;
  };
}

const formatIntegerWithCommas = (value: string): string =>
  value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const formatMicroAmount = (amount: bigint): string => {
  const whole = amount / microDenominator;
  const fraction = amount % microDenominator;

  return `${formatIntegerWithCommas(whole.toString())}.${fraction
    .toString()
    .padStart(6, "0")}`;
};

const formatPercent = (holderShare: bigint, totalShare: bigint): string => {
  if (totalShare <= 0n) {
    return "0.0000%";
  }

  const scaledPercent = (holderShare * 1_000_000n) / totalShare;
  const whole = scaledPercent / 10_000n;
  const fraction = scaledPercent % 10_000n;

  return `${whole.toString()}.${fraction.toString().padStart(4, "0")}%`;
};

const compareBigintDescending = (left: bigint, right: bigint): number => {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
};

const getQuoteSymbol = (depositDenom: string): QuoteSymbol | undefined => {
  if (depositDenom === usdcDepositDenom) {
    return "USDC";
  }

  if (depositDenom === usdtDepositDenom) {
    return "USDT";
  }

  return undefined;
};

const isNonActiveDerivativeMarketStatus = (
  status: string
): status is NonActiveDerivativeMarketStatus =>
  nonActiveDerivativeMarketStatuses.includes(
    status as NonActiveDerivativeMarketStatus
  );

const calculateHolderPoolAmount = ({
  fundBalance,
  holderShare,
  totalShare,
}: {
  readonly fundBalance: bigint;
  readonly holderShare: bigint;
  readonly totalShare: bigint;
}): bigint => {
  if (totalShare <= 0n) {
    return 0n;
  }

  return (holderShare * fundBalance) / totalShare;
};

const getBlockHeightRange = (
  blockHeights: readonly string[] | undefined
): string | undefined => {
  const heights = (blockHeights ?? [])
    .filter(Boolean)
    .map((blockHeight) => BigInt(blockHeight));

  if (heights.length === 0) {
    return undefined;
  }

  const minimum = heights.reduce((currentMinimum, blockHeight) =>
    blockHeight < currentMinimum ? blockHeight : currentMinimum
  );
  const maximum = heights.reduce((currentMaximum, blockHeight) =>
    blockHeight > currentMaximum ? blockHeight : currentMaximum
  );

  return minimum === maximum
    ? minimum.toString()
    : `${minimum.toString()}-${maximum.toString()}`;
};

const countMarketsByStatus = (
  derivativeMarkets: readonly DerivativeMarket[]
): Record<NonActiveDerivativeMarketStatus, number> => {
  const counts: Record<NonActiveDerivativeMarketStatus, number> = {
    Paused: 0,
    Demolished: 0,
    Expired: 0,
  };

  for (const market of derivativeMarkets) {
    if (isNonActiveDerivativeMarketStatus(market.status)) {
      counts[market.status] += 1;
    }
  }

  return counts;
};

const sumHolderShares = (
  owners: readonly DenomOwner[],
  shouldIncludeOwner: (owner: DenomOwner) => boolean
): bigint =>
  owners
    .filter(shouldIncludeOwner)
    .reduce((total, owner) => total + BigInt(owner.balance.amount), 0n);

const getHolderPoolAmounts = ({
  excludedHolderAddresses,
  fund,
  owners,
}: {
  readonly excludedHolderAddresses: ReadonlySet<string>;
  readonly fund: InsuranceFund;
  readonly owners: readonly DenomOwner[];
}): HolderPoolAmount[] => {
  const fundBalance = BigInt(fund.balance);
  const totalShare = BigInt(fund.total_share);

  return owners
    .filter((owner) => !excludedHolderAddresses.has(owner.address))
    .map((owner) => {
      const holderShare = BigInt(owner.balance.amount);
      const holderPoolAmount = calculateHolderPoolAmount({
        fundBalance,
        holderShare,
        totalShare,
      });

      return {
        address: owner.address,
        holderPoolAmount,
        holderShare,
      };
    })
    .filter((owner) => owner.holderPoolAmount > 0n)
    .sort((left, right) => {
      const amountComparison = compareBigintDescending(
        left.holderPoolAmount,
        right.holderPoolAmount
      );

      if (amountComparison !== 0) {
        return amountComparison;
      }

      return left.address.localeCompare(right.address);
    });
};

const createHolderRows = ({
  excludedHolderAddresses,
  fund,
  owners,
  quote,
  rankedHolderShare,
  topHolderCount,
}: {
  readonly excludedHolderAddresses: ReadonlySet<string>;
  readonly fund: InsuranceFund;
  readonly owners: readonly DenomOwner[];
  readonly quote: QuoteSymbol;
  readonly rankedHolderShare: bigint;
  readonly topHolderCount: number;
}): HolderReportRow[] => {
  const totalShare = BigInt(fund.total_share);

  return getHolderPoolAmounts({
    excludedHolderAddresses,
    fund,
    owners,
  })
    .slice(0, topHolderCount)
    .map((owner, index) => ({
      address: owner.address,
      amountFormatted: `${formatMicroAmount(owner.holderPoolAmount)} ${quote}`,
      amountMicro: owner.holderPoolAmount.toString(),
      fundOwnershipPercent: formatPercent(owner.holderShare, totalShare),
      holderShare: owner.holderShare.toString(),
      rank: index + 1,
      rankedOwnershipPercent: formatPercent(owner.holderShare, rankedHolderShare),
    }));
};

const buildAggregateTopHolders = ({
  excludedHolderAddresses,
  includedFunds,
}: {
  readonly excludedHolderAddresses: ReadonlySet<string>;
  readonly includedFunds: readonly IncludedInsuranceFund[];
}): AggregateHolderReportRow[] => {
  const totals = new Map<
    string,
    {
      address: string;
      totalMicro: bigint;
      usdcMicro: bigint;
      usdtMicro: bigint;
    }
  >();

  for (const includedFund of includedFunds) {
    for (const holder of getHolderPoolAmounts({
      excludedHolderAddresses,
      fund: includedFund.fund,
      owners: includedFund.owners,
    })) {
      const current = totals.get(holder.address) ?? {
        address: holder.address,
        totalMicro: 0n,
        usdcMicro: 0n,
        usdtMicro: 0n,
      };
      const amount = holder.holderPoolAmount;

      current.totalMicro += amount;

      if (includedFund.quote === "USDC") {
        current.usdcMicro += amount;
      }

      if (includedFund.quote === "USDT") {
        current.usdtMicro += amount;
      }

      totals.set(holder.address, current);
    }
  }

  return [...totals.values()]
    .sort((left, right) => {
      const amountComparison = compareBigintDescending(
        left.totalMicro,
        right.totalMicro
      );

      if (amountComparison !== 0) {
        return amountComparison;
      }

      return left.address.localeCompare(right.address);
    })
    .slice(0, topAggregateHolderCount)
    .map((holder, index) => ({
      address: holder.address,
      rank: index + 1,
      totalFormatted: formatMicroAmount(holder.totalMicro),
      totalMicro: holder.totalMicro.toString(),
      usdcFormatted: formatMicroAmount(holder.usdcMicro),
      usdcMicro: holder.usdcMicro.toString(),
      usdtFormatted: formatMicroAmount(holder.usdtMicro),
      usdtMicro: holder.usdtMicro.toString(),
    }));
};

export const buildNonActiveInsuranceFundReport = ({
  denomOwnersByDenom,
  derivativeMarkets,
  excludedHolderAddresses = new Set([insuranceModuleAddress]),
  funds,
  fundsBlockHeight,
  minimumPoolBalanceMicro = defaultMinimumPoolBalanceMicro,
  ownerBlockHeights,
  topHolderCount = defaultTopHolderCount,
}: BuildReportInput): NonActiveInsuranceFundReport => {
  const derivativeMarketById = new Map(
    derivativeMarkets.map((market) => [market.market_id.toLowerCase(), market])
  );

  const includedFunds = funds
    .map((fund): IncludedInsuranceFund | undefined => {
      const quote = getQuoteSymbol(fund.deposit_denom);

      if (!quote) {
        return undefined;
      }

      const market = derivativeMarketById.get(fund.market_id.toLowerCase());

      if (!market || !isNonActiveDerivativeMarketStatus(market.status)) {
        return undefined;
      }

      const poolBalance = BigInt(fund.balance);

      if (poolBalance < minimumPoolBalanceMicro) {
        return undefined;
      }

      const owners =
        denomOwnersByDenom.get(fund.insurance_pool_token_denom) ?? [];

      return {
        marketStatus: market.status,
        fund,
        owners,
        poolBalance,
        quote,
      };
    })
    .filter(
      (includedFund): includedFund is IncludedInsuranceFund =>
        Boolean(includedFund)
    );

  const groups = includedFunds
    .map(
      (includedFund): InsuranceFundReportGroup => {
        const totalShare = BigInt(includedFund.fund.total_share);
        const excludedHolderShare = sumHolderShares(
          includedFund.owners,
          (owner) => excludedHolderAddresses.has(owner.address)
        );
        const rankedHolderShare = sumHolderShares(
          includedFund.owners,
          (owner) => !excludedHolderAddresses.has(owner.address)
        );
        const excludedHolderAmount = calculateHolderPoolAmount({
          fundBalance: includedFund.poolBalance,
          holderShare: excludedHolderShare,
          totalShare,
        });
        const rankedHolderBalance = calculateHolderPoolAmount({
          fundBalance: includedFund.poolBalance,
          holderShare: rankedHolderShare,
          totalShare,
        });

        return {
          excludedHolderAmountFormatted: formatMicroAmount(excludedHolderAmount),
          excludedHolderAmountMicro: excludedHolderAmount.toString(),
          holderRows: createHolderRows({
            excludedHolderAddresses,
            fund: includedFund.fund,
            owners: includedFund.owners,
            quote: includedFund.quote,
            rankedHolderShare,
            topHolderCount,
          }),
          marketId: includedFund.fund.market_id,
          marketStatus: includedFund.marketStatus,
          marketTicker: includedFund.fund.market_ticker.trim(),
          poolBalanceFormatted: formatMicroAmount(includedFund.poolBalance),
          poolBalanceMicro: includedFund.poolBalance.toString(),
          quote: includedFund.quote,
          rankedHolderBalanceFormatted: formatMicroAmount(rankedHolderBalance),
          rankedHolderBalanceMicro: rankedHolderBalance.toString(),
          shareDenom: includedFund.fund.insurance_pool_token_denom,
        };
      }
    )
    .sort((left, right) => {
      const poolBalanceComparison = compareBigintDescending(
        BigInt(left.poolBalanceMicro),
        BigInt(right.poolBalanceMicro)
      );

      if (poolBalanceComparison !== 0) {
        return poolBalanceComparison;
      }

      return left.marketTicker.localeCompare(right.marketTicker);
    });

  return {
    groups,
    includedStatusCounts: countMarketsByStatus(
      groups.map((group) => ({
        market_id: group.marketId,
        status: group.marketStatus,
        ticker: group.marketTicker,
      }))
    ),
    minimumPoolBalanceFormatted: formatMicroAmount(minimumPoolBalanceMicro),
    source: {
      fundsBlockHeight,
      ownerBlockHeightRange: getBlockHeightRange(ownerBlockHeights),
    },
    topHoldersAcrossIncludedFunds: buildAggregateTopHolders({
      excludedHolderAddresses,
      includedFunds,
    }),
    totalDerivativeMarketsByStatus: countMarketsByStatus(derivativeMarkets),
    totalFundsChecked: funds.length,
  };
};

const createUrl = (
  lcdEndpoint: string,
  path: string,
  searchParams?: Record<string, string>
): URL => {
  const url = new URL(path, lcdEndpoint);

  for (const [name, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(name, value);
  }

  return url;
};

const fetchJson = async <ResponseBody>(
  url: URL
): Promise<FetchJsonResponse<ResponseBody>> => {
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `GET ${url.toString()} failed with ${response.status}: ${body.slice(
        0,
        500
      )}`
    );
  }

  return {
    blockHeight:
      response.headers.get("grpc-metadata-x-cosmos-block-height") ?? undefined,
    json: (await response.json()) as ResponseBody,
  };
};

const fetchInsuranceFunds = async (
  lcdEndpoint: string
): Promise<FetchJsonResponse<InsuranceFundsResponse>> =>
  fetchJson<InsuranceFundsResponse>(
    createUrl(lcdEndpoint, "/injective/insurance/v1beta1/insurance_funds")
  );

const fetchDerivativeMarketsByStatus = async (
  lcdEndpoint: string,
  status: NonActiveDerivativeMarketStatus
): Promise<readonly DerivativeMarket[]> => {
  const response = await fetchJson<DerivativeMarketsResponse>(
    createUrl(lcdEndpoint, "/injective/exchange/v1beta1/derivative/markets", {
      status,
    })
  );

  return response.json.markets.map((entry) => entry.market);
};

const fetchDenomOwners = async (
  lcdEndpoint: string,
  denom: string
): Promise<{
  readonly blockHeights: readonly string[];
  readonly owners: readonly DenomOwner[];
}> => {
  const blockHeights: string[] = [];
  const owners: DenomOwner[] = [];
  let nextKey: string | undefined;

  do {
    const response = await fetchJson<DenomOwnersResponse>(
      createUrl(
        lcdEndpoint,
        `/cosmos/bank/v1beta1/denom_owners/${encodeURIComponent(denom)}`,
        {
          "pagination.limit": String(denomOwnerPageLimit),
          ...(nextKey ? { "pagination.key": nextKey } : {}),
        }
      )
    );

    if (response.blockHeight) {
      blockHeights.push(response.blockHeight);
    }

    owners.push(...response.json.denom_owners);
    nextKey = response.json.pagination?.next_key ?? undefined;
  } while (nextKey);

  return { blockHeights, owners };
};

const getCandidateShareDenoms = ({
  derivativeMarkets,
  funds,
}: {
  readonly derivativeMarkets: readonly DerivativeMarket[];
  readonly funds: readonly InsuranceFund[];
}): string[] => {
  const nonActiveDerivativeMarketIds = new Set(
    derivativeMarkets.map((market) => market.market_id.toLowerCase())
  );

  return [
    ...new Set(
      funds
        .filter((fund) => getQuoteSymbol(fund.deposit_denom))
        .filter((fund) => nonActiveDerivativeMarketIds.has(fund.market_id.toLowerCase()))
        .filter((fund) => BigInt(fund.balance) >= defaultMinimumPoolBalanceMicro)
        .map((fund) => fund.insurance_pool_token_denom)
    ),
  ];
};

const renderReport = (report: NonActiveInsuranceFundReport): string => {
  const lines = [
    "# Injective USDC/USDT Non-Active Insurance Fund Holders",
    "",
    `Funds checked: ${report.totalFundsChecked}`,
    `Included funds: ${report.groups.length}`,
    `Minimum pool balance: ${report.minimumPoolBalanceFormatted}`,
    `Included status counts: Paused=${report.includedStatusCounts.Paused}, Demolished=${report.includedStatusCounts.Demolished}, Expired=${report.includedStatusCounts.Expired}`,
    `Total derivative markets by status: Paused=${report.totalDerivativeMarketsByStatus.Paused}, Demolished=${report.totalDerivativeMarketsByStatus.Demolished}, Expired=${report.totalDerivativeMarketsByStatus.Expired}`,
    `Funds block height: ${report.source.fundsBlockHeight ?? "unknown"}`,
    `Owner query block height range: ${
      report.source.ownerBlockHeightRange ?? "unknown"
    }`,
    "",
    `The insurance module account ${insuranceModuleAddress} is excluded from holder rankings.`,
    "Markets are ordered by pool balance descending. Holders inside each market are ordered by holder amount descending.",
    "",
  ];

  for (const group of report.groups) {
    lines.push(
      `## ${group.marketTicker} (${group.marketStatus}, ${group.quote}, ${group.shareDenom})`
    );
    lines.push(`Pool balance: ${group.poolBalanceFormatted} ${group.quote}`);
    lines.push(
      `Excluded holder balance: ${group.excludedHolderAmountFormatted} ${group.quote}`
    );
    lines.push(
      `Ranked holder balance: ${group.rankedHolderBalanceFormatted} ${group.quote}`
    );
    lines.push("");
    lines.push(
      "| Rank | Holder address | Holder amount | Fund ownership | Ranked ownership |"
    );
    lines.push("| ---: | --- | ---: | ---: | ---: |");

    if (group.holderRows.length === 0) {
      lines.push("|  | No non-module holders found |  |  |  |");
    }

    for (const holder of group.holderRows) {
      lines.push(
        `| ${holder.rank} | ${holder.address} | ${holder.amountFormatted} | ${holder.fundOwnershipPercent} | ${holder.rankedOwnershipPercent} |`
      );
    }

    lines.push("");
  }

  lines.push("## Top 5 Holders Across Included Insurance Funds");
  lines.push("");
  lines.push("| Rank | Holder address | Total | USDC | USDT |");
  lines.push("| ---: | --- | ---: | ---: | ---: |");

  for (const holder of report.topHoldersAcrossIncludedFunds) {
    lines.push(
      `| ${holder.rank} | ${holder.address} | ${holder.totalFormatted} | ${holder.usdcFormatted} | ${holder.usdtFormatted} |`
    );
  }

  lines.push("");
  return lines.join("\n");
};

export const metadata: ExampleMetadata = {
  id: "query:non-active-insurance-fund-holders",
  category: "queries",
  title: "Find non-active insurance fund holders",
  description:
    "List USDC/USDT insurance funds for Paused, Demolished, or Expired derivative markets and their top holders.",
  mayBroadcast: false,
};

export const run = async (): Promise<void> => {
  const { getEnvironmentVariable } = await import("../../lib/env");
  const lcdEndpoint = getEnvironmentVariable(
    "INJECTIVE_LCD_ENDPOINT",
    defaultLcdEndpoint
  );

  const [insuranceFundsResponse, derivativeMarketsByStatus] = await Promise.all([
    fetchInsuranceFunds(lcdEndpoint),
    Promise.all(
      nonActiveDerivativeMarketStatuses.map((status) =>
        fetchDerivativeMarketsByStatus(lcdEndpoint, status)
      )
    ),
  ]);

  const derivativeMarkets = derivativeMarketsByStatus.flat();
  const shareDenoms = getCandidateShareDenoms({
    derivativeMarkets,
    funds: insuranceFundsResponse.json.funds,
  });
  const denomOwnerResponses = await Promise.all(
    shareDenoms.map(async (shareDenom) => ({
      shareDenom,
      ...(await fetchDenomOwners(lcdEndpoint, shareDenom)),
    }))
  );
  const denomOwnersByDenom = new Map(
    denomOwnerResponses.map((response) => [response.shareDenom, response.owners])
  );
  const ownerBlockHeights = denomOwnerResponses.flatMap(
    (response) => response.blockHeights
  );
  const report = buildNonActiveInsuranceFundReport({
    denomOwnersByDenom,
    derivativeMarkets,
    funds: insuranceFundsResponse.json.funds,
    fundsBlockHeight: insuranceFundsResponse.blockHeight,
    ownerBlockHeights,
  });

  console.log(renderReport(report));
};

runDirectly(module, run);
