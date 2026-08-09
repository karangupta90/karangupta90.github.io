'use strict';
// FSBS Operations — business rules. Pure functions where possible; db passed in where needed.
const { getSetting, audit } = require('./db');

// ---------- Deadlines (all local time; server runs with TZ=America/Toronto) ----------

// Acknowledgement deadline per 06-future-state-operating-model.md §2.
// assignedAt / apptStart: Date objects.
function ackDeadline(assignedAt, apptStart, opts = {}) {
  const deadlineHour = opts.ackDeadlineHour ?? 23;
  const lateHour = opts.lateAssignHour ?? 21;
  const windowH = opts.exceptionWindowHours ?? 2;
  const sameEvening = assignedAt.getHours() >= lateHour;
  const nextMorning9 = new Date(assignedAt); nextMorning9.setDate(nextMorning9.getDate() + 1); nextMorning9.setHours(9, 0, 0, 0);
  const apptSoon = apptStart <= nextMorning9;
  if (sameEvening || apptSoon) {
    const plus2 = new Date(assignedAt.getTime() + windowH * 3600e3);
    return plus2 < apptStart ? plus2 : apptStart; // whichever is sooner
  }
  const d = new Date(assignedAt); d.setHours(deadlineHour, 0, 0, 0);
  return d;
}

// Post-appointment result deadline per §3: max(9 PM day-of, appt end + 2h).
function resultDeadline(apptStart, durationMin, opts = {}) {
  const hour = opts.resultDeadlineHour ?? 21;
  const windowH = opts.exceptionWindowHours ?? 2;
  const ninePM = new Date(apptStart); ninePM.setHours(hour, 0, 0, 0);
  const endPlus2 = new Date(apptStart.getTime() + (durationMin || 90) * 60e3 + windowH * 3600e3);
  return endPlus2 > ninePM ? endPlus2 : ninePM;
}

function isRepUnavailable(user, onDate) {
  try {
    const days = JSON.parse(user.unavailable_dates || '[]');
    const d = onDate.toISOString().slice(0, 10);
    return days.includes(d);
  } catch { return false; }
}

// ---------- Commissions (2026 rules: rate by discount band, on pre-tax amount) ----------

function commissionRate(db, discountPct) {
  const row = db.prepare(
    'SELECT rate FROM commission_rules WHERE active=1 AND ? >= min_discount AND ? <= max_discount ORDER BY min_discount LIMIT 1'
  ).get(discountPct, discountPct);
  return row ? row.rate : null;
}

// adjustment: upsell(+)/missed(-) $ impact discovered at measure; shifts effective discount.
function computeCommission(db, { initialPrice, finalPrice, hstRate, adjustment = 0 }) {
  const effFinal = finalPrice + adjustment;
  const discountPct = initialPrice > 0 ? Math.max(0, ((initialPrice - effFinal) / initialPrice) * 100) : 0;
  const rate = commissionRate(db, round2(discountPct));
  if (rate === null) return null;
  const preTax = effFinal / (1 + hstRate);
  return {
    discount_pct: round2(discountPct),
    pre_tax_amount: round2(preTax),
    rate,
    amount: round2(preTax * (rate / 100)),
  };
}

// ---------- Installer invoices (rate card + receipts w/ HST back-calc + mileage + bonus) ----------

