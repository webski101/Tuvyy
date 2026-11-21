import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bech32 } from '@scure/base';
import {
  createPublicClient, createWalletClient, custom, formatEther, formatUnits, http,
  isAddress, parseEther, parseUnits, zeroAddress, type Address, type EIP1193Provider,
} from 'viem';
import { diana, daoAbi } from '../../config/chain';
import deployment from '../../config/deployments.json';
import './style.css';

declare global { interface Window { ethereum?: EIP1193Provider } }
const client = createPublicClient({ chain: diana, transport: http() });
const nativeRestBase = (import.meta.env.VITE_QORE_API_BASE || '/qore-api').replace(/\/+$/, '');
const dao = deployment.dao && isAddress(deployment.dao) ? deployment.dao as Address : undefined;
type Proposal = {
  recipientQor1: string; recipientEvm: Address; amount: bigint; note: string;
  payoutKind: number; deadline: bigint; yes: bigint; no: bigint; executed: boolean;
};
type Entry = { id: bigint; proposal: Proposal; voted: boolean };
type Receipt = { id: number; sender: string; note: string; height: number };
const shorten = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message.split('\n')[0] : 'Request failed';

async function readNative<T>(contract: string, query: unknown): Promise<T> {
  const encoded = encodeURIComponent(btoa(JSON.stringify(query)));
  const response = await fetch(`${nativeRestBase}/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`);
  if (!response.ok) throw new Error(`Native query failed (${response.status})`);
  return (await response.json() as { data: T }).data;
}
function validQor(value: string) {
  try { const address = bech32.decode(value as `${string}1${string}`); return address.prefix === 'qor' && [20, 32].includes(bech32.fromWords(address.words).length); }
  catch { return false; }
}

