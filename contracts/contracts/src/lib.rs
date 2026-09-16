#![allow(deprecated)]
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env};

const DAY_IN_LEDGERS: u32 = 17280;
const THIRTY_DAYS_IN_LEDGERS: u32 = 17280 * 30;

#[contract]
pub struct AutopilotVault;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Engine,
    IsInitialized,
}

#[contractimpl]
impl AutopilotVault {
    /// Initialize the vault with owner and engine addresses
    pub fn initialize(env: Env, owner: Address, engine: Address) {
        if env.storage().instance().has(&DataKey::IsInitialized) {
            panic!("Vault already initialized");
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Engine, &engine);
        env.storage().instance().set(&DataKey::IsInitialized, &true);

        env.storage().instance().extend_ttl(DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);

        // Emit an event so initialization is auditable on-chain
        env.events()
            .publish((symbol_short!("init"), owner.clone()), engine.clone());
    }

    /// Get the owner address
    pub fn get_owner(env: Env) -> Address {
        env.storage().instance().extend_ttl(DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    /// Get the engine address
    pub fn get_engine(env: Env) -> Address {
        env.storage().instance().extend_ttl(DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
        env.storage().instance().get(&DataKey::Engine).unwrap()
    }

    /// Withdraw funds - only the owner can withdraw
    pub fn withdraw(env: Env, amount: i128, token_address: Address) {
        env.storage().instance().extend_ttl(DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
        // Retrieve owner
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();

        // Require the owner's cryptographic signature for this invocation
        owner.require_auth();

        // Transfer funds from contract to owner
        let client = token::Client::new(&env, &token_address);
        client.transfer(&env.current_contract_address(), &owner, &amount);

        // Emit an event so the withdrawal is auditable on-chain
        env.events().publish(
            (symbol_short!("withdraw"), owner.clone()),
            (token_address.clone(), amount),
        );
    }

    /// Engine execute - allow engine to execute rule-based withdrawals
    pub fn engine_execute(env: Env, amount: i128, token_address: Address) {
        env.storage().instance().extend_ttl(DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
        let engine: Address = env.storage().instance().get(&DataKey::Engine).unwrap();
        engine.require_auth();

        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();

        // Transfer funds from contract to owner
        let client = token::Client::new(&env, &token_address);
        client.transfer(&env.current_contract_address(), &owner, &amount);

        // Emit an event so engine-driven transfers are auditable on-chain
        env.events().publish(
            (symbol_short!("exec"), engine.clone()),
            (owner.clone(), token_address.clone(), amount),
        );
    }

    /// Keep alive - permissionless TTL extension
    pub fn extend_ttl(env: Env) {
        env.storage().instance().extend_ttl(DAY_IN_LEDGERS, THIRTY_DAYS_IN_LEDGERS);
    }
}

#[cfg(test)]
mod test;

