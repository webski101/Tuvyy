import { defineChain, parseAbi } from 'viem';

export const diana = defineChain({
  id: 9800,
  name: 'QoreChain Diana',
  nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: { default: { http: ['https://evm-testnet.qore.host'] } },
  blockExplorers: { default: { name: 'QoreChain Explorer (select Testnet)', url: 'https://explore.qore.network' } },
  testnet: true,
});

export const daoAbi = parseAbi([
  'function owner() view returns (address)',
  'function votingPeriod() view returns (uint256)',
  'function quorum() view returns (uint256)',
  'function members(address) view returns (bool)',
  'function proposalCount() view returns (uint256)',
  'function getProposal(uint256) view returns ((string recipientQor1, address recipientEvm, uint256 amount, string note, uint8 payoutKind, uint256 deadline, uint256 yes, uint256 no, bool executed))',
  'function hasVoted(uint256,address) view returns (bool)',
  'function propose(string,address,uint256,string,uint8) returns (uint256)',
  'function vote(uint256,bool)',
  'function execute(uint256)',
  'event Proposed(uint256 indexed id,address indexed proposer,uint8 kind,uint256 amount)',
  'event Executed(uint256 indexed id,address indexed executor,bytes receipt)',
  'error Unauthorized()', 'error InvalidInput()', 'error InvalidProposal()',
  'error VotingClosed()', 'error AlreadyVoted()', 'error NotExecutable()',
  'error PayoutFailed()', 'error BridgeFailed(bytes reason)', 'error BridgeInactive()', 'error Reentrant()',
]);
