import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";

export class WalletManager {
  private readonly connection: Connection;
  private keypair: Keypair | null = null;

  constructor(private readonly config: AppConfig) {
    this.connection = new Connection(config.SOLANA_RPC_URL, "confirmed");
    if (config.WALLET_PRIVATE_KEY) {
      try {
        const secret = bs58.decode(config.WALLET_PRIVATE_KEY);
        this.keypair = Keypair.fromSecretKey(secret);
        logger.info({ pubkey: this.keypair.publicKey.toBase58() }, "Wallet caricato");
      } catch (err) {
        logger.error({ err }, "WALLET_PRIVATE_KEY non valida");
        if (config.TRADING_MODE === "live") throw err;
      }
    } else {
      logger.warn("Nessuna WALLET_PRIVATE_KEY: solo paper trading");
    }
  }

  getPublicKey(): string | null {
    return this.keypair?.publicKey.toBase58() ?? null;
  }

  getKeypair(): Keypair | null {
    return this.keypair;
  }

  async getSolBalance(): Promise<number | null> {
    if (!this.keypair) return null;
    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey);
      return lamports / LAMPORTS_PER_SOL;
    } catch (err) {
      logger.warn({ err }, "Impossibile leggere balance SOL");
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.connection.getLatestBlockhash();
      return true;
    } catch {
      return false;
    }
  }

  validateMint(mint: string): boolean {
    try {
      // eslint-disable-next-line no-new
      new PublicKey(mint);
      return true;
    } catch {
      return false;
    }
  }
}
