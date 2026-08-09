'use strict';
// FSBS Operations — end-to-end API tests (node:test, real HTTP against in-memory-ish temp DB).
// Run: node --test test/
process.env.TZ = 'America/Toronto';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createApp } = require('../server');
const { ensureSeed } = require('../lib/seed');
const D = require('../lib/domain');
const scheduler = require('../lib/scheduler');

let server, db, base, tmp;
const jar = {};
async function call(method, p, body, { as = null, raw = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as && jar[as]) headers.Cookie = 'fsbs=' + jar[as];
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return raw ? r : { status: r.status, body: await r.json().catch(() => ({})) };
}
async function login(as, email, password) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, 'login ' + email);
  jar[as] = /fsbs=([^;]+)/.exec(r.headers.get('set-cookie'))[1];
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fsbs-test-'));
  process.env.FSBS_DATA_DIR = tmp;
  const app = createApp({ dbPath: path.join(tmp, 'test.db'), baseUrl: 'http://localhost:0' });
  server = app.server; db = app.db;
  ensureSeed(db);
  await new Promise(ok => server.listen(0, ok));
  base = 'http://localhost:' + server.address().port;
  await login('admin', dbUser('admin'), dbPass('admin'));
  await login('rep', dbUser('rep'), dbPass('rep'));
  await login('installer', dbUser('installer'), dbPass('installer'));
});
after(() => { server.close(); });

// helpers to read seeded creds regardless of which seed file is present
const { loadSeedConfig } = require('../lib/seed');
const seedCfg = loadSeedConfig().config;
function dbUser(role) { return seedCfg.users.find(u => u.role === role || (role === 'admin' && u.role === 'admin')).email; }
function dbPass(role) { return seedCfg.users.find(u => u.role === role || (role === 'admin' && u.role === 'admin')).password; }

// ---------- Deadline rules (pure) ----------
test('ack deadline: normal daytime assignment → 11 PM same day', () => {
  const assigned = new Date('2026-07-14T10:00:00');
  const appt = new Date('2026-07-16T14:00:00');
  const d = D.ackDeadline(assigned, appt);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getDate(), assigned.getDate());
});
test('ack deadline: late-evening assignment → 2h window, capped at appt start', () => {
  const assigned = new Date('2026-07-14T21:30:00');
  const appt = new Date('2026-07-15T08:30:00'); // before next-morning 9 AM
  const d = D.ackDeadline(assigned, appt);
  assert.equal(d.getTime(), assigned.getTime() + 2 * 3600e3); // 11:30 PM < 8:30 AM appt
  const apptSoon = new Date('2026-07-14T22:30:00');
  assert.equal(D.ackDeadline(assigned, apptSoon).getTime(), apptSoon.getTime()); // capped at appt
});
test('result deadline: evening appointment gets end+2h, not 9 PM', () => {
  const appt = new Date('2026-07-14T19:30:00');
  const d = D.resultDeadline(appt, 90);
  assert.equal(d.getTime(), appt.getTime() + 90 * 60e3 + 2 * 3600e3); // 23:00, later than 21:00
  const morning = new Date('2026-07-14T10:00:00');
  assert.equal(D.resultDeadline(morning, 90).getHours(), 21);
});

