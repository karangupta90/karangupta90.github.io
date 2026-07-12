'use strict';
// Seeding: loads seed/seed.private.json (real business config — git-ignored) when present,
// otherwise seed/seed.example.json (fictional placeholder values, committed).
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./auth');

function loadSeedConfig() {
  const dir = path.join(__dirname, '..', 'seed');
  for (const f of ['seed.private.json', 'seed.example.json']) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return { config: JSON.parse(fs.readFileSync(p, 'utf8')), source: f };
  }
  throw new Error('No seed file found in app/seed/.');
}

function ensureSeed(db) {
  const already = db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
  if (already) return { seeded: false };
  const { config, source } = loadSeedConfig();

  const insUser = db.prepare('INSERT INTO users (name,email,phone,role,pass_hash) VALUES (?,?,?,?,?)');
  for (const u of config.users) insUser.run(u.name, u.email.toLowerCase(), u.phone || null, u.role, hashPassword(u.password));

  const insRule = db.prepare('INSERT INTO commission_rules (min_discount,max_discount,rate) VALUES (?,?,?)');
  for (const r of config.commission_rules) insRule.run(r.min_discount, r.max_discount, r.rate);

  const insRate = db.prepare('INSERT INTO installer_rates (code,label,rate,unit,requires_photo,requires_receipt,sort) VALUES (?,?,?,?,?,?,?)');
  config.installer_rates.forEach((r, i) => insRate.run(r.code, r.label, r.rate, r.unit || 'ea', r.requires_photo ? 1 : 0, r.requires_receipt ? 1 : 0, i));

  if (config.settings) {
    const set = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const [k, v] of Object.entries(config.settings)) set.run(k, JSON.stringify(v));
  }

  if (config.demo_customers) {
    const insCust = db.prepare('INSERT INTO customers (name,email,phone,address,postal,consent_marketing,consent_photo_video) VALUES (?,?,?,?,?,?,?)');
    const consent = JSON.stringify({ given: true, at: new Date().toISOString(), method: 'seed-demo' });
    for (const c of config.demo_customers) insCust.run(c.name, c.email, c.phone, c.address, c.postal || null, consent, consent);
  }
  return { seeded: true, source };
}

module.exports = { ensureSeed, loadSeedConfig };
