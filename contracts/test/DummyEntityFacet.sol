// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import '../base/IDiamondFacet.sol';
import '../base/IEntityCoreFacet.sol';
import '../base/IEntityFundingFacet.sol';
import '../base/IEntitySimplePolicyFacet.sol';

contract DummyEntityFacet is IDiamondFacet, IEntityCoreFacet, IEntityFundingFacet, IEntitySimplePolicyFacet {
  function getSelectors () public pure override returns (bytes memory) {
    return abi.encodePacked(
      IEntityFundingFacet.getBalance.selector
    );
  }

  function getBalance(address /*_unit*/) public view override returns (uint256) {
    return 123;
  }

  function createPolicy(
    bytes32 _id,
    uint256[] calldata _typeAndDatesAndCommissionsBP,
    address[] calldata _unitAndTreasuryAndStakeholders,
    uint256[][] calldata _trancheData,
    bytes[] calldata _approvalSignatures
  ) external override {}

  function deposit(address _unit, uint256 _amount) external override {}
  function withdraw(address _unit, uint256 _amount) external override {}
  function payTranchePremium(address _policy, uint256 _trancheIndex, uint256 _amount) external override {}
  function trade(address _payUnit, uint256 _payAmount, address _buyUnit, uint256 _buyAmount) external override returns (uint256) {}
  function sellAtBestPrice(address _sellUnit, uint256 _sellAmount, address _buyUnit) external override {}

  function updateEnabledCurrency(address _unit, uint256 _collateralRatio, uint256 _maxCapital) external {}
  function getEnabledCurrency(address _unit) external view returns (uint256 _collateralRatio, uint256 _maxCapital) {}
  function getEnabledCurrencies() external view returns (address[] memory) {}
  function updateAllowPolicy(bool _allow) external override {}
  function allowPolicy() external override view returns (bool _allow) {}

  function createSimplePolicy (bytes32 _id, uint256 _startDate, uint256 _maturationDate, address _unit, uint256 _limit, address[] calldata _stakeholders, bytes[] calldata _approvalSignatures) external override {}
  function paySimplePremium(bytes32 _id, address _entityAddress, uint256 _amount) external override {}
  function updateAllowSimplePolicy(bool _allow) external override {}
  function allowSimplePolicy() external override view returns (bool _allow) {}
  function getNumSimplePolicies() external override view returns (uint256 _numPolicies) {}
  function getSimplePolicyId (uint256 _simplePolicyNumber) public view override returns (bytes32 _id ) {}
  function getSimplePolicyInfo (bytes32 _id) public view override returns (uint256 startDate_, uint256 maturationDate_, address unit_, uint256 limit_, uint256 state_, uint256 premiumsPaid_, uint256 claimsPaid_) {}
  function paySimpleClaim (bytes32 _id, uint256 _amount) external payable override {}
  function checkAndUpdateState (bytes32 _id ) external override {}
  function verifySimplePolicy (bytes32 _id ) external override {}
}
