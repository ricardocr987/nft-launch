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
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

async function mintNft(
    candyMachineId: string,
    collectionMint: string,
) {
    try {
        const umi = initializeUmi(true, true);        
        const candyMachine = await fetchCandyMachine(umi, publicKey(candyMachineId));
        const candyGuardPda = findCandyGuardPda(umi, { base: publicKey(candyMachineId) });
        const candyGuard = await fetchCandyGuard(umi as any, candyGuardPda);

        console.log(candyMachine.mintAuthority, candyGuard.publicKey)
        if (candyMachine.itemsLoaded === 0) {
            throw new Error('No items loaded in the candy machine');
        }

        if (candyMachine.itemsRedeemed >= candyMachine.data.itemsAvailable) {
            throw new Error('All items have been minted');
        }

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
            itemsLoaded: candyMachine.itemsLoaded,
            itemsMinted: candyMachine.itemsRedeemed,
            itemsAvailable: candyMachine.data.itemsAvailable,
        });

        const destinationAta = getAssociatedTokenAddressSync(
            USDC_MINT, 
            new PublicKey('rikiFB2VznT2izUT7UffzWCn1X4gNmGutX7XEqFdpRR')
        );

        const tx = transactionBuilder()
            .add(setComputeUnitLimit(umi, { units: 800_000 }))
            .add(
                mintV1(umi as any, {
                    candyMachine: publicKey(candyMachineId),
                    asset: nftMint,
                    collection: publicKey(collectionMint),
                    minter: umi.identity,
                    candyGuard: candyGuardPda[0],
                    mintArgs: {
                        tokenPayment: some({ mint: publicKey(USDC_MINT), destinationAta: publicKey(destinationAta) }),
                    },
                    payer: umi.identity,
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

    if (!candyMachineId || !collectionMint) {
        console.error('Usage: bun run scripts/mintNft.ts <candyMachineId> <collectionMint>');
        process.exit(1);
    }

    mintNft(candyMachineId, collectionMint)
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { mintNft }; 