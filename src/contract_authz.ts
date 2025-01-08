/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { config } from "dotenv";
import { Network } from "@injectivelabs/networks";
import {
  PrivateKey,
  MsgAuthzExec,
  MsgExecuteContract,
  ContractExecutionAuthz,
  MsgExecuteContractCompat,
  MsgGrantWithAuthorization,
} from "@injectivelabs/sdk-ts";
import { MsgBroadcasterWithPk } from "@injectivelabs/sdk-ts";
import { DEFAULT_GAS_LIMIT, INJ_DENOM } from "@injectivelabs/utils";

config();

const seedPhase = process.env.SEED_PHASE as string;
const privateKeyHash = process.env.PRIVATE_KEY as string;
const privateKeyGranter = PrivateKey.fromHex(privateKeyHash);
const privateKeyGrantee = PrivateKey.fromMnemonic(seedPhase);
const granter = privateKeyGranter.toBech32();
const grantee = privateKeyGrantee.toBech32();

// cw20_wrapper contract on testnet
const contractAddress = "inj1x8kqe398kp8z3pr7hm0tv89rgjs9qr3du2r6d7";
const nowInSeconds = Math.floor(Date.now() / 1000);
const expiration = nowInSeconds + 60 * 60 * 24; // 1 day

const grant = async () => {
  const contractAuthzMsgs = MsgGrantWithAuthorization.fromJSON({
    expiration,
    grantee,
    granter,
    authorization: ContractExecutionAuthz.fromJSON({
      contract: contractAddress,
      limit: {
        maxCalls: 100, // Set an appropriate limit
        amounts: [{ amount: "10000", denom: "inj" }],
      },
      filter: {
        acceptedMessagesKeys: ["wrap_token"],
      },
    }),
  });

  const response = await new MsgBroadcasterWithPk({
    network: Network.TestnetSentry,
    privateKey: privateKeyGranter,
    simulateTx: true,
  }).broadcast({ msgs: contractAuthzMsgs });

  console.log(response);
};

const executeContract = async () => {
  const msgExecContract = MsgAuthzExec.fromJSON({
    grantee,
    msgs: MsgExecuteContract.fromJSON({
      contractAddress: contractAddress,
      sender: granter,
      msg: { wrap_token: {} },
      funds: [{ denom: INJ_DENOM, amount: "1" }],
    }),
  });

  const responseMsgExecContract = await new MsgBroadcasterWithPk({
    network: Network.TestnetSentry,
    privateKey: privateKeyGrantee,
    simulateTx: true,
  }).broadcast({ msgs: msgExecContract, gas: { gas: DEFAULT_GAS_LIMIT } });

  console.log(responseMsgExecContract);
};

const executeContractCompat = async () => {
  const msgExecContractCompat = MsgAuthzExec.fromJSON({
    grantee,
    msgs: MsgExecuteContractCompat.fromJSON({
      contractAddress: contractAddress,
      sender: granter,
      msg: { wrap_token: {} },
      funds: [{ denom: INJ_DENOM, amount: "1" }],
    }),
  });

  const responseMsgExecContractCompat = await new MsgBroadcasterWithPk({
    network: Network.TestnetSentry,
    privateKey: privateKeyGrantee,
    simulateTx: true,
  }).broadcast({
    msgs: msgExecContractCompat,
    gas: { gas: DEFAULT_GAS_LIMIT },
  });

  console.log(responseMsgExecContractCompat);
};

(async () => {
  await grant();
  await executeContract();
  await executeContractCompat();
})();
