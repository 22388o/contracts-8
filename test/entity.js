import {
  EvmSnapshot,
  extractEventArgs,
  ADDRESS_ZERO,
  BYTES32_ZERO,
  BYTES_ZERO,
  createEntity,
  createPolicy,
  createTranche,
} from './utils'

import { getAccountWallet } from '../deploy/utils'

import { events } from '../'
import { ROLES, SETTINGS } from '../utils/constants'
import { ensureAclIsDeployed } from '../deploy/modules/acl'
import { ensureSettingsIsDeployed } from '../deploy/modules/settings'
import { ensureMarketIsDeployed } from '../deploy/modules/market'
import { ensureFeeBankIsDeployed } from '../deploy/modules/feeBank'
import { ensureEntityDeployerIsDeployed } from '../deploy/modules/entityDeployer'
import { ensureEntityImplementationsAreDeployed } from '../deploy/modules/entityImplementations'
import { ensurePolicyImplementationsAreDeployed } from '../deploy/modules/policyImplementations'
import { getAccounts } from '../deploy/utils'
import { expect } from 'chai'

const IEntity = artifacts.require("base/IEntity")
const Proxy = artifacts.require('base/Proxy')
const IERC20 = artifacts.require('base/IERC20')
const DummyToken = artifacts.require('DummyToken')
const IDiamondUpgradeFacet = artifacts.require('base/IDiamondUpgradeFacet')
const IDiamondProxy = artifacts.require('base/IDiamondProxy')
const AccessControl = artifacts.require('base/AccessControl')
const DummyEntityFacet = artifacts.require("test/DummyEntityFacet")
const FreezeUpgradesFacet = artifacts.require("test/FreezeUpgradesFacet")
const IMarketFeeSchedules = artifacts.require("base/IMarketFeeSchedules")
const Entity = artifacts.require("Entity")
const IPolicy = artifacts.require("IPolicy")
const ISimplePolicy = artifacts.require("ISimplePolicy")
const ISimplePolicyStates = artifacts.require("base/ISimplePolicyStates")

