import { 
  TransactionInstruction, 
  PublicKey, 
  ComputeBudgetProgram, 
  TransactionMessage, 
  VersionedTransaction,
  SimulateTransactionConfig,
} from "@solana/web3.js";
import { config } from "../config";
import bs58 from "bs58";

const MAX_COMPUTE_UNITS = 1_400_000;
const MIN_LAMPORTS_PER_CU = 10_000;
const MAX_LAMPORTS_PER_CU = 50_000;

async function simulateWithMaxUnits(
  instructions: TransactionInstruction[],
  payer: PublicKey
): Promise<number> {
  const maxComputeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: MAX_COMPUTE_UNITS,
  });
  
  const testInstructions = [maxComputeBudgetIx, ...instructions];
  const recentBlockhash = await config.RPC.getLatestBlockhash('confirmed')
    .then(res => res.blockhash);

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions: testInstructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);

  const simulation = await config.RPC.simulateTransaction(transaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    commitment: "confirmed",
  });

  if (simulation.value.err) {
    console.error("Simulation logs:", simulation.value.logs);
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err, null, 2)}`);
  }

  return simulation.value.unitsConsumed || 0;
}

async function getPriorityFeeEstimate(
  serializedTx: string,
): Promise<number> {
  if (config.RPC.rpcEndpoint.includes('devnet')) {
    return MIN_LAMPORTS_PER_CU;
  }

  try {
    const response = await fetch(config.RPC.rpcEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "getPriorityFeeEstimate",
        params: [{
          transaction: serializedTx,
          options: { recommended: true },
        }],
      }),
    });

    const data = await response.json();
    if (data.error) {
      console.warn("Priority fee estimate error:", data.error);
      return MIN_LAMPORTS_PER_CU;
    }

    const estimate = Number(data.result.priorityFeeEstimate);
    return Math.min(Math.max(estimate, MIN_LAMPORTS_PER_CU), MAX_LAMPORTS_PER_CU);
  } catch (error) {
    console.warn("Error getting priority fee estimate:", error);
    return MIN_LAMPORTS_PER_CU;
  }
}

export async function prepareTransaction(
  instructions: TransactionInstruction[], 
  payerKey: PublicKey
): Promise<string> {    
  // 1. Simulate to get compute units
  const unitsConsumed = await simulateWithMaxUnits(instructions, payerKey);
  const computeUnits = Math.ceil(unitsConsumed * 1.1); // Add 10% margin

  // 2. Create test transaction for priority fee estimation
  const recentBlockhash = await config.RPC.getLatestBlockhash('finalized')
    .then(res => res.blockhash);

  const testMessage = new TransactionMessage({
    payerKey,
    recentBlockhash,
    instructions,
  }).compileToV0Message();

  const testTx = new VersionedTransaction(testMessage);
  const serializedTestTx = bs58.encode(testTx.serialize());

  // 3. Get priority fee estimate
  const priorityFee = await getPriorityFeeEstimate(serializedTestTx);

  // 4. Build final transaction with compute budget instructions
  const computeBudgetIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
  ];

  const finalMessage = new TransactionMessage({
    payerKey,
    recentBlockhash,
    instructions: [...computeBudgetIxs, ...instructions],
  }).compileToV0Message();

  const finalTx = new VersionedTransaction(finalMessage);
  return Buffer.from(finalTx.serialize()).toString('base64');
}