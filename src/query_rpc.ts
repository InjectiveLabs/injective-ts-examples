import { config } from "dotenv";
import { InjectiveExchangeV1Beta1Query } from "@injectivelabs/core-proto-ts";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import { sleep } from "@injectivelabs/utils";

config();

/** Querying Example */
(async () => {
  const tmClient1 = await Tendermint37Client.connect(
    "http://15.204.206.103:26657"
  );
  const tmClient2 = await Tendermint37Client.connect(
    "http://15.204.206.103:26657"
  );
  const heightEnd = 81_632_475
  const heightStart = 77_230_037;
  const client1MaxHeight = 79_487_655;

  try {
    for (let i = heightStart; i < heightEnd; i++) {
      console.log('Querying for height:', i);
      const client = client1MaxHeight > i ? tmClient2 : tmClient1;

      const data =
        InjectiveExchangeV1Beta1Query.QueryAggregateVolumesRequest.encode({
          accounts: [],
          marketIds: [
            "0x03c8da1f6aaf8aca2be26b0f4d6b89d475835c7812a1dcdb19af7dec1c6b7f60",
            "0x6ad662364885b8a4c50edfc88deeef23338b2bd0c1e4dc9b680b054afc9b6b24",
            "0x2be72879bb90ec8cbbd7510d0eed6a727f6c2690ce7f1397982453d552f9fe8f",
            "0x9066bfa1bd97685e0df4e22a104f510fb867fde7f74a52f3341c7f5f56eb889c",
            "0x887beca72224f88fb678a13a1ae91d39c53a05459fd37ef55005eb68f745d46d",
            "0x8cd25fdc0d7aad678eb998248f3d1771a2d27c964a7630e6ffa5406de7ea54c1",
            "0xedc48ec071136eeb858b11ba50ba87c96e113400e29670fecc0a18d588238052",
            "0x1afa358349b140e49441b6e68529578c7d2f27f06e18ef874f428457c0aaeb8b",
            "0x9b9980167ecc3645ff1a5517886652d94a0825e54a77d2057cbbe3ebee015963",
            "0x63bafbeee644b6606afb8476dd378fba35d516c7081d6045145790af963545aa",
            "0x35fd4fa9291ea68ce5eef6e0ea8567c7744c1891c2059ef08580ba2e7a31f101",
            "0x48fcecd66ebabbf5a331178ec693b261dfae66ddfe6f552d7446744c6e78046c",
            "0x6ddf0b8fbbd888981aafdae9fc967a12c6777aac4dd100a8257b8755c0c4b7d5",
            "0x7980993e508e0efc1c2634c153a1ef90f517b74351d6406221c77c04ec4799fe",
            "0x0d4c722badb032f14dfc07355258a4bcbd354cbc5d79cb5b69ddd52b1eb2f709",
            "0x54d4505adef6a5cef26bc403a33d595620ded4e15b9e2bc3dd489b714813366a",
            "0xd3de35e09147492a051f514f42adacd4b988268ec5c6e0cdac4cbde99ff808a2",
            "0x2d8b2a2bef3782b988e16a8d718ea433d6dfebbb3b932975ca7913589cb408b5",
            "0x4d42425fc3ccd6b61b8c4ad61134ab3cf21bdae1b665317eff671cfab79f4387",
            "0xa508cb32923323679f29a032c70342c147c17d0145625922b0ef22e955c844c0",
            "0xc559df216747fc11540e638646c384ad977617d6d8f0ea5ffdfc18d52e58ab01",
            "0x6922cf4383294c673971dd06aa4ae5ef47f65cb4f1ec1c2af4271c5e5ca67486",
            "0x7a70d95e24ba42b99a30121e6a4ff0d6161847d5b86cbfc3d4b3a81d8e190a70",
            "0x03841e74624fd885d1ee28453f921d18c211e78a0d7646c792c7903054eb152c",
            "0x30a1463cfb4c393c80e257ab93118cecd73c1e632dc4d2d31c12a51bc0a70bd7",
            "0x18b2ca44b3d20a3b87c87d3765669b09b73b5e900693896c08394c70e79ab1e7",
            "0xf1bc70398e9b469db459f3153433c6bd1253bd02377248ee29bd346a218e6243",
            "0xd1956e20d74eeb1febe31cd37060781ff1cb266f49e0512b446a5fafa9a16034",
            "0x3c5bba656074e6e84965dc7d99a218f6f514066e6ddc5046acaff59105bb6bf5",
            "0x4fe7aff4dd27be7cbb924336e7fe2d160387bb1750811cf165ce58d4c612aebb",
            "0x06c5a306492ddc2b8dc56969766959163287ed68a6b59baa2f42330dda0aebe0",
            "0x3b7fb1d9351f7fa2e6e0e5a11b3639ee5e0486c33a6a74f629c3fc3c3043efd5",
            "0xd9089235d2c1b07261cbb2071f4f5a7f92fa1eca940e3cad88bb671c288a972f",
            "0xf1ceea00e01327497c321679896e5e64ad2a4e4b88e7324adeec7661351b6d93",
            "0x0511ddc4e6586f3bfe1acb2dd905f8b8a82c97e1edaef654b12ca7e6031ca0fa",
            "0xcf18525b53e54ad7d27477426ade06d69d8d56d2f3bf35fe5ce2ad9eb97c2fbc",
            "0x4ca0f92fc28be0c9761326016b5a1a2177dd6375558365116b5bdda9abc229ce",
            "0x1a6d3a59f45904e0a4a2eed269fc2f552e7e407ac90aaaeb602c31b017573f88",
            "0x35a83ec8948babe4c1b8fbbf1d93f61c754fedd3af4d222fe11ce2a294cd74fb",
            "0x960038a93b70a08f1694c4aa5c914afda329063191e65a5b698f9d0676a0abf9",
            "0x0160a0c8ecbf5716465b9fc22bceeedf6e92dcdc688e823bbe1af3b22a84e5b5",
            "0x5c0de20c02afe5dcc1c3c841e33bfbaa1144d8900611066141ad584eeaefbd2f",
            "0x1c79dac019f73e4060494ab1b4fcba734350656d6fc4d474f6a238c13c6f9ced",
          ],
        }).finish();

      const response = await client.abciQuery({
        path: "/injective.exchange.v1beta1.Query/AggregateVolumes",
        height: 0,
        data: Buffer.from(data),
      });

      console.log(
        InjectiveExchangeV1Beta1Query.QueryAggregateVolumesResponse.decode(
          response.value
        )
      );
      await sleep(500);
    }
  } catch (e) {
    console.log(e as any);
  }
})();
