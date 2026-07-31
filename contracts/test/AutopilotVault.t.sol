// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {AutopilotVault} from "../src/AutopilotVault.sol";
import {IAutopilotVault} from "../src/IAutopilotVault.sol";

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AutopilotVaultTest is Test {
    MockERC20 token;
    AutopilotVault vault;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant PERIOD = 60;
    uint256 constant LAG = 10;

    function setUp() public {
        token = new MockERC20();
        vault = new AutopilotVault(address(token), PERIOD, LAG);
        token.mint(alice, 1_000_000);
        token.mint(bob, 1_000_000);
        vm.startPrank(alice);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        token.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        vault.deposit(amount, who);
    }

    function _redeem(address who, uint256 shares) internal {
        vm.prank(who);
        vault.redeem(shares, who, who);
    }

    function test_DepositMintsSharesAndMovesAssets() public {
        _deposit(alice, 500_000);
        assertEq(vault.balanceOf(alice), 500_000);
        assertEq(vault.totalAssets(), 500_000);
        assertEq(token.balanceOf(address(vault)), 500_000);
    }

    function test_SharePriceAppreciatesWhenAssetsIncrease() public {
        _deposit(alice, 500_000);
        // Simulate accrued yield: transfer assets in outside of a deposit.
        vm.prank(bob);
        token.transfer(address(vault), 100_000);
        assertEq(vault.convertToAssets(500_000), 600_000);
    }

    function test_RedeemQueuesWithdrawalForFuturePeriod() public {
        _deposit(alice, 500_000);
        uint256 period = (block.timestamp + LAG) / PERIOD;
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit IAutopilotVault.WithdrawRequest(alice, alice, period, 500_000, 500_000);
        vault.redeem(500_000, alice, alice);

        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.assetsPendingWithdraw(), 500_000);
    }

    function test_ClaimRevertsBeforePeriodRolls() public {
        _deposit(alice, 500_000);
        uint256 period = (block.timestamp + LAG) / PERIOD;
        _redeem(alice, 500_000);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAutopilotVault.PeriodNotElapsed.selector, period));
        vault.claimWithdraw(period);
    }

    function test_FullLifecycleDepositRedeemClaim() public {
        _deposit(alice, 500_000);
        uint256 period = (block.timestamp + LAG) / PERIOD;
        _redeem(alice, 500_000);

        // Advance past the period boundary and past the lag.
        uint256 nextBoundary = ((block.timestamp / PERIOD) + 1) * PERIOD;
        vm.warp(nextBoundary + LAG + 1);

        vm.prank(alice);
        uint256 assets = vault.claimWithdraw(period);
        assertEq(assets, 500_000);
        assertEq(token.balanceOf(alice), 1_000_000);
        assertEq(vault.totalAssets(), 0);
    }

    function test_RedeemWithDifferentReceiverClaimedByReceiver() public {
        _deposit(alice, 500_000);
        uint256 period = (block.timestamp + LAG) / PERIOD;
        vm.prank(alice);
        vault.redeem(500_000, bob, alice);

        uint256 nextBoundary = ((block.timestamp / PERIOD) + 1) * PERIOD;
        vm.warp(nextBoundary + LAG + 1);

        vm.prank(bob);
        uint256 assets = vault.claimWithdraw(period);
        assertEq(assets, 500_000);
        assertEq(token.balanceOf(bob), 1_500_000);
    }

    function test_CannotClaimOtherPeoplesPeriod() public {
        _deposit(alice, 500_000);
        uint256 period = (block.timestamp + LAG) / PERIOD;
        _redeem(alice, 500_000);
        uint256 nextBoundary = ((block.timestamp / PERIOD) + 1) * PERIOD;
        vm.warp(nextBoundary + LAG + 1);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAutopilotVault.NothingPending.selector, period));
        vault.claimWithdraw(period);
    }

    function test_PendingWithdrawalDoesNotInflateSharePrice() public {
        _deposit(alice, 500_000);
        _redeem(alice, 250_000);
        // Pending assets excluded from totalAssets, so remaining shares still price 1:1.
        assertEq(vault.convertToAssets(250_000), 250_000);
    }
}
