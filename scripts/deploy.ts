import { readFileSync, writeFileSync } from 'node:fs';
import { isAddress, type Abi, type Address, type Hex } from 'viem';
import { assertNetwork, confirmed, deployment, deploymentPath, fail, qor1, wallet } from './common.js';

async function main() {
  await assertNetwork();
  const existing = deployment();
  if (existing.dao) throw new Error('Deployment already configured; archive it explicitly before redeploying');
  const client = wallet();
  const members = (process.env.DAO_MEMBERS ?? client.account.address).split(',').map(x => x.trim());
  if (!members.every(member => isAddress(member))) throw new Error('DAO_MEMBERS must contain comma-separated EVM addresses');
  const period = BigInt(process.env.VOTING_PERIOD ?? '60');
  const quorum = BigInt(process.env.QUORUM ?? '1');
  const artifact = JSON.parse(readFileSync(new URL('../out/TuvyyDAO.sol/TuvyyDAO.json', import.meta.url), 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  const hash = await client.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object,
    args: [members as Address[], period, quorum, existing.bridge, existing.wdt, existing.receipts] });
  const receipt = await confirmed(hash);
  if (!receipt.contractAddress) throw new Error('Deployment has no contract address');
  const result = { ...existing, dao: receipt.contractAddress, daoQor1: qor1(receipt.contractAddress), deploymentTransaction: hash };
  writeFileSync(deploymentPath, JSON.stringify(result, null, 2) + '\n');
  console.log('DAO:', result.dao, 'Native:', result.daoQor1, 'Transaction:', hash);
}
main().catch(fail);