function App() {
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [member, setMember] = useState(false);
  const [quorum, setQuorum] = useState(0n);
  const [balance, setBalance] = useState(0n);
  const [chainTime, setChainTime] = useState(0n);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(20);
  const [count, setCount] = useState(0n);
  const [error, setError] = useState('');
  const [nativeError, setNativeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState('');
  const [kind, setKind] = useState('1');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    const native = readNative<{ receipts: Receipt[] }>(deployment.receipts, { latest: { limit: 20 } })
      .then(data => { setReceipts(data.receipts); setNativeError(''); })
      .catch(e => setNativeError(errorText(e)));
    try {
      if (dao) {
        const [total, required, treasury, block, isMember] = await Promise.all([
          client.readContract({ address: dao, abi: daoAbi, functionName: 'proposalCount' }),
          client.readContract({ address: dao, abi: daoAbi, functionName: 'quorum' }),
          client.getBalance({ address: dao }), client.getBlock(),
          account ? client.readContract({ address: dao, abi: daoAbi, functionName: 'members', args: [account] }) : false,
        ]);
        const length = Number(total < BigInt(limit) ? total : BigInt(limit));
        const rows = await Promise.all(Array.from({ length }, async (_, index) => {
          const id = total - BigInt(index);
          const [proposal, voted] = await Promise.all([
            client.readContract({ address: dao, abi: daoAbi, functionName: 'getProposal', args: [id] }),
            account ? client.readContract({ address: dao, abi: daoAbi, functionName: 'hasVoted', args: [id, account] }) : false,
          ]);
          return { id, proposal, voted };
        }));
        setEntries(rows); setCount(total); setQuorum(required); setBalance(treasury);
        setChainTime(block.timestamp); setMember(isMember);
      }
    } catch (e) { setError(errorText(e)); }
    finally { await native; setLoading(false); }
  }, [account, limit]);

  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 12000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accountsChanged = (accounts: string[]) => { setAccount(accounts[0] as Address | undefined); setError(''); };
    const chainChanged = (chain: string) => setChainId(Number(chain));
    void provider.request({ method: 'eth_accounts' }).then(accountsChanged).catch(() => {});
    void provider.request({ method: 'eth_chainId' }).then(chainChanged).catch(() => {});
    provider.on('accountsChanged', accountsChanged);
    provider.on('chainChanged', chainChanged);
    return () => { provider.removeListener('accountsChanged', accountsChanged); provider.removeListener('chainChanged', chainChanged); };
  }, []);

  async function connect() {
    setError('');
    try {
      const provider = window.ethereum;
      if (!provider) throw new Error('Install an injected EVM wallet, such as QoreX or MetaMask.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2648' }] }); }
      catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await provider.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: '0x2648', chainName: diana.name, rpcUrls: [diana.rpcUrls.default.http[0]],
          nativeCurrency: diana.nativeCurrency, blockExplorerUrls: ['https://explore.qore.network'],
        }] });
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2648' }] });
      }
      setChainId(Number(await provider.request({ method: 'eth_chainId' })));
    } catch (e) { setError(errorText(e)); }
  }

  async function transact(functionName: 'propose' | 'vote' | 'execute', args: readonly unknown[]) {
    setError(''); setTransaction(''); setBusy(true);
    try {
      if (!account || !dao || !window.ethereum) throw new Error('Connect a wallet and configure a deployed DAO first.');
      const wallet = createWalletClient({ account, chain: diana, transport: custom(window.ethereum) });
      if (await wallet.getChainId() !== 9800) throw new Error('Switch your wallet to Diana (chain 9800).');
      // ABI runtime dispatch stays here; simulation validates every user action before signing.
      const { request } = await client.simulateContract({ address: dao, abi: daoAbi, functionName, args, account } as Parameters<typeof client.simulateContract>[0]);
      const hash = await wallet.writeContract(request);
      setTransaction(hash);
      const result = await client.waitForTransactionReceipt({ hash });
      if (result.status !== 'success') throw new Error('Transaction reverted; neither payout nor receipt persisted.');
      await refresh();
      return true;
    } catch (e) { setError(errorText(e)); return false; }
    finally { setBusy(false); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (new TextEncoder().encode(note).length > 512) throw new Error('Note must be at most 512 UTF-8 bytes.');
      if (kind === '0' ? !validQor(recipient) : !isAddress(recipient) || recipient === zeroAddress) throw new Error('Enter a valid recipient address.');
      const decimals = kind === '0' ? 6 : 18;
      if (!new RegExp(`^[0-9]+(?:\\.[0-9]{1,${decimals}})?$`).test(amount)) throw new Error(`Enter a positive decimal amount with at most ${decimals} decimal places.`);
      const units = kind === '0' ? parseUnits(amount, 6) : parseEther(amount);
      if (units <= 0n) throw new Error('Amount must be positive.');
      if (await transact('propose', [kind === '0' ? recipient : '', kind === '1' ? recipient : zeroAddress, units, note, Number(kind)])) {
        setRecipient(''); setAmount(''); setNote('');
      }
    } catch (e) { setError(errorText(e)); }
  }

  const canAct = Boolean(account && chainId === 9800 && dao && !busy);
  return <div className="shell">
    <header><a className="brand" href="#">tuvyy<span> / treasury, together</span></a>
      <button className="connect" onClick={() => void connect()}>{account ? `${shorten(account)} · ${chainId === 9800 ? 'Diana' : 'Switch network'}` : 'Connect wallet ↗'}</button></header>
    <main>
      <section className="hero"><div><p className="eyebrow">QORECHAIN DIANA · CROSS-VM DAO</p><h1>A shared decision.<br/><em>One atomic outcome.</em></h1><p>Vote on EVM. Pay from the treasury. Leave a receipt on the Native lane — or roll it all back.</p></div>
        <div className="treasury"><span className="eyebrow">NATIVE TREASURY</span><strong>{dao ? Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'} <small>QOR</small></strong><span>{dao ? shorten(dao) : 'Not deployed yet'}</span><span className="network">● Diana testnet · 9800</span></div></section>
      {!dao && <div className="notice">No DAO deployment configured. These are not demo proposals. Set the real address in <code>config/deployments.json</code> after deployment; live shared Native receipts remain readable below.</div>}
      <div className="notice subtle">EVM writes require a registered ML-DSA-87 key and an open EVM window. Open one in QoreX or the QoreChain Dashboard before signing. WDT is a separate token — faucet QOR does not fund WDT payouts.</div>
      {error && <div className="error" role="alert">{error}</div>}
      {transaction && <div className="notice" role="status">{busy ? 'Confirming' : 'Transaction'}: <code className="hash">{transaction}</code> · <a href="https://explore.qore.network" target="_blank" rel="noreferrer">Search in explorer (Testnet) ↗</a></div>}
      <div className="columns"><section className="panel proposals"><div className="section-head"><div><p className="eyebrow">THE COLLECTIVE</p><h2>Proposals <span>{count.toString()}</span></h2></div><button className="quiet" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Refresh ↻</button></div>
        {loading ? <p className="empty" role="status">Reading the chain…</p> : entries.length === 0 ? <div className="empty"><span>◎</span><h3>No proposals yet</h3><p>{dao ? 'Members can put the first treasury decision to a vote.' : 'Your treasury decisions will appear here once deployed.'}</p></div> : entries.map(({ id, proposal: p, voted }) => {
          const open = chainTime < p.deadline;
          const passed = p.yes > p.no && p.yes >= quorum;
          const status = p.executed ? 'Executed' : open ? 'Voting open' : passed ? 'Ready to execute' : 'Not passed';
          return <article className="proposal" key={id.toString()}><div className="section-head"><span className="eyebrow">PROPOSAL #{id.toString()}</span><span className={`badge ${p.executed ? 'done' : ''}`}>{status}</span></div>
            <h3>{formatUnits(p.amount, p.payoutKind === 0 ? 6 : 18)} {p.payoutKind === 0 ? 'WDT' : 'QOR'} <span>→ {shorten(p.payoutKind === 0 ? p.recipientQor1 : p.recipientEvm)}</span></h3><p className="note">{p.note || 'No note provided.'}</p>
            <p className="address">{p.payoutKind === 0 ? p.recipientQor1 : p.recipientEvm}</p>
            <div className="tally"><span>Yes <b>{p.yes.toString()}</b></span><span>No <b>{p.no.toString()}</b></span><span>Quorum <b>{quorum.toString()}</b></span></div>
            <footer><span>{open ? 'Closes' : 'Closed'} {new Date(Number(p.deadline) * 1000).toLocaleString()}</span><div className="actions">{open ? <><button disabled={!canAct || !member || voted} onClick={() => void transact('vote', [id, true])}>{voted ? 'Voted' : 'Vote yes'}</button><button className="quiet" disabled={!canAct || !member || voted} onClick={() => void transact('vote', [id, false])}>No</button></> : <button disabled={!canAct || !passed || p.executed} onClick={() => void transact('execute', [id])}>Execute ↗</button>}</div></footer>
          </article>;
        })}
        {count > BigInt(limit) && <button className="quiet" onClick={() => setLimit(limit + 20)}>Load older proposals</button>}
      </section>
      <aside><section className="panel"><p className="eyebrow">MAKE A PROPOSAL</p><h2>Put it to a vote.</h2><p className="muted">{account ? member ? 'You are a member. Start a treasury decision.' : 'Only DAO members can propose and vote.' : 'Connect a member wallet to propose.'}</p>
        <form onSubmit={event => void submit(event)}><label>Payout asset<select value={kind} onChange={event => { setKind(event.target.value); setRecipient(''); }}><option value="1">QOR · Native payment + Native receipt</option><option value="0">WDT · CW20 payment + Native receipt</option></select></label>
          <label>Recipient {kind === '0' ? '(qor1)' : '(0x)'}<input required value={recipient} onChange={event => setRecipient(event.target.value.trim())} placeholder={kind === '0' ? 'qor1…' : '0x…'} /></label>
          <label>Amount<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" pattern="[0-9]+([.][0-9]+)?" /></label>
          <label>Note<textarea value={note} onChange={event => setNote(event.target.value)} placeholder="What are we funding?" maxLength={512} /></label><small>Receipt summary is capped at 140 UTF-8 bytes. WDT has 6 decimals; QOR has 18.</small>
          <button className="primary" disabled={!canAct || !member} type="submit">{busy ? 'Awaiting confirmation…' : 'Create proposal ↗'}</button></form></section></aside></div>
      <section className="panel receipts"><div className="section-head"><div><p className="eyebrow">THE OTHER SIDE OF THE TRANSACTION</p><h2>Native receipts</h2></div><span className="badge">CosmWasm · live shared contract</span></div><p className="muted">Latest 20 receipts from the public qday-receipts book, including other projects. The sender is the calling contract's qor1 identity, not the voting wallet.</p>
        {nativeError ? <p className="error" role="alert">{nativeError}</p> : receipts.length === 0 ? <p className="empty">{loading ? 'Reading Native receipts…' : 'No receipts recorded.'}</p> : <div className="receipt-grid">{receipts.map(receipt => <article className="receipt" key={receipt.id}><span className="eyebrow">RECEIPT #{receipt.id} · BLOCK {receipt.height}</span><h3>{receipt.note}</h3><p className="address" title={receipt.sender}>{receipt.sender}</p>{deployment.daoQor1 === receipt.sender && <span className="badge done">This DAO</span>}</article>)}</div>}
      </section>
    </main><footer className="site-footer"><span>Tuvyy · Build Before Q-Day 2026</span><span>Testnet only. No assets have real value.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
