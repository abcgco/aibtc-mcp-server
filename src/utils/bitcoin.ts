import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import * as btc from "@scure/btc-signer";
import type { Network } from "../config/networks.js";

/**
 * Bitcoin address derivation result
 */
export interface BitcoinAddress {
  /**
   * Native SegWit address (bc1q... for mainnet, tb1q... for testnet)
   */
  address: string;
  /**
   * Compressed public key as hex string
   */
  publicKey: string;
}

/**
 * Derive Bitcoin L1 native SegWit address from BIP39 mnemonic
 *
 * Follows BIP84 derivation path:
 * - Mainnet: m/84'/0'/0'/0/0 (coin type 0)
 * - Testnet: m/84'/1'/0'/0/0 (coin type 1)
 *
 * Returns native SegWit (P2WPKH) address:
 * - Mainnet: bc1q... prefix
 * - Testnet: tb1q... prefix
 *
 * Security: Only returns address and public key. Private key is never exposed.
 *
 * @param mnemonic - BIP39 mnemonic phrase (12 or 24 words)
 * @param network - Network to derive address for ('mainnet' | 'testnet')
 * @returns Bitcoin address and public key
 *
 * @example
 * ```typescript
 * const { address, publicKey } = deriveBitcoinAddress(mnemonic, 'mainnet');
 * console.log(address); // bc1q...
 * console.log(publicKey); // 02... or 03... (33 bytes compressed)
 * ```
 */
export function deriveBitcoinAddress(
  mnemonic: string,
  network: Network
): BitcoinAddress {
  // Convert mnemonic to seed
  const seed = mnemonicToSeedSync(mnemonic);

  // Create master key from seed
  const masterKey = HDKey.fromMasterSeed(seed);

  // BIP84 derivation path
  // m / purpose' / coin_type' / account' / change / address_index
  // Purpose: 84 (native SegWit)
  // Coin type: 0 (Bitcoin mainnet) or 1 (Bitcoin testnet)
  // Account: 0 (first account)
  // Change: 0 (external/receiving addresses)
  // Address index: 0 (first address)
  const coinType = network === "mainnet" ? 0 : 1;
  const derivationPath = `m/84'/${coinType}'/0'/0/0`;

  // Derive key at path
  const derivedKey = masterKey.derive(derivationPath);

  if (!derivedKey.publicKey) {
    throw new Error("Failed to derive public key");
  }

  // Get compressed public key
  const publicKey = Buffer.from(derivedKey.publicKey).toString("hex");

  // Create native SegWit (P2WPKH) address
  const p2wpkh = btc.p2wpkh(derivedKey.publicKey, btc.NETWORK);

  if (!p2wpkh.address) {
    throw new Error("Failed to generate address");
  }

  // For testnet, we need to use testnet network params
  let address: string;
  if (network === "testnet") {
    // Use testnet network params
    const testnetP2wpkh = btc.p2wpkh(derivedKey.publicKey, btc.TEST_NETWORK);
    if (!testnetP2wpkh.address) {
      throw new Error("Failed to generate testnet address");
    }
    address = testnetP2wpkh.address;
  } else {
    address = p2wpkh.address;
  }

  return {
    address,
    publicKey,
  };
}
