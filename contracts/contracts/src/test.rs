#![cfg(test)]
#![allow(deprecated)]

use super::*;
use soroban_sdk::{
    testutils::{
        storage::Instance as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    token, Address, Env, IntoVal,
};

/// A vault registered and initialized with freshly generated owner/engine addresses.
struct VaultFixture {
    contract_id: Address,
    owner: Address,
    engine: Address,
}

fn setup_vault(env: &Env) -> VaultFixture {
    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(env, &contract_id);

    let owner = Address::generate(env);
    let engine = Address::generate(env);

    env.mock_all_auths();
    client.initialize(&owner, &engine);

    VaultFixture {
        contract_id,
        owner,
        engine,
    }
}

/// Register a token contract and mint `amount` into the vault.
fn fund_vault(env: &Env, contract_id: &Address, amount: i128) -> Address {
    let token_admin = Address::generate(env);
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    token::StellarAssetClient::new(env, &token_address).mint(contract_id, &amount);
    token_address
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    client.initialize(&owner, &engine);

    assert_eq!(client.get_owner(), owner);
    assert_eq!(client.get_engine(), engine);
}

#[test]
#[should_panic(expected = "Vault already initialized")]
fn test_initialize_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    client.initialize(&owner, &engine);
    client.initialize(&owner, &engine);
}

#[test]
fn test_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    client.initialize(&owner, &engine);

    // Create token
    let token_admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let token_client = token::Client::new(&env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);

    // Mint token to contract
    token_admin_client.mint(&contract_id, &1000);
    assert_eq!(token_client.balance(&contract_id), 1000);

    client.withdraw(&500, &token_address);

    assert_eq!(token_client.balance(&contract_id), 500);
    assert_eq!(token_client.balance(&owner), 500);
}

#[test]
fn test_engine_execute() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    client.initialize(&owner, &engine);

    // Create token
    let token_admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let token_client = token::Client::new(&env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
    let recipient = Address::generate(&env);

    // Mint token to contract
    token_admin_client.mint(&contract_id, &1000);
    assert_eq!(token_client.balance(&contract_id), 1000);

    assert!(client.engine_execute(
        &recipient,
        &300,
        &token_address,
        &soroban_sdk::String::from_str(&env, "rule-1")
    ));

    assert_eq!(token_client.balance(&contract_id), 700);
    assert_eq!(token_client.balance(&recipient), 300);
}

#[test]
fn test_instance_ttl_extended_on_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    client.initialize(&owner, &engine);

    // initialize() must leave the instance alive for ~30 days of ledgers
    let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert!(ttl >= 17280 * 30);
}

#[test]
fn test_vault_survives_long_inactivity() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    client.initialize(&owner, &engine);

    // Advance ~20 days of ledgers, then keep the vault alive without a withdrawal
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 17280 * 20);
    client.extend_ttl();

    // Another ~20 days: the vault is still reachable because of the bump above
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 17280 * 20);
    assert_eq!(client.get_owner(), owner);

    let token_admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let token_client = token::Client::new(&env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
    token_admin_client.mint(&contract_id, &1000);

    client.withdraw(&500, &token_address);
    assert_eq!(token_client.balance(&owner), 500);
}

// --- Authorization: withdraw() ---

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_withdraw_without_auth_panics() {
    let env = Env::default();
    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);

    // Drop the blanket mock installed by setup_vault: from here on, every
    // require_auth() must be satisfied by an explicit authorization.
    env.set_auths(&[]);

    AutopilotVaultClient::new(&env, &vault.contract_id).withdraw(&500, &token_address);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_withdraw_with_wrong_owner_panics() {
    let env = Env::default();
    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);

    // An attacker signs the withdrawal for themselves. The vault requires the
    // stored owner's signature, so this authorization does not satisfy it.
    let attacker = Address::generate(&env);
    let args = (500i128, token_address.clone()).into_val(&env);

    AutopilotVaultClient::new(&env, &vault.contract_id)
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &vault.contract_id,
                fn_name: "withdraw",
                args,
                sub_invokes: &[],
            },
        }])
        .withdraw(&500, &token_address);
}

#[test]
fn test_withdraw_with_owner_auth_succeeds() {
    let env = Env::default();
    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);
    let token_client = token::Client::new(&env, &token_address);

    // The owner — and only the owner — authorizes this exact invocation.
    let args = (500i128, token_address.clone()).into_val(&env);
    AutopilotVaultClient::new(&env, &vault.contract_id)
        .mock_auths(&[MockAuth {
            address: &vault.owner,
            invoke: &MockAuthInvoke {
                contract: &vault.contract_id,
                fn_name: "withdraw",
                args,
                sub_invokes: &[],
            },
        }])
        .withdraw(&500, &token_address);

    assert_eq!(token_client.balance(&vault.contract_id), 500);
    assert_eq!(token_client.balance(&vault.owner), 500);
}

