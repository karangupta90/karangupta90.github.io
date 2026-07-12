'use strict';
// FSBS Operations — application server. Zero external dependencies (Node 22+, node:sqlite).
process.env.TZ = process.env.TZ || 'America/Toronto';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, getSetting, setSetting, audit } = require('./lib/db');
const auth = require('./lib/auth');
const D = require('./lib/domain');
const scheduler = require('./lib/scheduler');
const { render } = require('./lib/templates');

const ROOT = __dirname;
const DATA_DIR = process.env.FSBS_DATA_DIR || path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const PUBLIC_DIR = path.join(ROOT, 'public');
fs.mkdirSync(FILES_DIR, { recursive: true });

function createApp({ dbPath = path.join(DATA_DIR, 'fsbs.db'), baseUrl = '' } = {}) {
  const db = open(dbPath);
  const routes = [];
  const route = (method, pattern, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    routes.push({ method, re: new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), keys: (pattern.match(/:\w+/g) || []).map(k => k.slice(1)), opts, handler });
  };
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const ROLES = { staff: ['admin', 'manager', 'office'], rep: ['rep', 'manager', 'admin'], installer: ['installer', 'admin'], any: ['admin', 'manager', 'office', 'rep', 'installer'] };

  function portalLink(customerId) {
    // The durable link in messages points at the portal; token is issued/refreshed by office or renew endpoint.
    return `${baseUrl}/portal/`;
  }
  function queueCustomer(dbx, customerId, template, vars, { urgent = false, attachPath = null, channels = ['email', 'sms'] } = {}) {
    const t = render(dbx, template, { ...vars, portalLink: portalLink(customerId) });
    for (const channel of channels)
      D.queueMessage(dbx, { toKind: 'customer', toId: customerId, channel, template, subject: t.subject, body: t.body, attachPath, urgent });
  }
  function saveFile(name, base64) {
    const safe = String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
    const rel = crypto.randomBytes(6).toString('hex') + '-' + safe;
    fs.writeFileSync(path.join(FILES_DIR, rel), Buffer.from(base64, 'base64'));
    return rel;
  }

  // ---------------- Auth ----------------
  route('POST', '/api/login', async (req, res, m, body) => {
    const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(body.email || '').toLowerCase());
    if (!u || !auth.verifyPassword(body.password || '', u.pass_hash)) return json(res, 401, { error: 'Invalid email or password.' });
    const token = auth.createSession(db, u.id);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `fsbs=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 86400}` });
    res.end(JSON.stringify({ id: u.id, name: u.name, role: u.role }));
  });
  route('POST', '/api/logout', { auth: 'any' }, (req, res) => { auth.destroySession(db, auth.parseCookies(req).fsbs); json(res, 200, { ok: true }); });
  route('GET', '/api/me', { auth: 'any' }, (req, res) => json(res, 200, { id: req.user.id, name: req.user.name, role: req.user.role }));

  // ---------------- Appointments (office books; rep acknowledges & results) ----------------
  route('POST', '/api/appointments', { auth: 'staff' }, (req, res, m, b) => {
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(b.customer_id);
    const rep = db.prepare("SELECT * FROM users WHERE id=? AND role='rep'").get(b.rep_id);
    if (!cust || !rep) return json(res, 400, { error: 'customer_id and rep_id required and must exist.' });
    const scheduled = new Date(b.scheduled_at);
    const assigned = new Date();
    const opts = { ackDeadlineHour: getSetting(db, 'ack_deadline_hour'), lateAssignHour: getSetting(db, 'late_assign_hour'), exceptionWindowHours: getSetting(db, 'exception_window_hours') };
    const ackDl = D.ackDeadline(assigned, scheduled, opts);
    const resDl = D.resultDeadline(scheduled, b.duration_min || 90, { resultDeadlineHour: getSetting(db, 'result_deadline_hour'), exceptionWindowHours: opts.exceptionWindowHours });
    const r = db.prepare(
      `INSERT INTO appointments (customer_id, rep_id, scheduled_at, duration_min, assigned_at, project_type, lead_notes, ack_deadline, result_status, result_deadline)
       VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`
    ).run(cust.id, rep.id, D.sqlDate(scheduled), b.duration_min || 90, D.sqlDate(assigned), b.project_type || null, b.lead_notes || null, D.sqlDate(ackDl), D.sqlDate(resDl));
    queueCustomer(db, cust.id, 'appointment_confirmation', { firstName: cust.name.split(' ')[0], date: scheduled.toDateString(), time: scheduled.toTimeString().slice(0, 5), address: cust.address, repName: rep.name });
    D.queueMessage(db, { toKind: 'user', toId: rep.id, channel: 'sms', template: 'rep_new_appointment', subject: 'New appointment', body: `New appointment #${r.lastInsertRowid} — ${cust.name}, ${scheduled}. Please acknowledge.`, urgent: true });
    audit(db, { entity: 'appointment', entityId: r.lastInsertRowid, field: 'created', byUser: req.user.id });
    json(res, 201, { id: r.lastInsertRowid, ack_deadline: D.sqlDate(ackDl), result_deadline: D.sqlDate(resDl) });
  });

  route('GET', '/api/rep/appointments', { auth: 'rep' }, (req, res) => {
    const rows = db.prepare(
      `SELECT a.*, c.name customer_name, c.phone customer_phone, c.address, c.postal,
        (SELECT COUNT(*) FROM documents d WHERE d.kind='design' AND d.customer_id=a.customer_id) design_count
       FROM appointments a JOIN customers c ON c.id=a.customer_id
       WHERE a.rep_id=? AND a.status IN ('booked','completed') ORDER BY a.scheduled_at`
    ).all(req.user.id);
    json(res, 200, rows);
  });

  const ACK_RESPONSES = ['received', 'need_info', 'conflict', 'wrong_info', 'unable'];
  route('POST', '/api/rep/appointments/:id/ack', { auth: 'rep' }, (req, res, m, b) => {
    if (!ACK_RESPONSES.includes(b.response)) return json(res, 400, { error: 'Invalid acknowledgement response.' });
    const a = db.prepare('SELECT * FROM appointments WHERE id=? AND rep_id=?').get(m.id, req.user.id);
    if (!a) return json(res, 404, { error: 'Not found.' });
    db.prepare("UPDATE appointments SET ack_status='acknowledged', ack_response=?, ack_at=datetime('now'), ack_tier=0 WHERE id=?").run(b.response, a.id);
    if (b.response !== 'received')
      D.queueMessage(db, { toKind: 'user', toId: req.user.id, channel: 'email', template: 'mgmt_ack_issue', subject: `Rep flagged: ${b.response}`, body: `Appointment #${a.id}: rep responded "${b.response}"${b.note ? ' — ' + b.note : ''}. Office follow-up needed.`, urgent: true });
    audit(db, { entity: 'appointment', entityId: a.id, field: 'ack', newValue: b.response, byUser: req.user.id });
    json(res, 200, { ok: true });
  });

  route('POST', '/api/rep/appointments/:id/result', { auth: 'rep' }, (req, res, m, b) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id=? AND rep_id=?').get(m.id, req.user.id);
    if (!a) return json(res, 404, { error: 'Not found.' });
    const data = b.data || {};
    if (b.draft) {
      db.prepare("UPDATE appointments SET result_status='draft' WHERE id=?").run(a.id);
      return json(res, 200, { ok: true, draft: true });
    }
    const errors = D.validateResult(b.outcome, data);
    if (errors.length) return json(res, 422, { errors });
    db.prepare('UPDATE results SET superseded=1 WHERE appointment_id=?').run(a.id);
    const ver = (db.prepare('SELECT MAX(version) v FROM results WHERE appointment_id=?').get(a.id)?.v || 0) + 1;
    db.prepare('INSERT INTO results (appointment_id, version, outcome, data, submitted_by) VALUES (?,?,?,?,?)')
      .run(a.id, ver, b.outcome, JSON.stringify(data), req.user.id);
    db.prepare("UPDATE appointments SET result_status='submitted', result_tier=0, status=CASE WHEN status='booked' THEN 'completed' ELSE status END WHERE id=?").run(a.id);

    // Proposal record — retained sold OR unsold.
    let proposalId = null;
    if (data.proposal_created !== false && data.initial_price != null) {
      const init = Number(data.initial_price), low = Number(data.lowest_price ?? data.initial_price);
      const discAmt = D.round2(init - low), discPct = init > 0 ? D.round2((discAmt / init) * 100) : 0;
      const status = b.outcome === 'sold' ? 'sold' : (b.outcome === 'standby' ? 'follow_up' : 'open');
      const pr = db.prepare(
        `INSERT INTO proposals (appointment_id, customer_id, rep_id, initial_price, lowest_price, amount, discount_amount, discount_pct, scope, status, follow_up_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(a.id, a.customer_id, req.user.id, init, low, low, discAmt, discPct, data.requested_project || a.project_type, status, data.follow_up_date || null);
      proposalId = pr.lastInsertRowid;
    }

    // Sold → contract + handoff + commission estimate + welcome.
    if (b.outcome === 'sold') {
      const final = Number(data.final_price), init = Number(data.initial_price ?? data.final_price);
      const discAmt = D.round2(init - final), discPct = init > 0 ? D.round2((discAmt / init) * 100) : 0;
      const cr = db.prepare(
        `INSERT INTO contracts (proposal_id, customer_id, final_price, discount_amount, discount_pct, deposit_due, signed_at)
         VALUES (?,?,?,?,?,?, datetime('now'))`
      ).run(proposalId, a.customer_id, final, discAmt, discPct, Number(data.deposit_amount || 0));
      const contract = db.prepare('SELECT * FROM contracts WHERE id=?').get(cr.lastInsertRowid);
      const projectId = D.createProjectFromContract(db, contract, req.user.id);
      if (data.deposit_collected) {
        db.prepare("UPDATE payments SET status='received', received_at=datetime('now'), method=? WHERE project_id=? AND kind='deposit'").run(data.deposit_method || null, projectId);
        db.prepare("UPDATE project_checklist SET done=1, done_at=datetime('now') WHERE project_id=? AND item='deposit'").run(projectId);
      }
      const hst = getSetting(db, 'hst_rate');
      const comm = D.computeCommission(db, { initialPrice: init, finalPrice: final, hstRate: hst });
      if (comm) db.prepare(
        `INSERT INTO commissions (contract_id, rep_id, sale_date, initial_price, final_price, discount_pct, pre_tax_amount, rate, amount, status)
         VALUES (?,?,date('now'),?,?,?,?,?,?, 'estimated')`
      ).run(contract.id, req.user.id, init, final, comm.discount_pct, comm.pre_tax_amount, comm.rate, comm.amount);
      const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(a.customer_id);
      queueCustomer(db, cust.id, 'post_sale_welcome', { firstName: cust.name.split(' ')[0] });
      if (data.install_timing) db.prepare('UPDATE projects SET install_requested=? WHERE id=?').run(data.install_timing, projectId);
      audit(db, { entity: 'contract', entityId: contract.id, field: 'created', newValue: `sold via appointment ${a.id}`, byUser: req.user.id });
      return json(res, 201, { ok: true, proposal_id: proposalId, contract_id: contract.id, project_id: projectId, commission: comm });
    }
    json(res, 201, { ok: true, proposal_id: proposalId });
  });

  route('POST', '/api/rep/appointments/:id/design', { auth: 'rep' }, (req, res, m, b) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id=? AND rep_id=?').get(m.id, req.user.id);
    if (!a) return json(res, 404, { error: 'Not found.' });
    if (!b.external_url && !b.content_base64) return json(res, 400, { error: 'Provide a file (content_base64+filename) or a secure link (external_url).' });
    const ver = (db.prepare("SELECT MAX(version) v FROM documents WHERE customer_id=? AND kind='design'").get(a.customer_id)?.v || 0) + 1;
    const rel = b.content_base64 ? saveFile(b.filename, b.content_base64) : null;
    const proj = db.prepare('SELECT p.id FROM projects p JOIN contracts c ON c.id=p.contract_id WHERE c.customer_id=? ORDER BY p.id DESC').get(a.customer_id);
    db.prepare(
      `INSERT INTO documents (customer_id, project_id, kind, title, filename, path, external_url, version, uploaded_by, source)
       VALUES (?,?,?,?,?,?,?,?,?, 'rep-upload')`
    ).run(a.customer_id, proj?.id || null, 'design', b.title || `3D Design v${ver}`, b.filename || null, rel, b.external_url || null, ver, req.user.id);
    if (proj) db.prepare("UPDATE project_checklist SET done=1, done_at=datetime('now') WHERE project_id=? AND item='design'").run(proj.id);
    audit(db, { entity: 'design', entityId: a.id, field: 'uploaded', newValue: `v${ver}`, byUser: req.user.id });
    json(res, 201, { ok: true, version: ver });
  });

  route('POST', '/api/manage/appointments/:id/return-result', { auth: 'staff' }, (req, res, m, b) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(m.id);
    if (!a || a.result_status !== 'submitted') return json(res, 400, { error: 'No submitted result to return.' });
    db.prepare("UPDATE appointments SET result_status='returned' WHERE id=?").run(a.id);
    db.prepare('UPDATE results SET returned_reason=? WHERE appointment_id=? AND superseded=0').run(b.reason || 'Please review.', a.id);
    D.queueMessage(db, { toKind: 'user', toId: a.rep_id, channel: 'sms', template: 'rep_result_returned', subject: 'Result returned', body: `Your result for appointment #${a.id} was returned: ${b.reason || ''}`, urgent: true });
    audit(db, { entity: 'result', entityId: a.id, field: 'returned', newValue: b.reason, byUser: req.user.id });
    json(res, 200, { ok: true });
  });

  // ---------------- Customers, magic links, portal ----------------
  route('POST', '/api/customers', { auth: 'staff' }, (req, res, m, b) => {
    if (!b.name) return json(res, 400, { error: 'name required' });
    const r = db.prepare(
      `INSERT INTO customers (name,email,phone,address,city,postal,language,consent_marketing,consent_photo_video) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(b.name, b.email || null, b.phone || null, b.address || null, b.city || 'Ottawa', b.postal || null, b.language || 'en',
      b.consent_marketing ? JSON.stringify({ given: true, at: new Date().toISOString(), method: b.consent_method || 'office-recorded' }) : null,
      b.consent_photo_video ? JSON.stringify({ given: true, at: new Date().toISOString(), method: b.consent_method || 'office-recorded' }) : null);
    json(res, 201, { id: r.lastInsertRowid });
  });
  route('GET', '/api/customers', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare('SELECT * FROM customers ORDER BY id DESC LIMIT 200').all()));
  route('GET', '/api/manage/reps', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare("SELECT id, name FROM users WHERE role='rep' AND active=1").all()));

  route('POST', '/api/customers/:id/magic-link', { auth: 'staff' }, (req, res, m, b) => {
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(m.id);
    if (!cust) return json(res, 404, { error: 'Not found.' });
    const count = db.prepare('SELECT COUNT(DISTINCT label) c FROM magic_links WHERE customer_id=? AND revoked=0').get(cust.id).c;
    const maxContacts = getSetting(db, 'max_authorized_contacts');
    if (b.label && b.label !== 'primary' && count >= maxContacts) return json(res, 400, { error: `Maximum ${maxContacts} authorized contacts.` });
    const token = auth.issueMagicLink(db, cust.id, b.label || 'primary');
    const url = `${baseUrl}/portal/?t=${token}`;
    queueCustomer(db, cust.id, 'magic_link', { firstName: cust.name.split(' ')[0], portalLink: url, days: getSetting(db, 'magic_link_days') }, { urgent: true });
    audit(db, { entity: 'magic_link', entityId: cust.id, field: 'issued', newValue: b.label || 'primary', byUser: req.user.id });
    json(res, 201, { url });
  });
  route('POST', '/api/portal/renew-link', (req, res, m, b) => {
    const cust = db.prepare('SELECT * FROM customers WHERE lower(email)=lower(?)').get(String(b.email || ''));
    // Always report success — never confirm/deny whether an email exists.
    if (cust) {
      const token = auth.issueMagicLink(db, cust.id, 'primary');
      queueCustomer(db, cust.id, 'magic_link', { firstName: cust.name.split(' ')[0], portalLink: `${baseUrl}/portal/?t=${token}`, days: getSetting(db, 'magic_link_days') }, { urgent: true });
    }
    json(res, 200, { ok: true, message: 'If that email is on file, a new link is on its way.' });
  });

  function portalAuth(req) {
    const url = new URL(req.url, 'http://x');
    return auth.resolveMagicLink(db, url.searchParams.get('t') || req.headers['x-portal-token']);
  }
  route('GET', '/api/portal/bundle', (req, res) => {
    const link = portalAuth(req);
    if (!link) return json(res, 401, { error: 'link_invalid' });
    const cust = db.prepare('SELECT id,name,address,city,postal,language FROM customers WHERE id=?').get(link.customer_id);
    const appts = db.prepare("SELECT id, scheduled_at, project_type, status FROM appointments WHERE customer_id=? ORDER BY scheduled_at").all(cust.id);
    const project = db.prepare('SELECT p.*, ct.final_price FROM projects p LEFT JOIN contracts ct ON ct.id=p.contract_id WHERE p.customer_id=? ORDER BY p.id DESC').get(cust.id);
    const docs = db.prepare('SELECT id,kind,title,version,created_at FROM documents WHERE customer_id=? AND customer_visible=1 ORDER BY kind, version DESC').all(cust.id);
    const pays = project ? db.prepare('SELECT kind,method,amount,status,received_at FROM payments WHERE project_id=?').all(project.id) : [];
    const svc = db.prepare('SELECT id,category,stage,urgency,opened_at,resolved_at FROM service_calls WHERE customer_id=? ORDER BY id DESC').all(cust.id);
    const msgs = db.prepare('SELECT direction,body,created_at FROM messages WHERE customer_id=? ORDER BY id DESC LIMIT 20').all(cust.id);
    const fin = project ? { contract: project.final_price, paid: D.round2(pays.filter(p => p.status === 'received').reduce((s, p) => s + p.amount, 0)) } : null;
    json(res, 200, {
      customer: cust, appointments: appts,
      project: project ? { stage: D.STAGE_LABELS[project.stage] || project.stage, stage_key: project.stage, install: D.installDateView(project), closed: !!project.closed } : null,
      documents: docs, payments: pays, balance: fin ? D.round2(fin.contract - fin.paid) : null, contract_total: fin?.contract ?? null,
      service_calls: svc, messages: msgs,
      office_phone: getSetting(db, 'office_phone'), company: getSetting(db, 'company_name'),
    });
  });
  route('GET', '/api/portal/document/:id', (req, res, m) => {
    const link = portalAuth(req);
    if (!link) return json(res, 401, { error: 'link_invalid' });
    const doc = db.prepare('SELECT * FROM documents WHERE id=? AND customer_id=? AND customer_visible=1').get(m.id, link.customer_id);
    if (!doc) return json(res, 404, { error: 'Not found.' });
    if (doc.external_url) return json(res, 200, { external_url: doc.external_url });
    const fp = path.join(FILES_DIR, doc.path || '');
    if (!doc.path || !fs.existsSync(fp)) return json(res, 404, { error: 'File missing.' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${doc.filename || doc.title}"` });
    fs.createReadStream(fp).pipe(res);
  });
  route('POST', '/api/portal/message', (req, res, m, b) => {
    const link = portalAuth(req);
    if (!link) return json(res, 401, { error: 'link_invalid' });
    if (!String(b.body || '').trim()) return json(res, 400, { error: 'Empty message.' });
    db.prepare("INSERT INTO messages (customer_id, direction, channel, body) VALUES (?, 'in', 'portal', ?)").run(link.customer_id, String(b.body).slice(0, 4000));
    json(res, 201, { ok: true });
  });
  route('POST', '/api/portal/service', (req, res, m, b) => {
    const link = portalAuth(req);
    if (!link) return json(res, 401, { error: 'link_invalid' });
    const urgency = D.classifyUrgency({ category: b.category, safety: !!b.safety, leak: !!b.leak });
    const proj = db.prepare('SELECT id FROM projects WHERE customer_id=? ORDER BY id DESC').get(link.customer_id);
    const r = db.prepare(
      `INSERT INTO service_calls (customer_id, project_id, category, description, urgency, safety, leak, channel) VALUES (?,?,?,?,?,?,?, 'portal')`
    ).run(link.customer_id, proj?.id || null, b.category || 'Other', b.description || '', urgency, b.safety ? 1 : 0, b.leak ? 1 : 0);
    const id = r.lastInsertRowid;
    db.prepare("INSERT INTO service_events (service_call_id, event) VALUES (?, 'received')").run(id);
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(link.customer_id);
    queueCustomer(db, cust.id, 'service_ack', { ref: 'SC-' + id }, { urgent: true });
    if (urgency === 'emergency') {
      for (const u of db.prepare("SELECT id FROM users WHERE role IN ('manager','admin') AND active=1").all())
        D.queueMessage(db, { toKind: 'user', toId: u.id, channel: 'sms', template: 'mgmt_emergency_service', subject: 'EMERGENCY service call', body: `EMERGENCY: SC-${id} (${b.category}) — ${cust.name}, ${cust.phone}. Call the customer now.`, urgent: true });
    }
    json(res, 201, { id, ref: 'SC-' + id, urgency });
  });

  // ---------------- Contracts (capture + delivery + versioning) ----------------
  route('POST', '/api/contracts/:id/document', { auth: 'staff' }, (req, res, m, b) => {
    const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(m.id);
    if (!c) return json(res, 404, { error: 'Not found.' });
    if (!b.content_base64 || !b.filename) return json(res, 400, { error: 'filename + content_base64 required (final signed PDF).' });
    if (!b.confirm_fully_signed) return json(res, 422, { error: 'You must confirm this is the final, fully signed version (confirm_fully_signed: true). Never send a draft.' });
    const rel = saveFile(b.filename, b.content_base64);
    const ver = (db.prepare("SELECT MAX(version) v FROM documents WHERE contract_id=? AND kind='contract'").get(c.id)?.v || 0) + 1;
    db.prepare(
      `INSERT INTO documents (customer_id, project_id, contract_id, kind, title, filename, path, version, uploaded_by, source)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(c.customer_id, c.project_id, c.id, 'contract', ver === 1 ? 'Your Signed Contract' : `Signed Contract (revision ${ver})`, b.filename, rel, ver, req.user.id, b.source || 'upload');
    if (c.project_id) db.prepare("UPDATE project_checklist SET done=1, done_at=datetime('now') WHERE project_id=? AND item='contract'").run(c.project_id);
    audit(db, { entity: 'contract', entityId: c.id, field: 'document', newValue: `v${ver} ${b.filename}`, byUser: req.user.id, reason: 'versions preserved; never replaced' });
    // Deliver: email with attachment if size allows, else portal-only wording.
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(c.customer_id);
    const sizeMb = Buffer.byteLength(b.content_base64, 'base64') / 1048576;
    const tpl = sizeMb <= getSetting(db, 'attachment_max_mb') ? 'contract_delivery' : 'contract_delivery_no_attachment';
    queueCustomer(db, cust.id, tpl, { firstName: cust.name.split(' ')[0] }, { urgent: true, attachPath: tpl === 'contract_delivery' ? rel : null, channels: ['email'] });
    db.prepare("UPDATE contracts SET delivery_status='sent', delivered_at=datetime('now') WHERE id=?").run(c.id);
    json(res, 201, { ok: true, version: ver, delivery: tpl });
  });
  route('POST', '/api/contracts/:id/resend', { auth: 'staff' }, (req, res, m) => {
    const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(m.id);
    const doc = db.prepare("SELECT * FROM documents WHERE contract_id=? AND kind='contract' ORDER BY version DESC").get(m.id);
    if (!c || !doc) return json(res, 404, { error: 'No stored signed contract to resend.' });
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(c.customer_id);
    queueCustomer(db, cust.id, 'contract_delivery', { firstName: cust.name.split(' ')[0] }, { urgent: true, attachPath: doc.path, channels: ['email'] });
    db.prepare("UPDATE contracts SET delivery_status='resent', delivered_at=datetime('now') WHERE id=?").run(c.id);
    audit(db, { entity: 'contract', entityId: c.id, field: 'resend', byUser: req.user.id });
    json(res, 200, { ok: true });
  });

  // ---------------- Projects: stages, install dates, checklist, measure, payments, costs ----------------
  route('GET', '/api/manage/projects', { auth: 'staff' }, (req, res) => {
    const rows = db.prepare(
      `SELECT p.*, c.name customer_name, ct.final_price FROM projects p
       JOIN customers c ON c.id=p.customer_id LEFT JOIN contracts ct ON ct.id=p.contract_id
       WHERE p.closed=0 ORDER BY p.id DESC`
    ).all().map(p => ({ ...p, install: D.installDateView(p), checklist: db.prepare('SELECT item,done FROM project_checklist WHERE project_id=?').all(p.id), financials: D.projectFinancials(db, p.id) }));
    json(res, 200, rows);
  });
  route('POST', '/api/projects/:id/stage', { auth: 'staff' }, (req, res, m, b) => {
    if (!D.STAGE_ORDER.includes(b.stage)) return json(res, 400, { error: 'Unknown stage.' });
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(m.id);
    if (!p) return json(res, 404, { error: 'Not found.' });
    db.prepare('UPDATE projects SET stage=? WHERE id=?').run(b.stage, p.id);
    audit(db, { entity: 'project', entityId: p.id, field: 'stage', oldValue: p.stage, newValue: b.stage, byUser: req.user.id });
    if (b.stage === 'install_complete') {
      const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(p.customer_id);
      db.prepare("UPDATE projects SET install_completed_at=datetime('now') WHERE id=?").run(p.id);
      queueCustomer(db, cust.id, 'install_complete', { firstName: cust.name.split(' ')[0] });
    }
    json(res, 200, { ok: true });
  });
  route('POST', '/api/projects/:id/install-date', { auth: 'staff' }, (req, res, m, b) => {
    const kinds = { tentative: 'install_tentative', reserved: 'install_reserved', confirmed: 'install_confirmed' };
    const col = kinds[b.kind];
    if (!col || !b.date) return json(res, 400, { error: 'kind (tentative|reserved|confirmed) and date required.' });
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(m.id);
    if (!p) return json(res, 404, { error: 'Not found.' });
    db.prepare(`UPDATE projects SET ${col}=? WHERE id=?`).run(b.date, p.id);
    audit(db, { entity: 'project', entityId: p.id, field: col, oldValue: p[col], newValue: b.date, byUser: req.user.id });
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(p.customer_id);
    if (b.kind === 'tentative') queueCustomer(db, cust.id, 'install_tentative', { firstName: cust.name.split(' ')[0], date: b.date });
    if (b.kind === 'confirmed') {
      db.prepare("UPDATE projects SET stage='install_confirmed' WHERE id=?").run(p.id);
      queueCustomer(db, cust.id, 'install_confirmed', { firstName: cust.name.split(' ')[0], date: b.date });
    }
    json(res, 200, { ok: true });
  });
  route('POST', '/api/projects/:id/checklist', { auth: 'staff' }, (req, res, m, b) => {
    db.prepare("UPDATE project_checklist SET done=?, done_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END WHERE project_id=? AND item=?")
      .run(b.done ? 1 : 0, b.done ? 1 : 0, m.id, b.item);
    json(res, 200, { ok: true });
  });
  route('POST', '/api/projects/:id/measure-complete', { auth: 'staff' }, (req, res, m, b) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(m.id);
    if (!p) return json(res, 404, { error: 'Not found.' });
    db.prepare("UPDATE projects SET measure_status='completed', measure_completed_at=datetime('now') WHERE id=?").run(p.id);
    db.prepare("UPDATE project_checklist SET done=1, done_at=datetime('now') WHERE project_id=? AND item='measurements'").run(p.id);
    // Commission becomes due at measure completion (real 2026 rule), with optional upsell/missed adjustment.
    const c = db.prepare('SELECT * FROM contracts WHERE id=?').get(p.contract_id);
    if (c) {
      const comm = db.prepare("SELECT * FROM commissions WHERE contract_id=? AND status IN ('estimated','pending')").get(c.id);
      if (comm) {
        let upd = { rate: comm.rate, amount: comm.amount, discount_pct: comm.discount_pct, pre_tax_amount: comm.pre_tax_amount };
        if (b.adjustment) {
          const re = D.computeCommission(db, { initialPrice: comm.initial_price, finalPrice: comm.final_price, hstRate: getSetting(db, 'hst_rate'), adjustment: Number(b.adjustment) });
          if (re) upd = re;
        }
        db.prepare("UPDATE commissions SET status='due', adjustment=?, adjustment_note=?, discount_pct=?, pre_tax_amount=?, rate=?, amount=? WHERE id=?")
          .run(Number(b.adjustment || 0), b.adjustment_note || null, upd.discount_pct, upd.pre_tax_amount, upd.rate, upd.amount, comm.id);
        audit(db, { entity: 'commission', entityId: comm.id, field: 'status', oldValue: comm.status, newValue: 'due', byUser: req.user.id, reason: 'measure completed' });
      }
    }
    json(res, 200, { ok: true });
  });
  route('POST', '/api/projects/:id/payments/:pid/receive', { auth: 'staff' }, (req, res, m, b) => {
    const pay = db.prepare('SELECT * FROM payments WHERE id=? AND project_id=?').get(m.pid, m.id);
    if (!pay) return json(res, 404, { error: 'Not found.' });
    db.prepare("UPDATE payments SET status='received', received_at=datetime('now'), method=?, reference=? WHERE id=?").run(b.method || null, b.reference || null, pay.id);
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(pay.customer_id);
    queueCustomer(db, cust.id, 'payment_received', { amount: '$' + pay.amount.toLocaleString() });
    audit(db, { entity: 'payment', entityId: pay.id, field: 'received', newValue: `${b.method} ${b.reference || ''}`, byUser: req.user.id });
    json(res, 200, { ok: true });
  });
  route('POST', '/api/projects/:id/costs', { auth: 'staff' }, (req, res, m, b) => {
    if (!b.category || b.amount == null) return json(res, 400, { error: 'category and amount required.' });
    db.prepare('INSERT INTO job_costs (project_id, category, description, amount, tax, month, source) VALUES (?,?,?,?,?,?,?)')
      .run(m.id, b.category, b.description || null, Number(b.amount), Number(b.tax || 0), b.month || new Date().toISOString().slice(0, 7), b.source || 'manual');
    json(res, 201, { ok: true });
  });

  // ---------------- Service calls (staff side) ----------------
  route('GET', '/api/manage/service-calls', { auth: 'staff' }, (req, res) => {
    json(res, 200, db.prepare(
      `SELECT s.*, c.name customer_name, c.phone FROM service_calls s JOIN customers c ON c.id=s.customer_id ORDER BY (s.stage IN ('resolved','closed')), s.opened_at DESC`
    ).all());
  });
  route('POST', '/api/service-calls/:id/stage', { auth: 'staff' }, (req, res, m, b) => {
    if (!D.SC_STAGES.includes(b.stage)) return json(res, 400, { error: 'Unknown stage.' });
    const s = db.prepare('SELECT * FROM service_calls WHERE id=?').get(m.id);
    if (!s) return json(res, 404, { error: 'Not found.' });
    const patch = { acknowledged: "acknowledged_at=datetime('now')", resolved: "resolved_at=datetime('now')", closed: "closed_at=datetime('now')" }[b.stage] || null;
    db.prepare(`UPDATE service_calls SET stage=?${patch ? ', ' + patch : ''}${b.stage === 'reopened' ? ', reopened_count=reopened_count+1, resolved_at=NULL, closed_at=NULL' : ''} WHERE id=?`).run(b.stage, s.id);
    db.prepare('INSERT INTO service_events (service_call_id, event, note, by_user) VALUES (?,?,?,?)').run(s.id, b.stage, b.note || null, req.user.id);
    const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(s.customer_id);
    if (b.stage === 'scheduled' && b.date) queueCustomer(db, cust.id, 'service_scheduled', { date: b.date }, { urgent: s.urgency === 'emergency' });
    if (b.stage === 'resolved') queueCustomer(db, cust.id, 'service_resolved', { ref: 'SC-' + s.id });
    audit(db, { entity: 'service_call', entityId: s.id, field: 'stage', oldValue: s.stage, newValue: b.stage, byUser: req.user.id });
    json(res, 200, { ok: true });
  });

  // ---------------- Commissions & payouts ----------------
  route('GET', '/api/manage/commission-rules', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare('SELECT * FROM commission_rules WHERE active=1 ORDER BY min_discount').all()));
  route('PUT', '/api/manage/commission-rules', { auth: 'staff' }, (req, res, m, b) => {
    if (!['admin', 'manager'].includes(req.user.role)) return json(res, 403, { error: 'Admin only.' });
    if (!Array.isArray(b.rules) || !b.rules.length) return json(res, 400, { error: 'rules[] required.' });
    db.prepare('UPDATE commission_rules SET active=0').run();
    const ins = db.prepare('INSERT INTO commission_rules (min_discount, max_discount, rate) VALUES (?,?,?)');
    for (const r of b.rules) ins.run(Number(r.min_discount), Number(r.max_discount), Number(r.rate));
    audit(db, { entity: 'commission_rules', field: 'replaced', newValue: JSON.stringify(b.rules), byUser: req.user.id });
    json(res, 200, { ok: true });
  });
  route('GET', '/api/manage/commissions', { auth: 'staff' }, (req, res) => {
    const rows = db.prepare(
      `SELECT cm.*, u.name rep_name, cu.name customer_name FROM commissions cm
       LEFT JOIN users u ON u.id=cm.rep_id JOIN contracts ct ON ct.id=cm.contract_id JOIN customers cu ON cu.id=ct.customer_id
       ORDER BY cm.id DESC`
    ).all();
    const byMonth = db.prepare(
      `SELECT substr(sale_date,1,7) month, COUNT(*) sales, ROUND(SUM(final_price),2) total_sales, ROUND(SUM(amount),2) commissions
       FROM commissions WHERE status!='reversed' GROUP BY month ORDER BY month`
    ).all();
    json(res, 200, { rows, byMonth });
  });
  route('POST', '/api/manage/commissions/:id/status', { auth: 'staff' }, (req, res, m, b) => {
    const ok = ['estimated', 'pending', 'due', 'approved', 'paid', 'held', 'reversed'];
    if (!ok.includes(b.status)) return json(res, 400, { error: 'Invalid status.' });
    const c = db.prepare('SELECT * FROM commissions WHERE id=?').get(m.id);
    if (!c) return json(res, 404, { error: 'Not found.' });
    if (['approved', 'paid', 'reversed'].includes(b.status) && !['admin', 'manager'].includes(req.user.role)) return json(res, 403, { error: 'Manager approval required.' });
    db.prepare(`UPDATE commissions SET status=?, exception_note=COALESCE(?, exception_note)${b.status === 'paid' ? ", paid_at=datetime('now')" : ''} WHERE id=?`).run(b.status, b.note || null, c.id);
    audit(db, { entity: 'commission', entityId: c.id, field: 'status', oldValue: c.status, newValue: b.status, byUser: req.user.id, reason: b.note });
    json(res, 200, { ok: true });
  });
  route('POST', '/api/manage/payouts', { auth: 'staff' }, (req, res, m, b) => {
    if (!['admin', 'manager'].includes(req.user.role)) return json(res, 403, { error: 'Manager only.' });
    db.prepare('INSERT INTO commission_payouts (rep_id, date, amount, method, note) VALUES (?,?,?,?,?)')
      .run(b.rep_id, b.date || new Date().toISOString().slice(0, 10), Number(b.amount), b.method || null, b.note || null);
    json(res, 201, { ok: true });
  });

  // ---------------- Installer ----------------
  route('GET', '/api/installer/rates', { auth: 'installer' }, (req, res) => json(res, 200, db.prepare('SELECT code,label,rate,unit,requires_photo,requires_receipt FROM installer_rates WHERE active=1 ORDER BY sort,id').all()));
  route('GET', '/api/installer/projects', { auth: 'installer' }, (req, res) => {
    json(res, 200, db.prepare(
      `SELECT p.id, c.name customer_name, c.address, p.stage, p.install_confirmed FROM projects p JOIN customers c ON c.id=p.customer_id
       WHERE p.installer_id=? AND p.closed=0 ORDER BY p.id DESC`).all(req.user.id));
  });
  route('POST', '/api/installer/invoices', { auth: 'installer' }, (req, res, m, b) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(b.project_id);
    if (!p) return json(res, 404, { error: 'Project not found.' });
    const rateRows = db.prepare('SELECT * FROM installer_rates WHERE active=1').all();
    const lines = (b.lines || []).map(l => {
      const r = rateRows.find(x => x.code === l.code);
      if (!r) throw Object.assign(new Error('Unknown rate code: ' + l.code), { status: 400 });
      return { rate_code: r.code, label: r.label, qty: Number(l.qty || 1), unit_price: r.rate };
    });
    const calc = D.computeInvoice(db, { lines, receipts: b.receipts || [], mileageKm: Number(b.mileage_km || 0), bonusChecklist: b.bonus_checklist || {} });
    const inv = db.prepare(
      `INSERT INTO installer_invoices (installer_id, project_id, subtotal, hst, total, bonus_amount, bonus_checklist, note)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(req.user.id, p.id, calc.subtotal, calc.hst, calc.total, calc.bonus, JSON.stringify(b.bonus_checklist || {}), (b.note || '').slice(0, 500));
    const invId = inv.lastInsertRowid;
    const il = db.prepare('INSERT INTO invoice_lines (invoice_id, rate_code, label, qty, unit_price, total) VALUES (?,?,?,?,?,?)');
    for (const l of calc.lines) il.run(invId, l.rate_code || null, l.label, l.qty, l.unit_price, l.total);
    const ir = db.prepare('INSERT INTO invoice_receipts (invoice_id, description, total, pre_tax, hst, path) VALUES (?,?,?,?,?,?)');
    for (const r of calc.receipts) ir.run(invId, r.description || null, r.total, r.pre_tax, r.hst, r.receipt_base64 ? saveFile(r.filename || 'receipt.jpg', r.receipt_base64) : null);
    json(res, 201, { id: invId, ...calc });
  });
  route('GET', '/api/installer/invoices', { auth: 'installer' }, (req, res) => {
    json(res, 200, db.prepare('SELECT * FROM installer_invoices WHERE installer_id=? ORDER BY id DESC').all(req.user.id));
  });
  route('GET', '/api/manage/installer-invoices', { auth: 'staff' }, (req, res) => {
    json(res, 200, db.prepare(
      `SELECT i.*, u.name installer_name, c.name customer_name FROM installer_invoices i
       JOIN users u ON u.id=i.installer_id JOIN projects p ON p.id=i.project_id JOIN customers c ON c.id=p.customer_id ORDER BY i.id DESC`).all());
  });
  route('POST', '/api/manage/installer-invoices/:id/decide', { auth: 'staff' }, (req, res, m, b) => {
    const ok = ['review', 'correction', 'approved', 'partial', 'rejected', 'scheduled', 'paid'];
    if (!ok.includes(b.status)) return json(res, 400, { error: 'Invalid status.' });
    const inv = db.prepare('SELECT * FROM installer_invoices WHERE id=?').get(m.id);
    if (!inv) return json(res, 404, { error: 'Not found.' });
    const approvedTotal = b.status === 'partial' ? Number(b.approved_total) : (['approved', 'scheduled', 'paid'].includes(b.status) ? (inv.approved_total ?? inv.total) : inv.approved_total);
    db.prepare(`UPDATE installer_invoices SET status=?, approved_total=?, decision_note=?, decided_at=datetime('now')${b.status === 'paid' ? ", paid_at=datetime('now')" : ''} WHERE id=?`)
      .run(b.status, approvedTotal ?? null, b.note || null, inv.id);
    // Approved installer cost feeds profitability exactly once.
    if (['approved', 'partial'].includes(b.status)) {
      const already = db.prepare("SELECT 1 FROM job_costs WHERE source=? LIMIT 1").get('installer-invoice:' + inv.id);
      if (!already) db.prepare('INSERT INTO job_costs (project_id, category, description, amount, month, source) VALUES (?,?,?,?,?,?)')
        .run(inv.project_id, 'installer', `Installer invoice #${inv.id}`, approvedTotal ?? inv.total, new Date().toISOString().slice(0, 7), 'installer-invoice:' + inv.id);
    }
    audit(db, { entity: 'installer_invoice', entityId: inv.id, field: 'status', oldValue: inv.status, newValue: b.status, byUser: req.user.id, reason: b.note });
    json(res, 200, { ok: true });
  });

  // ---------------- Dashboard, revenue, outbox, failures, AI drafts ----------------
  route('GET', '/api/manage/dashboard', { auth: 'staff' }, (req, res) => {
    const q = (sql, ...a) => db.prepare(sql).get(...a).n;
    json(res, 200, {
      overdue_acks_t1: q("SELECT COUNT(*) n FROM appointments WHERE ack_status='pending' AND ack_tier=1"),
      overdue_acks_t2: q("SELECT COUNT(*) n FROM appointments WHERE ack_status='pending' AND ack_tier=2"),
      overdue_results_t1: q("SELECT COUNT(*) n FROM appointments WHERE result_status IN ('pending','draft') AND result_tier=1"),
      overdue_results_t2: q("SELECT COUNT(*) n FROM appointments WHERE result_status IN ('pending','draft') AND result_tier=2"),
      missing_designs: q(`SELECT COUNT(*) n FROM appointments a WHERE a.status='completed'
        AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.customer_id=a.customer_id AND d.kind='design')`),
      handoffs_incomplete: q(`SELECT COUNT(DISTINCT project_id) n FROM project_checklist WHERE done=0`),
      open_service_calls: q("SELECT COUNT(*) n FROM service_calls WHERE stage NOT IN ('resolved','closed')"),
      aging_service_48h: q("SELECT COUNT(*) n FROM service_calls WHERE stage NOT IN ('resolved','closed') AND opened_at < datetime('now','-2 days')"),
      integration_failures: q("SELECT COUNT(*) n FROM integration_failures WHERE status='open'"),
      ai_drafts_pending: q("SELECT COUNT(*) n FROM ai_drafts WHERE status='pending'"),
      outbox_failed: q("SELECT COUNT(*) n FROM outbox WHERE status='failed'"),
      payments_outstanding: db.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) n FROM payments WHERE status='due'").get().n,
      commissions_due: db.prepare("SELECT ROUND(COALESCE(SUM(amount+adjustment),0),2) n FROM commissions WHERE status='due'").get().n,
    });
  });
  route('GET', '/api/manage/overdue', { auth: 'staff' }, (req, res) => {
    json(res, 200, db.prepare(
      `SELECT a.id, a.ack_status, a.ack_tier, a.result_status, a.result_tier, a.scheduled_at, c.name customer_name, u.name rep_name
       FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN users u ON u.id=a.rep_id
       WHERE (a.ack_status='pending' AND a.ack_tier>0) OR (a.result_status IN ('pending','draft') AND a.result_tier>0)
       ORDER BY a.ack_tier+a.result_tier DESC`).all());
  });
  route('GET', '/api/manage/revenue', { auth: 'staff' }, (req, res) => {
    // Mirrors the 2025 monthly job-revenue sheet: per install-month rollup.
    const rows = db.prepare(
      `SELECT p.id project_id, c.name customer, p.finance_or_cash, p.finance_fees,
              COALESCE(p.install_confirmed, p.install_reserved, p.install_tentative) install_date,
              ct.final_price contracted_total
       FROM projects p JOIN customers c ON c.id=p.customer_id LEFT JOIN contracts ct ON ct.id=p.contract_id`
    ).all().map(r => {
      const fin = D.projectFinancials(db, r.project_id);
      const sentrel = fin.costs.find(x => x.category === 'sentrel');
      return { ...r, collected: fin.collected, ar: fin.ar, sentrel_subtotal: sentrel?.amt || 0, sentrel_tax: sentrel?.tax || 0, commission: fin.commission, gross_profit: fin.gross_profit, gross_margin: fin.gross_margin, month: (r.install_date || '').slice(0, 7) || 'unscheduled' };
    });
    const months = {};
    for (const r of rows) {
      months[r.month] ??= { jobs: 0, revenue: 0, collected: 0, ar: 0, sentrel: 0, commissions: 0, finance_fees: 0, gross_profit: 0 };
      const mo = months[r.month];
      mo.jobs++; mo.revenue += r.contracted_total || 0; mo.collected += r.collected; mo.ar += r.ar; mo.sentrel += r.sentrel_subtotal; mo.commissions += r.commission; mo.finance_fees += r.finance_fees || 0; mo.gross_profit += r.gross_profit || 0;
    }
    for (const k of Object.keys(months)) for (const f of Object.keys(months[k])) months[k][f] = D.round2(months[k][f]);
    json(res, 200, { jobs: rows, months });
  });
  route('GET', '/api/manage/outbox', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 100').all()));
  route('POST', '/api/manage/outbox/:id/resend', { auth: 'staff' }, (req, res, m) => {
    db.prepare("UPDATE outbox SET status='queued', error=NULL, scheduled_for=datetime('now') WHERE id=?").run(m.id);
    json(res, 200, { ok: true });
  });
  route('GET', '/api/manage/integration-failures', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare("SELECT * FROM integration_failures WHERE status='open' ORDER BY id DESC").all()));
  route('POST', '/api/manage/integration-failures/:id/resolve', { auth: 'staff' }, (req, res, m, b) => {
    db.prepare("UPDATE integration_failures SET status='resolved', resolved_by=?, resolved_note=? WHERE id=?").run(req.user.id, b.note || null, m.id);
    json(res, 200, { ok: true });
  });
  route('GET', '/api/manage/ai-drafts', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare("SELECT * FROM ai_drafts WHERE status='pending' ORDER BY id").all()));
  route('POST', '/api/manage/ai-drafts/:id/decide', { auth: 'staff' }, (req, res, m, b) => {
    if (!['approved', 'edited', 'rejected'].includes(b.status)) return json(res, 400, { error: 'Invalid decision.' });
    db.prepare("UPDATE ai_drafts SET status=?, decided_by=?, decided_at=datetime('now'), draft=COALESCE(?, draft) WHERE id=?").run(b.status, req.user.id, b.edited_draft || null, m.id);
    audit(db, { entity: 'ai_draft', entityId: Number(m.id), field: 'decision', newValue: b.status, byUser: req.user.id });
    json(res, 200, { ok: true });
  });
  route('GET', '/api/manage/messages', { auth: 'staff' }, (req, res) => json(res, 200, db.prepare(
    `SELECT m.*, c.name customer_name FROM messages m JOIN customers c ON c.id=m.customer_id ORDER BY m.id DESC LIMIT 100`).all()));
  route('POST', '/api/manage/messages/:customerId/reply', { auth: 'staff' }, (req, res, m, b) => {
    db.prepare("INSERT INTO messages (customer_id, direction, channel, body, by_user) VALUES (?, 'out', 'portal', ?, ?)").run(m.customerId, String(b.body || '').slice(0, 4000), req.user.id);
    json(res, 201, { ok: true });
  });

  // ---------------- Webhooks (integration boundary; dedup + failure capture) ----------------
  function dedup(source, eventId) {
    try { db.prepare('INSERT INTO sync_dedup (source, event_id) VALUES (?,?)').run(source, String(eventId)); return true; }
    catch { return false; } // already processed
  }
  route('POST', '/webhooks/occ', (req, res, m, b) => {
    if (!b.event_id) return json(res, 400, { error: 'event_id required' });
    if (!dedup('occ', b.event_id)) return json(res, 200, { ok: true, duplicate: true });
    try {
      if (b.type === 'contract.signed') {
        const d = b.data || {};
        const cust = db.prepare('SELECT * FROM customers WHERE lower(email)=lower(?)').get(d.customer_email || '')
          || db.prepare('SELECT * FROM customers WHERE name=?').get(d.customer_name || '');
        if (!cust) throw new Error('No matching customer (email/name) — held for manual review.');
        const cr = db.prepare(
          `INSERT INTO contracts (customer_id, final_price, discount_amount, discount_pct, deposit_due, signed_at, occ_document_id)
           VALUES (?,?,?,?,?, datetime('now'), ?)`
        ).run(cust.id, Number(d.final_price), Number(d.discount_amount || 0), Number(d.discount_pct || 0), Number(d.deposit_due || 0), String(d.document_id || b.event_id));
        const contract = db.prepare('SELECT * FROM contracts WHERE id=?').get(cr.lastInsertRowid);
        D.createProjectFromContract(db, contract, null);
        // Immediately persist the PDF — never rely on OCC's expiring link.
        if (d.pdf_base64) {
          const rel = saveFile(d.pdf_filename || 'signed-contract.pdf', d.pdf_base64);
          db.prepare(`INSERT INTO documents (customer_id, project_id, contract_id, kind, title, filename, path, version, source) VALUES (?,?,?,?,?,?,?,1,'occ-webhook')`)
            .run(cust.id, contract.project_id, contract.id, 'contract', 'Your Signed Contract', d.pdf_filename || 'signed-contract.pdf', rel);
          const c2 = db.prepare('SELECT * FROM customers WHERE id=?').get(cust.id);
          queueCustomer(db, cust.id, 'contract_delivery', { firstName: c2.name.split(' ')[0] }, { urgent: true, attachPath: rel, channels: ['email'] });
          db.prepare("UPDATE contracts SET delivery_status='sent', delivered_at=datetime('now') WHERE id=?").run(contract.id);
        }
        return json(res, 201, { ok: true, contract_id: contract.id });
      }
      json(res, 200, { ok: true, ignored: b.type });
    } catch (e) {
      db.prepare('INSERT INTO integration_failures (source, payload, error) VALUES (?,?,?)').run('occ', JSON.stringify(b).slice(0, 4000), String(e.message || e));
      json(res, 202, { ok: false, held_for_review: true });
    }
  });
  route('POST', '/webhooks/companycam', (req, res, m, b) => {
    if (!b.event_id) return json(res, 400, { error: 'event_id required' });
    if (!dedup('companycam', b.event_id)) return json(res, 200, { ok: true, duplicate: true });
    try {
      const d = b.data || {};
      const cust = db.prepare('SELECT * FROM customers WHERE lower(email)=lower(?) OR name=?').get(d.customer_email || '', d.customer_name || '');
      if (!cust) throw new Error('No matching customer for CompanyCam project.');
      db.prepare(`INSERT INTO documents (customer_id, kind, title, external_url, source, customer_visible) VALUES (?, 'other', ?, ?, 'companycam-webhook', 0)`)
        .run(cust.id, d.title || 'CompanyCam photos', d.photo_url || d.project_url || null);
      const proj = db.prepare('SELECT p.id FROM projects p WHERE p.customer_id=? ORDER BY p.id DESC').get(cust.id);
      if (proj) db.prepare("UPDATE project_checklist SET done=1, done_at=datetime('now') WHERE project_id=? AND item='photos'").run(proj.id);
      json(res, 201, { ok: true });
    } catch (e) {
      db.prepare('INSERT INTO integration_failures (source, payload, error) VALUES (?,?,?)').run('companycam', JSON.stringify(b).slice(0, 4000), String(e.message || e));
      json(res, 202, { ok: false, held_for_review: true });
    }
  });
  route('POST', '/webhooks/helcim', (req, res, m, b) => {
    if (!b.event_id) return json(res, 400, { error: 'event_id required' });
    if (!dedup('helcim', b.event_id)) return json(res, 200, { ok: true, duplicate: true });
    try {
      const d = b.data || {};
      const pay = db.prepare("SELECT * FROM payments WHERE status='due' AND ABS(amount-?)<0.01 AND customer_id=(SELECT id FROM customers WHERE lower(email)=lower(?))").get(Number(d.amount), d.customer_email || '');
      if (!pay) throw new Error('No matching due payment for Helcim transaction.');
      db.prepare("UPDATE payments SET status='received', received_at=datetime('now'), method='card', helcim_txn_id=? WHERE id=?").run(String(d.transaction_id || b.event_id), pay.id);
      const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(pay.customer_id);
      queueCustomer(db, cust.id, 'payment_received', { amount: '$' + pay.amount.toLocaleString() });
      json(res, 200, { ok: true, payment_id: pay.id });
    } catch (e) {
      db.prepare('INSERT INTO integration_failures (source, payload, error) VALUES (?,?,?)').run('helcim', JSON.stringify(b).slice(0, 4000), String(e.message || e));
      json(res, 202, { ok: false, held_for_review: true });
    }
  });

  // ---------------- HTTP plumbing ----------------
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json' };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const pathname = url.pathname;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.re.exec(pathname);
        if (!match) continue;
        if (r.opts.auth) {
          const user = auth.getSessionUser(db, auth.parseCookies(req).fsbs);
          if (!user || !ROLES[r.opts.auth].includes(user.role)) return json(res, 401, { error: 'auth_required' });
          req.user = user;
        }
        const params = Object.fromEntries(r.keys.map((k, i) => [k, match[i + 1]]));
        let body = {};
        if (req.method !== 'GET') {
          const chunks = [];
          let size = 0;
          for await (const ch of req) { size += ch.length; if (size > 25 * 1048576) { return json(res, 413, { error: 'Payload too large.' }); } chunks.push(ch); }
          const raw = Buffer.concat(chunks).toString('utf8');
          if (raw) { try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid JSON.' }); } }
        }
        try { return await r.handler(req, res, params, body); }
        catch (e) { return json(res, e.status || 500, { error: String(e.message || e) }); }
      }
      // Static
      let fp = pathname === '/' ? '/index.html' : pathname;
      if (fp.endsWith('/')) fp += 'index.html';
      const full = path.join(PUBLIC_DIR, path.normalize(fp));
      if (full.startsWith(PUBLIC_DIR) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
        return fs.createReadStream(full).pipe(res);
      }
      json(res, 404, { error: 'Not found.' });
    } catch (e) {
      json(res, 500, { error: 'Internal error.' });
    }
  });

  return { server, db };
}

// ---------------- boot ----------------
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const { server, db } = createApp({ baseUrl: process.env.BASE_URL || `http://localhost:${port}` });
  require('./lib/seed').ensureSeed(db);
  const sched = scheduler.start(db, { intervalMs: 60_000 });
  server.listen(port, () => console.log(`FSBS Operations running on http://localhost:${port}`));
  process.on('SIGINT', () => { sched.stop(); server.close(); process.exit(0); });
}

module.exports = { createApp };