// ---------- Commission engine (verified against the real 2026 sheet rows) ----------
test('commission: matches real 2026 sheet math (pre-tax basis, tier lookup)', () => {
  // Row: $22,738.30, 0% discount → pre-tax 20,122.39, top tier → 3,018.36
  const zero = D.computeCommission(db, { initialPrice: 22738.30, finalPrice: 22738.30, hstRate: 0.13 });
  assert.equal(zero.pre_tax_amount, 20122.39);
  assert.equal(zero.amount, D.round2(20122.39 * (zero.rate / 100)));
  // Row: 16,005.90 → 12,563.00 (21.5% discount) → pre-tax 11,117.70
  const deep = D.computeCommission(db, { initialPrice: 16005.90, finalPrice: 12563.00, hstRate: 0.13 });
  assert.equal(deep.discount_pct, 21.51);
  assert.equal(deep.pre_tax_amount, 11117.70);
  // Deeper discount must never pay a higher rate
  assert.ok(deep.rate <= zero.rate);
});
test('commission: adjustment (upsell at measure) shifts effective discount', () => {
  const before = D.computeCommission(db, { initialPrice: 20000, finalPrice: 17000, hstRate: 0.13 }); // 15%
  const after = D.computeCommission(db, { initialPrice: 20000, finalPrice: 17000, hstRate: 0.13, adjustment: 1000 }); // → 10%
  assert.ok(after.discount_pct < before.discount_pct);
  assert.ok(after.rate >= before.rate);
});

// ---------- Installer invoice math (verified against the real pay-sheet template) ----------
test('installer invoice: HST back-calc on receipts, mileage free-km, bonus', () => {
  const calc = D.computeInvoice(db, {
    lines: [{ rate_code: 'x', label: 'Standard Install', qty: 1, unit_price: 1200 }],
    receipts: [{ description: 'rona', total: 8.2 }],   // pre-tax 7.26 per the real sheet
    mileageKm: 75,                                      // 25 chargeable * 0.40 = 10.00
    bonusChecklist: { photos: true, form: true, payment: true, review: true },
  });
  const receipt = calc.receipts[0];
  assert.equal(receipt.pre_tax, 7.26);
  const mileage = calc.lines.find(l => l.rate_code === 'mileage');
  assert.equal(mileage.total, 10);
  assert.equal(calc.bonus, 150);
  assert.equal(calc.subtotal, D.round2(1200 + 10 + 8.2));
  assert.equal(calc.total, D.round2(calc.subtotal + 150 + calc.hst));
});
test('installer invoice: no bonus when checklist incomplete', () => {
  const calc = D.computeInvoice(db, { lines: [{ label: 'x', qty: 1, unit_price: 100 }], bonusChecklist: { photos: true } });
  assert.equal(calc.bonus, 0);
});

