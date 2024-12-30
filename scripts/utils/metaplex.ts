import { 
    generateSigner, 
    publicKey, 
    createNoopSigner, 
    createGenericFile,
    Umi,
    createSignerFromKeypair
} from '@metaplex-foundation/umi';
import { createCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import { createCandyMachine, addConfigLines } from '@metaplex-foundation/mpl-core-candy-machine';
import { fromWeb3JsKeypair, toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { SeasonConfig } from './types';
import { readImagesFromFolder } from './files';
import { initializeUmi } from '../../src/umi';
import { config } from '../../src/config';

const umi = initializeUmi(true);

export async function uploadCollectionMetadata(seasonConfig: SeasonConfig) {
    const collectionImageBuffer = readImagesFromFolder(seasonConfig.mediaFolderPath)[0];
    const genericFile = createGenericFile(
        new Uint8Array(collectionImageBuffer),
        `${seasonConfig.name}_collection.png`,
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
                `${seasonConfig.name}_${index}.png`,
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
    
    console.log({
        collectionMint: seasonConfig.collectionSigner.publicKey,
        candyMachineMint: seasonConfig.candyMachineSigner.publicKey,
    });

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
    });

    const candyMachineInstructions = await createCandyMachine(umi, {
      candyMachine: seasonConfig.candyMachineSigner,
      collection: seasonConfig.collectionSigner.publicKey,
      collectionUpdateAuthority: umi.identity,
      itemsAvailable: seasonConfig.maxSupply,
      authority: umi.identity.publicKey,
      isMutable: true,
      configLineSettings: {
        prefixName: `${seasonConfig.name} #`,
        nameLength: 4,
        prefixUri: 'https://',
        uriLength: 100,
        isSequential: true,
      },
    });

    return {
      collectionInstructions: collectionInstructions.getInstructions().map(ix => toWeb3JsInstruction(ix)),
      candyMachineInstructions: candyMachineInstructions.getInstructions().map(ix => toWeb3JsInstruction(ix)),
    };
}

export async function getBatchedConfigLines(nftMetadata: any[], batchSize = 50) {
  const batches = [];
  for (let i = 0; i < nftMetadata.length; i += batchSize) {
    const batch = nftMetadata.slice(i, i + batchSize);
    const configLineInstructions = addConfigLines(umi, {
      candyMachine: umi.identity.publicKey,
      index: i,
      configLines: batch,
    });

    batches.push(configLineInstructions.getInstructions().map(ix => toWeb3JsInstruction(ix)));
  }
  return batches;
}