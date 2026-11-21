import { formatUnits, hexToString, type Hex } from 'viem';

export type Receipt = { id: number; sender: string; note: string; height: number };

export function receiptNote(note: string) {
  return note.replace(/^(Tuvyy #\d+: )(NATIVE|CW20) (\d+)(?=;|$)/, (_, prefix, kind, amount) =>
    `${prefix}${formatUnits(BigInt(amount), kind === 'NATIVE' ? 18 : 6)} ${kind === 'NATIVE' ? 'QOR' : 'WDT'}`);
}

export function matchesReceipt(receipt: Receipt, daoQor1: string | null, proposalId: bigint) {
  return receipt.sender === daoQor1 && receipt.note.startsWith(`Tuvyy #${proposalId}:`);
}

export function receiptId(bytes: Hex): number {
  const parsed = JSON.parse(hexToString(bytes)) as { id?: unknown };
  if (typeof parsed.id !== 'number' || !Number.isSafeInteger(parsed.id) || parsed.id < 1) throw new Error('Invalid receipt ID in Executed event');
  return parsed.id;
}

type ActionState = {
  connected: boolean; correctChain: boolean; member: boolean; busy: boolean; deployed: boolean;
  executed?: boolean; open?: boolean; voted?: boolean; deadline?: bigint; yes?: bigint; no?: bigint; quorum?: bigint;
};

export function actionReason(action: 'create' | 'vote' | 'execute', state: ActionState): string {
  if (state.executed) return 'Already executed.';
  if (action === 'vote' && state.open === false) return 'Voting closed.';
  if (action === 'vote' && state.voted) return 'You already voted.';
  if (action === 'execute' && state.open) return `Voting still open until ${new Date(Number(state.deadline) * 1000).toLocaleString()}.`;
  if (action === 'execute' && state.yes !== undefined && state.quorum !== undefined && state.yes < state.quorum) return 'Quorum not met.';
  if (action === 'execute' && state.yes !== undefined && state.no !== undefined && state.yes <= state.no) return 'Proposal did not pass (yes must exceed no).';
  if (!state.deployed) return 'No DAO deployment configured.';
  if (!state.connected) return 'Connect a wallet to continue.';
  if (!state.correctChain) return 'Switch your wallet to Diana (chain 9800).';
  if (action !== 'execute' && !state.member) return 'Only DAO members can create proposals and vote.';
  if (state.busy) return 'Waiting for the current transaction to finish.';
  return '';
}
