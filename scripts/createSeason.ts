import { config } from '../src/config';
import { prepareTransaction } from '../src/solana/prepareTransaction';
import { confirmTransaction } from '../src/solana/confirmTransaction';
import { SeasonConfig } from './utils/types';
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

async function createSeason() {
    try {
        const umi = initializeUmi(true);
        const seasonConfig: SeasonConfig = {
            name: "Test Season 1",
            symbol: "TEST",
            description: "This is a test season",
            maxSupply: 100,
            mediaFolderPath: "./scripts/media",
            creators: [
                {
                    address: config.KEYPAIR.publicKey.toString(),
                    share: 100,
                }
            ],
            royaltyBasisPoints: 500,
            sellerFeeBasisPoints: 500,
            paymentMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            price: 1,
            collectionSigner: generateSigner(umi),
            candyMachineSigner: generateSigner(umi),
        };

        // Step 1: Upload all metadata
        console.log('Uploading metadata...');
        const [collectionMetadata, nftMetadata] = await Promise.all([
            uploadCollectionMetadata(seasonConfig),
            uploadNFTsMetadata(seasonConfig)
        ]);

        // Step 2: Create Candy Machine and Collection
        console.log('Creating Candy Machine...');
        const { collectionInstructions, candyMachineInstructions } = await createCoreCandyMachine(seasonConfig);
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
            candyMachineInstructions,
            config.KEYPAIR.publicKey
        );
        const candyMachineTransaction = VersionedTransaction.deserialize(Buffer.from(base64CandyMachineTransaction, "base64"));
        candyMachineTransaction.sign([config.KEYPAIR]);
        candyMachineTransaction.sign([toWeb3JsKeypair(seasonConfig.candyMachineSigner)]);
        const signedCandyMachineTransaction = candyMachineTransaction.serialize();
        await confirmTransaction(Buffer.from(signedCandyMachineTransaction).toString('base64'));
        console.log('Candy Machine created successfully!');

        // Step 3: Add nfts to collection
        /*console.log('Adding nfts to collection...');
        const batches = await getBatchedConfigLines(nftMetadata);
        
        for (let i = 0; i < batches.length; i++) {
            const batchTransaction = await prepareTransaction(
                batches[i],
                config.KEYPAIR.publicKey
            );
            await confirmTransaction(Buffer.from(batchTransaction).toString('base64'));
            console.log(`Processed batch ${i + 1} of ${batches.length}`);
        }
        */
       
        console.log('Season created successfully!');
    } catch (error) {
        console.error('Error creating season:', error);
        process.exit(1);
    }
}

createSeason().then(() => process.exit(0)); 