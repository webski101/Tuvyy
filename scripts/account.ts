// SPDX-License-Identifier: Apache-2.0
// Adapted from QoreChain build-before-qday workshop-3/02-cross-vm.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { StargateClient } from '@cosmjs/stargate';
import {
  EthNativeSigner, buildRegisterPqcKeyMsg, fetchPqcStatus, generatePqcRecoveryCode,
  isRegisteredPqcKey, isValidRecoveryCode, openEvmWindowMsg, signProofOfPossession,
  unifiedAccountFromSeed, type UnifiedAccount,
} from '@qorechain/sdk';
import { evmWindowCost, evmWindowStatus } from '@qorechain/evm';
import { hexToBytes } from 'viem';
import { expandHome, fail, loadKey, net, wallet, qor1 } from './common.js';

const recoveryPath = expandHome(process.env.PQC_RECOVERY_PATH ?? '~/tuvyy-secrets/pqc-recovery-code');
function account(): UnifiedAccount {
  const recoveryCode = (process.env.QORE_PQC_RECOVERY_CODE ?? readFileSync(recoveryPath, 'utf8')).trim();
  if (!isValidRecoveryCode(recoveryCode)) throw new Error('Invalid PQC recovery code; run account init once');
  return unifiedAccountFromSeed(hexToBytes(loadKey()), { recoveryCode });
}
async function broadcast(acc: UnifiedAccount, mode: 'hybrid' | 'classical', messages: Parameters<EthNativeSigner['sign']>[0]['messages']) {
  const response = await fetch(`${net.endpoints.rest}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  if (!response.ok) throw new Error(`Fund ${acc.cosmos} before setup (account HTTP ${response.status})`);
  const body = await response.json() as { account: { base_account?: { account_number: string; sequence: string }; account_number: string; sequence: string } };
  const base = body.account.base_account ?? body.account;
  const transport = await StargateClient.connect(net.endpoints.rpc!);
  try {
    const signer = new EthNativeSigner(acc, { signMode: mode, rest: net.endpoints.rest });
    const result = await signer.signAndBroadcast(transport, {
      chainId: net.chainId, accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence),
      fee: { amount: [{ denom: 'uqor', amount: '100000' }], gas: '800000' }, messages,
    });
    if (result.code !== 0) throw new Error(`Native transaction failed: ${result.code} ${result.rawLog}`);
    console.log('Transaction:', result.transactionHash);
  } finally { transport.disconnect(); }
}
async function main() {
  const command = process.argv[2] ?? 'status';
  if (command === 'init') {
    loadKey();
    mkdirSync(dirname(recoveryPath), { recursive: true, mode: 0o700 });
    writeFileSync(recoveryPath, generatePqcRecoveryCode(), { mode: 0o600, flag: 'wx' });
    console.log('PQC recovery code saved privately. Back it up separately; never regenerate after registration.');
    return;
  }
  const acc = account();
  if (acc.evm.toLowerCase() !== wallet().account.address.toLowerCase()) throw new Error('SDK/private-key address mismatch');
  console.log('Deployer:', acc.evm, qor1(wallet().account.address));
  const pqc = await fetchPqcStatus({ rest: net.endpoints.rest, address: acc.cosmos });
  if (pqc.registered && isRegisteredPqcKey(pqc, acc.pqc.publicKey) === false) throw new Error('Registered PQC key differs from local recovery code');
  if (command === 'status') {
    console.log('PQC registered:', pqc.registered);
    console.log('EVM window:', await evmWindowStatus({ rest: net.endpoints.rest, address: acc.cosmos }));
  } else if (command === 'register') {
    if (pqc.registered) { console.log('Already registered'); return; }
    const proofOfPossession = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
    await broadcast(acc, 'classical', [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession })]);
  } else if (command === 'open') {
    if (!pqc.registered) throw new Error('Register PQC key first');
    const blocks = BigInt(process.env.WINDOW_BLOCKS ?? '1200');
    const maxTxs = BigInt(process.env.WINDOW_TXS ?? '12');
    const perTx = evmWindowCost({ gas: 6_000_000n, maxFeePerGas: 250_000_000_000n });
    const maxValue = BigInt(process.env.WINDOW_MAX_UQOR ?? (perTx * maxTxs + 1_000_000n).toString());
    await broadcast(acc, 'hybrid', [openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue })]);
  } else throw new Error('Use init | status | register | open');
}
main().catch(fail);
