import { Connection, Keypair } from "@solana/web3.js";
import bs58 from 'bs58';

export const config = {
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || '3001',
  RPC: new Connection(process.env.PROD === 'true' 
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.RPC_KEY!}` 
    : `https://devnet.helius-rpc.com/?api-key=${process.env.RPC_KEY!}`),
  KEYPAIR: Keypair.fromSecretKey(Buffer.from(bs58.decode(process.env.KEYPAIR!))),
  RPC_WS_URL: process.env.PROD === 'true' 
    ? `wss://mainnet.helius-rpc.com/?api-key=${process.env.RPC_KEY!}` 
    : `wss://devnet.helius-rpc.com/?api-key=${process.env.RPC_KEY!}`
};

const requiredEnvVariables = [
  'RPC_KEY',
  'KEYPAIR',
  'PROD'
];

requiredEnvVariables.forEach(variable => {
  if (config[variable as keyof typeof config] === '') {
    throw new Error(`Missing required environment variable: ${variable}`);
  }
});
