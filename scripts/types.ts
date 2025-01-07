import { KeypairSigner } from "@metaplex-foundation/umi";

export interface SeasonConfig {
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
  price: BigInt;
  collectionSigner: KeypairSigner;
  candyMachineSigner: KeypairSigner;
  candyGuardSigner: KeypairSigner;
} 
