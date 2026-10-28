'use strict';
const { lineOf, matchBrace } = require('./parse');

// Each rule: id, category, title, priority, why, verify, check(file) -> [{line, note}]
const at = (f, fn, idx) => lineOf(f.clean, fn.bodyOffset + idx);
const entries = f => f.functions.filter(fn => fn.entry);
const STORE_WRITE = /\.(persistent|instance)\s*\(\s*\)\s*\.\s*set\s*\(/;
const ANY_WRITE = /\.(persistent|instance|temporary)\s*\(\s*\)\s*\.\s*(set|remove|update|try_update)\s*\(/g;
const HAS_AUTH = /\.require_auth(_for_args)?\s*\(/;
const INIT_NAME = /^(initialize|init|__constructor|constructor|setup)$/;
const PRIV_NAME = /^(set_|update_|change_|upgrade|mint|burn|pause|unpause|withdraw_all|sweep|rescue|emergency|transfer_admin|set_admin|add_|remove_|grant|revoke|configure|clawback|freeze)/;
// Helper calls the scanner treats as an auth check (project-local helpers named like these).
const AUTH_HELPER = /\b(require_admin|check_admin|only_admin|ensure_admin|assert_admin|require_owner|only_owner|check_auth|admin_auth)\s*\(/;

function loops(body) {
  const out = []; const re = /\b(for\s+[^{]*?\s+in\s+[^{]+|while\s+[^{]+|loop\s*)\{/g; let m;
  while ((m = re.exec(body))) { const open = m.index + m[0].length - 1; out.push({ idx: m.index, head: m[0], text: body.slice(open, matchBrace(body, open) + 1) }); }
  return out;
}
const firstIdx = (s, re) => { const m = new RegExp(re.source, re.flags.replace('g', '')).exec(s); return m ? m.index : -1; };
const lastIdx = (s, re) => { let r = -1; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m; while ((m = g.exec(s))) r = m.index; return r; };
const EXT_CALL = /\b(token::(Token)?Client|TokenClient|\w*Client)::new\s*\([^)]*\)\s*\.\s*(transfer|transfer_from|burn|burn_from|mint|approve|\w+)\s*\(|\b\w*(token|client|tok)\w*\s*\.\s*(transfer|transfer_from|burn|burn_from|approve|swap|deposit|withdraw)\s*\(|\.invoke_contract\s*(::<[^>]*>)?\s*\(|\.try_invoke_contract\s*(::<[^>]*>)?\s*\(/i;
const AMT_TYPES = /\b(i128|u128|i64|u64)\b/;
const ARITH = /([\w)\]]+)\s*([+\-*])\s*(?![=>])([\w(]+)|\b\w+\s*([+\-*])=\s*/;

// True if the line has a +, -, * (or +=, -=, *=) where neither operand is a numeric literal
// (e.g. `bal + amount`), ignoring small-constant forms like `x + 1`, `n * 1000`, `len - 1`.
const NUM = /^\(*\d[\d_]*(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|usize)?\)*$/;
function riskyArith(l) {
  const code = l.replace(/->|=>|<-|&mut\b/g, ' ');
  const re = /([\w.)\]]+)\s*([+\-*])(=?)\s*(?![=>])([\w(]+)/g; let m;
  while ((m = re.exec(code))) {
    const a = m[1], b = m[4];
    if (m[2] === '*' && /[(,&]\s*$/.test(code.slice(0, m.index))) continue; // deref, not multiply
    if (NUM.test(a) || NUM.test(b)) continue;
    return true;
  }
  return false;
}

const rules = [
  // ---------- Storage TTL / archival ----------
  {
    id: 'ST-01', category: 'Storage TTL / archival', title: 'Persistent or instance entry written with no TTL extension in the same function', priority: 'medium',
    why: 'Persistent and instance entries are archived when their TTL runs out. A contract that writes balances, config or the admin key but never calls extend_ttl relies on users or ops to bump TTL, or on restore, and an archived instance makes the whole contract unusable until restored.',
    verify: 'Call env.storage().persistent().extend_ttl(&key, threshold, extend_to) after writing long-lived keys, and env.storage().instance().extend_ttl(threshold, extend_to) in entry points. If TTL is bumped by a helper or an off-chain job, document it.',
    check: f => entries(f).filter(fn => fn.name !== '__constructor' && STORE_WRITE.test(fn.body) && !/\bextend_ttl\w*\s*\(/.test(fn.body) && !/\b(bump|extend)_\w*\s*\(/.test(fn.body))
      .map(fn => ({ line: at(f, fn, firstIdx(fn.body, STORE_WRITE)), note: `${fn.name}() writes persistent/instance storage without extend_ttl` })),
  },
  {
    id: 'ST-02', category: 'Storage TTL / archival', title: 'Value-bearing data kept in temporary storage', priority: 'high',
    why: 'Temporary entries are deleted for good when their TTL expires and cannot be restored. Balances, allowances that must persist, ownership or admin keys in temporary storage can silently vanish.',
    verify: 'Use persistent storage for balances, positions and ownership, and instance storage for contract-wide config. Keep temporary storage for data that is fine to lose (nonces with expiry, short-lived allowances with an explicit expiration ledger).',
    check: f => { const hits = []; const re = /\.temporary\s*\(\s*\)\s*\.\s*set\s*\(\s*&?\s*([^,]+),/g; let m;
      while ((m = re.exec(f.clean))) if (/balance|admin|owner|position|deposit|share|supply|debt|collateral/i.test(m[1])) hits.push({ line: lineOf(f.clean, m.index), note: `temporary storage key ${m[1].trim().slice(0, 60)}` });
      return hits; },
  },
  {
    id: 'ST-03', category: 'Storage TTL / archival', title: 'Per-user data keyed into instance storage', priority: 'medium',
    why: 'Instance storage is one ledger entry shared with the contract instance: it is loaded on every call and its total size is capped by the ledger entry size limit. Per-user balances, allowances or positions there grow without bound until every call to the contract fails.',
    verify: 'Keep per-user or per-id data in persistent storage (env.storage().persistent()) under one key per user; keep instance storage for small, bounded, contract-wide config such as the admin or token pair.',
    check: f => { const hits = []; const re = /\.instance\s*\(\s*\)\s*\.\s*set\s*\(\s*&?\s*([\w:]+)\s*\(([^)]*)\)/g; let m;
      while ((m = re.exec(f.clean))) if (/balance|allowance|position|deposit|stake|share|debt|collateral|holder|user|claim/i.test(m[1])) hits.push({ line: lineOf(f.clean, m.index), note: `instance storage key ${m[1]}(${m[2].trim().slice(0, 30)})` });
      return hits; },
  },
  // ---------- Resource budgets ----------
  {
    id: 'RB-01', category: 'Resource budgets', title: 'Loop over a caller-supplied Vec/Map with no length bound', priority: 'medium',
    why: 'Soroban transactions have hard CPU, memory and read/write limits. A loop over an unbounded caller-supplied collection can exceed the budget and fail, and a loop over a stored collection that anyone can grow can lock a function forever.',
    verify: 'Check the length against a constant (if v.len() > MAX { panic_with_error!(...) }) before the loop, or paginate. Measure the worst case with the test budget (env.cost_estimate().budget()).',
    check: f => { const hits = [];
      for (const fn of entries(f)) {
        const coll = fn.paramList.filter(p => /\b(Vec|Map|Bytes)\b/.test(p.type)).map(p => p.name);
        for (const lp of loops(fn.body)) {
          const name = coll.find(c => new RegExp('\\b' + c + '\\b').test(lp.head));
          if (name && !new RegExp('\\b' + name + '\\s*\\.\\s*len\\s*\\(\\s*\\)\\s*(>|>=|<|<=)').test(fn.body)) hits.push({ line: at(f, fn, lp.idx), note: `${fn.name}() loops over parameter ${name} with no len() bound` });
        }
      }
      return hits; },
  },
  {
    id: 'RB-02', category: 'Resource budgets', title: 'Storage read or write inside a loop', priority: 'low',
    why: 'Each ledger entry access counts toward the per-transaction read/write entry and byte limits. Storage access in a loop grows with input size and is a common cause of budget-exceeded failures.',
    verify: 'Bound the loop, batch the data into one entry, or read once before the loop. Confirm the worst case fits the network limits in a test.',
    check: f => { const hits = [];
      for (const fn of f.functions) for (const lp of loops(fn.body)) { const k = firstIdx(lp.text, /\.(persistent|instance|temporary)\s*\(\s*\)\s*\.\s*(get|set|has|remove|update)\s*\(/);
        if (k >= 0) hits.push({ line: at(f, fn, fn.body.indexOf(lp.text) + k), note: `storage access inside a loop in ${fn.name}()` }); }
      return hits; },
  },
  {
    id: 'RB-03', category: 'Resource budgets', title: 'Stored Vec/Map grown by push/insert with no size cap', priority: 'medium',
    why: 'An entry that any caller can append to keeps growing. Once it is too big to read within the entry size or budget limits, every function that loads it fails, which is a permanent denial of service.',
    verify: 'Cap the collection length, or store one entry per item (a key per user or per id) instead of one growing Vec/Map.',
    check: f => entries(f).filter(fn => /\.(push_back|push_front|insert|append)\s*\(/.test(fn.body) && STORE_WRITE.test(fn.body) && !/\.len\s*\(\s*\)\s*(>|>=|<|<=|==)/.test(fn.body))
      .map(fn => ({ line: at(f, fn, firstIdx(fn.body, /\.(push_back|push_front|insert|append)\s*\(/)), note: `${fn.name}() grows a collection and writes it to storage with no length check` })),
  },
  // ---------- Authorization ----------
  {
    id: 'AU-01', category: 'Authorization', title: 'Entry point changes state with no require_auth', priority: 'high',
    why: 'Soroban has no implicit msg.sender. If a function that moves value or writes state never calls require_auth / require_auth_for_args on the acting Address, anyone can call it on behalf of anyone.',
    verify: 'Call addr.require_auth() (or require_auth_for_args) on the address whose funds or rights are used, before any state change. If the function is intentionally open (permissionless keeper), note it in scope docs.',
    check: f => entries(f).filter(fn => !INIT_NAME.test(fn.name) && (new RegExp(ANY_WRITE.source).test(fn.body) || EXT_CALL.test(fn.body)) && !HAS_AUTH.test(fn.body) && !AUTH_HELPER.test(fn.body))
      .map(fn => ({ line: fn.line, note: `${fn.name}() writes state or calls a token with no require_auth` })),
  },
  {
    id: 'AU-02', category: 'Authorization', title: 'Privileged function authorizes a caller-supplied address, not the stored admin', priority: 'high',
    why: 'admin.require_auth() only proves that the given address signed. If admin is a function parameter rather than the address loaded from storage, any account can pass itself and pass the check.',
    verify: 'Load the admin from storage (let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();) and call require_auth on that value.',
    check: f => entries(f).filter(fn => PRIV_NAME.test(fn.name) && HAS_AUTH.test(fn.body) && !AUTH_HELPER.test(fn.body) && (() => {
        const authed = [...fn.body.matchAll(/(\w+)\s*\.\s*require_auth(_for_args)?\s*\(/g)].map(m => m[1]);
        const params = fn.paramList.filter(p => /\bAddress\b/.test(p.type)).map(p => p.name);
        return authed.length && authed.every(a => params.includes(a)) && authed.some(a => /admin|owner|governor|operator|manager|authority|minter|guardian/i.test(a)) && !/\.get\s*\(\s*&\s*\w*::?\s*(Admin|Owner)/i.test(fn.body) && !/\b(admin|owner)\b[^;]*(==|!=)/i.test(fn.body);
      })()).map(fn => ({ line: fn.line, note: `${fn.name}() calls require_auth only on a parameter address` })),
  },
  {
    id: 'AU-03', category: 'Authorization', title: 'Token-style function authorizes the wrong address', priority: 'high',
    why: 'In the SEP-41 token interface, transfer, burn and approve must be authorized by `from`, and transfer_from / burn_from by `spender` (whose allowance is then consumed). Authorizing some other address (for example `to`, or `from` in transfer_from without an allowance check) lets one account move another account\'s balance.',
    verify: 'Call from.require_auth() in transfer, burn and approve; call spender.require_auth() and spend the allowance in transfer_from and burn_from. See the token interface on developers.stellar.org.',
    check: f => { const hits = [];
      const want = { transfer: 'from', burn: 'from', approve: 'from', transfer_from: 'spender', burn_from: 'spender' };
      for (const fn of entries(f)) { const w = want[fn.name]; if (!w || !fn.paramList.some(p => p.name === w)) continue;
        const authed = [...fn.body.matchAll(/(\w+)\s*\.\s*require_auth(_for_args)?\s*\(/g)].map(m => m[1]);
        if (authed.length && !authed.includes(w)) hits.push({ line: fn.line, note: `${fn.name}() calls require_auth on ${[...new Set(authed)].join(', ')} but not on ${w}` }); }
      return hits; },
  },
  // ---------- Arithmetic ----------
  {
    id: 'AR-01', category: 'Arithmetic', title: 'Unchecked +, -, * on i128/u128/i64/u64 amounts', priority: 'medium',
    why: 'Plain arithmetic wraps silently in release builds unless overflow-checks = true is set in the Cargo release profile. Negative i128 amounts are also valid inputs and can flip a subtraction into an addition.',
    verify: 'Use checked_add / checked_sub / checked_mul (returning an error), or set overflow-checks = true in [profile.release] and check it in CI. Reject amount < 0 (or <= 0) at entry.',
    check: f => { const hits = [];
      for (const fn of entries(f)) {
        if (!AMT_TYPES.test(fn.params + fn.body)) continue;
        const lines = fn.body.split('\n'); let off = 0;
        for (const l of lines) {
          if (!/checked_|saturating_|wrapping_|overflowing_|\bfor\b|\.\.|\bas\s+usize|\[[^\]]*[+\-*][^\]]*\]/.test(l) && !/^\s*(let\s+(mut\s+)?\w+\s*:\s*(u8|u16|u32|usize|i32))/.test(l) && riskyArith(l)) hits.push({ line: at(f, fn, off), note: `unchecked arithmetic in ${fn.name}()` });
          off += l.length + 1;
        }
      }
      // With overflow-checks = true the operation traps instead of wrapping: keep it visible, but as info.
      if (f.overflowChecks) for (const h of hits) { h.note += ' (overflow-checks = true: traps, does not wrap)'; h.priority = 'info'; }
      return hits; },
  },
  {
    id: 'AR-02', category: 'Arithmetic', title: 'Narrowing or sign-changing `as` cast on a numeric value', priority: 'low',
    why: '`as` truncates or reinterprets silently (i128 as u64, u128 as i128, i128 as u32). A large or negative amount becomes a different, valid-looking number.',
    verify: 'Use try_from / try_into and return an error on failure.',
    check: f => { const hits = []; const re = /\bas\s+(u8|u16|u32|u64|i8|i16|i32|i64|i128|u128)\b/g; let m;
      // Sources that are already u32 in soroban-sdk (Ledger::sequence, protocol_version, Vec/Map/Bytes len): widening or same-width casts are not narrowing.
      const U32_SRC = /(\.\s*(sequence|protocol_version|len)\s*\(\s*\)|\b\d+u32)\s*$/;
      while ((m = re.exec(f.clean))) {
        const before = f.clean.slice(Math.max(0, m.index - 200), m.index);
        if (/^(u32|u64|i64|u128|i128)$/.test(m[1]) && U32_SRC.test(before)) continue;
        hits.push({ line: lineOf(f.clean, m.index), note: `cast to ${m[1]}` }); }
      return hits; },
  },
  {
    id: 'AR-03', category: 'Arithmetic', title: 'Signed amount parameter used without a sign check', priority: 'medium',
    why: 'Token amounts are i128 in the Soroban token interface. A negative amount passed to deposit/withdraw/transfer logic can reverse the direction of balance changes.',
    verify: 'Reject amount < 0 (or <= 0) at the top of every function that takes an i128 amount.',
    check: f => { const hits = [];
      for (const fn of entries(f)) for (const p of fn.paramList) if (/\bi128\b/.test(p.type) && /amount|amt|value|qty|shares/i.test(p.name)) {
        const n = p.name; if (!new RegExp(`\\b${n}\\s*(<=?|>=?)\\s*0|\\b0\\s*(<=?|>=?)\\s*${n}\\b|check_nonnegative_amount\\s*\\(\\s*${n}|check_amount\\s*\\(\\s*${n}|${n}\\s*\\.\\s*is_negative`).test(fn.body))
          hits.push({ line: fn.line, note: `${fn.name}(${n}: i128) has no sign check` }); }
      return hits; },
  },
  // ---------- Init / upgrade ----------
  {
    id: 'IN-01', category: 'Init / upgrade', title: 'initialize can be called more than once', priority: 'high',
    why: 'A public init function with no already-initialized guard lets anyone call it again and replace the admin or token config. Unlike __constructor (protocol 22+), a normal init function is callable at any time.',
    verify: 'Panic if the admin/config key already exists (if env.storage().instance().has(&DataKey::Admin) { panic_with_error!(...) }), or move setup into __constructor so it runs exactly once at deploy.',
    check: f => entries(f).filter(fn => /^(initialize|init|setup)$/.test(fn.name) && new RegExp(ANY_WRITE.source).test(fn.body) && !/\.has\s*\(/.test(fn.body) && !/is_initialized|already_init|\bInitialized\b|AlreadyInit/i.test(fn.body))
      .map(fn => ({ line: fn.line, note: `${fn.name}() writes storage with no already-initialized check` })),
  },
  {
    id: 'IN-02', category: 'Init / upgrade', title: 'Contract Wasm upgrade with no admin authorization', priority: 'high',
    why: 'update_current_contract_wasm replaces the contract code. If the function that calls it does not require the stored admin to authorize, anyone can swap in arbitrary code and take every asset.',
    verify: 'Load the stored admin and call admin.require_auth() before env.deployer().update_current_contract_wasm(hash). Consider a timelock or multisig admin.',
    check: f => f.functions.filter(fn => /\.update_current_contract(_wasm)?\s*\(/.test(fn.body) && !HAS_AUTH.test(fn.body) && !AUTH_HELPER.test(fn.body))
      .map(fn => ({ line: at(f, fn, firstIdx(fn.body, /\.update_current_contract(_wasm)?\s*\(/)), note: `${fn.name}() upgrades the Wasm with no require_auth` })),
  },
  // ---------- Cross-contract calls ----------
  {
    id: 'RE-01', category: 'Cross-contract calls', title: 'State written after an external token or contract call', priority: 'low',
    why: 'Soroban blocks direct re-entry into the same contract, but the called token or contract can be malicious or call other contracts that read your stale state, and a failed/unexpected callee leaves accounting half-updated. Updating state first (checks-effects-interactions) keeps the contract consistent.',
    verify: 'Move storage writes before the token transfer / invoke_contract call, or document why the order is safe. Only call token contracts you trust or have allow-listed.',
    check: f => entries(f).filter(fn => { const c = firstIdx(fn.body, EXT_CALL); return c >= 0 && lastIdx(fn.body, ANY_WRITE) > c; })
      .map(fn => ({ line: at(f, fn, lastIdx(fn.body, ANY_WRITE)), note: `${fn.name}() writes storage after an external call` })),
  },
  {
    id: 'RE-02', category: 'Cross-contract calls', title: 'Token or contract address taken from the caller', priority: 'high',
    why: 'A function that builds a token client from an Address parameter will call whatever contract the caller names. A fake token can report success without moving value, so deposits can be credited for nothing and later paid out in the real token.',
    verify: 'Load token addresses from storage set by the admin, or check the parameter against an allow-list.',
    check: f => { const hits = [];
      for (const fn of entries(f)) for (const p of fn.paramList.filter(p => /\bAddress\b/.test(p.type))) {
        const m = new RegExp(`(\\w*Client)::new\\s*\\(\\s*&?\\s*\\w+\\s*,\\s*&?\\s*${p.name}\\s*\\)`).exec(fn.body);
        if (m && !new RegExp(`\\b${p.name}\\s*(==|!=)|(==|!=)\\s*&?\\s*${p.name}\\b|allowed|whitelist|allowlist|is_supported`, 'i').test(fn.body)) hits.push({ line: at(f, fn, m.index), note: `${fn.name}() builds ${m[1]} from parameter ${p.name}` });
      }
      return hits; },
  },
];
module.exports = { rules };
