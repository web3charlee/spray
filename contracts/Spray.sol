// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Spray is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Mode {
        LIVE,
        POT
    }

    enum Status {
        OPEN,
        CLOSED,
        CANCELLED,
        SETTLED
    }

    struct Event {
        string name;
        address host;
        address[] recipients;
        uint16[] sharesBps;
        Mode mode;
        Status status;
        uint256 unlockAt;
        uint256 ngnPerUsd;
        uint256 totalSprayed;
    }

    error ZeroAddress();
    error InvalidName();
    error InvalidDisplayName();
    error InvalidRecipients();
    error InvalidShares();
    error InvalidMode();
    error InvalidUnlockAt();
    error InvalidRate();
    error AmountOutOfRange();
    error EventCapExceeded();
    error EventNotFound();
    error NotOpen();
    error NotHost();
    error NotPOT();
    error NotLIVE();
    error TooEarly();
    error TooLate();
    error AlreadySettled();
    error NothingToRefund();
    error NothingToWithdraw();
    error NotCancelled();

    event EventCreated(
        uint256 indexed eventId,
        address indexed host,
        string name,
        Mode mode,
        uint256 unlockAt,
        uint256 ngnPerUsd
    );
    event Sprayed(
        uint256 indexed eventId,
        address indexed from,
        string displayName,
        uint256 amount,
        uint256 timestamp
    );
    event Settled(uint256 indexed eventId, uint256 totalAmount);
    event EventCancelled(uint256 indexed eventId);
    event EventClosed(uint256 indexed eventId);
    event Refunded(uint256 indexed eventId, address indexed contributor, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    uint256 public constant MIN_SPRAY = 0.10e6;
    uint256 public constant MAX_SPRAY = 20e6;
    uint256 public constant EVENT_CAP = 200e6;
    uint256 public constant MAX_UNLOCK_DELAY = 90 days;
    uint16 public constant BPS_TOTAL = 10_000;

    mapping(uint256 => Event) public events;
    mapping(uint256 => mapping(address => uint256)) public contributions;
    mapping(address => uint256) public balance;

    uint256 public nextEventId;
    IERC20 public immutable usdc;

    constructor(address _usdc) {
        if (_usdc == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
    }

    function createEvent(
        string calldata name,
        address[] calldata recipients,
        uint16[] calldata sharesBps,
        Mode mode,
        uint256 unlockAt,
        uint256 ngnPerUsd
    ) external returns (uint256 eventId) {
        uint256 nameLen = bytes(name).length;
        if (nameLen == 0 || nameLen > 64) revert InvalidName();

        uint256 len = recipients.length;
        if (len == 0 || len > 10) revert InvalidRecipients();
        if (sharesBps.length != len) revert InvalidShares();

        uint256 sum;
        for (uint256 i; i < len; ++i) {
            if (recipients[i] == address(0)) revert InvalidRecipients();
            if (sharesBps[i] == 0) revert InvalidShares();

            for (uint256 j = i + 1; j < len; ++j) {
                if (recipients[i] == recipients[j]) revert InvalidRecipients();
            }

            sum += sharesBps[i];
        }

        if (sum != BPS_TOTAL) revert InvalidShares();

        if (ngnPerUsd < 100 || ngnPerUsd > 10_000) revert InvalidRate();

        uint256 normalizedUnlockAt;
        if (mode == Mode.LIVE) {
            if (unlockAt != 0) revert InvalidUnlockAt();
            normalizedUnlockAt = 0;
        } else if (mode == Mode.POT) {
            if (unlockAt <= block.timestamp || unlockAt > block.timestamp + MAX_UNLOCK_DELAY) {
                revert InvalidUnlockAt();
            }
            normalizedUnlockAt = unlockAt;
        } else {
            revert InvalidMode();
        }

        eventId = nextEventId;
        unchecked {
            nextEventId = eventId + 1;
        }

        Event storage e = events[eventId];
        e.name = name;
        e.host = msg.sender;
        e.recipients = recipients;
        e.sharesBps = sharesBps;
        e.mode = mode;
        e.status = Status.OPEN;
        e.unlockAt = normalizedUnlockAt;
        e.ngnPerUsd = ngnPerUsd;

        emit EventCreated(eventId, msg.sender, name, mode, normalizedUnlockAt, ngnPerUsd);
    }

    function spray(uint256 eventId, uint256 amount, string calldata displayName) external nonReentrant {
        uint256 displayLen = bytes(displayName).length;
        if (displayLen == 0 || displayLen > 32) revert InvalidDisplayName();
        if (amount < MIN_SPRAY || amount > MAX_SPRAY) revert AmountOutOfRange();

        Event storage e = events[eventId];
        if (e.host == address(0)) revert EventNotFound();
        if (e.status != Status.OPEN) revert NotOpen();

        uint256 newTotal = e.totalSprayed + amount;
        if (newTotal > EVENT_CAP) revert EventCapExceeded();

        if (e.mode == Mode.POT) {
            if (block.timestamp >= e.unlockAt) revert TooLate();
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        e.totalSprayed = newTotal;

        if (e.mode == Mode.LIVE) {
            _creditRecipients(e.recipients, e.sharesBps, amount);
        } else if (e.mode == Mode.POT) {
            contributions[eventId][msg.sender] += amount;
        } else {
            revert InvalidMode();
        }

        emit Sprayed(eventId, msg.sender, displayName, amount, block.timestamp);
    }

    function settle(uint256 eventId) external nonReentrant {
        Event storage e = events[eventId];

        if (e.host == address(0)) revert EventNotFound();
        if (e.mode != Mode.POT) revert NotPOT();
        if (e.status == Status.SETTLED) revert AlreadySettled();
        if (e.status != Status.OPEN) revert NotOpen();
        if (block.timestamp < e.unlockAt) revert TooEarly();

        e.status = Status.SETTLED;
        _creditRecipients(e.recipients, e.sharesBps, e.totalSprayed);

        emit Settled(eventId, e.totalSprayed);
    }

    function cancelEvent(uint256 eventId) external {
        Event storage e = events[eventId];

        if (e.host == address(0)) revert EventNotFound();
        if (msg.sender != e.host) revert NotHost();
        if (e.mode != Mode.POT) revert NotPOT();
        if (e.status != Status.OPEN) revert NotOpen();
        if (block.timestamp >= e.unlockAt) revert TooLate();

        e.status = Status.CANCELLED;
        emit EventCancelled(eventId);
    }

    function closeEvent(uint256 eventId) external {
        Event storage e = events[eventId];

        if (e.host == address(0)) revert EventNotFound();
        if (msg.sender != e.host) revert NotHost();
        if (e.mode != Mode.LIVE) revert NotLIVE();
        if (e.status != Status.OPEN) revert NotOpen();

        e.status = Status.CLOSED;
        emit EventClosed(eventId);
    }

    function refund(uint256 eventId) external nonReentrant {
        Event storage e = events[eventId];

        if (e.host == address(0)) revert EventNotFound();
        if (e.mode != Mode.POT) revert NotPOT();
        if (e.status != Status.CANCELLED) revert NotCancelled();

        uint256 amount = contributions[eventId][msg.sender];
        if (amount == 0) revert NothingToRefund();

        contributions[eventId][msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Refunded(eventId, msg.sender, amount);
    }

    function withdraw() external nonReentrant {
        uint256 amount = balance[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        balance[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function getEvent(uint256 eventId) external view returns (Event memory) {
        return events[eventId];
    }

    function getContribution(uint256 eventId, address contributor) external view returns (uint256) {
        return contributions[eventId][contributor];
    }

    function _creditRecipients(address[] storage recipients, uint16[] storage sharesBps, uint256 amount) internal {
        uint256 len = recipients.length;
        uint256 distributed;

        for (uint256 i; i < len; ++i) {
            uint256 share = (amount * sharesBps[i]) / BPS_TOTAL;
            distributed += share;
            balance[recipients[i]] += share;
        }

        uint256 dust = amount - distributed;
        if (dust > 0) {
            balance[recipients[0]] += dust;
        }
    }
}
