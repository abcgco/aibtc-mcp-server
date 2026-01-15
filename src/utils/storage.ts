import fs from "fs/promises";
import path from "path";
import os from "os";
import type { EncryptedData } from "./encryption.js";
import type { Network } from "../config/networks.js";
import { getUserApiKey, hasUserContext } from "../context.js";

/**
 * Storage directory location
 *
 * In remote mode (HTTP server): /data/users/{apiKey}/
 * In local mode (stdio):        ~/.stx402/
 */
function getBaseStorageDir(): string {
  // Check if we're in remote mode with a user context
  if (hasUserContext()) {
    try {
      const apiKey = getUserApiKey();
      // Use /data for Docker, or DATA_DIR env var, or fallback to ~/.stx402-server
      const baseDir =
        process.env.DATA_DIR ||
        (process.env.DOCKER === "true" ? "/data" : path.join(os.homedir(), ".stx402-server"));
      return path.join(baseDir, "users", apiKey);
    } catch {
      // Fall through to local mode
    }
  }

  // Local mode (stdio transport)
  return path.join(os.homedir(), ".stx402");
}

// Dynamic path getters
function getStorageDirPath(): string {
  return getBaseStorageDir();
}

function getWalletsDirPath(): string {
  return path.join(getBaseStorageDir(), "wallets");
}

function getWalletIndexFilePath(): string {
  return path.join(getBaseStorageDir(), "wallets.json");
}

function getConfigFilePath(): string {
  return path.join(getBaseStorageDir(), "config.json");
}

/**
 *
 * Wallet metadata (stored in index, no sensitive data)
 */
export interface WalletMetadata {
  id: string;
  name: string;
  address: string;
  network: Network;
  createdAt: string;
  lastUsed?: string;
}

/**
 * Wallet index file structure
 */
export interface WalletIndex {
  version: number;
  wallets: WalletMetadata[];
}

/**
 * App configuration
 */
export interface AppConfig {
  version: number;
  activeWalletId: string | null;
  autoLockTimeout: number; // Minutes, 0 = never
}

/**
 * Keystore file structure (contains encrypted mnemonic)
 */
export interface KeystoreFile {
  version: number;
  encrypted: EncryptedData;
  addressIndex: number; // BIP44 address index
}

const CURRENT_INDEX_VERSION = 1;
const CURRENT_CONFIG_VERSION = 1;

/**
 * Get storage directory path
 */
export function getStorageDir(): string {
  return getStorageDirPath();
}

/**
 * Check if storage directory exists
 */
export async function storageExists(): Promise<boolean> {
  try {
    await fs.access(getStorageDirPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize storage directory structure
 */
export async function initializeStorage(): Promise<void> {
  const walletsDir = getWalletsDirPath();
  const walletIndexFile = getWalletIndexFilePath();
  const configFile = getConfigFilePath();

  // Create directories
  await fs.mkdir(walletsDir, { recursive: true, mode: 0o700 });

  // Create wallet index if it doesn't exist
  try {
    await fs.access(walletIndexFile);
  } catch {
    const defaultIndex: WalletIndex = {
      version: CURRENT_INDEX_VERSION,
      wallets: [],
    };
    await writeWalletIndex(defaultIndex);
  }

  // Create config if it doesn't exist
  try {
    await fs.access(configFile);
  } catch {
    const defaultConfig: AppConfig = {
      version: CURRENT_CONFIG_VERSION,
      activeWalletId: null,
      autoLockTimeout: 15, // 15 minutes default
    };
    await writeAppConfig(defaultConfig);
  }
}

/**
 * Read wallet index
 */
export async function readWalletIndex(): Promise<WalletIndex> {
  try {
    const walletIndexFile = getWalletIndexFilePath();
    const content = await fs.readFile(walletIndexFile, "utf8");
    return JSON.parse(content) as WalletIndex;
  } catch {
    return {
      version: CURRENT_INDEX_VERSION,
      wallets: [],
    };
  }
}

/**
 * Write wallet index (atomic write with temp file)
 */
export async function writeWalletIndex(index: WalletIndex): Promise<void> {
  const walletIndexFile = getWalletIndexFilePath();
  const tempFile = `${walletIndexFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(index, null, 2), {
    mode: 0o600,
  });
  await fs.rename(tempFile, walletIndexFile);
}

/**
 * Read app config
 */
export async function readAppConfig(): Promise<AppConfig> {
  try {
    const configFile = getConfigFilePath();
    const content = await fs.readFile(configFile, "utf8");
    return JSON.parse(content) as AppConfig;
  } catch {
    return {
      version: CURRENT_CONFIG_VERSION,
      activeWalletId: null,
      autoLockTimeout: 15,
    };
  }
}

/**
 * Write app config (atomic write)
 */
export async function writeAppConfig(config: AppConfig): Promise<void> {
  const configFile = getConfigFilePath();
  const tempFile = `${configFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  await fs.rename(tempFile, configFile);
}

/**
 * Get keystore file path for a wallet
 */
function getKeystorePath(walletId: string): string {
  return path.join(getWalletsDirPath(), walletId, "keystore.json");
}

/**
 * Read keystore for a wallet
 */
export async function readKeystore(walletId: string): Promise<KeystoreFile> {
  const keystorePath = getKeystorePath(walletId);
  const content = await fs.readFile(keystorePath, "utf8");
  return JSON.parse(content) as KeystoreFile;
}

/**
 * Write keystore for a wallet (creates directory if needed)
 */
export async function writeKeystore(
  walletId: string,
  keystore: KeystoreFile
): Promise<void> {
  const walletDir = path.join(getWalletsDirPath(), walletId);
  await fs.mkdir(walletDir, { recursive: true, mode: 0o700 });

  const keystorePath = getKeystorePath(walletId);
  const tempFile = `${keystorePath}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(keystore, null, 2), {
    mode: 0o600,
  });
  await fs.rename(tempFile, keystorePath);
}

/**
 * Delete a wallet directory and its contents
 */
export async function deleteWalletStorage(walletId: string): Promise<void> {
  const walletDir = path.join(getWalletsDirPath(), walletId);
  await fs.rm(walletDir, { recursive: true, force: true });
}

/**
 * Update wallet metadata in index
 */
export async function updateWalletMetadata(
  walletId: string,
  updates: Partial<WalletMetadata>
): Promise<void> {
  const index = await readWalletIndex();
  const walletIndex = index.wallets.findIndex((w) => w.id === walletId);

  if (walletIndex === -1) {
    throw new Error(`Wallet not found: ${walletId}`);
  }

  index.wallets[walletIndex] = {
    ...index.wallets[walletIndex],
    ...updates,
  };

  await writeWalletIndex(index);
}

/**
 * Add wallet to index
 */
export async function addWalletToIndex(wallet: WalletMetadata): Promise<void> {
  const index = await readWalletIndex();
  index.wallets.push(wallet);
  await writeWalletIndex(index);
}

/**
 * Remove wallet from index
 */
export async function removeWalletFromIndex(walletId: string): Promise<void> {
  const index = await readWalletIndex();
  index.wallets = index.wallets.filter((w) => w.id !== walletId);
  await writeWalletIndex(index);
}
