import { config } from '../src/config';
import { prepareTransaction } from '../src/solana/prepareTransaction';
import { confirmTransaction } from '../src/solana/confirmTransaction';
import { SeasonConfig } from './types';
import { 
    createCoreCandyMachine, 
    uploadCollectionMetadata, 
    uploadNFTsMetadata,
    getBatchedConfigLines
} from './utils/metaplex';
import { VersionedTransaction } from '@solana/web3.js';
import { generateSigner } from '@metaplex-foundation/umi';
import { initializeUmi } from '../src/umi';
import { toWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { USDC_MINT } from '../src/constants';

// fix 3rd step to fix mint, better management of nft files
async function createSeason() {
    try {
        const umi = initializeUmi(true);
        const onChainUsdcPrice = BigInt(1) * BigInt(10 ** 6);

        const seasonConfig: SeasonConfig = {
            name: "Test Season 1",
            symbol: "TEST",
            description: "This is a test season",
            maxSupply: 2,
            mediaFolderPath: "./scripts/media",
            creators: [
                {
                    address: config.KEYPAIR.publicKey.toString(),
                    share: 100,
                }
            ],
            royaltyBasisPoints: 500,
            sellerFeeBasisPoints: 500,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            price: onChainUsdcPrice,
            collectionSigner: generateSigner(umi),
            candyMachineSigner: generateSigner(umi),
        };

        console.log({
            collection: seasonConfig.collectionSigner.publicKey,
            candyMachine: seasonConfig.candyMachineSigner.publicKey,
        });

        // Step 1: Upload all metadata
        console.log('Uploading metadata...');
        const [collectionMetadata, nftMetadata] = await Promise.all([
            uploadCollectionMetadata(seasonConfig),
            uploadNFTsMetadata(seasonConfig)
        ]);

        // Step 2: Create Candy Machine and Collection
        const { 
            collectionInstructions, 
            candyMachineInstructions, 
            candyGuardInstructions,
            wrapInstructions
        } = await createCoreCandyMachine(seasonConfig);
        const base64CollectionTransaction = await prepareTransaction(
            collectionInstructions,
            config.KEYPAIR.publicKey
        );
        const collectionTransaction = VersionedTransaction.deserialize(Buffer.from(base64CollectionTransaction, "base64"));
        collectionTransaction.sign([config.KEYPAIR]);
        collectionTransaction.sign([toWeb3JsKeypair(seasonConfig.collectionSigner)]);
        const signedCollectionTransaction = collectionTransaction.serialize();
        await confirmTransaction(Buffer.from(signedCollectionTransaction).toString('base64'));
        console.log('Collection created successfully!');

        const base64CandyMachineTransaction = await prepareTransaction(
            [...candyMachineInstructions, ...candyGuardInstructions, ...wrapInstructions],
            config.KEYPAIR.publicKey
        );
        const candyMachineTransaction = VersionedTransaction.deserialize(Buffer.from(base64CandyMachineTransaction, "base64"));
        candyMachineTransaction.sign([config.KEYPAIR]);
        candyMachineTransaction.sign([toWeb3JsKeypair(seasonConfig.candyMachineSigner)]);
        const signedCandyMachineTransaction = candyMachineTransaction.serialize();
        await confirmTransaction(Buffer.from(signedCandyMachineTransaction).toString('base64'));
        console.log('Candy Machine created successfully!');

        console.log('Adding NFTs to collection...');
        const batches = await getBatchedConfigLines(seasonConfig, nftMetadata);

        for (let i = 0; i < batches.length; i++) {
            const base64BatchTransaction = await prepareTransaction(
                batches[i],
                config.KEYPAIR.publicKey
            );
            const batchTransaction = VersionedTransaction.deserialize(
                Buffer.from(base64BatchTransaction, "base64")
            );
            batchTransaction.sign([config.KEYPAIR]);
            const signedBatchTransaction = batchTransaction.serialize();
            await confirmTransaction(Buffer.from(signedBatchTransaction).toString('base64'));
            console.log(`Processed batch ${i + 1} of ${batches.length}`);
        }
       
        console.log('Season created successfully!');
        
        // Add this section to print the mint command
        console.log('\nTo mint NFTs, run the following command:');
        console.log('----------------------------------------');
        console.log(`bun run scripts/mintNft.ts \\
    ${seasonConfig.candyMachineSigner.publicKey} \\
    ${seasonConfig.collectionSigner.publicKey}`);
    console.log('----------------------------------------');

    } catch (error) {
        console.error('Error creating season:', error);
        process.exit(1);
    }
}

createSeason().then(() => process.exit(0)); 