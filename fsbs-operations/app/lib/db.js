'use strict';
// FSBS Operations — database layer (node:sqlite, zero external deps)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','office','rep','installer')),
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  unavailable_dates TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  city TEXT DEFAULT 'Ottawa',
  province TEXT DEFAULT 'Ontario',
  postal TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  consent_marketing TEXT,          -- json {given,at,method}
  consent_photo_video TEXT,        -- json {given,at,method}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS magic_links (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  token_hash TEXT UNIQUE NOT NULL,
  label TEXT,                      -- e.g. 'primary', 'authorized contact: <name>'
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  rep_id INTEGER REFERENCES users(id),
  scheduled_at TEXT NOT NULL,      -- ISO local
  duration_min INTEGER NOT NULL DEFAULT 90,
  assigned_at TEXT,
  project_type TEXT,
  lead_notes TEXT,
  status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','completed','cancelled','no_show','rescheduled')),
  ack_status TEXT NOT NULL DEFAULT 'pending' CHECK(ack_status IN ('pending','acknowledged','skipped_unavailable')),
  ack_response TEXT,
  ack_at TEXT,
  ack_deadline TEXT,
  ack_tier INTEGER NOT NULL DEFAULT 0,       -- 0 none, 1 rep reminded, 2 escalated
  ack_tier1_at TEXT,
  result_status TEXT NOT NULL DEFAULT 'none' CHECK(result_status IN ('none','pending','draft','submitted','returned')),
  result_deadline TEXT,
  result_tier INTEGER NOT NULL DEFAULT 0,
  result_tier1_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  version INTEGER NOT NULL DEFAULT 1,
  outcome TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}', -- json: conditional fields
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  returned_reason TEXT,
  superseded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  rep_id INTEGER REFERENCES users(id),
  initial_price REAL,
  lowest_price REAL,
  amount REAL,
  discount_amount REAL,
  discount_pct REAL,
  scope TEXT,
  products TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','sold','lost','follow_up')),
  follow_up_date TEXT,
  occ_estimate_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY,
  proposal_id INTEGER REFERENCES proposals(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  project_id INTEGER,
  final_price REAL NOT NULL,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  deposit_due REAL NOT NULL DEFAULT 0,
  signed_at TEXT,
  occ_document_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sent','failed','resent')),
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  project_id INTEGER,
  contract_id INTEGER REFERENCES contracts(id),
  kind TEXT NOT NULL CHECK(kind IN ('contract','proposal','design','receipt','guide','warranty','completion','service','other')),
  title TEXT NOT NULL,
  filename TEXT,
  path TEXT,
  external_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by INTEGER REFERENCES users(id),
  source TEXT,                     -- 'upload','occ-webhook','import',...
  customer_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  contract_id INTEGER REFERENCES contracts(id),
  stage TEXT NOT NULL DEFAULT 'project_review',
  install_requested TEXT,
  install_tentative TEXT,
  install_reserved TEXT,
  install_confirmed TEXT,
  install_started_at TEXT,
  install_completed_at TEXT,
  installer_id INTEGER REFERENCES users(id),
  finance_or_cash TEXT CHECK(finance_or_cash IN ('finance','cash',NULL)),
  finance_fees REAL NOT NULL DEFAULT 0,
  measure_status TEXT NOT NULL DEFAULT 'pending' CHECK(measure_status IN ('pending','scheduled','completed')),
  measure_completed_at TEXT,
  notes TEXT,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_checklist (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  PRIMARY KEY (project_id, item)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL CHECK(kind IN ('deposit','progress','final','refund')),
  method TEXT CHECK(method IN ('etransfer','cheque','card','financing','cash',NULL)),
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK(status IN ('due','received','waived')),
  received_at TEXT,
  reference TEXT,
  helcim_txn_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_costs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  category TEXT NOT NULL,          -- sentrel|wall_system|base_tub|door_glass|fixtures|installer|plumbing|freight|materials_other|service_call|rework|finance_fees
  description TEXT,
  amount REAL NOT NULL,
  tax REAL NOT NULL DEFAULT 0,
  month TEXT,                      -- YYYY-MM attribution
  source TEXT,                     -- 'manual','installer-invoice','material-order'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS material_orders (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  label TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'job' CHECK(order_type IN ('job','stock','service_warranty','inventory','display','other')),
  order_number TEXT,
  subtotal REAL NOT NULL,
  tax REAL NOT NULL DEFAULT 0,
  order_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS service_calls (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  project_id INTEGER REFERENCES projects(id),
  category TEXT NOT NULL,
  description TEXT,
  urgency TEXT NOT NULL DEFAULT 'standard' CHECK(urgency IN ('emergency','urgent','standard','informational')),
  safety INTEGER NOT NULL DEFAULT 0,
  leak INTEGER NOT NULL DEFAULT 0,
  warranty_class TEXT NOT NULL DEFAULT 'undetermined',
  stage TEXT NOT NULL DEFAULT 'received',
  assigned_to INTEGER REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'portal',
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS service_events (
  id INTEGER PRIMARY KEY,
  service_call_id INTEGER NOT NULL REFERENCES service_calls(id),
  event TEXT NOT NULL,
  note TEXT,
  by_user INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS commission_rules (
  id INTEGER PRIMARY KEY,
  min_discount REAL NOT NULL,      -- inclusive, percent
  max_discount REAL NOT NULL,      -- inclusive, percent
  rate REAL NOT NULL,              -- percent
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  rep_id INTEGER REFERENCES users(id),
  sale_date TEXT,
  initial_price REAL,
  final_price REAL NOT NULL,
  discount_pct REAL NOT NULL,
  pre_tax_amount REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL,
  adjustment REAL NOT NULL DEFAULT 0,      -- upsell(+)/missed(-) discount impact $
  adjustment_note TEXT,
  status TEXT NOT NULL DEFAULT 'estimated' CHECK(status IN ('estimated','pending','due','approved','paid','held','reversed')),
  exception_note TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS commission_payouts (
  id INTEGER PRIMARY KEY,
  rep_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS installer_rates (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  rate REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ea', -- ea|sqft|hour|km
  requires_photo INTEGER NOT NULL DEFAULT 0,
  requires_receipt INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS installer_invoices (
  id INTEGER PRIMARY KEY,
  installer_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','review','correction','approved','partial','rejected','scheduled','paid')),
  subtotal REAL NOT NULL DEFAULT 0,
  hst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  approved_total REAL,
  bonus_amount REAL NOT NULL DEFAULT 0,
  bonus_checklist TEXT NOT NULL DEFAULT '{}',  -- json: photos, form, payment, review
  note TEXT,
  decision_note TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES installer_invoices(id),
  rate_code TEXT,
  label TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_receipts (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES installer_invoices(id),
  description TEXT,
  total REAL NOT NULL,             -- receipt total incl. tax
  pre_tax REAL NOT NULL,           -- back-calculated: total / 1.13
  hst REAL NOT NULL,
  path TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  channel TEXT NOT NULL DEFAULT 'portal',
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  by_user INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  to_kind TEXT NOT NULL CHECK(to_kind IN ('customer','user')),
  to_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  template TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  attach_path TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed','held_cooldown')),
  scheduled_for TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  by_user INTEGER,
  reason TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sync_dedup (
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, event_id)
);
CREATE TABLE IF NOT EXISTS integration_failures (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  payload TEXT,
  error TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  resolved_by INTEGER,
  resolved_note TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_drafts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  context TEXT,
  draft TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','edited','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  hst_rate: 0.13,
  ack_deadline_hour: 23,           // 11:00 PM
  result_deadline_hour: 21,        // 9:00 PM
  late_assign_hour: 21,            // assignments at/after 9 PM use the exception rule
  exception_window_hours: 2,
  tier2_after_hours: 2,            // escalate 2h after tier-1 reminder with no response
  cooldown_hours: 24,              // non-urgent customer message cooldown
  magic_link_days: 14,
  max_authorized_contacts: 2,
  bonus_amount: 150,
  mileage_rate: 0.40,
  mileage_free_km: 50,
  office_phone: '+1 343-843-2719',
  office_address: '1 Rideau St, Office No 728, Ottawa, Ontario K1N 8S7',
  company_name: 'Five Star Bath Solutions of Ottawa',
  attachment_max_mb: 15,
};

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, JSON.stringify(v));
  return db;
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : undefined;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}
function audit(db, { entity, entityId = null, field = null, oldValue = null, newValue = null, byUser = null, reason = null }) {
  db.prepare('INSERT INTO audit_log (entity,entity_id,field,old_value,new_value,by_user,reason) VALUES (?,?,?,?,?,?,?)')
    .run(entity, entityId, field, oldValue === null ? null : String(oldValue), newValue === null ? null : String(newValue), byUser, reason);
}

module.exports = { open, getSetting, setSetting, audit, DEFAULT_SETTINGS };
