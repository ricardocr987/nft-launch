import { 
  publicKey, 
  createGenericFile,
  sol,
  some,
  dateTime,
  createSignerFromKeypair,
  signerIdentity
} from '@metaplex-foundation/umi';
import { createCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import { addConfigLines, mplCandyMachine, createCandyMachine, createCandyGuard } from '@metaplex-foundation/mpl-core-candy-machine';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { fromWeb3JsKeypair, toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { SeasonConfig } from '../types';
import { readImagesFromFolder } from './files';
import { config } from '../../src/config';
import { USDC_MINT } from '../../src/constants';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';

const umi = createUmi(config.RPC.rpcEndpoint, 'confirmed').use(mplCandyMachine()).use(dasApi())
.use(irysUploader());
const signer = createSignerFromKeypair(umi, fromWeb3JsKeypair(config.KEYPAIR));
umi.use(signerIdentity(signer));


export async function uploadCollectionMetadata(seasonConfig: SeasonConfig) {
  const collectionImageBuffer = readImagesFromFolder(seasonConfig.mediaFolderPath)[0];
  const genericFile = createGenericFile(
    new Uint8Array(collectionImageBuffer),
    `collection.png`,
    { contentType: 'image/png', extension: 'png' }
  );

  const [imageUri] = await umi.uploader.upload([genericFile]);
  
  const uri = await umi.uploader.uploadJson({
    name: seasonConfig.name,
    symbol: seasonConfig.symbol,
    description: seasonConfig.description,
    image: imageUri,
    seller_fee_basis_points: seasonConfig.sellerFeeBasisPoints,
    properties: {
      files: [{ uri: imageUri, type: 'image/png' }],
      category: 'image',
      creators: seasonConfig.creators,
    },
  });

  return { uri, imageUri };
}

export async function uploadNFTsMetadata(seasonConfig: SeasonConfig) {
    const imageBuffers = readImagesFromFolder(seasonConfig.mediaFolderPath);
    return Promise.all(
        imageBuffers.map(async (buffer, index) => {
            const nftFile = createGenericFile(
                new Uint8Array(buffer),
                `nft.png`,
                { contentType: 'image/png', extension: 'png' }
            );
            const [imageUri] = await umi.uploader.upload([nftFile]);

            const uri = await umi.uploader.uploadJson({
                name: `${seasonConfig.name} #${index + 1}`,
                symbol: seasonConfig.symbol,
                description: seasonConfig.description,
                image: imageUri,
                seller_fee_basis_points: seasonConfig.sellerFeeBasisPoints,
                properties: {
                    files: [{ uri: imageUri, type: 'image/png' }],
                    category: 'image',
                    creators: seasonConfig.creators,
                },
                attributes: [
                    { trait_type: 'Season', value: '1' },
                ],
            });

            return {
                name: `${index + 1}`,
                uri: uri.replace('https://', ''),
            };
        })
    );
}

export async function createCoreCandyMachine(seasonConfig: SeasonConfig) {
    const { uri } = await uploadCollectionMetadata(seasonConfig);

    const collectionInstructions = createCollection(umi, {
      collection: seasonConfig.collectionSigner,
      name: seasonConfig.name,
      uri,
      plugins: [
        {
          type: 'MasterEdition',
          maxSupply: seasonConfig.maxSupply,
          name: seasonConfig.name,
          uri,
        },
        // Royalties plugin for marketplace trading
        {
          type: 'Royalties',
          basisPoints: seasonConfig.sellerFeeBasisPoints,
          creators: seasonConfig.creators.map(creator => ({
            address: publicKey(creator.address),
            percentage: creator.share,
          })),
          ruleSet: ruleSet('ProgramAllowList', [
            [
              // Add known marketplace program IDs that should be allowed to trade the NFTs
              publicKey('M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K'), // Magic Eden v2
              publicKey('TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN'), // Tensor
            ]
          ]),
        },
        // Permanent burn delegate plugin to allow burning
        {
          type: 'PermanentBurnDelegate',
          authority: {
            type: 'Address',
            address: publicKey(config.KEYPAIR.publicKey),
          },
        },
        // Attribute plugin for storing metadata
        {
          type: 'Attributes',
          attributeList: [
            {
              key: 'collection_type',
              value: 'season',
            },
            {
              key: 'season_number',
              value: '1',
            }
          ],
        }
      ],
      payer: createSignerFromKeypair(umi, fromWeb3JsKeypair(config.KEYPAIR))
    }).getInstructions().map(x => toWeb3JsInstruction(x));

    const candyMachineInstructions = (await createCandyMachine(umi, {
      candyMachine: seasonConfig.candyMachineSigner,
      collection: seasonConfig.collectionSigner.publicKey,
      collectionUpdateAuthority: umi.identity,
      itemsAvailable: seasonConfig.maxSupply,
      maxEditionSupply: 0,
      isMutable: true,
      configLineSettings: some({
          prefixName: `${seasonConfig.name} #`,
          nameLength: 4,
          prefixUri: 'https://',
          uriLength: 100,
          isSequential: false,
      }),
    })).getInstructions().map(x => toWeb3JsInstruction(x));

    const candyGuardInstructions = createCandyGuard(umi as any, {
      base: seasonConfig.candyGuardSigner,
      guards: {
        botTax: some({ lamports: sol(0.01), lastInstruction: true }),
        startDate: some({ 
            date: dateTime(seasonConfig.startDate.toISOString()) 
        }),
        endDate: some({ 
            date: dateTime(seasonConfig.endDate.toISOString()) 
        }),
        mintLimit: some({ id: 1, limit: 2 }),
        redeemLimit: some({ maximum: seasonConfig.maxSupply }),
        tokenPayment: some({
            amount: Number(seasonConfig.price),
            mint: publicKey(USDC_MINT),
            destinationAta: findAssociatedTokenPda(umi, {
                mint: publicKey(USDC_MINT),
                owner: umi.identity.publicKey,
            })[0],
        }),
      }
      /*
       groups: [
          {
            // First group for VIPs.
            label: 'VIP',
            guards: {
              startDate: some({ date: '2022-09-05T16:00:00.000Z' }),
              allowList: some({ merkleRoot }),
              solPayment: some({
                lamports: sol(1),
                destination: solDestination,
              }),
            },
          },
          {
            // Second group for whitelist token holders.
            label: 'WLIST',
            guards: {
              startDate: some({ date: '2022-09-05T18:00:00.000Z' }),
              tokenGate: some({ mint: tokenGateMint, amount: 1 }),
              solPayment: some({
                lamports: sol(2),
                destination: solDestination,
              }),
            },
          },
          {
            // Third group for the public.
            label: 'PUBLIC',
            guards: {
              startDate: some({ date: '2022-09-05T20:00:00.000Z' }),
              gatekeeper: some({ gatekeeperNetwork, expireOnUse: false }),
              solPayment: some({
                lamports: sol(3),
                destination: solDestination,
              }),
            },
          },
        ],
      */
    }).getInstructions().map(x => toWeb3JsInstruction(x));

    return {
      collectionInstructions,
      candyMachineInstructions,
      candyGuardInstructions
    };
}

export async function getBatchedConfigLines(
    seasonConfig: SeasonConfig,
    nftMetadata: { name: string; uri: string }[], 
    batchSize = 2
) {
    const batches = [];
    for (let i = 0; i < nftMetadata.length; i += batchSize) {
        const batch = nftMetadata.slice(i, i + batchSize);
        const configLineInstructions = addConfigLines(umi, {
            candyMachine: seasonConfig.candyMachineSigner.publicKey,
            index: i,
            configLines: batch.map(meta => ({
                name: meta.name,
                uri: meta.uri.replace('https://', '')
            })),
        });

        batches.push(configLineInstructions.getInstructions().map(ix => toWeb3JsInstruction(ix)));
    }
    return batches;
}