// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TuvyyDAO} from "../contracts/TuvyyDAO.sol";

interface Vm {
    function etch(address, bytes calldata) external;
    function deal(address, uint256) external;
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}

contract MockBridge {
    bytes[] public payloads;
    string[] public targets;
    bool public failReceipt;
    bool public failPayout;
    uint256 public cw20Paid;

    function configure(bool receipt, bool payout) external {
        failReceipt = receipt;
        failPayout = payout;
    }

    function executeCrossVMCall(uint8 vmType, string calldata target, bytes calldata payload)
        external
        returns (bytes memory)
    {
        require(vmType == 1, "wrong VM");
        bool transfer = payload.length > 2 && payload[2] == "t";
        require(!(transfer ? failPayout : failReceipt), "mock failure");
        if (transfer) ++cw20Paid;
        payloads.push(payload);
        targets.push(target);
        return transfer ? bytes("") : bytes('{"id":1}');
    }

    function count() external view returns (uint256) {
        return payloads.length;
    }
}

contract ReenterRecipient {
    TuvyyDAO public dao;

    constructor(TuvyyDAO d) {
        dao = d;
    }

    receive() external payable {
        (bool ok,) = address(dao).call(abi.encodeCall(dao.execute, (uint256(1))));
        require(!ok, "reentrancy admitted");
    }
}

contract RejectRecipient {
    receive() external payable {
        revert();
    }
}

