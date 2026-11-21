import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { stringToHex } from 'viem';
import { actionReason, matchesReceipt, receiptId, receiptNote } from './src/presentation.ts';

test('receipt notes format exact QOR and six-decimal WDT without changing other text', () => {
  assert.equal(receiptNote('Tuvyy #1: NATIVE 2000000000000000000; Demo grant'), 'Tuvyy #1: 2 QOR; Demo grant');
  assert.equal(receiptNote('Tuvyy #2: CW20 1234567; Supplies'), 'Tuvyy #2: 1.234567 WDT; Supplies');
  assert.equal(receiptNote('Tuvyy #3: NATIVE 1; Small'), 'Tuvyy #3: 0.000000000000000001 QOR; Small');
  assert.equal(receiptNote('Tuvyy #4: CW20 0;'), 'Tuvyy #4: 0 WDT;');
  for (const note of ['', 'Other project', 'Tuvyy #1: NATIVE invalid; note']) assert.equal(receiptNote(note), note);
});

test('receipt association requires both DAO sender and exact proposal prefix', () => {
  const receipt = { id: 3, sender: 'qor-dao', note: 'Tuvyy #1: NATIVE 2;', height: 100 };
  assert.equal(matchesReceipt(receipt, 'qor-dao', 1n), true);
  assert.equal(matchesReceipt(receipt, 'qor-other', 1n), false);
  assert.equal(matchesReceipt(receipt, null, 1n), false);
  assert.equal(matchesReceipt({ ...receipt, note: 'Tuvyy #11: NATIVE 2;' }, 'qor-dao', 1n), false);
  assert.equal(matchesReceipt({ ...receipt, note: '' }, 'qor-dao', 1n), false);
});

test('receipt IDs decode from bridge bytes and reject empty or malformed responses', () => {
  assert.equal(receiptId(stringToHex('{"id":3,"sender":"qor-dao","note":"Tuvyy #1: NATIVE 2;","height":100}')), 3);
  for (const value of ['', '{}', '{"id":"3"}', '{"id":0}', '{"id":1.5}', '{"id":9007199254740992}']) assert.throws(() => receiptId(stringToHex(value)));
});

test('action reasons prioritize proposal state and explain wallet, membership and pending states', () => {
  const ready = { connected: true, correctChain: true, member: true, busy: false, deployed: true };
  assert.equal(actionReason('create', ready), '');
  assert.match(actionReason('create', { ...ready, connected: false }), /Connect a wallet/);
  assert.match(actionReason('create', { ...ready, member: false }), /Only DAO members/);
  assert.match(actionReason('vote', { ...ready, member: false }), /Only DAO members/);
  assert.match(actionReason('vote', { ...ready, voted: true, member: false }), /already voted/);
  assert.match(actionReason('vote', { ...ready, open: false }), /Voting closed/);
  assert.match(actionReason('execute', { ...ready, connected: false, executed: true }), /Already executed/);
  assert.match(actionReason('execute', { ...ready, connected: false, open: true, deadline: 2000000000n }), /Voting still open until/);
  assert.match(actionReason('execute', { ...ready, yes: 0n, no: 0n, quorum: 1n }), /Quorum not met/);
  assert.match(actionReason('execute', { ...ready, yes: 1n, no: 1n, quorum: 1n }), /did not pass/);
  assert.equal(actionReason('execute', { ...ready, member: false, yes: 1n, no: 0n, quorum: 1n }), '');
  assert.match(actionReason('create', { ...ready, correctChain: false }), /Switch your wallet/);
  assert.match(actionReason('create', { ...ready, busy: true }), /current transaction/);
  assert.match(actionReason('create', { ...ready, deployed: false }), /No DAO/);
});
