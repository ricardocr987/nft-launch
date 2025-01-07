import { config } from '../src/config';
import { initializeUmi } from '../src/umi';
import { generateSigner, transactionBuilder, publicKey } from '@metaplex-foundation/umi';
import { 
    mintV1,
    fetchCandyMachine,
    fetchCandyGuard,
    findCandyGuardPda
} from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { some } from '@metaplex-foundation/umi';
import { USDC_MINT } from '../src/constants';
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

async function mintNft(
    candyMachineId: string,
    collectionMint: string,
    candyGuard: string
) {
    try {
        const umi = initializeUmi(true);
        
        // Fetch candy machine data first
        const candyMachine = await fetchCandyMachine(umi, publicKey(candyMachineId));
        const candyGuardPda = findCandyGuardPda(umi, { base: publicKey(candyGuard) });

        // Check if candy machine is ready
        if (candyMachine.itemsLoaded < candyMachine.data.itemsAvailable) {
            throw new Error(
                `Candy Machine not fully loaded. ${candyMachine.itemsLoaded}/${candyMachine.data.itemsAvailable} items loaded`
            );
        }

        const nftMint = generateSigner(umi);
        
        console.log('Minting NFT...');
        console.log({
            candyMachine: candyMachineId,
            nftMint: nftMint.publicKey,
            collectionMint,
            candyGuard
        });

        const destinationAta = getAssociatedTokenAddressSync(USDC_MINT, toWeb3JsPublicKey(umi.identity.publicKey));

        const tx = transactionBuilder()
            .add(setComputeUnitLimit(umi, { units: 800_000 }))
            .add(
                mintV1(umi as any, {
                    candyMachine: publicKey(candyMachineId),
                    asset: nftMint,
                    collection: publicKey(collectionMint),
                    minter: umi.identity,
                    candyGuard: candyGuardPda,
                    mintArgs: {
                        tokenPayment: some({ mint: publicKey(USDC_MINT), destinationAta: publicKey(destinationAta) }),
                    }
                })
            );

        const { signature } = await tx.sendAndConfirm(umi);
        
        console.log('NFT minted successfully!');
        console.log('Mint Address:', nftMint.publicKey);
        console.log('Signature:', signature.toString());
        
        return {
            mintAddress: nftMint.publicKey,
            signature
        };
    } catch (error) {
        console.error('Error minting NFT:', error);
        throw error;
    }
}

if (require.main === module) {
    const candyMachineId = process.argv[2];
    const collectionMint = process.argv[3];
    const candyGuard = process.argv[4];

    if (!candyMachineId || !collectionMint || !candyGuard) {
        console.error('Usage: bun run scripts/mintNft.ts <candyMachineId> <collectionMint> <candyGuard>');
        process.exit(1);
    }

    mintNft(candyMachineId, collectionMint, candyGuard)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { mintNft }; 