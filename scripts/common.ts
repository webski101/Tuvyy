import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bech32 } from '@scure/base';
import { getNetwork } from '@qorechain/sdk';
import { createPublicClient, createWalletClient, hexToBytes, http, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { diana, daoAbi } from '../config/chain.js';

export { diana, daoAbi };
export const net = getNetwork('testnet');
if (net.chainId !== 'qorechain-diana') throw new Error('Unexpected SDK testnet preset');
export const publicClient = createPublicClient({ chain: diana, transport: http(diana.rpcUrls.default.http[0]) });
export const deploymentPath = fileURLToPath(new URL('../config/deployments.json', import.meta.url));
export function deployment() {
  return JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
    chainId: number; dao: Address | null; deploymentTransaction: Hex | null;
    daoQor1: string | null; bridge: Address; wdt: string; receipts: string;
  };
}
export function daoAddress(): Address {
  const d = deployment();
  if (d.chainId !== diana.id || !d.dao || !isAddress(d.dao)) throw new Error('Deploy first: config/deployments.json has no Diana DAO');
  return d.dao;
}
export function expandHome(path: string) { return path.startsWith('~/') ? homedir() + path.slice(1) : path; }
export function loadKey(): Hex {
  const key = (process.env.DEPLOYER_KEY ?? readFileSync(expandHome(process.env.DEPLOYER_KEY_PATH ?? '~/tuvyy-secrets/deployer.key'), 'utf8')).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Deployer key must be 0x + 64 hex characters');
  return key as Hex;
}
export function wallet() {
  return createWalletClient({ chain: diana, account: privateKeyToAccount(loadKey()), transport: http(diana.rpcUrls.default.http[0]) });
}
export function qor1(address: Address) { return bech32.encode('qor', bech32.toWords(hexToBytes(address))); }
export async function assertNetwork() {
  if (await publicClient.getChainId() !== diana.id) throw new Error('Wrong RPC chain');
}
export async function confirmed(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}
export async function smart<T>(contract: string, query: unknown): Promise<T> {
  const encoded = encodeURIComponent(Buffer.from(JSON.stringify(query)).toString('base64'));
  const response = await fetch(`${net.endpoints.rest}/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`);
  if (!response.ok) throw new Error(`Native query failed: HTTP ${response.status}`);
  return (await response.json() as { data: T }).data;
}
export function fail(error: unknown) {
  console.error(error instanceof Error ? error.message : 'Operation failed');
  process.exitCode = 1;
}