describe('Entity', () => {
  const evmSnapshot = new EvmSnapshot()

  let accounts

  let acl
  let settings
  let entityDeployer
  let etherToken
  let etherToken2
  let market
  let feeBank
  let entityProxy
  let entity
  let entityCoreAddress
  let entityContext
  let systemContext

  let entityAdmin

  let DOES_NOT_HAVE_ROLE
  let HAS_ROLE_CONTEXT

  let FEE_SCHEDULE_STANDARD
  let FEE_SCHEDULE_PLATFORM_ACTION

  before(async () => {
    accounts = await getAccounts()
    acl = await ensureAclIsDeployed({ artifacts })
    settings = await ensureSettingsIsDeployed({ artifacts, acl })
    market = await ensureMarketIsDeployed({ artifacts, settings })
    feeBank = await ensureFeeBankIsDeployed({ artifacts, settings })

    entityDeployer = await ensureEntityDeployerIsDeployed({ artifacts, settings })

    await ensurePolicyImplementationsAreDeployed({ artifacts, settings })
    await ensureEntityImplementationsAreDeployed({ artifacts, settings })
    
    DOES_NOT_HAVE_ROLE = (await acl.DOES_NOT_HAVE_ROLE()).toNumber()
    HAS_ROLE_CONTEXT = (await acl.HAS_ROLE_CONTEXT()).toNumber()
    
    entityAdmin = accounts[9]
    
    const entityAddress = await createEntity({ entityDeployer, adminAddress: entityAdmin })
    entityProxy = await Entity.at(entityAddress)
    entity = await IEntity.at(entityProxy.address)
    entityContext = await entityProxy.aclContext()
    systemContext = await acl.systemContext()

    ;([ entityCoreAddress ] = await settings.getRootAddresses(SETTINGS.ENTITY_IMPL))
    
    const { facets: [marketCoreAddress] } = market
    const mktFeeSchedules = await IMarketFeeSchedules.at(marketCoreAddress)
    FEE_SCHEDULE_STANDARD = await mktFeeSchedules.FEE_SCHEDULE_STANDARD()
    FEE_SCHEDULE_PLATFORM_ACTION = await mktFeeSchedules.FEE_SCHEDULE_PLATFORM_ACTION()

    etherToken = await DummyToken.new('Wrapped ETH', 'WETH', 18, 0, false)
    etherToken2 = await DummyToken.new('Wrapped ETH 2', 'WETH2', 18, 0, true)
  })

  beforeEach(async () => {
    await evmSnapshot.take()
  })

  afterEach(async () => {
    await evmSnapshot.restore()
  })

  describe('simple policy', () => {
    
    let systemManager
    let entityManager
    let entityRep
    let insuredPartyRep
    let underwriterRep
    let brokerRep
    let claimsAdminRep

    let underwriter
    let insuredParty
    let broker
    let claimsAdmin
    
    let id = web3.eth.abi.encodeEventSignature('SimplePolicyTestID')
    let startDate = parseInt(Date.now() / 1000)
    let maturationDate = startDate + 1000
    let unit
    let limit = 100
    let stakeholders

    beforeEach(async () => {
      entityManager = accounts[2]
      entityRep = accounts[3]
      systemManager = accounts[1]
      insuredPartyRep = accounts[4]
      underwriterRep = accounts[5]
      brokerRep = accounts[6]
      claimsAdminRep = accounts[7]

      await acl.assignRole(entityContext, entityManager, ROLES.ENTITY_MANAGER)
      await acl.assignRole(entityContext, entityRep, ROLES.ENTITY_REP)
      await acl.assignRole(systemContext, systemManager, ROLES.SYSTEM_MANAGER)
      await entity.updateAllowPolicy(true, { from: systemManager })

      broker = await createEntity({ entityDeployer, adminAddress: brokerRep })
      underwriter = await createEntity({ entityDeployer, adminAddress: underwriterRep, entityContext, acl })
      insuredParty = await createEntity({ entityDeployer, adminAddress: insuredPartyRep })
      claimsAdmin = await createEntity({ entityDeployer, adminAddress: claimsAdminRep })

      const bytes = hre.ethers.utils.arrayify(id)
      const brokerSig = await getAccountWallet(brokerRep).signMessage(bytes)
      const underwriterSig = await getAccountWallet(underwriterRep).signMessage(bytes)
      const insuredPartySig = await getAccountWallet(insuredPartyRep).signMessage(bytes)
      const claimsAdminSig = await getAccountWallet(claimsAdminRep).signMessage(bytes)

      stakeholders = {
        roles: [ ROLES.BROKER, ROLES.UNDERWRITER, ROLES.INSURED_PARTY, ROLES.CLAIMS_ADMIN ],
        stakeholdersAddresses: [ broker, underwriter, insuredParty, claimsAdmin, feeBank.address ],
        approvalSignatures: [ brokerSig, underwriterSig, insuredPartySig, claimsAdminSig ],
        commissions: [ 10, 10, 10, 10, 10 ]
      }
      
      unit = etherToken.address

    })

    describe('can be created if', () => {

      it('creation is enabled on entity', async () => {
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders).should.be.rejectedWith('creation disabled')
      })

      it('limit is greater than 0', async () => {
        await entity.updateAllowSimplePolicy(true, { from: systemManager })
        await entity.updateEnabledCurrency(unit, 500, 100, { from: systemManager })
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, 0, stakeholders).should.be.rejectedWith('limit not > 0')
      })

      it('collateral ratio is valid', async () => {
        await entity.updateAllowSimplePolicy(true, { from: systemManager })
        await entity.updateEnabledCurrency(unit, 1500, 100, { from: systemManager }).should.be.rejectedWith('collateral ratio is 0-1000')
      })

      it('limit is below max capital', async () => {
        await entity.updateAllowSimplePolicy(true, { from: systemManager })
        await entity.updateEnabledCurrency(unit, 500, 100, { from: systemManager })
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, 150, stakeholders).should.be.rejectedWith('max capital exceeded')
      })

      it('currency is enabled', async () => {
        await entity.updateAllowSimplePolicy(true, { from: systemManager })
        await entity.allowSimplePolicy().should.eventually.eq(true)
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders).should.be.rejectedWith('currency disabled')
      })

      it('collateral ratio is met', async () => {
        await entity.updateEnabledCurrency(unit, 500, 100, { from: systemManager })
        await entity.updateAllowSimplePolicy(true, { from: systemManager })
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders).should.be.rejectedWith('collateral ratio not met')
      })

      it('caller is an underwriter or broker', async () => {
        const balance = 500

        await etherToken.deposit({ value: balance })
        await etherToken.approve(entityProxy.address, balance)
        await entity.deposit(etherToken.address, balance).should.be.fulfilled

        await entity.updateEnabledCurrency(unit, 500, 1000, { from: systemManager })
        await entity.updateAllowSimplePolicy(true, { from: systemManager })
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders).should.be.rejectedWith('must be broker or underwriter')
          
      })

      it('number of roles and signatures match', async () => {
        stakeholders.approvalSignatures.pop()
        
        const balance = 500
        await etherToken.deposit({ value: balance })
        await etherToken.approve(entityProxy.address, balance)
        await entity.deposit(etherToken.address, balance).should.be.fulfilled

        await entity.updateEnabledCurrency(unit, 500, 1000, { from: systemManager })
        await entity.updateAllowSimplePolicy(true, { from: systemManager })

        await acl.assignRole(systemContext, underwriter, ROLES.UNDERWRITER)

        await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders, { from: entityRep }).should.be.rejectedWith('wrong number of signatures')
            .then(() => {}, (error) => {
              console.error("  ---  CREATE FAILED  ---")
              console.log(error);
              throw error;
            })
      })
    })

    describe('after creation', () => {

      beforeEach(async () => {

        const balance = 500
        await etherToken.deposit({ value: balance })
        await etherToken.approve(entityProxy.address, balance)
        await entity.deposit(etherToken.address, balance).should.be.fulfilled

        await entity.updateEnabledCurrency(unit, 500, 1000, { from: systemManager })
        await entity.updateAllowSimplePolicy(true, { from: systemManager })

        await acl.assignRole(systemContext, underwriter, ROLES.UNDERWRITER)

      })
      
      it('they exist and have their properties set', async () => {

        const result = await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
          
        const eventArgs = extractEventArgs(result, events.NewSimplePolicy)
        
        const policy = await ISimplePolicy.at(eventArgs.simplePolicy)
        
        const policyStates = await ISimplePolicyStates.at(eventArgs.simplePolicy)
        const POLICY_STATE_APPROVED = await policyStates.POLICY_STATE_APPROVED()

        await policy.getSimplePolicyInfo().should.eventually.matchObj({
          id_: id,
          startDate_: startDate,
          maturationDate_: maturationDate,
          unit_: unit,
          limit_: limit,
          state_: POLICY_STATE_APPROVED
        })
      })

      it('number of policies is increased', async () => {
        const numberOfSimplePolicies = await entity.getNumSimplePolicies()
        await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
        
        const newNumSimplePolicies = await entity.getNumSimplePolicies()
        
        newNumSimplePolicies.should.eq(parseInt(numberOfSimplePolicies, 10) + 1)
      })

      it('lookup is available', async () => {
        const result = await entity.createSimplePolicy(id, startDate, maturationDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
        const eventArgs = extractEventArgs(result, events.NewSimplePolicy)
        const policy = await ISimplePolicy.at(eventArgs.simplePolicy)

        const { number_ } = await policy.getSimplePolicyInfo()

        await entity.getSimplePolicyId(number_).should.eventually.eq(id)
      })
      
      describe('claims can be payed out', () => {

        it('only by the system manager', async () => {
          await entity.paySimpleClaim(id, 1000, { from: entityRep }).should.be.rejectedWith('must be system mgr')
        })
        
        it('and amount is greater than 0', async () => {
          await entity.paySimpleClaim(id, 0, { from: systemManager }).should.be.rejectedWith('invalid claim amount')
        })

        it('and total amount of claims paid is below the limit ', async () => {
          await entity.createSimplePolicy(id, startDate, startDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
          await entity.paySimpleClaim(id, 101, { from: systemManager }).should.be.rejectedWith('exceeds policy limit')
        })
  
        it('then the payout goes to the insured party', async () => {
          const claimAmount = 30
          const balanceBefore = await entity.getBalance(unit)

          await entity.createSimplePolicy(id, startDate, startDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
          await entity.paySimpleClaim(id, claimAmount, { from: systemManager }).should.be.fulfilled

          await entity.getBalance(unit).should.eventually.eq(balanceBefore - claimAmount)

          await entity.getPremiumsAndClaimsPaid(id).should.eventually.matchObj({
            claimsPaid_: claimAmount
          })
        })
      })
  
      describe('premiums can be payed out', async () => {

        it('if done by entity represetative', async () => {
          await entity.paySimplePremium(id, entity.address, 0, { from: systemManager }).should.be.rejectedWith('not an entity rep')
        })

        it('if amount is greater than 0', async () => {
          await entity.createSimplePolicy(id, startDate, startDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
          await entity.paySimplePremium(id, entity.address, 0, { from: entityRep }).should.be.rejectedWith('invalid premium amount')
        })
  
        it('and the payout goes to the entity', async () => {
          const premiumAmount = 10
          const balanceBefore = (await entity.getBalance(unit)).toNumber()

          console.log("  --  trasury address: %s", feeBank.address)

          await entity.createSimplePolicy(id, startDate, startDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
            .then(() => {}, (error) => console.log("  ---  create simple policy:", error))

          await entity.paySimplePremium(id, entity.address, premiumAmount, { from: entityRep }).should.be.fulfilled
            .then(() => {}, (error) => console.log("  ---  pay premium error:", error))
          

          await entity.getBalance(unit).should.eventually.eq(balanceBefore + premiumAmount)
            .then(() => {}, (error) => console.log("  ---  get balance error:", error))

          await entity.getPremiumsAndClaimsPaid(id).should.eventually.matchObj({
            premiumsPaid_: premiumAmount
          }).then(() => {}, (error) => console.log("  ---  get premiums and claims paid error:", error))

        })
      })

      describe('heart beat function', () => {
        
        it('activates the policy after start date ', async () => {
          const result = await entity.createSimplePolicy(id, startDate - 1, maturationDate, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
          const eventArgs = extractEventArgs(result, events.NewSimplePolicy)
  
          const policyStates = await ISimplePolicyStates.at(eventArgs.simplePolicy)
          const POLICY_STATE_ACTIVE = await policyStates.POLICY_STATE_ACTIVE()

          entity.checkAndUpdateState(id)
          
          const policy = await ISimplePolicy.at(eventArgs.simplePolicy)
          await policy.getSimplePolicyInfo().should.eventually.matchObj({
            state_: POLICY_STATE_ACTIVE
          })
        })

        it('updates state and total limit accordingly after maturation date', async () => {

          const result = await entity.createSimplePolicy(id, startDate - 10, startDate - 5, unit, limit, stakeholders, { from: entityRep }).should.be.fulfilled
          const eventArgs = extractEventArgs(result, events.NewSimplePolicy)
          
          const policyStates = await ISimplePolicyStates.at(eventArgs.simplePolicy)
          const POLICY_STATE_MATURED = await policyStates.POLICY_STATE_MATURED()
          
          const { totalLimit_: totalLimitBefore } = await entity.getEnabledCurrency(unit)

          entity.checkAndUpdateState(id)
          
          const policy = await ISimplePolicy.at(eventArgs.simplePolicy)
          await policy.getSimplePolicyInfo().should.eventually.matchObj({
            state_: POLICY_STATE_MATURED
          })
          
          const { totalLimit_: totalLimitAfter } = await entity.getEnabledCurrency(unit)

          totalLimitAfter.should.eq(totalLimitBefore - limit)

        })
      })

      it('currency can be disabled', async () => {
        await entity.updateEnabledCurrency(unit, 500, 100, { from: systemManager })
        await entity.updateEnabledCurrency(etherToken2.address, 500, 100, { from: systemManager })

        const currencies = await entity.getEnabledCurrencies()
        expect(currencies).to.have.members([ unit, etherToken2.address ])

        await entity.updateEnabledCurrency(unit, 0, 0, { from: systemManager })
        
        const currencies2 = await entity.getEnabledCurrencies()
        expect(currencies2).to.not.have.members([ unit ])
        expect(currencies2).to.have.members([ etherToken2.address ])
      })

      it('currency can be updated', async () => {
        await entity.updateEnabledCurrency(unit, 500, 100, { from: systemManager })

        const currencies = await entity.getEnabledCurrencies()
        expect(currencies).to.have.members([ unit ])

        await entity.updateEnabledCurrency(unit, 600, 200, { from: systemManager })
        
        const {
          collateralRatio_: collateralRatio,
          maxCapital_: maxCapital
        } = await entity.getEnabledCurrency(unit)

        collateralRatio.should.eq(600)
        maxCapital.should.eq(200)
      })

    })
  })
})