// --- Authorization: engine_execute() ---

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_engine_execute_without_auth_panics() {
    let env = Env::default();
    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);
    let recipient = Address::generate(&env);
    let memo = soroban_sdk::String::from_str(&env, "test");

    env.set_auths(&[]);

    AutopilotVaultClient::new(&env, &vault.contract_id).engine_execute(
        &recipient,
        &300,
        &token_address,
        &memo,
    );
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn test_engine_execute_with_owner_auth_panics() {
    let env = Env::default();
    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);
    let recipient = Address::generate(&env);
    let memo = soroban_sdk::String::from_str(&env, "test");

    // The owner is a privileged address, but engine_execute() requires the
    // engine's signature specifically — owner auth must not be accepted.
    let args = (
        recipient.clone(),
        300i128,
        token_address.clone(),
        memo.clone(),
    )
        .into_val(&env);

    AutopilotVaultClient::new(&env, &vault.contract_id)
        .mock_auths(&[MockAuth {
            address: &vault.owner,
            invoke: &MockAuthInvoke {
                contract: &vault.contract_id,
                fn_name: "engine_execute",
                args,
                sub_invokes: &[],
            },
        }])
        .engine_execute(&recipient, &300, &token_address, &memo);
}

#[test]
fn test_engine_execute_with_engine_auth_succeeds() {
    let env = Env::default();
    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);
    let token_client = token::Client::new(&env, &token_address);
    let recipient = Address::generate(&env);
    let memo = soroban_sdk::String::from_str(&env, "test");

    let args = (
        recipient.clone(),
        300i128,
        token_address.clone(),
        memo.clone(),
    )
        .into_val(&env);
    AutopilotVaultClient::new(&env, &vault.contract_id)
        .mock_auths(&[MockAuth {
            address: &vault.engine,
            invoke: &MockAuthInvoke {
                contract: &vault.contract_id,
                fn_name: "engine_execute",
                args,
                sub_invokes: &[],
            },
        }])
        .engine_execute(&recipient, &300, &token_address, &memo);

    // Engine-driven transfers pay out to recipient.
    assert_eq!(token_client.balance(&vault.contract_id), 700);
    assert_eq!(token_client.balance(&recipient), 300);
}

// --- TTL ---

#[test]
fn test_extend_ttl_is_permissionless() {
    let env = Env::default();
    let vault = setup_vault(&env);

    // extend_ttl() has no require_auth(), so an arbitrary caller may bump the
    // instance and keep the vault reachable.
    env.set_auths(&[]);
    AutopilotVaultClient::new(&env, &vault.contract_id).extend_ttl();

    let ttl = env.as_contract(&vault.contract_id, || env.storage().instance().get_ttl());
    assert!(ttl >= THIRTY_DAYS_IN_LEDGERS);
}

// --- Events ---

#[test]
fn test_initialize_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, AutopilotVault);
    let client = AutopilotVaultClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let engine = Address::generate(&env);

    client.initialize(&owner, &engine);

    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        soroban_sdk::vec![
            &env,
            (
                contract_id.clone(),
                (symbol_short!("init"),).into_val(&env),
                (owner.clone(), engine.clone()).into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_withdraw_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);
    let client = AutopilotVaultClient::new(&env, &vault.contract_id);

    client.withdraw(&400, &token_address);

    assert_eq!(
        env.events().all().filter_by_contract(&vault.contract_id),
        soroban_sdk::vec![
            &env,
            (
                vault.contract_id.clone(),
                (symbol_short!("withdraw"),).into_val(&env),
                (vault.owner.clone(), 400i128, token_address.clone()).into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_engine_execute_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let vault = setup_vault(&env);
    let token_address = fund_vault(&env, &vault.contract_id, 1000);
    let client = AutopilotVaultClient::new(&env, &vault.contract_id);
    let recipient = Address::generate(&env);
    let memo = soroban_sdk::String::from_str(&env, "rule-trigger-1");

    client.engine_execute(&recipient, &300, &token_address, &memo);

    assert_eq!(
        env.events().all().filter_by_contract(&vault.contract_id),
        soroban_sdk::vec![
            &env,
            (
                vault.contract_id.clone(),
                (symbol_short!("execute"),).into_val(&env),
                (
                    recipient.clone(),
                    300i128,
                    token_address.clone(),
                    memo.clone()
                )
                    .into_val(&env),
            ),
        ]
    );
}
