pragma solidity >=0.5.8;

import './base/IERC20.sol';
import './base/IERC777.sol';
import './base/TranchTokenImpl.sol';

/**
 * @dev An FUC tranch.
 */
contract FUCTranch is IERC20, IERC777 {
  TranchTokenImpl public impl;
  uint256 public index;

  constructor (address _impl, uint256 _index) public {
    impl = TranchTokenImpl(_impl);
    index = _index;
  }

  // ERC-20 and ERC-777 queries //

  function name() public view returns (string memory) {
    return impl.tknName(index);
  }

  function symbol() public view returns (string memory) {
    return impl.tknSymbol(index);
  }

  function totalSupply() public view returns (uint256) {
    return impl.tknTotalSupply(index);
  }

  function balanceOf(address owner) public view returns (uint256) {
    return impl.tknBalanceOf(index, owner);
  }

  function granularity() public view returns (uint256) {
    return 1;
  }

  function decimals() public view returns (uint8) {
    return 18;
  }

  function allowance(address owner, address spender) public view returns (uint256) {
    return impl.tknAllowance(index, owner, spender);
  }

  function isOperatorFor(address operator, address tokenHolder) public view returns (bool) {
    return impl.tknIsOperatorFor(operator, tokenHolder);
  }

  function defaultOperators() public view returns (address[] memory) {
    return [];
  }

  // ERC-20 mutations //

  function approve(address spender, uint256 value) public returns (bool) {
    impl.tknApprove(index, msg.sender, spender, value);
    Approval(msg.sender, spender, value);
    return true;
  }

  function transfer(address to, uint256 value) public returns (bool) {
    impl.tknTransfer(index, msg.sender, to, value);
    Transfer(from, to, amount);
    return true;
  }

  function transferFrom(address from, address to, uint256 value) public returns (bool) {
    impl.tknTransferFrom(index, msg.sender, from, to, value);
    Transfer(from, to, amount);
    return true;
  }

  // ERC-777 mutations //

  function authorizeOperator(address operator) public {
    impl.tknAuthorizeOperator(index, msg.sender, operator);
    AuthorizedOperator(operator, msg.sender);
  }

  function revokeOperator(address operator) public {
    impl.tknRevokeOperator(index, msg.sender, operator);
    RevokedOperator(operator, msg.sender);
  }

  function send(address recipient, uint256 amount, bytes memory data) public {
    impl.tknSend(index, msg.sender, recipient, amount, data);
    Transfer(from, to, amount);
    Sent(operator, from, to, amount, data, "");
  }

  function operatorSend(
      address sender,
      address recipient,
      uint256 amount,
      bytes calldata data,
      bytes calldata operatorData
  ) public {
    impl.tknOperatorSend(index, msg.sender, sender, recipient, amount, data, operatorData);
    Transfer(from, to, amount);
    Sent(operator, from, to, amount, data, operatorData);
  }
}
