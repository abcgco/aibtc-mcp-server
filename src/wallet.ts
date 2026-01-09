import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import { TransactionVersion } from "@stacks/transactions";

export type Network = "mainnet" | "testnet";

export interface Account {
  address: string;
  privateKey: string;
  network: Network;
}

export async function mnemonicToAccount(
  mnemonic: string,
  network: Network
): Promise<Account> {
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: "",
  });

  const account = wallet.accounts[0];
  const transactionVersion =
    network === "mainnet"
      ? TransactionVersion.Mainnet
      : TransactionVersion.Testnet;
  const address = getStxAddress({ account, transactionVersion });

  return {
    address,
    privateKey: account.stxPrivateKey,
    network,
  };
}
