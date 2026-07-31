// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IAutopilotVault
/// @notice ERC4626-style single-asset savings vault with claimable redemption periods.
///         Modeled on the Firelight-style vault used by Flare Smart Accounts, but with a
///         configurable period duration and lag so the full redemption lifecycle can be
///         exercised quickly on testnets.
interface IAutopilotVault {
    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event WithdrawRequest(
        address indexed caller, address indexed receiver, uint256 period, uint256 assets, uint256 shares
    );
    event WithdrawalClaimed(address indexed receiver, uint256 period, uint256 assets);

    error InsufficientShares(uint256 have, uint256 want);
    error NothingPending(uint256 period);
    error PeriodNotElapsed(uint256 period);
    error LagNotElapsed(uint256 requestedAt, uint256 lag, uint256 now);
    error ZeroAmount();

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    function claimWithdraw(uint256 period) external returns (uint256 assets);

    function currentPeriod() external view returns (uint256);

    function convertToAssets(uint256 shares) external view returns (uint256);

    function previewRedeem(uint256 shares) external view returns (uint256);
}