contract TuvyyDAOTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant BRIDGE = address(0x901);
    address constant BOB = address(0xb0b);
    address constant OUTSIDER = address(0xbeef);
    string constant WDT = "qor14hj2tavq8fpesdwxxcu44rty3hh90vhujrvcmstl4zr3txmfvw9s93uuqt";
    string constant RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";
    string constant RECIPIENT = "qor12phq0k9dz3z6aut2hggfc3m9y2g2v3yheaxg4y";
    TuvyyDAO dao;
    MockBridge mock;

    function setUp() public {
        vm.etch(BRIDGE, address(new MockBridge()).code);
        mock = MockBridge(BRIDGE);
        address[] memory members = new address[](2);
        members[0] = address(this);
        members[1] = BOB;
        dao = new TuvyyDAO(members, 60, 1, BRIDGE, WDT, RECEIPTS);
        vm.deal(address(dao), 10 ether);
    }

    function _proposal(TuvyyDAO.PayoutKind kind, string memory note) private returns (uint256) {
        return dao.propose(RECIPIENT, BOB, 1 ether, note, kind);
    }

    function _ready(TuvyyDAO.PayoutKind kind, string memory note) private returns (uint256 id) {
        id = _proposal(kind, note);
        dao.vote(id, true);
        vm.warp(block.timestamp + 60);
    }

    function _eq(bytes memory a, bytes memory b) private pure {
        require(keccak256(a) == keccak256(b), "payload mismatch");
    }

    function testCW20HappyExactPayloads() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.CW20, "grant");
        vm.prank(OUTSIDER);
        dao.execute(id);
        require(mock.count() == 2 && mock.cw20Paid() == 1);
        _eq(bytes(mock.targets(0)), bytes(WDT));
        _eq(bytes(mock.targets(1)), bytes(RECEIPTS));
        _eq(
            mock.payloads(0),
            abi.encodePacked('{"transfer":{"recipient":"', RECIPIENT, '","amount":"1000000000000000000"}}')
        );
        _eq(mock.payloads(1), bytes('{"record":{"note":"Tuvyy #1: CW20 1000000000000000000; grant"}}'));
        require(dao.getProposal(id).executed);
    }

    function testNativeHappyExactPayload() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "grant");
        dao.execute(id);
        require(BOB.balance == 1 ether && address(dao).balance == 9 ether && mock.count() == 1);
        _eq(mock.payloads(0), bytes('{"record":{"note":"Tuvyy #1: NATIVE 1000000000000000000; grant"}}'));
    }

    function testReceiptFailureRevertsNativePayout() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "grant");
        mock.configure(true, false);
        vm.expectRevert();
        dao.execute(id);
        require(BOB.balance == 0 && address(dao).balance == 10 ether && !dao.getProposal(id).executed);
        mock.configure(false, false);
        dao.execute(id);
        require(BOB.balance == 1 ether);
    }

    function testReceiptFailureRevertsCW20Payout() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.CW20, "grant");
        mock.configure(true, false);
        vm.expectRevert();
        dao.execute(id);
        require(mock.cw20Paid() == 0 && mock.count() == 0 && !dao.getProposal(id).executed);
    }

    function testPayoutBridgeFailure() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.CW20, "grant");
        mock.configure(false, true);
        vm.expectRevert();
        dao.execute(id);
        require(mock.count() == 0 && !dao.getProposal(id).executed);
    }

    function testDoubleExecute() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "grant");
        dao.execute(id);
        vm.expectRevert(TuvyyDAO.NotExecutable.selector);
        dao.execute(id);
    }

    function testNonMemberVoteAndPropose() public {
        uint256 id = _proposal(TuvyyDAO.PayoutKind.NATIVE, "grant");
        vm.prank(OUTSIDER);
        vm.expectRevert(TuvyyDAO.Unauthorized.selector);
        dao.vote(id, true);
        vm.prank(OUTSIDER);
        vm.expectRevert(TuvyyDAO.Unauthorized.selector);
        _proposal(TuvyyDAO.PayoutKind.NATIVE, "grant");
    }

    function testDoubleVote() public {
        uint256 id = _proposal(TuvyyDAO.PayoutKind.NATIVE, "grant");
        dao.vote(id, true);
        vm.expectRevert(TuvyyDAO.AlreadyVoted.selector);
        dao.vote(id, false);
        require(dao.hasVoted(id, address(this)) && dao.getProposal(id).yes == 1);
    }

    function testEarlyExecute() public {
        uint256 id = _proposal(TuvyyDAO.PayoutKind.NATIVE, "grant");
        dao.vote(id, true);
        vm.expectRevert(TuvyyDAO.NotExecutable.selector);
        dao.execute(id);
    }

    function testTiedVoteCannotExecute() public {
        uint256 id = _proposal(TuvyyDAO.PayoutKind.NATIVE, "grant");
        dao.vote(id, true);
        vm.prank(BOB);
        dao.vote(id, false);
        vm.warp(block.timestamp + 60);
        vm.expectRevert(TuvyyDAO.NotExecutable.selector);
        dao.execute(id);
    }

    function testNoVotesFailsQuorum() public {
        uint256 id = _proposal(TuvyyDAO.PayoutKind.NATIVE, "grant");
        vm.warp(block.timestamp + 60);
        vm.expectRevert(TuvyyDAO.NotExecutable.selector);
        dao.execute(id);
    }

    function testYesMajorityBelowQuorum() public {
        address[] memory m = new address[](2);
        m[0] = address(this);
        m[1] = BOB;
        dao = new TuvyyDAO(m, 60, 2, BRIDGE, WDT, RECEIPTS);
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "grant");
        vm.expectRevert(TuvyyDAO.NotExecutable.selector);
        dao.execute(id);
    }

    function testLateVote() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "grant");
        vm.prank(BOB);
        vm.expectRevert(TuvyyDAO.VotingClosed.selector);
        dao.vote(id, true);
    }

    function testInsufficientTreasury() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "grant");
        vm.deal(address(dao), 0);
        vm.expectRevert(TuvyyDAO.PayoutFailed.selector);
        dao.execute(id);
        require(!dao.getProposal(id).executed && mock.count() == 0);
    }

    function testRejectedNativePayment() public {
        uint256 id = dao.propose("", address(new RejectRecipient()), 1, "", TuvyyDAO.PayoutKind.NATIVE);
        dao.vote(id, true);
        vm.warp(block.timestamp + 60);
        vm.expectRevert(TuvyyDAO.PayoutFailed.selector);
        dao.execute(id);
    }

    function testReentrantExecutionRejected() public {
        uint256 id = dao.propose("", address(new ReenterRecipient(dao)), 1, "", TuvyyDAO.PayoutKind.NATIVE);
        dao.vote(id, true);
        vm.warp(block.timestamp + 60);
        dao.execute(id);
        require(dao.getProposal(id).executed);
    }

    function testEscaping() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "quote\" slash\\\n\t\r\x01");
        dao.execute(id);
        _eq(
            mock.payloads(0),
            bytes(
                '{"record":{"note":"Tuvyy #1: NATIVE 1000000000000000000; quote\\" slash\\\\\\u000a\\u0009\\u000d\\u0001"}}'
            )
        );
    }

    function testTruncation() public {
        bytes memory note = new bytes(200);
        for (uint256 i; i < 200; ++i) note[i] = "x";
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, string(note));
        dao.execute(id);
        bytes memory expected = new bytes(140);
        bytes memory prefix = bytes("Tuvyy #1: NATIVE 1000000000000000000; ");
        for (uint256 i; i < 140; ++i) expected[i] = i < prefix.length ? prefix[i] : bytes1("x");
        _eq(mock.payloads(0), abi.encodePacked('{"record":{"note":"', expected, '"}}'));
    }

    function testUnicodeTruncation() public {
        bytes memory note = new bytes(200);
        for (uint256 i; i < 200; i += 2) {
            note[i] = 0xc3;
            note[i + 1] = 0xa9;
        }
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, string(note));
        dao.execute(id);
        bytes memory payload = mock.payloads(0);
        require(payload[payload.length - 4] == 0xa9, "split unicode");
        require(payload.length <= 163);
    }

    function testEmptyNote() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "");
        dao.execute(id);
        _eq(mock.payloads(0), bytes('{"record":{"note":"Tuvyy #1: NATIVE 1000000000000000000; "}}'));
    }

    function testMembershipAndInvalidInputs() public {
        dao.setMember(BOB, false);
        require(!dao.members(BOB));
        dao.setMember(BOB, true);
        require(dao.members(BOB));
        vm.prank(BOB);
        vm.expectRevert(TuvyyDAO.Unauthorized.selector);
        dao.setMember(OUTSIDER, true);
        vm.expectRevert(TuvyyDAO.InvalidInput.selector);
        dao.propose("bad", BOB, 1, "", TuvyyDAO.PayoutKind.CW20);
        vm.expectRevert(TuvyyDAO.InvalidInput.selector);
        dao.propose("", address(0), 1, "", TuvyyDAO.PayoutKind.NATIVE);
        vm.expectRevert(TuvyyDAO.InvalidInput.selector);
        dao.propose("", BOB, 0, "", TuvyyDAO.PayoutKind.NATIVE);
        vm.expectRevert(TuvyyDAO.InvalidProposal.selector);
        dao.getProposal(0);
    }

    function testInactiveBridge() public {
        uint256 id = _ready(TuvyyDAO.PayoutKind.NATIVE, "");
        vm.etch(BRIDGE, hex"");
        vm.expectRevert(TuvyyDAO.BridgeInactive.selector);
        dao.execute(id);
        require(BOB.balance == 0);
    }
}
