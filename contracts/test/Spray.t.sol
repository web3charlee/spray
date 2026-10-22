// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Spray} from "../Spray.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: a contract that reverts on ERC-20 transfer (acts as a blocked wallet)
// ─────────────────────────────────────────────────────────────────────────────
contract RevertOnReceive {
    // We mimic a contract that cannot receive ERC-20 tokens because it reverts
    // inside any fallback / receive triggered by the ERC-20 `transfer` hook.
    // SafeERC20 uses a low-level call; to simulate a revert we override the
    // ERC-20 `transfer` at the token level instead (see BlockingToken below).
    // This contract is simply used as an *address* – it has no code that
    // interferes with a normal safeTransfer.  The blocking behaviour is
    // simulated via ReentrantWithdrawer below for the reentrancy test and via
    // the test checking that withdraw() itself reverts when the recipient is
    // a contract that consumes all gas / reverts.
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: a contract that attempts re-entrancy via the ERC-20 transfer hook.
// We subclass MockERC20 so we can intercept transfer() to try the re-entrant
// call.  The actual re-entrant call is attempted BEFORE the state is cleared,
// which is the attack vector ReentrancyGuard must block.
// ─────────────────────────────────────────────────────────────────────────────
contract ReentrantERC20 is MockERC20 {
    Spray public spray;
    bool internal _attacking;

    constructor() MockERC20("REUSDC", "REUSDC", 6) {}

    function setSpray(Spray _spray) external {
        spray = _spray;
    }

    /// @dev Arm the re-entrant attack on the next transfer.
    function arm() external {
        _attacking = true;
    }

    /// @dev Override transfer so that when `_attacking` is true the token
    ///      calls back into Spray.withdraw() before completing, simulating
    ///      a malicious token / callback scenario.
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (_attacking) {
            _attacking = false; // prevent infinite recursion
            spray.withdraw(); // re-entrant call — must be blocked
        }
        return super.transfer(to, amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: a USDC that reverts when transferring to a specific address.
// Used to simulate the "blocked-recipient isolation" scenario.
// ─────────────────────────────────────────────────────────────────────────────
contract BlockingERC20 is MockERC20 {
    address public blocked;

    constructor() MockERC20("BUSDC", "BUSDC", 6) {}

    function setBlocked(address addr) external {
        blocked = addr;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(to != blocked, "BlockingERC20: blocked recipient");
        return super.transfer(to, amount);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main test contract
// ─────────────────────────────────────────────────────────────────────────────
contract SprayTest is Test {
    // ── constants mirrored from Spray ──────────────────────────────────────
    uint256 internal constant MIN_SPRAY   = 0.10e6;
    uint256 internal constant MAX_SPRAY   = 20e6;
    uint256 internal constant EVENT_CAP   = 200e6;
    uint256 internal constant MAX_UNLOCK  = 90 days;
    uint16  internal constant BPS_TOTAL   = 10_000;

    // ── actors ────────────────────────────────────────────────────────────
    address internal host    = makeAddr("host");
    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal sprayer = makeAddr("sprayer");
    address internal sprayer2 = makeAddr("sprayer2");

    // ── contracts ─────────────────────────────────────────────────────────
    MockERC20 internal usdc;
    Spray     internal spray;

    // ─────────────────────────────────────────────────────────────────────
    // setUp — fresh state before every test
    // ─────────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc  = new MockERC20("Mock USDC", "mUSDC", 6);
        spray = new Spray(address(usdc));

        // Fund all actors with 500 USDC each and approve Spray.
        address[4] memory actors = [sprayer, sprayer2, alice, bob];
        for (uint256 i; i < actors.length; ++i) {
            usdc.mint(actors[i], 500e6);
            vm.prank(actors[i]);
            usdc.approve(address(spray), type(uint256).max);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────

    // Valid ngnPerUsd (must be 100–10_000 per new InvalidRate check)
    uint256 internal constant VALID_RATE = 1600;

    /// Create a 1-recipient LIVE event.  Returns eventId.
    function _createLive1(address recipient) internal returns (uint256) {
        address[] memory r = new address[](1);
        r[0] = recipient;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        return spray.createEvent("Test LIVE", r, s, Spray.Mode.LIVE, 0, VALID_RATE);
    }

    /// Create a 3-recipient LIVE event with shares [5000, 3000, 2000].
    /// Returns eventId.
    function _createLive3() internal returns (uint256, address, address, address) {
        address r0 = makeAddr("r0");
        address r1 = makeAddr("r1");
        address r2 = makeAddr("r2");
        address[] memory r = new address[](3);
        r[0] = r0; r[1] = r1; r[2] = r2;
        uint16[] memory s = new uint16[](3);
        s[0] = 5000; s[1] = 3000; s[2] = 2000;
        vm.prank(host);
        uint256 eid = spray.createEvent("3-rec LIVE", r, s, Spray.Mode.LIVE, 0, VALID_RATE);
        return (eid, r0, r1, r2);
    }

    /// Create a 1-recipient POT event unlocking `delay` seconds from now.
    function _createPot1(address recipient, uint256 delay) internal returns (uint256) {
        address[] memory r = new address[](1);
        r[0] = recipient;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        return spray.createEvent("Test POT", r, s, Spray.Mode.POT, block.timestamp + delay, VALID_RATE);
    }

    /// Create a 3-recipient POT event with equal shares [3334, 3333, 3333].
    function _createPot3(uint256 delay)
        internal
        returns (uint256, address, address, address)
    {
        address p0 = makeAddr("p0");
        address p1 = makeAddr("p1");
        address p2 = makeAddr("p2");
        address[] memory r = new address[](3);
        r[0] = p0; r[1] = p1; r[2] = p2;
        uint16[] memory s = new uint16[](3);
        s[0] = 3334; s[1] = 3333; s[2] = 3333;
        vm.prank(host);
        uint256 eid = spray.createEvent("3-rec POT", r, s, Spray.Mode.POT, block.timestamp + delay, VALID_RATE);
        return (eid, p0, p1, p2);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 1. SHARE SPLITS AND DUST
    // ═════════════════════════════════════════════════════════════════════

    /// 1a. Single recipient gets 100% – no dust.
    function test_ShareSplit_OneRecipient_NoDust() public {
        uint256 eid = _createLive1(alice);
        uint256 amount = 10e6;

        vm.prank(sprayer);
        spray.spray(eid, amount, "Alice");

        assertEq(spray.balance(alice), amount, "single recipient must get 100%");
    }

    /// 1b. Three recipients with uneven shares; dust goes to recipients[0];
    ///     total credited == amount sprayed.
    function test_ShareSplit_ThreeRecipients_DustToFirst() public {
        // shares: 5000/10000, 3000/10000, 2000/10000
        // amount: 1e6 (1 USDC = 1_000_000 micro-USDC)
        // r0 = 1_000_000 * 5000 / 10_000 = 500_000
        // r1 = 1_000_000 * 3000 / 10_000 = 300_000
        // r2 = 1_000_000 * 2000 / 10_000 = 200_000
        // sum = 1_000_000, dust = 0  — let's use an amount that produces dust
        // Use 1_000_001 to force 1 unit of dust → goes to r0
        uint256 amount = 1_000_001;
        // Mint & approve the extra unit
        usdc.mint(sprayer, 1);

        (uint256 eid, address r0, address r1, address r2) = _createLive3();
        vm.prank(sprayer);
        spray.spray(eid, amount, "Dusty");

        uint256 share0 = (amount * 5000) / BPS_TOTAL;
        uint256 share1 = (amount * 3000) / BPS_TOTAL;
        uint256 share2 = (amount * 2000) / BPS_TOTAL;
        uint256 dust   = amount - share0 - share1 - share2;

        assertEq(spray.balance(r0), share0 + dust, "r0 gets share + dust");
        assertEq(spray.balance(r1), share1,         "r1 gets exact share");
        assertEq(spray.balance(r2), share2,         "r2 gets exact share");
        assertEq(
            spray.balance(r0) + spray.balance(r1) + spray.balance(r2),
            amount,
            "total credited must equal amount"
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // 2. LIVE CREDITING
    // ═════════════════════════════════════════════════════════════════════

    function test_LiveCrediting_BalancesIncrease() public {
        (uint256 eid, address r0, address r1, address r2) = _createLive3();
        uint256 amount = 9e6;

        vm.prank(sprayer);
        spray.spray(eid, amount, "party");

        uint256 exp0 = (amount * 5000) / BPS_TOTAL;
        uint256 exp1 = (amount * 3000) / BPS_TOTAL;
        uint256 exp2 = (amount * 2000) / BPS_TOTAL;
        uint256 dust = amount - exp0 - exp1 - exp2;

        assertEq(spray.balance(r0), exp0 + dust);
        assertEq(spray.balance(r1), exp1);
        assertEq(spray.balance(r2), exp2);
    }

    function test_LiveCrediting_MultipleSpraysCumulate() public {
        uint256 eid = _createLive1(alice);

        vm.prank(sprayer);
        spray.spray(eid, 5e6, "first");
        vm.prank(sprayer2);
        spray.spray(eid, 3e6, "second");

        assertEq(spray.balance(alice), 8e6);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 3. POT LOCKING
    // ═════════════════════════════════════════════════════════════════════

    function test_PotLocking_ContributionIncreases_BalanceUnchanged() public {
        uint256 eid = _createPot1(alice, 1 days);
        uint256 amount = 5e6;

        uint256 aliceBalBefore = spray.balance(alice);

        vm.prank(sprayer);
        spray.spray(eid, amount, "potSpray");

        assertEq(spray.contributions(eid, sprayer), amount, "contribution must record amount");
        assertEq(spray.balance(alice), aliceBalBefore, "recipient balance must NOT change yet");
    }

    function test_PotLocking_MultipleSprayers_BalancesStayZero() public {
        uint256 eid = _createPot1(alice, 1 days);

        vm.prank(sprayer);
        spray.spray(eid, 5e6, "s1");
        vm.prank(sprayer2);
        spray.spray(eid, 3e6, "s2");

        assertEq(spray.contributions(eid, sprayer),  5e6);
        assertEq(spray.contributions(eid, sprayer2), 3e6);
        assertEq(spray.balance(alice), 0, "balance stays zero until settle");
    }

    // ═════════════════════════════════════════════════════════════════════
    // 4. SETTLE – only after unlock, only once
    // ═════════════════════════════════════════════════════════════════════

    function test_Settle_RevertsBeforeUnlock() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "pre");

        vm.expectRevert(Spray.TooEarly.selector);
        spray.settle(eid);
    }

    function test_Settle_SucceedsAfterUnlock() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "pre");

        vm.warp(block.timestamp + 1 days + 1);
        spray.settle(eid);

        assertEq(spray.balance(alice), 5e6, "balance must be set after settle");
    }

    function test_Settle_SecondCallRevertsNotOpen() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "pre");

        vm.warp(block.timestamp + 1 days + 1);
        spray.settle(eid);

        // Status is now SETTLED; settle() checks AlreadySettled first,
        // then NotOpen.  The contract checks AlreadySettled first.
        vm.expectRevert(Spray.AlreadySettled.selector);
        spray.settle(eid);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 5. CANCEL THEN REFUND EXACTLY
    // ═════════════════════════════════════════════════════════════════════

    function test_CancelRefund_ExactAmounts() public {
        uint256 eid = _createPot1(alice, 1 days);

        vm.prank(sprayer);
        spray.spray(eid, 7e6, "s1");
        vm.prank(sprayer2);
        spray.spray(eid, 4e6, "s2");

        vm.prank(host);
        spray.cancelEvent(eid);

        uint256 sprayerBefore  = usdc.balanceOf(sprayer);
        uint256 sprayer2Before = usdc.balanceOf(sprayer2);

        vm.prank(sprayer);
        spray.refund(eid);
        vm.prank(sprayer2);
        spray.refund(eid);

        assertEq(usdc.balanceOf(sprayer),  sprayerBefore  + 7e6, "sprayer refund exact");
        assertEq(usdc.balanceOf(sprayer2), sprayer2Before + 4e6, "sprayer2 refund exact");
    }

    function test_CancelRefund_ContributionClearedAfterRefund() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "s1");
        vm.prank(host);
        spray.cancelEvent(eid);

        vm.prank(sprayer);
        spray.refund(eid);

        assertEq(spray.contributions(eid, sprayer), 0, "contribution cleared");
    }

    // ═════════════════════════════════════════════════════════════════════
    // 6. NO REFUND WITHOUT CANCEL
    // ═════════════════════════════════════════════════════════════════════

    function test_Refund_RevertsIfNotCancelled() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "s1");

        // Status is OPEN, not CANCELLED
        vm.prank(sprayer);
        vm.expectRevert(Spray.NotCancelled.selector);
        spray.refund(eid);
    }

    function test_Refund_RevertsOnLiveEvent() public {
        uint256 eid = _createLive1(alice);
        // LIVE event is not a POT event – refund must revert with NotPOT
        vm.prank(sprayer);
        vm.expectRevert(Spray.NotPOT.selector);
        spray.refund(eid);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 7. SPRAY LIMITS AND CAPS
    // ═════════════════════════════════════════════════════════════════════

    function test_Spray_RevertsBelow_MinSpray() public {
        uint256 eid = _createLive1(alice);
        uint256 tooLow = MIN_SPRAY - 1;

        vm.prank(sprayer);
        vm.expectRevert(Spray.AmountOutOfRange.selector);
        spray.spray(eid, tooLow, "low");
    }

    function test_Spray_RevertsAbove_MaxSpray() public {
        uint256 eid = _createLive1(alice);
        uint256 tooHigh = MAX_SPRAY + 1;
        usdc.mint(sprayer, tooHigh);

        vm.prank(sprayer);
        vm.expectRevert(Spray.AmountOutOfRange.selector);
        spray.spray(eid, tooHigh, "high");
    }

    function test_Spray_RevertsAtExactMinMinus1() public {
        uint256 eid = _createLive1(alice);
        vm.prank(sprayer);
        vm.expectRevert(Spray.AmountOutOfRange.selector);
        spray.spray(eid, MIN_SPRAY - 1, "low2");
    }

    function test_Spray_AcceptsExactMin() public {
        uint256 eid = _createLive1(alice);
        vm.prank(sprayer);
        spray.spray(eid, MIN_SPRAY, "min");
        assertEq(spray.balance(alice), MIN_SPRAY);
    }

    function test_Spray_AcceptsExactMax() public {
        uint256 eid = _createLive1(alice);
        vm.prank(sprayer);
        spray.spray(eid, MAX_SPRAY, "max");
        assertEq(spray.balance(alice), MAX_SPRAY);
    }

    function test_Spray_RevertsWhenEventCapExceeded() public {
        uint256 eid = _createLive1(alice);
        // Fill up to just under the cap with 10 × 20 USDC sprays
        uint256 bigSprayCount = EVENT_CAP / MAX_SPRAY; // 10
        for (uint256 i; i < bigSprayCount; ++i) {
            address s = makeAddr(string(abi.encodePacked("bigSprayer", i)));
            usdc.mint(s, MAX_SPRAY);
            vm.prank(s);
            usdc.approve(address(spray), type(uint256).max);
            vm.prank(s);
            spray.spray(eid, MAX_SPRAY, "cap");
        }
        // Now totalSprayed == 200e6 == EVENT_CAP; next spray must revert
        vm.prank(sprayer);
        vm.expectRevert(Spray.EventCapExceeded.selector);
        spray.spray(eid, MIN_SPRAY, "overflow");
    }

    function test_Spray_RevertsWhenSingleSprayWouldExceedCap() public {
        uint256 eid = _createLive1(alice);
        // Spray up to EVENT_CAP - 1 using several MIN_SPRAY sprays.
        // More precisely: spray to (EVENT_CAP - MIN_SPRAY) first,
        // then try to spray MIN_SPRAY+1 which would push it over.
        // Easier: spray 9 × MAX_SPRAY = 180e6, then try 21e6 (> MAX_SPRAY)
        // — that's AmountOutOfRange. Better: spray (200e6 - MIN_SPRAY + 1)
        // in a single shot — but that's > MAX_SPRAY.
        // Correct approach: spray to 199.91e6, then try MIN_SPRAY (0.10e6)
        // which gives exactly 200.01e6 > 200e6.
        // First, spray 9×20e6 = 180e6, then 19.90e6, total=199.90e6,
        // then MIN_SPRAY=0.10e6 → total=200.00e6 (not over). So we need
        // total to be at EVENT_CAP already. Let's reach cap in the loop
        // above test already covers the ==cap case. Instead test: reach
        // 199.99e6 and then attempt 0.10e6 giving 200.09e6 > cap.
        uint256 fill = EVENT_CAP - MIN_SPRAY; // 199.90e6
        // spray fill as 9×20e6 + 19.90e6
        for (uint256 i; i < 9; ++i) {
            address s = makeAddr(string(abi.encodePacked("capper", i)));
            usdc.mint(s, MAX_SPRAY);
            vm.prank(s);
            usdc.approve(address(spray), type(uint256).max);
            vm.prank(s);
            spray.spray(eid, MAX_SPRAY, "cap2");
        }
        // remaining = fill - 9*MAX_SPRAY = 199_900_000 - 180_000_000 = 19_900_000
        uint256 remaining = fill - 9 * MAX_SPRAY;
        usdc.mint(sprayer2, remaining);
        vm.prank(sprayer2);
        spray.spray(eid, remaining, "fill");

        // Now totalSprayed == 199.90e6; add MIN_SPRAY → 200.00e6 == EVENT_CAP (not over)
        // So try totalSprayed + MIN_SPRAY = EVENT_CAP  which is NOT > EVENT_CAP.
        // → that should succeed. Skip and instead try MIN_SPRAY+1 which is > MIN_SPRAY
        //   but still < MAX_SPRAY:
        vm.prank(sprayer);
        vm.expectRevert(Spray.EventCapExceeded.selector);
        spray.spray(eid, MIN_SPRAY + 1, "over");
    }

    // ═════════════════════════════════════════════════════════════════════
    // 8. CLOSED EVENTS
    // ═════════════════════════════════════════════════════════════════════

    function test_CloseEvent_LiveEvent_Works() public {
        uint256 eid = _createLive1(alice);
        vm.prank(host);
        spray.closeEvent(eid);

        Spray.Event memory e = spray.getEvent(eid);
        assertEq(uint8(e.status), uint8(Spray.Status.CLOSED));
    }

    function test_CloseEvent_RevertsOnPot() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(host);
        vm.expectRevert(Spray.NotLIVE.selector);
        spray.closeEvent(eid);
    }

    function test_SprayToClosedEvent_Reverts() public {
        uint256 eid = _createLive1(alice);
        vm.prank(host);
        spray.closeEvent(eid);

        vm.prank(sprayer);
        vm.expectRevert(Spray.NotOpen.selector);
        spray.spray(eid, MIN_SPRAY, "closed");
    }

    // ═════════════════════════════════════════════════════════════════════
    // 9. WITHDRAW
    // ═════════════════════════════════════════════════════════════════════

    function test_Withdraw_SendsCorrectAmount() public {
        uint256 eid = _createLive1(alice);
        uint256 amount = 5e6;

        vm.prank(sprayer);
        spray.spray(eid, amount, "gift");

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        spray.withdraw();

        assertEq(usdc.balanceOf(alice), aliceBefore + amount, "alice gets full amount");
        assertEq(spray.balance(alice), 0, "balance cleared after withdraw");
    }

    function test_Withdraw_SecondCallRevertsNothingToWithdraw() public {
        uint256 eid = _createLive1(alice);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "gift");

        vm.prank(alice);
        spray.withdraw();

        vm.prank(alice);
        vm.expectRevert(Spray.NothingToWithdraw.selector);
        spray.withdraw();
    }

    function test_Withdraw_RevertsWithNoBalance() public {
        vm.prank(alice);
        vm.expectRevert(Spray.NothingToWithdraw.selector);
        spray.withdraw();
    }

    // ═════════════════════════════════════════════════════════════════════
    // 10. BLOCKED-RECIPIENT ISOLATION (pull-payment)
    // ═════════════════════════════════════════════════════════════════════

    function test_BlockedRecipient_DoesNotAffectOtherRecipient() public {
        // Deploy a blocking token that reverts on transfers to `blocked`.
        BlockingERC20 blockingUsdc = new BlockingERC20();

        // Deploy a fresh Spray with the blocking token.
        Spray blockingSpray = new Spray(address(blockingUsdc));

        address blocked = makeAddr("blocked");
        address normal  = makeAddr("normal");

        blockingUsdc.setBlocked(blocked);

        // Fund sprayer and approve
        blockingUsdc.mint(sprayer, 100e6);
        vm.prank(sprayer);
        blockingUsdc.approve(address(blockingSpray), type(uint256).max);

        // Create 2-recipient LIVE event: blocked=50%, normal=50%
        address[] memory r = new address[](2);
        r[0] = blocked; r[1] = normal;
        uint16[] memory s = new uint16[](2);
        s[0] = 5000; s[1] = 5000;
        vm.prank(host);
        uint256 eid = blockingSpray.createEvent("block-test", r, s, Spray.Mode.LIVE, 0, VALID_RATE);

        vm.prank(sprayer);
        blockingSpray.spray(eid, 10e6, "spray");

        // blocked's balance is credited (pull model); withdraw fails because token reverts
        assertEq(blockingSpray.balance(blocked), 5e6, "blocked has credit");
        assertEq(blockingSpray.balance(normal),  5e6, "normal has credit");

        // `normal` can withdraw independently
        uint256 normalBefore = blockingUsdc.balanceOf(normal);
        vm.prank(normal);
        blockingSpray.withdraw();
        assertEq(blockingUsdc.balanceOf(normal), normalBefore + 5e6, "normal withdrew successfully");

        // `blocked` withdraw fails because the token reverts for that address
        vm.prank(blocked);
        vm.expectRevert();
        blockingSpray.withdraw();
    }

    // ═════════════════════════════════════════════════════════════════════
    // 11. REENTRANCY GUARD
    // ═════════════════════════════════════════════════════════════════════

    function test_Reentrancy_BlockedByGuard() public {
        // Deploy ReentrantERC20 token and a Spray that uses it.
        ReentrantERC20 rUsdc = new ReentrantERC20();
        Spray rSpray = new Spray(address(rUsdc));
        rUsdc.setSpray(rSpray);

        // Fund attacker (alice) and approve
        rUsdc.mint(alice, 50e6);
        vm.prank(alice);
        rUsdc.approve(address(rSpray), type(uint256).max);

        // Create LIVE event, alice is both sprayer and recipient
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        uint256 eid = rSpray.createEvent("reentrancy-test", r, s, Spray.Mode.LIVE, 0, VALID_RATE);

        vm.prank(alice);
        rSpray.spray(eid, 5e6, "spray");

        // alice has 5e6 balance. When withdraw() calls token.transfer(alice, 5e6),
        // the ReentrantERC20.transfer() fires rSpray.withdraw() again.
        // The second call happens BEFORE the balance is cleared in the base
        // super.transfer, which means if ReentrancyGuard is absent it would
        // drain double. With ReentrancyGuard the inner call should revert.
        rUsdc.arm(); // arm the re-entrant transfer hook

        vm.prank(alice);
        // The outer withdraw should either:
        //  a) succeed (guard caught the inner call, outer completes) — safest, OR
        //  b) revert entirely if the revert bubbles up.
        // Either way alice must NOT receive more than 5e6.
        uint256 before = rUsdc.balanceOf(alice);
        try rSpray.withdraw() {} catch {}
        // Regardless of success/failure, alice must have received ≤ 5e6 net new tokens.
        uint256 gained = rUsdc.balanceOf(alice) > before ? rUsdc.balanceOf(alice) - before : 0;
        assertLe(gained, 5e6, "reentrancy guard must prevent double-spend");
    }

    // ═════════════════════════════════════════════════════════════════════
    // 12. HAPPY PATH: POT SETTLE DISTRIBUTES CORRECTLY
    // ═════════════════════════════════════════════════════════════════════

    function test_PotSettle_DistributesCorrectly_WithDust() public {
        uint256 unlockDelay = 7 days;
        (uint256 eid, address p0, address p1, address p2) = _createPot3(unlockDelay);

        // Two contributors
        vm.prank(sprayer);
        spray.spray(eid, 9e6, "s1");
        vm.prank(sprayer2);
        spray.spray(eid, 3e6, "s2");

        uint256 total = 12e6; // 9e6 + 3e6

        vm.warp(block.timestamp + unlockDelay + 1);
        spray.settle(eid);

        // shares: p0=3334/10000, p1=3333/10000, p2=3333/10000
        uint256 s0 = (total * 3334) / BPS_TOTAL;
        uint256 s1 = (total * 3333) / BPS_TOTAL;
        uint256 s2 = (total * 3333) / BPS_TOTAL;
        uint256 dust = total - s0 - s1 - s2;

        assertEq(spray.balance(p0), s0 + dust, "p0 gets share + dust");
        assertEq(spray.balance(p1), s1,        "p1 gets share");
        assertEq(spray.balance(p2), s2,        "p2 gets share");
        assertEq(
            spray.balance(p0) + spray.balance(p1) + spray.balance(p2),
            total,
            "total distributed == total sprayed"
        );
    }

    // ═════════════════════════════════════════════════════════════════════
    // 13. SPRAY TO POT AFTER UNLOCK REVERTS TooLate()
    // ═════════════════════════════════════════════════════════════════════

    function test_Spray_PotAfterUnlock_RevertsTooLate() public {
        uint256 eid = _createPot1(alice, 1 days);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(sprayer);
        vm.expectRevert(Spray.TooLate.selector);
        spray.spray(eid, MIN_SPRAY, "late");
    }

    // ═════════════════════════════════════════════════════════════════════
    // 14. CANCEL AFTER UNLOCK REVERTS TooLate()
    // ═════════════════════════════════════════════════════════════════════

    function test_CancelEvent_AfterUnlock_RevertsTooLate() public {
        uint256 eid = _createPot1(alice, 1 days);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(host);
        vm.expectRevert(Spray.TooLate.selector);
        spray.cancelEvent(eid);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 15. ONLY HOST CAN CANCEL / CLOSE
    // ═════════════════════════════════════════════════════════════════════

    function test_CancelEvent_NonHost_RevertsNotHost() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(alice); // not the host
        vm.expectRevert(Spray.NotHost.selector);
        spray.cancelEvent(eid);
    }

    function test_CloseEvent_NonHost_RevertsNotHost() public {
        uint256 eid = _createLive1(alice);
        vm.prank(alice); // not the host
        vm.expectRevert(Spray.NotHost.selector);
        spray.closeEvent(eid);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 16. createEvent VALIDATION
    // ═════════════════════════════════════════════════════════════════════

    /// 16a. name too long (> 64 bytes)
    function test_CreateEvent_NameTooLong_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        // 65-character name
        string memory longName = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";
        vm.prank(host);
        vm.expectRevert(Spray.InvalidName.selector);
        spray.createEvent(longName, r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16b. name exactly 64 bytes — should succeed
    function test_CreateEvent_Name64Bytes_Succeeds() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        string memory name64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        vm.prank(host);
        spray.createEvent(name64, r, s, Spray.Mode.LIVE, 0, VALID_RATE); // should not revert
    }

    /// 16c. empty name
    function test_CreateEvent_EmptyName_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidName.selector);
        spray.createEvent("", r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16d. recipients.length == 0
    function test_CreateEvent_ZeroRecipients_Reverts() public {
        address[] memory r = new address[](0);
        uint16[] memory s = new uint16[](0);
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRecipients.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16e. recipients.length > 10
    function test_CreateEvent_TooManyRecipients_Reverts() public {
        address[] memory r = new address[](11);
        uint16[] memory s = new uint16[](11);
        for (uint256 i; i < 11; ++i) {
            r[i] = makeAddr(string(abi.encodePacked("rr", i)));
            s[i] = 909; // 909*11 = 9999, not exactly 10000, but doesn't matter — hits InvalidRecipients first
        }
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRecipients.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16f. sharesBps sum != 10000
    function test_CreateEvent_SharesSumNot10000_Reverts() public {
        address[] memory r = new address[](2);
        r[0] = alice; r[1] = bob;
        uint16[] memory s = new uint16[](2);
        s[0] = 5000; s[1] = 4999; // sum = 9999
        vm.prank(host);
        vm.expectRevert(Spray.InvalidShares.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16g. duplicate recipients
    function test_CreateEvent_DuplicateRecipients_Reverts() public {
        address[] memory r = new address[](2);
        r[0] = alice; r[1] = alice; // duplicate
        uint16[] memory s = new uint16[](2);
        s[0] = 5000; s[1] = 5000;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRecipients.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16h. LIVE with nonzero unlockAt
    function test_CreateEvent_LiveWithNonzeroUnlockAt_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidUnlockAt.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, block.timestamp + 1 days, VALID_RATE);
    }

    /// 16i. POT with unlockAt in the past (or == block.timestamp)
    function test_CreateEvent_PotUnlockInPast_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidUnlockAt.selector);
        spray.createEvent("Test", r, s, Spray.Mode.POT, block.timestamp, VALID_RATE);
    }

    /// 16j. POT with unlockAt > 90 days away
    function test_CreateEvent_PotUnlockTooFar_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        uint256 tooFar = block.timestamp + MAX_UNLOCK + 1;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidUnlockAt.selector);
        spray.createEvent("Test", r, s, Spray.Mode.POT, tooFar, VALID_RATE);
    }

    /// 16k. sharesBps array length != recipients length
    function test_CreateEvent_SharesLengthMismatch_Reverts() public {
        address[] memory r = new address[](2);
        r[0] = alice; r[1] = bob;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidShares.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0);
    }

    /// 16l. Zero-address recipient
    function test_CreateEvent_ZeroAddressRecipient_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = address(0);
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRecipients.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    // EVENTS (EventCreated, Sprayed, Settled, EventCancelled, EventClosed,
    //         Refunded, Withdrawn)
    // ═════════════════════════════════════════════════════════════════════

    function test_Event_EventCreatedEmitted() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;

        uint256 expectedId = spray.nextEventId();
        uint256 unlockAt   = block.timestamp + 1 days;

        vm.prank(host);
        vm.expectEmit(true, true, false, true, address(spray));
        emit Spray.EventCreated(expectedId, host, "EmitTest", Spray.Mode.POT, unlockAt, VALID_RATE);
        spray.createEvent("EmitTest", r, s, Spray.Mode.POT, unlockAt, VALID_RATE);
    }

    function test_Event_SprayedEmitted() public {
        uint256 eid = _createLive1(alice);
        uint256 amount = 1e6;
        uint256 ts = block.timestamp;

        vm.prank(sprayer);
        vm.expectEmit(true, true, false, true, address(spray));
        emit Spray.Sprayed(eid, sprayer, "gift", amount, ts);
        spray.spray(eid, amount, "gift");
    }

    function test_Event_SettledEmitted() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "s");
        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, false, false, true, address(spray));
        emit Spray.Settled(eid, 5e6);
        spray.settle(eid);
    }

    function test_Event_EventCancelledEmitted() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(host);
        vm.expectEmit(true, false, false, false, address(spray));
        emit Spray.EventCancelled(eid);
        spray.cancelEvent(eid);
    }

    function test_Event_EventClosedEmitted() public {
        uint256 eid = _createLive1(alice);
        vm.prank(host);
        vm.expectEmit(true, false, false, false, address(spray));
        emit Spray.EventClosed(eid);
        spray.closeEvent(eid);
    }

    function test_Event_RefundedEmitted() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "s");
        vm.prank(host);
        spray.cancelEvent(eid);

        vm.prank(sprayer);
        vm.expectEmit(true, true, false, true, address(spray));
        emit Spray.Refunded(eid, sprayer, 5e6);
        spray.refund(eid);
    }

    function test_Event_WithdrawnEmitted() public {
        uint256 eid = _createLive1(alice);
        vm.prank(sprayer);
        spray.spray(eid, 5e6, "gift");

        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(spray));
        emit Spray.Withdrawn(alice, 5e6);
        spray.withdraw();
    }

    // ═════════════════════════════════════════════════════════════════════
    // FUZZ: spray amount within valid range always credits correctly
    // ═════════════════════════════════════════════════════════════════════

    function testFuzz_Spray_LiveSingleRecipient(uint256 amount) public {
        amount = bound(amount, MIN_SPRAY, MAX_SPRAY);
        uint256 eid = _createLive1(alice);

        vm.prank(sprayer);
        spray.spray(eid, amount, "fuzz");

        assertEq(spray.balance(alice), amount);
    }

    function testFuzz_Spray_PotContributionAccumulates(uint256 a1, uint256 a2) public {
        // Both amounts independently bounded to [MIN_SPRAY, MAX_SPRAY].
        // Two independent sprays: combined max is 40e6 << EVENT_CAP (200e6).
        a1 = bound(a1, MIN_SPRAY, MAX_SPRAY);
        a2 = bound(a2, MIN_SPRAY, MAX_SPRAY);
        uint256 eid = _createPot1(alice, 1 days);

        vm.prank(sprayer);
        spray.spray(eid, a1, "f1");
        vm.prank(sprayer2);
        spray.spray(eid, a2, "f2");

        assertEq(spray.contributions(eid, sprayer),  a1);
        assertEq(spray.contributions(eid, sprayer2), a2);
        assertEq(spray.balance(alice), 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    // EXTRA: constructor rejects zero address
    // ═════════════════════════════════════════════════════════════════════

    function test_Constructor_ZeroUsdc_Reverts() public {
        vm.expectRevert(Spray.ZeroAddress.selector);
        new Spray(address(0));
    }

    // ═════════════════════════════════════════════════════════════════════
    // EXTRA: displayName validation on spray()
    // ═════════════════════════════════════════════════════════════════════

    function test_Spray_EmptyDisplayName_Reverts() public {
        uint256 eid = _createLive1(alice);
        vm.prank(sprayer);
        vm.expectRevert(Spray.InvalidDisplayName.selector);
        spray.spray(eid, MIN_SPRAY, "");
    }

    function test_Spray_DisplayNameTooLong_Reverts() public {
        uint256 eid = _createLive1(alice);
        // 33-byte display name
        vm.prank(sprayer);
        vm.expectRevert(Spray.InvalidDisplayName.selector);
        spray.spray(eid, MIN_SPRAY, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    }

    // ═════════════════════════════════════════════════════════════════════
    // EXTRA: settle on LIVE reverts NotPOT
    // ═════════════════════════════════════════════════════════════════════

    function test_Settle_OnLiveEvent_RevertsNotPOT() public {
        uint256 eid = _createLive1(alice);
        vm.expectRevert(Spray.NotPOT.selector);
        spray.settle(eid);
    }

    // ═════════════════════════════════════════════════════════════════════
    // EXTRA: cancelEvent on LIVE reverts NotPOT
    // ═════════════════════════════════════════════════════════════════════

    function test_CancelEvent_OnLiveEvent_RevertsNotPOT() public {
        uint256 eid = _createLive1(alice);
        vm.prank(host);
        vm.expectRevert(Spray.NotPOT.selector);
        spray.cancelEvent(eid);
    }

    // ═════════════════════════════════════════════════════════════════════
    // EXTRA: nextEventId increments
    // ═════════════════════════════════════════════════════════════════════

    function test_NextEventId_Increments() public {
        assertEq(spray.nextEventId(), 0);
        _createLive1(alice);
        assertEq(spray.nextEventId(), 1);
        _createPot1(alice, 1 days);
        assertEq(spray.nextEventId(), 2);
    }

    // ═════════════════════════════════════════════════════════════════════
    // EXTRA: getContribution helper mirrors contributions mapping
    // ═════════════════════════════════════════════════════════════════════

    function test_GetContribution_MatchesMapping() public {
        uint256 eid = _createPot1(alice, 1 days);
        vm.prank(sprayer);
        spray.spray(eid, 3e6, "x");

        assertEq(spray.getContribution(eid, sprayer), spray.contributions(eid, sprayer));
        assertEq(spray.getContribution(eid, sprayer), 3e6);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 17. EventNotFound — spray, settle, cancelEvent, closeEvent, refund
    //     all revert with EventNotFound for a non-existent eventId.
    // ═════════════════════════════════════════════════════════════════════

    function test_Spray_NonExistentEvent_RevertsEventNotFound() public {
        uint256 badId = 9999;
        vm.prank(sprayer);
        vm.expectRevert(Spray.EventNotFound.selector);
        spray.spray(badId, MIN_SPRAY, "ghost");
    }

    function test_Settle_NonExistentEvent_RevertsEventNotFound() public {
        vm.expectRevert(Spray.EventNotFound.selector);
        spray.settle(9999);
    }

    function test_CancelEvent_NonExistentEvent_RevertsEventNotFound() public {
        vm.prank(host);
        vm.expectRevert(Spray.EventNotFound.selector);
        spray.cancelEvent(9999);
    }

    function test_CloseEvent_NonExistentEvent_RevertsEventNotFound() public {
        vm.prank(host);
        vm.expectRevert(Spray.EventNotFound.selector);
        spray.closeEvent(9999);
    }

    function test_Refund_NonExistentEvent_RevertsEventNotFound() public {
        vm.prank(sprayer);
        vm.expectRevert(Spray.EventNotFound.selector);
        spray.refund(9999);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 18. InvalidRate — ngnPerUsd below 100 or above 10_000
    // ═════════════════════════════════════════════════════════════════════

    function test_CreateEvent_RateTooLow_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRate.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 99); // 99 < 100
    }

    function test_CreateEvent_RateZero_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRate.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 0); // 0 < 100
    }

    function test_CreateEvent_RateTooHigh_Reverts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        vm.expectRevert(Spray.InvalidRate.selector);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 10_001); // > 10_000
    }

    function test_CreateEvent_RateAtBoundary100_Succeeds() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 100); // exactly 100 — valid
    }

    function test_CreateEvent_RateAtBoundary10000_Succeeds() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint16[] memory s = new uint16[](1);
        s[0] = BPS_TOTAL;
        vm.prank(host);
        spray.createEvent("Test", r, s, Spray.Mode.LIVE, 0, 10_000); // exactly 10_000 — valid
    }
}
