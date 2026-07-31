// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IAutopilotVault} from "./IAutopilotVault.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AutopilotVault
/// @notice Minimal ERC4626-style vault with claimable redemption periods, used by the
///         Autopilot product to demonstrate the full XRP savings lifecycle on Flare.
/// @dev Shares are an internal accounting token (not a real ERC20). Redemptions burn
///      shares immediately and queue assets for a future period derived from
///      `block.timestamp + lag`; `claimWithdraw` releases them once the period has rolled.
contract AutopilotVault is IAutopilotVault {
    string public constant name = "Autopilot Savings Vault";
    string public constant symbol = "aSAV";
    uint8 public constant decimals = 6;

    IERC20Minimal public immutable asset;

    uint256 public periodDuration;
    uint256 public lag;

    uint256 public totalSupply;
    uint256 public assetsPendingWithdraw;
    mapping(address account => uint256 balance) public balanceOf;

    struct Pending {
        uint256 assets;
        uint256 shares;
        uint256 timestamp;
    }
    mapping(address receiver => mapping(uint256 period => Pending)) public pendingWithdrawals;

    constructor(address _asset, uint256 _periodDuration, uint256 _lag) {
        require(_asset != address(0), "zero asset");
        require(_periodDuration > 0, "zero period");
        asset = IERC20Minimal(_asset);
        periodDuration = _periodDuration;
        lag = _lag;
    }

    function currentPeriod() public view returns (uint256) {
        return block.timestamp / periodDuration;
    }

    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this)) - assetsPendingWithdraw;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return totalSupply == 0 ? shares : (shares * totalAssets()) / totalSupply;
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets_, address receiver) external returns (uint256 shares) {
        if (assets_ == 0) revert ZeroAmount();
        shares = totalSupply == 0 ? assets_ : (assets_ * totalSupply) / totalAssets();
        bool ok = asset.transferFrom(msg.sender, address(this), assets_);
        require(ok, "transferFrom failed");
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Deposit(msg.sender, receiver, assets_, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf[owner] < shares) revert InsufficientShares(balanceOf[owner], shares);

        balanceOf[owner] -= shares;
        assets = convertToAssets(shares);
        totalSupply -= shares;
        assetsPendingWithdraw += assets;

        uint256 period = (block.timestamp + lag) / periodDuration;
        Pending storage p = pendingWithdrawals[receiver][period];
        p.assets += assets;
        p.shares += shares;
        p.timestamp = block.timestamp;

        emit WithdrawRequest(msg.sender, receiver, period, assets, shares);
    }

    function claimWithdraw(uint256 period) external returns (uint256 assets) {
        if (period >= currentPeriod()) revert PeriodNotElapsed(period);
        Pending storage p = pendingWithdrawals[msg.sender][period];
        if (p.assets == 0) revert NothingPending(period);
        if (block.timestamp < p.timestamp + lag) revert LagNotElapsed(p.timestamp, lag, block.timestamp);

        assets = p.assets;
        assetsPendingWithdraw -= assets;
        delete pendingWithdrawals[msg.sender][period];
        bool ok = asset.transfer(msg.sender, assets);
        require(ok, "transfer failed");
        emit WithdrawalClaimed(msg.sender, period, assets);
    }

    function setPeriodDuration(uint256 _periodDuration) external {
        require(_periodDuration > 0, "zero period");
        periodDuration = _periodDuration;
    }

    function setLag(uint256 _lag) external {
        lag = _lag;
    }
}
