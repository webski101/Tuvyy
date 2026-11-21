import { setTimeout as delay } from 'node:timers/promises';
import { decodeEventLog, parseEther, zeroAddress } from 'viem';
import { assertNetwork, confirmed, daoAbi, daoAddress, deployment, fail, publicClient, qor1, smart, wallet } from './common.js';

async function main() {
  await assertNetwork();
  const address = daoAddress();
  const client = wallet();
  const account = client.account;
  const member = await publicClient.readContract({ address, abi: daoAbi, functionName: 'members', args: [account.address] });
  const quorum = await publicClient.readContract({ address, abi: daoAbi, functionName: 'quorum' });
  if (!member || quorum !== 1n) throw new Error('Demo requires the deployer to be a member and quorum = 1');
  const kind = process.env.PAYOUT_KIND ?? 'NATIVE';
  if (!['CW20', 'NATIVE'].includes(kind)) throw new Error('PAYOUT_KIND must be NATIVE or CW20');
  const cw20 = kind === 'CW20';
  const amount = cw20 ? BigInt(process.env.WDT_AMOUNT ?? '1000000') : parseEther(process.env.QOR_AMOUNT ?? '0.001');
  if (amount <= 0n) throw new Error('Amount must be positive');
  if (!cw20) await confirmed(await client.sendTransaction({ to: address, value: amount }));
  else {
    const balance = await smart<{ balance: string }>(deployment().wdt, { balance: { address: qor1(address) } });
    if (BigInt(balance.balance) < amount) throw new Error('Fund DAO with real WDT first; demo never substitutes an allowance for payout');
  }
  const proposed = await confirmed(await client.writeContract({ address, abi: daoAbi, functionName: 'propose',
    args: [cw20 ? qor1(account.address) : '', cw20 ? zeroAddress : account.address, amount, 'Demo grant', cw20 ? 0 : 1] }));
  let id: bigint | undefined;
  for (const log of proposed.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try { const event = decodeEventLog({ abi: daoAbi, eventName: 'Proposed', data: log.data, topics: log.topics }); id = event.args.id; } catch { /* Other event. */ }
  }
  if (id === undefined) throw new Error('Proposed event missing');
  await confirmed(await client.writeContract({ address, abi: daoAbi, functionName: 'vote', args: [id, true] }));
  const proposal = await publicClient.readContract({ address, abi: daoAbi, functionName: 'getProposal', args: [id] });
  console.log(`Waiting for proposal ${id}, deadline ${proposal.deadline} (chain time)…`);
  const end = Date.now() + Number(proposal.deadline - BigInt(Math.floor(Date.now() / 1000))) * 1000 + 120_000;
  while ((await publicClient.getBlock()).timestamp < proposal.deadline) {
    if (Date.now() > end) throw new Error('Timed out waiting for chain voting deadline');
    await delay(2000);
  }
  const result = await confirmed(await client.writeContract({ address, abi: daoAbi, functionName: 'execute', args: [id] }));
  console.log('Execution transaction:', result.transactionHash);
  console.log('DAO qor1:', qor1(address));
  const event = result.logs.filter(log => log.address.toLowerCase() === address.toLowerCase()).map(log => {
    try { return decodeEventLog({ abi: daoAbi, eventName: 'Executed', data: log.data, topics: log.topics }); } catch { return undefined; }
  }).find(Boolean);
  if (!event) throw new Error('Executed event missing');
  const returned = JSON.parse(Buffer.from(event.args.receipt.slice(2), 'hex').toString()) as { id: number };
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const receipt = await smart<{ id: number; sender: string; note: string; height: number }>(deployment().receipts, { receipt: { id: returned.id } });
      if (receipt.sender !== qor1(address)) throw new Error('Receipt sender mismatch');
      console.log('New Native receipt:', JSON.stringify(receipt, null, 2));
      return;
    } catch (error) { if (attempt === 9) throw error; await delay(1500); }
  }
}
main().catch(fail);