// ---------- Full sales workflow over HTTP ----------
let apptId, customerId, contractId, projectId, portalToken;
test('office books appointment → confirmation queued, rep must acknowledge', async () => {
  const c = await call('POST', '/api/customers', { name: 'Test Homeowner', email: 'test.homeowner@example.com', phone: '+16135550999', address: '9 Test Lane, Ottawa', consent_marketing: true }, { as: 'admin' });
  customerId = c.body.id;
  const a = await call('POST', '/api/appointments', {
    customer_id: customerId, rep_id: db.prepare("SELECT id FROM users WHERE role='rep'").get().id,
    scheduled_at: new Date(Date.now() + 26 * 3600e3).toISOString(), project_type: 'Tub-to-shower conversion',
  }, { as: 'admin' });
  assert.equal(a.status, 201);
  apptId = a.body.id;
  assert.ok(a.body.ack_deadline);
  const confirmation = db.prepare("SELECT * FROM outbox WHERE template='appointment_confirmation' AND to_id=?").get(customerId);
  assert.ok(confirmation, 'customer confirmation queued');
});
test('rep acknowledges explicitly; viewing does not count', async () => {
  const list = await call('GET', '/api/rep/appointments', null, { as: 'rep' });
  assert.equal(list.body.find(x => x.id === apptId).ack_status, 'pending'); // viewing ≠ ack
  const bad = await call('POST', `/api/rep/appointments/${apptId}/ack`, { response: 'looked-at-it' }, { as: 'rep' });
  assert.equal(bad.status, 400);
  const ok = await call('POST', `/api/rep/appointments/${apptId}/ack`, { response: 'received' }, { as: 'rep' });
  assert.equal(ok.status, 200);
});
test('result validation blocks contradictions; sold creates contract+project+commission+welcome', async () => {
  const bad = await call('POST', `/api/rep/appointments/${apptId}/result`, { outcome: 'sold', data: { contract_signed: false } }, { as: 'rep' });
  assert.equal(bad.status, 422);
  const r = await call('POST', `/api/rep/appointments/${apptId}/result`, {
    outcome: 'sold',
    data: { initial_price: 16716.35, lowest_price: 15212, final_price: 15212, contract_signed: true, deposit_collected: true, deposit_amount: 5000, deposit_method: 'cheque', photos_done: true, proposal_created: true },
  }, { as: 'rep' });
  assert.equal(r.status, 201);
  contractId = r.body.contract_id; projectId = r.body.project_id;
  assert.ok(r.body.commission, 'commission estimated at sale');
  // Discount 9.0% (like the real Kroeker agreement: 16,716.35 → 15,212.00)
  assert.equal(r.body.commission.discount_pct, 9);
  const pays = db.prepare('SELECT * FROM payments WHERE project_id=? ORDER BY kind').all(projectId);
  assert.equal(pays.find(p => p.kind === 'deposit').status, 'received');
  assert.equal(pays.find(p => p.kind === 'final').amount, D.round2(15212 - 5000));
  const welcome = db.prepare("SELECT * FROM outbox WHERE template='post_sale_welcome' AND to_id=?").get(customerId);
  assert.ok(welcome, 'welcome queued');
});
test('unsold proposal is retained (pitch & miss)', async () => {
  const c2 = await call('POST', '/api/customers', { name: 'Unsold Person', email: 'unsold@example.com' }, { as: 'admin' });
  const a2 = await call('POST', '/api/appointments', { customer_id: c2.body.id, rep_id: db.prepare("SELECT id FROM users WHERE role='rep'").get().id, scheduled_at: new Date(Date.now() + 30 * 3600e3).toISOString() }, { as: 'admin' });
  await call('POST', `/api/rep/appointments/${a2.body.id}/ack`, { response: 'received' }, { as: 'rep' });
  const r = await call('POST', `/api/rep/appointments/${a2.body.id}/result`, { outcome: 'pitch_miss', data: { initial_price: 18000, lowest_price: 15500, photos_done: true, proposal_created: true } }, { as: 'rep' });
  assert.equal(r.status, 201);
  const prop = db.prepare('SELECT * FROM proposals WHERE id=?').get(r.body.proposal_id);
  assert.equal(prop.status, 'open');
  assert.equal(prop.discount_pct, D.round2((2500 / 18000) * 100));
});
test('contract PDF: refuses unsigned confirmation, stores versions, queues delivery with attachment', async () => {
  const pdf = Buffer.from('%PDF-1.7 test signed contract').toString('base64');
  const noConfirm = await call('POST', `/api/contracts/${contractId}/document`, { filename: 'signed.pdf', content_base64: pdf }, { as: 'admin' });
  assert.equal(noConfirm.status, 422, 'must confirm fully signed');
  const v1 = await call('POST', `/api/contracts/${contractId}/document`, { filename: 'signed.pdf', content_base64: pdf, confirm_fully_signed: true }, { as: 'admin' });
  assert.equal(v1.status, 201); assert.equal(v1.body.version, 1);
  const v2 = await call('POST', `/api/contracts/${contractId}/document`, { filename: 'signed-rev2.pdf', content_base64: pdf, confirm_fully_signed: true }, { as: 'admin' });
  assert.equal(v2.body.version, 2, 'revision becomes new version, never replaces');
  const delivery = db.prepare("SELECT * FROM outbox WHERE template='contract_delivery' AND to_id=? ORDER BY id DESC").get(customerId);
  assert.ok(delivery.attach_path, 'PDF attached to delivery email');
});
test('measure completed → commission due; adjustment recalculates', async () => {
  const r = await call('POST', `/api/projects/${projectId}/measure-complete`, { adjustment: 500, adjustment_note: 'upsell: extra shelf + grab bar' }, { as: 'admin' });
  assert.equal(r.status, 200);
  const comm = db.prepare('SELECT * FROM commissions WHERE contract_id=?').get(contractId);
  assert.equal(comm.status, 'due');
  assert.ok(comm.discount_pct < 9, 'upsell reduced effective discount');
});
test('install dates: tentative vs confirmed messaging; tentative never says confirmed', async () => {
  await call('POST', `/api/projects/${projectId}/install-date`, { kind: 'tentative', date: '2026-08-03' }, { as: 'admin' });
  const tent = db.prepare("SELECT * FROM outbox WHERE template='install_tentative' AND to_id=?").get(customerId);
  assert.ok(tent && /isn't confirmed|not.*confirmed|tentative/i.test(tent.body));
  await call('POST', `/api/projects/${projectId}/install-date`, { kind: 'confirmed', date: '2026-08-10' }, { as: 'admin' });
  const conf = db.prepare("SELECT * FROM outbox WHERE template='install_confirmed' AND to_id=?").get(customerId);
  assert.ok(conf && /confirmed/i.test(conf.body));
});
test('magic link portal: bundle, message, service call w/ emergency escalation', async () => {
  const ml = await call('POST', `/api/customers/${customerId}/magic-link`, {}, { as: 'admin' });
  portalToken = new URL(ml.body.url).searchParams.get('t');
  const bundle = await call('GET', `/api/portal/bundle?t=${portalToken}`);
  assert.equal(bundle.status, 200);
  assert.equal(bundle.body.project.install.status, 'Confirmed');
  assert.equal(bundle.body.balance, D.round2(15212 - 5000));
  assert.ok(!JSON.stringify(bundle.body).includes('commission'), 'no internal fields leak to portal');
  const bad = await call('GET', '/api/portal/bundle?t=wrong-token');
  assert.equal(bad.status, 401);
  const svc = await call('POST', `/api/portal/service?t=${portalToken}`, { category: 'Water damage', description: 'water coming through ceiling', leak: true });
  assert.equal(svc.body.urgency, 'emergency');
  const alert = db.prepare("SELECT * FROM outbox WHERE template='mgmt_emergency_service'").get();
  assert.ok(alert, 'management alerted immediately on emergency');
});
test('service call lifecycle: resolve → reopen increments counter', async () => {
  const sc = db.prepare('SELECT * FROM service_calls ORDER BY id DESC').get();
  await call('POST', `/api/service-calls/${sc.id}/stage`, { stage: 'acknowledged' }, { as: 'admin' });
  await call('POST', `/api/service-calls/${sc.id}/stage`, { stage: 'resolved' }, { as: 'admin' });
  await call('POST', `/api/service-calls/${sc.id}/stage`, { stage: 'reopened' }, { as: 'admin' });
  const after = db.prepare('SELECT * FROM service_calls WHERE id=?').get(sc.id);
  assert.equal(after.reopened_count, 1);
  assert.equal(after.resolved_at, null);
});
test('installer invoice over HTTP → approval feeds job costs exactly once', async () => {
  db.prepare('UPDATE projects SET installer_id=? WHERE id=?').run(db.prepare("SELECT id FROM users WHERE role='installer'").get().id, projectId);
  const inv = await call('POST', '/api/installer/invoices', {
    project_id: projectId,
    lines: [{ code: db.prepare('SELECT code FROM installer_rates ORDER BY id LIMIT 1').get().code, qty: 1 }],
    receipts: [{ description: 'materials', total: 113 }],
    mileage_km: 60,
    bonus_checklist: { photos: true, form: true, payment: true, review: true },
  }, { as: 'installer' });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.receipts[0].pre_tax, 100);
  await call('POST', `/api/manage/installer-invoices/${inv.body.id}/decide`, { status: 'approved' }, { as: 'admin' });
  await call('POST', `/api/manage/installer-invoices/${inv.body.id}/decide`, { status: 'paid' }, { as: 'admin' });
  const costs = db.prepare("SELECT COUNT(*) n FROM job_costs WHERE source=?").get('installer-invoice:' + inv.body.id);
  assert.equal(costs.n, 1, 'cost fed to profitability exactly once despite two decisions');
});
test('webhooks: dedup, failure capture (never silent)', async () => {
  const ev = { event_id: 'occ-evt-1', type: 'contract.signed', data: { customer_email: 'nobody@nowhere.example', final_price: 10000 } };
  const first = await call('POST', '/webhooks/occ', ev);
  assert.equal(first.status, 202, 'unmatched customer → held for review, not dropped');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM integration_failures WHERE source='occ' AND status='open'").get().n, 1);
  const dup = await call('POST', '/webhooks/occ', ev);
  assert.equal(dup.body.duplicate, true, 'duplicate event_id ignored');
  const pay = await call('POST', '/webhooks/helcim', { event_id: 'h-1', data: { amount: D.round2(15212 - 5000), customer_email: 'test.homeowner@example.com', transaction_id: 'TX9' } });
  assert.equal(pay.status, 200);
  assert.equal(db.prepare("SELECT status FROM payments WHERE helcim_txn_id='TX9'").get().status, 'received');
});
test('overdue sweep: tier 1 reminder then tier 2 escalation', async () => {
  const repId = db.prepare("SELECT id FROM users WHERE role='rep'").get().id;
  const r = db.prepare(
    `INSERT INTO appointments (customer_id, rep_id, scheduled_at, assigned_at, ack_deadline, result_status, result_deadline)
     VALUES (?,?,datetime('now','+1 day'),datetime('now','-4 hours'),datetime('now','-3 hours'),'none',datetime('now','+1 day'))`
  ).run(customerId, repId);
  scheduler.sweepAcknowledgements(db);
  let a = db.prepare('SELECT * FROM appointments WHERE id=?').get(r.lastInsertRowid);
  assert.equal(a.ack_tier, 1, 'tier 1 after first sweep');
  db.prepare("UPDATE appointments SET ack_tier1_at=datetime('now','-3 hours') WHERE id=?").run(a.id);
  scheduler.sweepAcknowledgements(db);
  a = db.prepare('SELECT * FROM appointments WHERE id=?').get(a.id);
  assert.equal(a.ack_tier, 2, 'tier 2 after no response');
});
test('cooldown: second non-urgent message within 24h is held', async () => {
  const c = await call('POST', '/api/customers', { name: 'Cooldown Test', email: 'cool@example.com' }, { as: 'admin' });
  D.queueMessage(db, { toKind: 'customer', toId: c.body.id, channel: 'email', template: 'satisfaction_request', subject: 's', body: 'b' });
  const second = D.queueMessage(db, { toKind: 'customer', toId: c.body.id, channel: 'email', template: 'payment_reminder', subject: 's2', body: 'b2' });
  const row = db.prepare('SELECT * FROM outbox WHERE id=?').get(second);
  assert.equal(row.status, 'held_cooldown');
  const urgent = D.queueMessage(db, { toKind: 'customer', toId: c.body.id, channel: 'email', template: 'service_ack', subject: 'u', body: 'u', urgent: true });
  assert.equal(db.prepare('SELECT status FROM outbox WHERE id=?').get(urgent).status, 'queued', 'urgent bypasses cooldown');
});
test('permissions: rep cannot access management; portal token cannot access staff APIs', async () => {
  assert.equal((await call('GET', '/api/manage/commissions', null, { as: 'rep' })).status, 401);
  assert.equal((await call('GET', '/api/manage/dashboard', null, { as: 'installer' })).status, 401);
  const r = await fetch(base + '/api/manage/dashboard', { headers: { 'X-Portal-Token': portalToken } });
  assert.equal(r.status, 401);
});
test('audit log records sensitive changes', () => {
  const n = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity IN ('contract','commission','project')").get().n;
  assert.ok(n >= 3, 'audit entries exist for contract/commission/project changes, got ' + n);
});
