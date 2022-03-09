// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "./base/SafeMath.sol";
import "./base/EternalStorage.sol";
import "./base/Controller.sol";
import "./base/IDiamondFacet.sol";
import "./base/IPolicyCoreFacet.sol";
import "./base/IPolicyPremiumsFacet.sol";
import ".//PolicyFacetBase.sol";
import "./base/AccessControl.sol";
import "./base/IERC20.sol";

/**
 * @dev Business-logic for Policy premiums
 */
contract PolicyPremiumsFacet is EternalStorage, Controller, IDiamondFacet, IPolicyPremiumsFacet, PolicyFacetBase {
  using SafeMath for uint;

  modifier assertTranchePaymentAllowed (uint256 _index) {
    uint256 _trancheState = dataUint256[__i(_index, "state")];
    require(_trancheState != TRANCHE_STATE_CANCELLED && _trancheState != TRANCHE_STATE_MATURED, 'payment not allowed');
    _;
  }

  /**
   * Constructor
   */
  constructor (address _settings) Controller(_settings) public {
    // empty
  }

  // IDiamondFacet

  function getSelectors () public pure override returns (bytes memory) {
    return abi.encodePacked(
      IPolicyPremiumsFacet.getTranchePremiumsInfo.selector,
      IPolicyPremiumsFacet.getTranchePremiumInfo.selector,
      IPolicyPremiumsFacet.payTranchePremium.selector
    );
  }

  // IPolicyPremiumsFacet

  function getTranchePremiumsInfo (uint256 _trancheIndex) public view override returns (
    uint256 numPremiums_,
    uint256 nextPremiumAmount_,
    uint256 nextPremiumDueAt_,
    uint256 nextPremiumPaidSoFar_,
    uint256 premiumPaymentsMissed_,
    uint256 numPremiumsPaid_
  ) {
    numPremiums_ = dataUint256[__i(_trancheIndex, "numPremiums")];
    (nextPremiumAmount_, nextPremiumDueAt_, nextPremiumPaidSoFar_) = _getNextTranchePremium(_trancheIndex);
    premiumPaymentsMissed_ = _getNumberOfTranchePaymentsMissed(_trancheIndex);
    numPremiumsPaid_ = dataUint256[__i(_trancheIndex, "numPremiumsPaid")];
  }

  function getTranchePremiumInfo (uint256 _trancheIndex, uint256 _premiumIndex) public view override returns (
    uint256 amount_,
    uint256 dueAt_,
    uint256 paidSoFar_,
    uint256 fullyPaidAt_
  ) {
    amount_ = dataUint256[__ii(_trancheIndex, _premiumIndex, "premiumAmount")];
    dueAt_ = dataUint256[__ii(_trancheIndex, _premiumIndex, "premiumDueAt")];
    paidSoFar_ = dataUint256[__ii(_trancheIndex, _premiumIndex, "premiumPaidSoFar")];
    fullyPaidAt_ = dataUint256[__ii(_trancheIndex, _premiumIndex, "premiumPaidAt")];
  }

  function payTranchePremium (uint256 _index, uint256 _amount) external override {
    IPolicyCoreFacet(address(this)).checkAndUpdateState();
    _payTranchePremium(_index, _amount);
  }

  // Internal methods

  function _payTranchePremium (uint256 _index, uint256 _amount) private assertTranchePaymentAllowed(_index) {
    uint256 totalPaid;
    uint256 netPremium;

    while (_amount > 0 && !_tranchePaymentsAllMade(_index)) {
      uint256 expectedAmount;
      uint256 expectedAt;
      uint256 paidSoFar;

      (expectedAmount, expectedAt, paidSoFar) = _getNextTranchePremium(_index);

      require(expectedAt >= now, 'payment too late');

      uint256 pending = expectedAmount.sub(paidSoFar);

      uint256 numPremiumsPaid = dataUint256[__i(_index, "numPremiumsPaid")];

      if (_amount >= pending) {
        netPremium += _applyPremiumPaymentAmount(_index, pending);
        totalPaid = totalPaid.add(pending);
        _amount = _amount.sub(pending);

        dataUint256[__i(_index, "numPremiumsPaid")] = numPremiumsPaid + 1;
        dataUint256[__ii(_index, numPremiumsPaid, "premiumPaidAt")] = now;
        dataUint256[__ii(_index, numPremiumsPaid, "premiumPaidSoFar")] = dataUint256[__ii(_index, numPremiumsPaid, "premiumAmount")];
      } else {
        netPremium += _applyPremiumPaymentAmount(_index, _amount);
        totalPaid = totalPaid.add(_amount);
        dataUint256[__ii(_index, numPremiumsPaid, "premiumPaidSoFar")] = dataUint256[__ii(_index, numPremiumsPaid, "premiumPaidSoFar")].add(_amount);
        _amount = 0;
      }
    }

    // do the actual transfer to the treasury
    IERC20 tkn = IERC20(dataAddress["unit"]);
    uint256 totalCommissions = totalPaid - netPremium;
    tkn.transferFrom(msg.sender, address(this), totalCommissions);
    tkn.transferFrom(msg.sender, dataAddress["treasury"], netPremium);

    // tell treasury to update its balance for this policy
    _getTreasury().incPolicyBalance(netPremium);
    
    // event
    emit PremiumPayment(_index, totalPaid, msg.sender);
  }

  function _applyPremiumPaymentAmount (uint256 _index, uint256 _amount) private returns (uint256) {
    // calculate commissions
    uint256 brokerCommission = dataUint256["brokerCommissionBP"].mul(_amount).div(10000);
    uint256 claimsAdminCommission = dataUint256["claimsAdminCommissionBP"].mul(_amount).div(10000);
    uint256 naymsCommission = dataUint256["naymsCommissionBP"].mul(_amount).div(10000);
    uint256 underwriterCommission = dataUint256["underwriterCommissionBP"].mul(_amount).div(10000);

    // add to commission balances
    dataUint256["brokerCommissionBalance"] = dataUint256["brokerCommissionBalance"].add(brokerCommission);
    dataUint256["claimsAdminCommissionBalance"] = dataUint256["claimsAdminCommissionBalance"].add(claimsAdminCommission);
    dataUint256["naymsCommissionBalance"] = dataUint256["naymsCommissionBalance"].add(naymsCommission);
    dataUint256["underwriterCommissionBalance"] = dataUint256["underwriterCommissionBalance"].add(underwriterCommission);

    // add to tranche balance
    uint256 trancheBalanceDelta = _amount.sub(brokerCommission.add(claimsAdminCommission).add(naymsCommission).add(underwriterCommission));
    dataUint256[__i(_index, "balance")] = dataUint256[__i(_index, "balance")].add(trancheBalanceDelta);

    return trancheBalanceDelta;
  }

  function _getNextTranchePremium (uint256 _index) private view returns (uint256, uint256, uint256) {
    uint256 numPremiumsPaid = dataUint256[__i(_index, "numPremiumsPaid")];

    return (
      dataUint256[__ii(_index, numPremiumsPaid, "premiumAmount")],
      dataUint256[__ii(_index, numPremiumsPaid, "premiumDueAt")],
      dataUint256[__ii(_index, numPremiumsPaid, "premiumPaidSoFar")]
    );
  }
}
