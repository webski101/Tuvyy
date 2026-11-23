import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chainSync } from './src/wallet.ts';

function mockWallet(chain = '0x2648') {
  const pending: ((chain: string) => void)[] = [];
  const state = { chain, calls: 0, deferred: false, fail: false };
  const provider = {
    request({ method }: { method: 'eth_chainId' }) {
      assert.equal(method, 'eth_chainId');
      state.calls++;
      if (state.fail) return Promise.reject(new Error('locked'));
      return state.deferred ? new Promise<string>(resolve => pending.push(resolve)) : Promise.resolve(state.chain);
    },
  };
  return { provider, state, pending };
}

// Mirrors the App wiring: accounts and chain ID gate every action (`canAct`).
function mockApp(wallet: ReturnType<typeof mockWallet>) {
  const app = { account: undefined as string | undefined, chainId: undefined as number | undefined, disconnected: false };
  const chain = chainSync(wallet.provider, id => { app.chainId = id; }, () => !app.disconnected);
  const accountsChanged = async (accounts: string[]) => {
    app.account = accounts[0];
    if (!accounts.length) app.chainId = undefined;
    else await chain.query();
  };
  return { app, chain, accountsChanged, canAct: () => Boolean(app.account && app.chainId === 9800) };
}

test('H-06: accounts restored without chainChanged re-enable actions without reconnecting', async () => {
  const wallet = mockWallet();
  const { app, chain, accountsChanged, canAct } = mockApp(wallet);
  chain.changed('0x2648');
  await accountsChanged(['0xabc']);
  assert.equal(canAct(), true);

  await accountsChanged([]);
  assert.equal(app.chainId, undefined);
  assert.equal(canAct(), false);

  const calls = wallet.state.calls;
  await accountsChanged(['0xabc']);
  assert.equal(wallet.state.calls, calls + 1);
  assert.equal(app.chainId, 9800);
  assert.equal(canAct(), true);
});

test('accounts restored on another network keep actions disabled until the wallet switches', async () => {
  const wallet = mockWallet('0x1');
  const { app, chain, accountsChanged, canAct } = mockApp(wallet);
  await accountsChanged(['0xabc']);
  assert.equal(app.chainId, 1);
  assert.equal(canAct(), false);
  chain.changed('0x2648');
  assert.equal(canAct(), true);
});

test('a chainChanged event or newer query supersedes a slower eth_chainId reply', async () => {
  const wallet = mockWallet();
  wallet.state.deferred = true;
  const { app, chain } = mockApp(wallet);

  const stale = chain.query();
  chain.changed('0x1');
  wallet.pending.shift()!('0x2648');
  await stale;
  assert.equal(app.chainId, 1);

  const first = chain.query();
  const second = chain.query();
  wallet.pending.pop()!('0x2648');
  wallet.pending.pop()!('0x5');
  await Promise.all([first, second]);
  assert.equal(app.chainId, 9800);
});

test('replies after disconnect and provider errors leave the chain untouched', async () => {
  const wallet = mockWallet();
  wallet.state.deferred = true;
  const { app, chain } = mockApp(wallet);

  const query = chain.query();
  app.disconnected = true;
  wallet.pending.shift()!('0x2648');
  await query;
  chain.changed('0x2648');
  assert.equal(app.chainId, undefined);

  app.disconnected = false;
  wallet.state.fail = true;
  await chain.query();
  assert.equal(app.chainId, undefined);
});
