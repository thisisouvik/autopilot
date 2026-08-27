#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _}, token, Address, Env};

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
    let token_address = env.register_stellar_asset_contract_v2(token_admin).address();
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
    let token_address = env.register_stellar_asset_contract_v2(token_admin).address();
    let token_client = token::Client::new(&env, &token_address);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);
    
    // Mint token to contract
    token_admin_client.mint(&contract_id, &1000);
    assert_eq!(token_client.balance(&contract_id), 1000);
    
    client.engine_execute(&300, &token_address);
    
    assert_eq!(token_client.balance(&contract_id), 700);
    assert_eq!(token_client.balance(&owner), 300);
}