function computeInvoice(db, { lines = [], receipts = [], mileageKm = 0, bonusChecklist = {} }) {
  const hst = getSetting(db, 'hst_rate');
  const freeKm = getSetting(db, 'mileage_free_km');
  const kmRate = getSetting(db, 'mileage_rate');
  const bonusAmt = getSetting(db, 'bonus_amount');

  const outLines = lines.map(l => ({ ...l, total: round2(l.qty * l.unit_price) }));
  const chargeableKm = Math.max(0, (mileageKm || 0) - freeKm);
  if (chargeableKm > 0) outLines.push({ rate_code: 'mileage', label: `Mileage (${mileageKm} km, first ${freeKm} free)`, qty: chargeableKm, unit_price: kmRate, total: round2(chargeableKm * kmRate) });

  const outReceipts = receipts.map(r => {
    const preTax = round2(r.total / (1 + hst));
    return { ...r, pre_tax: preTax, hst: round2(r.total - preTax) };
  });
  const receiptTotal = round2(outReceipts.reduce((s, r) => s + r.total, 0));
  if (receiptTotal > 0) outLines.push({ rate_code: 'receipts', label: 'Materials & dump fees (receipts attached)', qty: 1, unit_price: receiptTotal, total: receiptTotal });

  const subtotal = round2(outLines.reduce((s, l) => s + l.total, 0));
  const bonusEarned = ['photos', 'form', 'payment', 'review'].every(k => bonusChecklist[k] === true);
  const bonus = bonusEarned ? bonusAmt : 0;
  const hstAmt = round2((subtotal + bonus) * hst); // labour is HST-applicable for subcontractors (per pay-sheet template)
  return { lines: outLines, receipts: outReceipts, subtotal, bonus, hst: hstAmt, total: round2(subtotal + bonus + hstAmt) };
}

// ---------- Customer-facing stage mapping ----------

const STAGE_LABELS = {
  project_review: 'Project review',
  measurements: 'Measurements',
  materials: 'Materials in progress',
  install_scheduling: 'Installation scheduling',
  install_confirmed: 'Installation confirmed',
  install_in_progress: 'Installation in progress',
  install_complete: 'Installation complete',
  follow_up: 'Follow-up',
  complete: 'Project complete',
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);

function installDateView(project) {
  if (project.install_confirmed) return { date: project.install_confirmed, status: 'Confirmed' };
  if (project.install_reserved) return { date: project.install_reserved, status: 'Tentative' }; // reserved shown as tentative to customer
  if (project.install_tentative) return { date: project.install_tentative, status: 'Tentative' };
  return { date: null, status: 'Not yet scheduled' };
}

// ---------- Payments / revenue rollup (per 2025 job-revenue sheet structure) ----------

function projectFinancials(db, projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p) return null;
  const c = p.contract_id ? db.prepare('SELECT * FROM contracts WHERE id=?').get(p.contract_id) : null;
  const pays = db.prepare("SELECT * FROM payments WHERE project_id=?").all(projectId);
  const collected = round2(pays.filter(x => x.status === 'received').reduce((s, x) => s + x.amount, 0));
  const contractTotal = c ? c.final_price : 0;
  const costs = db.prepare('SELECT category, SUM(amount) amt, SUM(tax) tax FROM job_costs WHERE project_id=? GROUP BY category').all(projectId);
  const totalCost = round2(costs.reduce((s, x) => s + x.amt, 0));
  const comm = c ? db.prepare("SELECT SUM(amount+adjustment) a FROM commissions WHERE contract_id=? AND status NOT IN ('reversed')").get(c.id)?.a || 0 : 0;
  const grossProfit = round2(contractTotal / 1.13 - totalCost - comm); // revenue pre-tax vs costs
  return {
    contract_total: contractTotal,
    collected,
    ar: round2(contractTotal - collected),
    finance_fees: p.finance_fees,
    costs, total_cost: totalCost,
    commission: round2(comm),
    gross_profit: grossProfit,
    gross_margin: contractTotal > 0 ? round2((grossProfit / (contractTotal / 1.13)) * 100) : 0,
  };
}

// ---------- Outbox with cooldown (06 §12) ----------

