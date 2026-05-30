import type { ExampleMetadata } from "../types";
import {
  getBooleanEnvironmentVariable,
  getEnvironmentVariable,
  getNumberEnvironmentVariable,
  requireEnvironmentVariable,
} from "../../lib/env";
import { runDirectly } from "../../lib/direct-run";

const defaultContractAddress = "inj1x8kqe398kp8z3pr7hm0tv89rgjs9qr3du2r6d7";

export const metadata: ExampleMetadata = {
  id: "authz:contract-execution",
  category: "authz",
  title: "Simulate contract execution authz",
  description: "Grant and execute a contract execution authorization in simulation mode.",
  requiresEnvironment: ["PRIVATE_KEY", "SEED_PHRASE"],
  mayBroadcast: true,
};

export const run = async (): Promise<void> => {
  const { Network } = await import("@injectivelabs/networks");
  const {
    ContractExecutionAuthz,
    MsgAuthzExec,
    MsgBroadcasterWithPk,
    MsgExecuteContract,
    MsgExecuteContractCompat,
    MsgGrantWithAuthorization,
    PrivateKey,
  } = await import("@injectivelabs/sdk-ts");
  const { DEFAULT_GAS_LIMIT, INJ_DENOM } = await import("@injectivelabs/utils");
  const { getInjectiveNetworkFromEnvironment } = await import(
    "../../lib/networks"
  );
  const privateKeyHex = requireEnvironmentVariable("PRIVATE_KEY");
  const seedPhrase = requireEnvironmentVariable("SEED_PHRASE");
  const network = getInjectiveNetworkFromEnvironment(
    "INJECTIVE_NETWORK",
    Network.TestnetSentry
  );
  const simulateTx = !getBooleanEnvironmentVariable(
    "BROADCAST_TRANSACTIONS",
    false
  );
  const contractAddress = getEnvironmentVariable(
    "CONTRACT_ADDRESS",
    defaultContractAddress
  );
  const expirationSeconds = getNumberEnvironmentVariable(
    "AUTHZ_EXPIRATION_SECONDS",
    60 * 60 * 24
  );
  const maxCalls = getNumberEnvironmentVariable("AUTHZ_MAX_CALLS", 100);
  const spendLimitAmount = getEnvironmentVariable(
    "AUTHZ_SPEND_LIMIT_ATTO_INJ",
    "10000"
  );

  const privateKeyGranter = PrivateKey.fromHex(privateKeyHex);
  const privateKeyGrantee = PrivateKey.fromMnemonic(seedPhrase);
  const granter = privateKeyGranter.toBech32();
  const grantee = privateKeyGrantee.toBech32();
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const expiration = nowInSeconds + expirationSeconds;

  const grantMessage = MsgGrantWithAuthorization.fromJSON({
    expiration,
    grantee,
    granter,
    authorization: ContractExecutionAuthz.fromJSON({
      contract: contractAddress,
      limit: {
        maxCalls,
        amounts: [{ amount: spendLimitAmount, denom: INJ_DENOM }],
      },
      filter: {
        acceptedMessagesKeys: ["wrap_token"],
      },
    }),
  });

  const grantResponse = await new MsgBroadcasterWithPk({
    network,
    privateKey: privateKeyGranter,
    simulateTx,
  }).broadcast({ msgs: grantMessage });

  const executeMessage = MsgAuthzExec.fromJSON({
    grantee,
    msgs: MsgExecuteContract.fromJSON({
      contractAddress,
      sender: granter,
      msg: { wrap_token: {} },
      funds: [{ denom: INJ_DENOM, amount: "1" }],
    }),
  });

  const executeResponse = await new MsgBroadcasterWithPk({
    network,
    privateKey: privateKeyGrantee,
    simulateTx,
  }).broadcast({
    msgs: executeMessage,
    gas: { gas: DEFAULT_GAS_LIMIT },
  });

  const executeCompatMessage = MsgAuthzExec.fromJSON({
    grantee,
    msgs: MsgExecuteContractCompat.fromJSON({
      contractAddress,
      sender: granter,
      msg: { wrap_token: {} },
      funds: [{ denom: INJ_DENOM, amount: "1" }],
    }),
  });

  const executeCompatResponse = await new MsgBroadcasterWithPk({
    network,
    privateKey: privateKeyGrantee,
    simulateTx,
  }).broadcast({
    msgs: executeCompatMessage,
    gas: { gas: DEFAULT_GAS_LIMIT },
  });

  console.log({
    network,
    simulateTx,
    contractAddress,
    granter,
    grantee,
    grantResponse,
    executeResponse,
    executeCompatResponse,
  });
};

runDirectly(module, run);
