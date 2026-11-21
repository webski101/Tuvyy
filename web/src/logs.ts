export async function findEventInChunks<T>(
  fromBlock: bigint,
  toBlock: bigint,
  readChunk: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>,
  matches: (event: T) => boolean,
): Promise<T | undefined> {
  for (let start = fromBlock; start <= toBlock; start += 10_000n) {
    const end = start + 9_999n < toBlock ? start + 9_999n : toBlock;
    const event = (await readChunk(start, end)).find(matches);
    if (event !== undefined) return event;
  }
  return undefined;
}