function queueMessage(db, { toKind, toId, channel, template, subject, body, attachPath = null, urgent = false }) {
  let scheduledFor = new Date();
  let status = 'queued';
  if (!urgent && toKind === 'customer') {
    const cooldownH = getSetting(db, 'cooldown_hours');
    const recent = db.prepare(
      "SELECT MAX(COALESCE(sent_at, scheduled_for)) m FROM outbox WHERE to_kind='customer' AND to_id=? AND urgent=0 AND status IN ('queued','sent')"
    ).get(toId)?.m;
    if (recent) {
      const nextOk = new Date(new Date(recent + 'Z').getTime() + cooldownH * 3600e3);
      if (nextOk > scheduledFor) { scheduledFor = nextOk; status = 'held_cooldown'; }
    }
  }
  const r = db.prepare(
    'INSERT INTO outbox (to_kind,to_id,channel,template,subject,body,attach_path,urgent,status,scheduled_for) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(toKind, toId, channel, template, subject, body, attachPath, urgent ? 1 : 0, status, sqlDate(scheduledFor));
  return r.lastInsertRowid;
}

// ---------- Service calls ----------

const SC_STAGES = ['received','acknowledged','info_requested','under_review','triage_complete','appointment_required','scheduled','assigned','waiting_parts','waiting_manufacturer','customer_unavailable','visit_completed','follow_up_required','resolved','closed','reopened'];

function classifyUrgency({ category = '', safety = false, leak = false }) {
  if (safety || leak || /leak|safety/i.test(category)) return 'emergency';
  if (/not draining|no water|door.*(off|broken)/i.test(category)) return 'urgent';
  if (/question|education/i.test(category)) return 'informational';
  return 'standard';
}

// ---------- Sold-job handoff (06 §5) ----------

const HANDOFF_ITEMS = ['contract', 'design', 'photos', 'deposit', 'measurements'];

function createProjectFromContract(db, contract, byUser) {
  const r = db.prepare('INSERT INTO projects (customer_id, contract_id) VALUES (?,?)').run(contract.customer_id, contract.id);
  const projectId = r.lastInsertRowid;
  db.prepare('UPDATE contracts SET project_id=? WHERE id=?').run(projectId, contract.id);
  const ins = db.prepare('INSERT INTO project_checklist (project_id, item, done) VALUES (?,?,0)');
  for (const item of HANDOFF_ITEMS) ins.run(projectId, item);
  // payment schedule mirrors the real sales agreement: down payment + balance at substantial completion
  db.prepare("INSERT INTO payments (project_id, customer_id, kind, amount, status) VALUES (?,?,'deposit',?, 'due')")
    .run(projectId, contract.customer_id, contract.deposit_due);
  db.prepare("INSERT INTO payments (project_id, customer_id, kind, amount, status) VALUES (?,?,'final',?, 'due')")
    .run(projectId, contract.customer_id, round2(contract.final_price - contract.deposit_due));
  audit(db, { entity: 'project', entityId: projectId, field: 'created', newValue: `from contract ${contract.id}`, byUser });
  return projectId;
}

// ---------- Result validation (06 §3 guardrails) ----------

const OUTCOMES = ['sold','pitch_miss','standby','no_demo','out_of_scope','cancelled','no_show','rescheduled','financing_pending','decision_maker_absent','proposal_pending','other'];
const EXPLAIN_REQUIRED = ['cancelled','no_show','rescheduled','out_of_scope','other'];

function validateResult(outcome, data) {
  const errors = [];
  if (!OUTCOMES.includes(outcome)) errors.push('Unknown outcome.');
  if (EXPLAIN_REQUIRED.includes(outcome) && !String(data.explanation || '').trim()) errors.push('An explanation is required for this outcome.');
  if (outcome === 'sold') {
    if (!data.contract_signed) errors.push('"Sold" requires a signed contract on file.');
    if (data.final_price == null || data.final_price <= 0) errors.push('"Sold" requires the final selling price.');
  }
  if (outcome === 'standby' && !data.follow_up_date) errors.push('Standby/follow-up requires a follow-up date.');
  if (data.financing_pending && data.deposit_collected && !String(data.deposit_note || '').trim())
    errors.push('Financing pending + deposit collected requires a note explaining the combination.');
  if (data.initial_price != null && data.lowest_price != null && Number(data.lowest_price) > Number(data.initial_price))
    errors.push('Lowest price cannot exceed initial price.');
  return errors;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function sqlDate(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

module.exports = {
  ackDeadline, resultDeadline, isRepUnavailable,
  commissionRate, computeCommission,
  computeInvoice,
  STAGE_LABELS, STAGE_ORDER, installDateView,
  projectFinancials, queueMessage,
  SC_STAGES, classifyUrgency,
  HANDOFF_ITEMS, createProjectFromContract,
  OUTCOMES, validateResult,
  round2, sqlDate,
};
