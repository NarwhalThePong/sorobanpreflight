#![no_std]
// Reference fixture for sorobanpreflight tests: the same vault with each checklist item handled.
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, panic_with_error, token, Address, BytesN, Env, Vec};

#[contracttype]
pub enum DataKey { Admin, Token, Balance(Address) }

#[contracterror]
#[derive(Copy, Clone)]
#[repr(u32)]
pub enum Error { AlreadyInitialized = 1, BadAmount = 2, TooMany = 3, Overflow = 4 }

const BUMP_AT: u32 = 17280;
const BUMP_TO: u32 = 518400;
const MAX_BATCH: u32 = 25;

fn admin(env: &Env) -> Address { env.storage().instance().get(&DataKey::Admin).unwrap() }

#[contract]
pub struct Vault;

#[contractimpl]
impl Vault {
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) { panic_with_error!(&env, Error::AlreadyInitialized); }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().extend_ttl(BUMP_AT, BUMP_TO);
    }

    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic_with_error!(&env, Error::BadAmount); }
        let key = DataKey::Balance(user.clone());
        let bal: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let nb = bal.checked_add(amount).unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        env.storage().persistent().set(&key, &nb);
        env.storage().persistent().extend_ttl(&key, BUMP_AT, BUMP_TO);
        let tok: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::TokenClient::new(&env, &tok).transfer(&user, &env.current_contract_address(), &amount);
    }

    pub fn withdraw(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if amount <= 0 { panic_with_error!(&env, Error::BadAmount); }
        let key = DataKey::Balance(user.clone());
        let bal: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let nb = bal.checked_sub(amount).unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        if nb < 0 { panic_with_error!(&env, Error::BadAmount); }
        env.storage().persistent().set(&key, &nb);
        env.storage().persistent().extend_ttl(&key, BUMP_AT, BUMP_TO);
        let tok: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::TokenClient::new(&env, &tok).transfer(&env.current_contract_address(), &user, &amount);
    }

    pub fn balances(env: Env, users: Vec<Address>) -> Vec<i128> {
        if users.len() > MAX_BATCH { panic_with_error!(&env, Error::TooMany); }
        let mut out = Vec::new(&env);
        for u in users.iter() { out.push_back(Self::balance(env.clone(), u)); }
        out
    }

    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(user)).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 { panic_with_error!(&env, Error::BadAmount); }
        let fk = DataKey::Balance(from.clone());
        let tk = DataKey::Balance(to.clone());
        let fb: i128 = env.storage().persistent().get(&fk).unwrap_or(0);
        let tb: i128 = env.storage().persistent().get(&tk).unwrap_or(0);
        let nf = fb.checked_sub(amount).unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        if nf < 0 { panic_with_error!(&env, Error::BadAmount); }
        let nt = tb.checked_add(amount).unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        env.storage().persistent().set(&fk, &nf);
        env.storage().persistent().set(&tk, &nt);
        env.storage().persistent().extend_ttl(&fk, BUMP_AT, BUMP_TO);
        env.storage().persistent().extend_ttl(&tk, BUMP_AT, BUMP_TO);
    }

    pub fn set_token(env: Env, token: Address) {
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().extend_ttl(BUMP_AT, BUMP_TO);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        admin(&env).require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test {
    #[test]
    fn placeholder() {}
}
