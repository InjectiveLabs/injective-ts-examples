import { Network } from "@injectivelabs/networks";
import { getEnumEnvironmentVariable } from "./env";

const injectiveNetworks = Object.values(Network).filter(
  (value): value is Network => typeof value === "string"
);

export const getInjectiveNetworkFromEnvironment = (
  name: string,
  defaultNetwork: Network
): Network => getEnumEnvironmentVariable(name, defaultNetwork, injectiveNetworks);

