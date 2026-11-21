// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TuvyyDAO {
    enum PayoutKind {
        CW20,
        NATIVE
    }

    struct Proposal {
        string recipientQor1;
        address recipientEvm;
        uint256 amount;
        string note;
        PayoutKind payoutKind;
        uint256 deadline;
        uint256 yes;
        uint256 no;
        bool executed;
    }

    address public immutable owner;
    address public immutable bridge;
    string public wdt;
    string public receipts;
    uint256 public immutable votingPeriod;
    uint256 public immutable quorum;
    uint256 public proposalCount;
    mapping(address => bool) public members;
    mapping(uint256 => Proposal) private proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    bool private executing;

    error Unauthorized();
    error InvalidInput();
    error InvalidProposal();
    error VotingClosed();
    error AlreadyVoted();
    error NotExecutable();
    error PayoutFailed();
    error BridgeFailed(bytes reason);
    error BridgeInactive();
    error Reentrant();

    event MemberChanged(address indexed member, bool active);
    event Proposed(uint256 indexed id, address indexed proposer, PayoutKind kind, uint256 amount);
    event Voted(uint256 indexed id, address indexed voter, bool support);
    event Executed(uint256 indexed id, address indexed executor, bytes receipt);
    event Funded(address indexed sender, uint256 amount);

    constructor(
        address[] memory initialMembers,
        uint256 period,
        uint256 requiredVotes,
        address bridgeAddress,
        string memory wdtAddress,
        string memory receiptsAddress
    ) {
        if (period == 0 || requiredVotes == 0 || bridgeAddress == address(0)) {
            revert InvalidInput();
        }
        owner = msg.sender;
        votingPeriod = period;
        quorum = requiredVotes;
        bridge = bridgeAddress;
        _checkQor(wdtAddress);
        _checkQor(receiptsAddress);
        wdt = wdtAddress;
        receipts = receiptsAddress;
        uint256 unique;
        for (uint256 i; i < initialMembers.length; ++i) {
            address member = initialMembers[i];
            if (member == address(0)) revert InvalidInput();
            if (!members[member]) {
                members[member] = true;
                ++unique;
                emit MemberChanged(member, true);
            }
        }
        if (requiredVotes > unique) revert InvalidInput();
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function setMember(address member, bool active) external {
        if (msg.sender != owner) revert Unauthorized();
        if (member == address(0)) revert InvalidInput();
        members[member] = active;
        emit MemberChanged(member, active);
    }

    function propose(
        string calldata recipientQor1,
        address recipientEvm,
        uint256 amount,
        string calldata note,
        PayoutKind payoutKind
    ) external returns (uint256 id) {
        if (!members[msg.sender]) revert Unauthorized();
        if (amount == 0 || bytes(note).length > 512) revert InvalidInput();
        if (payoutKind == PayoutKind.CW20) _checkQor(recipientQor1);
        else if (recipientEvm == address(0) || recipientEvm == address(this)) revert InvalidInput();
        id = ++proposalCount;
        proposals[id] = Proposal(
            recipientQor1, recipientEvm, amount, note, payoutKind, block.timestamp + votingPeriod, 0, 0, false
        );
        emit Proposed(id, msg.sender, payoutKind, amount);
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        _exists(id);
        return proposals[id];
    }

    function vote(uint256 id, bool support) external {
        _exists(id);
        if (!members[msg.sender]) revert Unauthorized();
        Proposal storage p = proposals[id];
        if (block.timestamp >= p.deadline) revert VotingClosed();
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();
        hasVoted[id][msg.sender] = true;
        if (support) ++p.yes;
        else ++p.no;
        emit Voted(id, msg.sender, support);
    }

    function execute(uint256 id) external {
        _exists(id);
        if (executing) revert Reentrant();
        Proposal storage p = proposals[id];
        if (p.executed || block.timestamp < p.deadline || p.yes <= p.no || p.yes < quorum) revert NotExecutable();
        executing = true;
        p.executed = true;
        if (p.payoutKind == PayoutKind.CW20) {
            _callNative(
                wdt,
                abi.encodePacked(
                    '{"transfer":{"recipient":"', p.recipientQor1, '","amount":"', _decimal(p.amount), '"}}'
                )
            );
        } else {
            (bool paid,) = p.recipientEvm.call{value: p.amount}("");
            if (!paid) revert PayoutFailed();
        }
        string memory summary = string.concat(
            "Tuvyy #",
            _decimal(id),
            ": ",
            p.payoutKind == PayoutKind.CW20 ? "CW20 " : "NATIVE ",
            _decimal(p.amount),
            "; ",
            p.note
        );
        bytes memory receipt = _callNative(
            receipts, abi.encodePacked('{"record":{"note":"', _escape(_truncate(bytes(summary), 140)), '"}}')
        );
        executing = false;
        emit Executed(id, msg.sender, receipt);
    }

    function _callNative(string memory target, bytes memory payload) private returns (bytes memory) {
        (bool ok, bytes memory ret) =
            bridge.call(abi.encodeWithSignature("executeCrossVMCall(uint8,string,bytes)", uint8(1), target, payload));
        if (!ok) revert BridgeFailed(ret);
        if (ret.length == 0) revert BridgeInactive();
        if (ret.length >= 64 && uint256(bytes32(ret)) == 32) return abi.decode(ret, (bytes));
        return ret;
    }

    function _exists(uint256 id) private view {
        if (id == 0 || id > proposalCount) revert InvalidProposal();
    }

    function _checkQor(string memory value) private pure {
        bytes memory b = bytes(value);
        if (b.length < 42 || b.length > 64 || b[0] != "q" || b[1] != "o" || b[2] != "r" || b[3] != "1") {
            revert InvalidInput();
        }
        bytes memory alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
        for (uint256 i = 4; i < b.length; ++i) {
            bool valid;
            for (uint256 j; j < alphabet.length; ++j) if (b[i] == alphabet[j]) valid = true;
            if (!valid) revert InvalidInput();
        }
    }

    function _decimal(uint256 n) private pure returns (string memory) {
        if (n == 0) return "0";
        uint256 count;
        for (uint256 v = n; v != 0; v /= 10) ++count;
        bytes memory b = new bytes(count);
        while (n != 0) {
            b[--count] = bytes1(uint8(48 + n % 10));
            n /= 10;
        }
        return string(b);
    }

    function _truncate(bytes memory b, uint256 limit) private pure returns (bytes memory) {
        if (b.length <= limit) return b;
        uint256 end = limit;
        while (end > 0 && uint8(b[end]) & 0xc0 == 0x80) --end;
        bytes memory result = new bytes(end);
        for (uint256 i; i < end; ++i) result[i] = b[i];
        return result;
    }

    function _escape(bytes memory b) private pure returns (bytes memory) {
        bytes memory out = new bytes(b.length * 6);
        bytes memory hexChars = "0123456789abcdef";
        uint256 n;
        for (uint256 i; i < b.length; ++i) {
            uint8 c = uint8(b[i]);
            if (c == 34 || c == 92) {
                out[n++] = "\\";
                out[n++] = b[i];
            } else if (c < 32) {
                out[n++] = "\\";
                out[n++] = "u";
                out[n++] = "0";
                out[n++] = "0";
                out[n++] = hexChars[c >> 4];
                out[n++] = hexChars[c & 15];
            } else {
                out[n++] = b[i];
            }
        }
        assembly { mstore(out, n) }
        return out;
    }
}
