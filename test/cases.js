'use strict';
// For every rule: a minimal vulnerable snippet (must fire) and a safe snippet (must not fire).
const H = '#![no_std]\nuse soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec, BytesN};\n#[contract]\npub struct C;\n';
const W = body => H + '#[contractimpl]\nimpl C {\n' + body + '\n}\n';
const ADMIN = 'let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();\nadmin.require_auth();\n';

module.exports = {
  'ST-01': {
    bad: W('pub fn deposit(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nenv.storage().persistent().set(&DataKey::Balance(user), &amount);\n}'),
    good: W('pub fn deposit(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nlet key = DataKey::Balance(user);\nenv.storage().persistent().set(&key, &amount);\nenv.storage().persistent().extend_ttl(&key, 100, 1000);\n}'),
  },
  'ST-02': {
    bad: W('pub fn credit(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nenv.storage().temporary().set(&DataKey::Balance(user), &amount);\n}'),
    good: W('pub fn note(env: Env, user: Address, nonce: u64) {\nuser.require_auth();\nenv.storage().temporary().set(&DataKey::Nonce(user), &nonce);\n}'),
  },
  'ST-03': {
    bad: W('pub fn stake(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nenv.storage().instance().set(&DataKey::Stake(user), &amount);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
    good: W('pub fn stake(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nlet k = DataKey::Stake(user);\nenv.storage().persistent().set(&k, &amount);\nenv.storage().persistent().extend_ttl(&k, 100, 1000);\n}'),
  },
  'RB-01': {
    bad: W('pub fn airdrop(env: Env, users: Vec<Address>) -> u32 {\nlet mut n = 0u32;\nfor u in users.iter() { n += 1; }\nn\n}'),
    good: W('pub fn airdrop(env: Env, users: Vec<Address>) -> u32 {\nif users.len() > 50 { panic!(); }\nlet mut n = 0u32;\nfor u in users.iter() { n += 1; }\nn\n}'),
  },
  'RB-02': {
    bad: W('pub fn total(env: Env, users: Vec<Address>) -> i128 {\nif users.len() > 50 { panic!(); }\nlet mut t: i128 = 0;\nfor u in users.iter() { let b: i128 = env.storage().persistent().get(&DataKey::Balance(u)).unwrap_or(0); t = t.checked_add(b).unwrap(); }\nt\n}'),
    good: W('pub fn total(env: Env) -> i128 {\nenv.storage().instance().get(&DataKey::Total).unwrap_or(0)\n}'),
  },
  'RB-03': {
    bad: W('pub fn join(env: Env, user: Address) {\nuser.require_auth();\nlet mut m: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();\nm.push_back(user);\nenv.storage().instance().set(&DataKey::Members, &m);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
    good: W('pub fn join(env: Env, user: Address) {\nuser.require_auth();\nlet mut m: Vec<Address> = env.storage().instance().get(&DataKey::Members).unwrap();\nif m.len() >= 100 { panic!(); }\nm.push_back(user);\nenv.storage().instance().set(&DataKey::Members, &m);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
  },
  'AU-01': {
    bad: W('pub fn withdraw(env: Env, user: Address, amount: i128) {\nif amount <= 0 { panic!(); }\nenv.storage().persistent().remove(&DataKey::Balance(user.clone()));\n}'),
    good: W('pub fn withdraw(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nenv.storage().persistent().remove(&DataKey::Balance(user.clone()));\n}'),
  },
  'AU-02': {
    bad: W('pub fn set_fee(env: Env, admin: Address, fee: u32) {\nadmin.require_auth();\nenv.storage().instance().set(&DataKey::Fee, &fee);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
    good: W('pub fn set_fee(env: Env, fee: u32) {\n' + ADMIN + 'env.storage().instance().set(&DataKey::Fee, &fee);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
  },
  'AU-03': {
    bad: W('pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {\nfrom.require_auth();\nif amount <= 0 { panic!(); }\nenv.events().publish((from, to), amount);\n}'),
    good: W('pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {\nspender.require_auth();\nif amount <= 0 { panic!(); }\nenv.events().publish((from, to), amount);\n}'),
  },
  'AR-01': {
    bad: W('pub fn add(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nlet bal: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);\nlet nb = bal + amount;\nenv.storage().persistent().set(&DataKey::Balance(user.clone()), &nb);\nenv.storage().persistent().extend_ttl(&DataKey::Balance(user), 100, 1000);\n}'),
    good: W('pub fn add(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nlet bal: i128 = env.storage().persistent().get(&DataKey::Balance(user.clone())).unwrap_or(0);\nlet nb = bal.checked_add(amount).expect("overflow");\nenv.storage().persistent().set(&DataKey::Balance(user.clone()), &nb);\nenv.storage().persistent().extend_ttl(&DataKey::Balance(user), 100, 1000);\n}'),
  },
  'AR-02': {
    bad: W('pub fn shares(env: Env, amount: i128) -> u64 {\nif amount < 0 { panic!(); }\namount as u64\n}'),
    good: W('pub fn shares(env: Env, amount: i128) -> u64 {\nif amount < 0 { panic!(); }\nu64::try_from(amount).unwrap()\n}'),
  },
  'AR-03': {
    bad: W('pub fn burn_mine(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nenv.events().publish((user,), amount);\n}'),
    good: W('pub fn burn_mine(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nenv.events().publish((user,), amount);\n}'),
  },
  'IN-01': {
    bad: W('pub fn initialize(env: Env, admin: Address) {\nenv.storage().instance().set(&DataKey::Admin, &admin);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
    good: W('pub fn initialize(env: Env, admin: Address) {\nif env.storage().instance().has(&DataKey::Admin) { panic!("already initialized"); }\nenv.storage().instance().set(&DataKey::Admin, &admin);\nenv.storage().instance().extend_ttl(100, 1000);\n}'),
  },
  'IN-02': {
    bad: W('pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {\nenv.deployer().update_current_contract_wasm(new_wasm_hash);\n}'),
    good: W('pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {\n' + ADMIN + 'env.deployer().update_current_contract_wasm(new_wasm_hash);\n}'),
  },
  'RE-01': {
    bad: W('pub fn withdraw(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nlet tok: Address = env.storage().instance().get(&DataKey::Token).unwrap();\ntoken::TokenClient::new(&env, &tok).transfer(&env.current_contract_address(), &user, &amount);\nenv.storage().persistent().set(&DataKey::Balance(user.clone()), &0i128);\nenv.storage().persistent().extend_ttl(&DataKey::Balance(user), 100, 1000);\n}'),
    good: W('pub fn withdraw(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!(); }\nenv.storage().persistent().set(&DataKey::Balance(user.clone()), &0i128);\nenv.storage().persistent().extend_ttl(&DataKey::Balance(user.clone()), 100, 1000);\nlet tok: Address = env.storage().instance().get(&DataKey::Token).unwrap();\ntoken::TokenClient::new(&env, &tok).transfer(&env.current_contract_address(), &user, &amount);\n}'),
  },
  'RE-02': {
    bad: W('pub fn pay(env: Env, from: Address, token_addr: Address, amount: i128) {\nfrom.require_auth();\nif amount <= 0 { panic!(); }\ntoken::TokenClient::new(&env, &token_addr).transfer(&from, &env.current_contract_address(), &amount);\n}'),
    good: W('pub fn pay(env: Env, from: Address, amount: i128) {\nfrom.require_auth();\nif amount <= 0 { panic!(); }\nlet t: Address = env.storage().instance().get(&DataKey::Token).unwrap();\ntoken::TokenClient::new(&env, &t).transfer(&from, &env.current_contract_address(), &amount);\n}'),
  },
  'ER-01': {
    bad: W('pub fn deposit(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic!("bad amount"); }\n}'),
    good: W('pub fn deposit(env: Env, user: Address, amount: i128) {\nuser.require_auth();\nif amount <= 0 { panic_with_error!(&env, Error::BadAmount); }\n}'),
  },
};
