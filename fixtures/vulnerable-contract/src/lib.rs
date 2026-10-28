#![no_std]
// Deliberately vulnerable fixture for sorobanpreflight tests. Do not deploy.
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env, Vec};

#[contracttype]
pub enum DataKey { Admin, Token, Balance(Address), Members }

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    // IN-01: no already-initialized guard. ST-01: no TTL bump.
    pub fn initialize(env: Env, admin: Address, token: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    // RE-02: token from caller. AR-01 unchecked add. ST-01 no TTL bump.
    pub fn deposit(env: Env, user: Address, token_addr: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("bad amount"); }
        token::TokenClient::new(&env, &token_addr).transfer(&user, &env.current_contract_address(), &amount);
        let bal: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Balance(user), &(bal + amount));
    }

    // AU-01: no require_auth. AR-03: no sign check. RE-01: state after transfer.
    pub fn withdraw(env: Env, user: Address, amount: i128) {
        let tok: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::TokenClient::new(&env, &tok).transfer(&env.current_contract_address(), &user, &amount);
        let bal: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Balance(user), &(bal - amount));
    }

    // ST-02: balance in temporary storage.
    pub fn credit_bonus(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic!("bad amount"); }
        env.storage().temporary().set(&DataKey::Balance(user), &amount);
    }

    // RB-03: unbounded growth of a stored Vec.
    pub fn join(env: Env, user: Address) {
        user.require_auth();
        let mut m: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap_or(Vec::new(&env));
        m.push_back(user);
        env.storage().instance().set(&DataKey::Members, &m);
    }

    // RB-01 + RB-02: unbounded loop over caller data with storage reads.
    pub fn total_of(env: Env, users: Vec<Address>) -> i128 {
        let mut t: i128 = 0;
        for u in users.iter() {
            let b: i128 = env.storage().persistent().get(&DataKey::Balance(u)).unwrap_or(0);
            t = t.checked_add(b).unwrap();
        }
        t
    }

    // AU-02: authorizes a caller-supplied admin.
    pub fn set_token(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().extend_ttl(1000, 10000);
    }

    // IN-02: upgrade with no auth. AR-02: narrowing u64 -> u32 cast.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>, version: u64) -> u32 {
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        version as u32
    }

    // AU-03: transfer authorizes `to` instead of `from`. ST-03: per-user balance in instance storage.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        to.require_auth();
        if amount <= 0 { panic!("bad amount"); }
        let fb: i128 = env.storage().instance().get(&DataKey::Balance(from.clone())).unwrap_or(0);
        let tb: i128 = env.storage().instance().get(&DataKey::Balance(to.clone())).unwrap_or(0);
        env.storage().instance().set(&DataKey::Balance(from), &fb.checked_sub(amount).unwrap());
        env.storage().instance().set(&DataKey::Balance(to), &tb.checked_add(amount).unwrap());
        env.storage().instance().extend_ttl(1000, 10000);
    }
}
