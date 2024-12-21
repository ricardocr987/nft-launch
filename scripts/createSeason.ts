import { config } from '../src/config';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCandyMachine } from "@metaplex-foundation/mpl-candy-machine";
import { toWeb3JsInstruction, fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { 
  generateSigner, 
  publicKey, 
  signerIdentity, 
  createNoopSigner, 
  createSignerFromKeypair,
  createGenericFile,
  GenericFile,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api';
import { createCollection, mplCore, ruleSet } from "@metaplex-foundation/mpl-core";
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { readFileSync, readdirSync } from 'fs';
import { prepareTransaction } from '../src/solana/prepareTransaction';
import { confirmTransaction } from '../src/solana/confirmTransaction';
import { createCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import path from 'path';

// note: i would do the update on the uri

// Helper Functions
const base64ToGenericFile = (base64String: string, fileName: string): GenericFile => {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  
    return createGenericFile(bytes, fileName, {
      contentType: 'image/png',
      extension: 'png',
    });
};

// Helper function to read all images from media folder
const readImagesFromFolder = (folderPath: string): Buffer[] => {
  const files = readdirSync(folderPath)
    .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
    .map(file => readFileSync(path.join(folderPath, file)));
  
  if (files.length === 0) {
    throw new Error('No image files found in media folder');
  }
  return files;
};

// Initialize UMI
const umi = createUmi(config.RPC.rpcEndpoint)
  .use(mplCore())
  .use(dasApi())
  .use(irysUploader())
  .use(mplCandyMachine());

const signer = createSignerFromKeypair(umi, fromWeb3JsKeypair(config.FILES_KEYPAIR));
umi.use(signerIdentity(signer));

interface SeasonConfig {
  name: string;
  symbol: string;
  description: string;
  maxSupply: number;
  mediaFolderPath: string;
  creators: Array<{
    address: string;
    share: number;
  }>;
  royaltyBasisPoints: number;
  sellerFeeBasisPoints: number;
  paymentMint: string;
  startDate: Date;
  endDate: Date;
  price: number;
}

async function createSeason() {
  try {
    const startDate = new Date();
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    const seasonConfig: SeasonConfig = {
      name: "Test Season 1",
      symbol: "TEST",
      description: "This is a test season",
      maxSupply: 100,
      mediaFolderPath: "./media",
      creators: [
        {
          address: config.FILES_KEYPAIR.publicKey.toString(),
          share: 100,
        }
      ],
      royaltyBasisPoints: 500, // 5% royalties
      sellerFeeBasisPoints: 500, // 5% seller fee
      paymentMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mint address
      startDate,
      endDate,
      price: 1,
    };

    // Read images from media folder
    const imageBuffers = readImagesFromFolder(seasonConfig.mediaFolderPath);

    // Upload collection image
    const collectionImageBuffer = imageBuffers[0];
    const genericFile = createGenericFile(
      new Uint8Array(collectionImageBuffer),
      `${seasonConfig.name}_collection.png`,
      { contentType: 'image/png', extension: 'png' }
    );

    const [imageUri] = await umi.uploader.upload([genericFile]);
    
    // Upload metadata
    const uri = await umi.uploader.uploadJson({
      name: seasonConfig.name,
      symbol: seasonConfig.symbol,
      description: seasonConfig.description,
      image: imageUri,
      seller_fee_basis_points: seasonConfig.sellerFeeBasisPoints,
      properties: {
        files: [{ uri: imageUri, type: 'image/png' }],
        category: 'image',
        creators: seasonConfig.creators.map(creator => ({
          address: creator.address,
          share: creator.share,
        })),
      },
    });

    // Create collection with proper plugins
    const collectionSigner = generateSigner(umi);
    const collectionInstructions = createCollection(umi, {
      collection: collectionSigner,
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
            type: 'UpdateAuthority',
            address: publicKey(config.FILES_KEYPAIR.publicKey),
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
      payer: createNoopSigner(publicKey(config.FILES_KEYPAIR.publicKey))
    });

    // Create Candy Machine with USDC payment
    const candyMachineSigner = generateSigner(umi);
    const candyMachineInstructions = await createCandyMachine(umi, {
        candyMachine: candyMachineSigner,
        collection: collectionSigner.publicKey,
        collectionUpdateAuthority: signer,
        itemsAvailable: seasonConfig.maxSupply,
        authority: signer.publicKey,
        isMutable: true,
        configLineSettings: {
            prefixName: `${seasonConfig.name} #`,
            nameLength: 4,
            prefixUri: `${uri}/`,
            uriLength: 43,
            isSequential: true,
        },
    });

    // Combine all instructions
    const instructions = [
      ...collectionInstructions.getInstructions().map(ix => toWeb3JsInstruction(ix)),
      ...candyMachineInstructions.getInstructions().map(ix => toWeb3JsInstruction(ix)),
    ];

    // Prepare and send transaction
    const transaction = await prepareTransaction(
      instructions,
      config.FILES_KEYPAIR.publicKey
    );

    // Convert transaction to base64
    const serializedTransaction = Buffer.from(transaction).toString('base64');
    
    // Send and confirm transaction
    const signature = await confirmTransaction(serializedTransaction);

    console.log('Season created successfully!');
    console.log({
      signature,
      collectionMint: base58.serialize(collectionSigner.publicKey),
      candyMachineMint: base58.serialize(candyMachineSigner.publicKey),
    });

  } catch (error) {
    console.error('Error creating season:', error);
    process.exit(1);
  }
}

// Run the script
createSeason().then(() => process.exit(0)); 