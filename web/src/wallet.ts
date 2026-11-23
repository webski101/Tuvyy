type ChainProvider = { request(args: { method: 'eth_chainId' }): Promise<string> };

/**
 * Keeps the wallet chain ID current. `query` re-reads it from the provider (used when accounts
 * return without a `chainChanged` event); a reply is dropped if a newer event or query superseded
 * it, or if `live` says the wallet is disconnected or the listener is gone.
 */
export function chainSync(provider: ChainProvider, apply: (chainId: number) => void, live: () => boolean) {
  let turn = 0;
  return {
    changed(chain: string) { turn++; if (live()) apply(Number(chain)); },
    async query() {
      const mine = ++turn;
      try {
        const chain = await provider.request({ method: 'eth_chainId' });
        if (mine === turn && live()) apply(Number(chain));
      } catch { /* The chain stays unknown; Connect re-queries it. */ }
    },
  };
}
