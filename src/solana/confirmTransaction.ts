import { VersionedTransaction } from "@solana/web3.js";
import { config } from "../config";

const GLOBAL_TIMEOUT = 60000; // 60 seconds
const POLLING_INTERVAL = 5000; // 5 seconds
const MAX_RETRIES = 3;

interface TransactionStatus {
  signature: string;
  confirmed: boolean;
  error?: string;
}

async function checkTransactionStatus(signature: string): Promise<TransactionStatus> {
  try {
    const status = await config.RPC.getSignatureStatuses([signature]);
    const confirmation = status.value[0];

    if (!confirmation) {
      return { signature, confirmed: false };
    }

    if (confirmation.err) {
      return { 
        signature, 
        confirmed: false, 
        error: JSON.stringify(confirmation.err) 
      };
    }

    return { 
      signature, 
      confirmed: confirmation.confirmationStatus === 'confirmed' 
    };
  } catch (error) {
    return { 
      signature, 
      confirmed: false,
    };
  }
}

async function pollTransaction(signature: string): Promise<string> {
  let attempts = 0;
  
  while (attempts < MAX_RETRIES) {
    const status = await checkTransactionStatus(signature);
    
    if (status.confirmed) {
      console.log('Transaction confirmed', signature);
      return signature;
    }
    
    if (status.error) {
      throw new Error(`Transaction failed: ${status.error}`);
    }
    
    attempts++;
    if (attempts < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }
  }
  
  throw new Error('Transaction confirmation timeout');
}

export async function confirmTransaction(
  transaction: string,
): Promise<string> {
  const startTime = Date.now();
  const transactionBuffer = Buffer.from(transaction, 'base64');
  const tx = VersionedTransaction.deserialize(transactionBuffer);
  
  while (Date.now() - startTime < GLOBAL_TIMEOUT) {
    try {
      // Send transaction
      const signature = await config.RPC.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 0,
      });

      // Poll for confirmation
      return await pollTransaction(signature);
    } catch (error: any) {
      if (Date.now() - startTime >= GLOBAL_TIMEOUT) {
        throw new Error(`Transaction timed out after ${GLOBAL_TIMEOUT}ms`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Retrying transaction...', error);
    }
  }

  throw new Error("Transaction confirmation failed");
}