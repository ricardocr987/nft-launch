import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { mplCore } from "@metaplex-foundation/mpl-core";
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { createNoopSigner, createSignerFromKeypair, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { config } from './config';

export function initializeUmi(useConfig: boolean = true) {
  const umi = createUmi(config.RPC.rpcEndpoint, 'confirmed')
    .use(mplCore())
    .use(dasApi())
    .use(irysUploader())
    .use(mplCandyMachine());

  if (useConfig) {
    const signer = createSignerFromKeypair(umi, fromWeb3JsKeypair(config.KEYPAIR));
    umi.use(signerIdentity(signer));
  } else {
    umi.use(signerIdentity(createNoopSigner(publicKey('11111111111111111111111111111111'))));
  }

  return umi;
}; 