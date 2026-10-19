#![allow(deprecated)]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, BytesN,
    ContractExecutable, Env, Symbol, Vec,
};

#[contract]
pub struct VaultFactory;

#[contracttype]
#[derive(Clone)]
pub enum FactoryDataKey {
    Admin,
    Engine,
    VaultWasmHash,
    IsInitialized,
    Vault(Address, Symbol),
    UserVaults(Address),
}

#[contractimpl]
impl VaultFactory {
    /// Initialize the factory with admin, engine addresses and the AutopilotVault WASM hash
    pub fn init(env: Env, admin: Address, engine: Address, vault_wasm_hash: BytesN<32>) {
        if env.storage().instance().has(&FactoryDataKey::IsInitialized) {
            panic!("Factory already initialized");
        }
        env.storage().instance().set(&FactoryDataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&FactoryDataKey::Engine, &engine);
        env.storage()
            .instance()
            .set(&FactoryDataKey::VaultWasmHash, &vault_wasm_hash);
        env.storage()
            .instance()
            .set(&FactoryDataKey::IsInitialized, &true);
        env.events()
            .publish((symbol_short!("init_fac"),), (admin, engine));
        Self::bump_instance_ttl(&env);
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Address {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&FactoryDataKey::Admin)
            .expect("Admin not set")
    }

    /// Get factory engine address
    pub fn get_factory_engine(env: Env) -> Address {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&FactoryDataKey::Engine)
            .expect("Engine not set")
    }

    /// Get current vault WASM hash
    pub fn get_wasm_hash(env: Env) -> BytesN<32> {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&FactoryDataKey::VaultWasmHash)
            .expect("Wasm hash not set")
    }

    /// Update engine address (admin only)
    pub fn set_factory_engine(env: Env, new_engine: Address) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();
        env.storage()
            .instance()
            .set(&FactoryDataKey::Engine, &new_engine);
        Self::bump_instance_ttl(&env);
    }

    /// Update vault WASM hash for future deployments (admin only)
    pub fn set_wasm_hash(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = Self::get_admin(env.clone());
        admin.require_auth();
        env.storage()
            .instance()
            .set(&FactoryDataKey::VaultWasmHash, &new_wasm_hash);
        Self::bump_instance_ttl(&env);
    }

    /// Deploy a new AutopilotVault instance for the caller using the configured WASM hash,
    /// initializes it with the user as Owner and engine as Engine, and registers it.
    pub fn deploy_vault(env: Env, owner: Address, vault_type: Symbol) -> Address {
        owner.require_auth();

        if !env.storage().instance().has(&FactoryDataKey::IsInitialized) {
            panic!("Factory not initialized");
        }

        let vault_key = FactoryDataKey::Vault(owner.clone(), vault_type.clone());
        if env.storage().persistent().has(&vault_key) {
            panic!("Vault already exists for this owner and type");
        }

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&FactoryDataKey::VaultWasmHash)
            .expect("Wasm hash not set");
        let engine: Address = env
            .storage()
            .instance()
            .get(&FactoryDataKey::Engine)
            .expect("Engine not set");

        // Deterministic salt derived from owner and vault_type
        let salt = env
            .crypto()
            .sha256(&(owner.clone(), vault_type.clone()).to_xdr(&env));

        // Deploy the new AutopilotVault instance via deployer with_address
        let vault_address = env
            .deployer()
            .with_address(owner.clone(), salt)
            .deploy_contract(ContractExecutable::Wasm(wasm_hash), ());

        // Initialize the new vault instance with owner and engine
        crate::AutopilotVaultClient::new(&env, &vault_address).initialize(&owner, &engine);

        // Record vault in factory mapping: (owner, vault_type) -> vault_address
        env.storage().persistent().set(&vault_key, &vault_address);
        env.storage().persistent().extend_ttl(
            &vault_key,
            crate::INSTANCE_TTL_LEDGERS,
            crate::INSTANCE_TTL_LEDGERS,
        );

        // Record in user vaults list: owner -> Vec<Address>
        let user_vaults_key = FactoryDataKey::UserVaults(owner.clone());
        let mut user_vaults: Vec<Address> = env
            .storage()
            .persistent()
            .get(&user_vaults_key)
            .unwrap_or_else(|| Vec::new(&env));
        user_vaults.push_back(vault_address.clone());
        env.storage()
            .persistent()
            .set(&user_vaults_key, &user_vaults);
        env.storage().persistent().extend_ttl(
            &user_vaults_key,
            crate::INSTANCE_TTL_LEDGERS,
            crate::INSTANCE_TTL_LEDGERS,
        );

        env.events().publish(
            (symbol_short!("dep_vlt"), owner),
            (vault_address.clone(), vault_type),
        );
        Self::bump_instance_ttl(&env);

        vault_address
    }

    /// Query the deployed vault address for a given user and type
    pub fn get_vault(env: Env, owner: Address, vault_type: Symbol) -> Option<Address> {
        let vault_key = FactoryDataKey::Vault(owner, vault_type);
        env.storage().persistent().get(&vault_key)
    }

    /// Query all vault addresses deployed for a user
    pub fn get_user_vaults(env: Env, owner: Address) -> Vec<Address> {
        let user_vaults_key = FactoryDataKey::UserVaults(owner);
        env.storage()
            .persistent()
            .get(&user_vaults_key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(crate::INSTANCE_TTL_LEDGERS, crate::INSTANCE_TTL_LEDGERS);
    }
}
