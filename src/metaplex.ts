import { PublicKey } from "@solana/web3.js";
import { Elysia } from "elysia";
import { config } from "./config";
import { confirmTransaction } from "./solana/confirmTransaction";
import { prepareTransaction } from "./solana/prepareTransaction";
import { toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import { 
  generateSigner, 
  publicKey, 
  signerIdentity, 
  createNoopSigner, 
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { rateLimit } from 'elysia-rate-limit';
import { TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { initializeUmi } from './umi';
import { mintV1 } from "@metaplex-foundation/mpl-core-candy-machine/dist/src/generated/instructions/mintV1";

const umi = initializeUmi(false);

export const metaplexManager = new Elysia({
  prefix: '/metaplex',
})
  .use(rateLimit({
    duration: 60000, // 1 minute
    max: 30, // 30 requests per minute
    errorResponse: new Response('Rate limit exceeded. Please try again later.', {
      status: 429,
      headers: {
        'Content-Type': 'text/plain',
      }
    }),
    generator: (req: any) => 
      req.headers.get('CF-Connecting-IP') ?? 
      req.headers.get('X-Forwarded-For') ?? 
      req.headers.get('X-Real-IP') ?? 
      '',
  }))

  .get('/getAssets', async ({ query }: { query: { user: string } }) => {
    try {
      const user = new PublicKey(query.user!);
      const userInfo = await config.RPC.getAccountInfo(user);
      if (!userInfo) return { error: 'Ensure you have SOL and USDC on your wallet', status: 404 };
      
      const assets = await umi.rpc.getAssetsByOwner({
        owner: publicKey(user)
      });

      return { data: { assets }, statusCode: 200 };
    } catch (e: any) {
      console.error(e.message);
      return { error: e.message, status: 500 };
    }
  })

  .post('/mint', async ({ body }: { 
    body: { signer: string }
  }) => {
    try {
      const { signer } = body;
      const signerPubkey = new PublicKey(signer);
      const candyMachineId = '11111111111111111111111111111111';
      const collectionId = '11111111111111111111111111111111';

      const mintSigner = generateSigner(umi);
      const instructions = mintV1(umi, {
        candyMachine: publicKey(candyMachineId),
        asset: mintSigner, // TODO: get next asset to mint
        collection: publicKey(collectionId),
        minter: mintSigner,
        payer: mintSigner,
        mintArgs: {
          nftPayment: {
            mint: mintSigner.publicKey,
            destination: publicKey(signerPubkey),
            tokenStandard: TokenStandard.NonFungible,
          }
        },
      }).getInstructions();

      const transaction = await prepareTransaction(
        instructions.map(ix => toWeb3JsInstruction(ix)),
        signerPubkey
      );

      return { 
        data: {
          transaction,
          mintAddress: base58.serialize(mintSigner.publicKey),
        },
        statusCode: 200 
      };

    } catch (error: any) {
      console.error('Error creating mint transaction:', error);
      return { message: 'error', error: error.message, statusCode: 500 };
    }
  })

  .post('/sendTransaction', async ({ body }: { body: { transaction: string } }) => {
    try {
      const signature = await confirmTransaction(body.transaction);
      return { data: { signature }, statusCode: 200 };
    } catch (error: any) {
      console.error('Error sending transaction:', error);
      return { error: error.message, statusCode: 500 };
    }
  });