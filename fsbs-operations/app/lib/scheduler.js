'use strict';
// FSBS Operations — background sweeps: overdue tiers, outbox dispatch, link expiry.
// Runs in-process on an interval; every action is idempotent and audited.
const { getSetting, audit } = require('./db');
const { isRepUnavailable, queueMessage, sqlDate } = require('./domain');

function sweepAcknowledgements(db, now = new Date()) {
  const tier2h = getSetting(db, 'tier2_after_hours');
  const rows = db.prepare(
    `SELECT a.*, u.name rep_name, u.unavailable_dates FROM appointments a JOIN users u ON u.id = a.rep_id
     WHERE a.ack_status = 'pending' AND a.status = 'booked' AND a.ack_deadline IS NOT NULL AND a.ack_deadline < ?`
  ).all(sqlDate(now));
  for (const a of rows) {
    if (isRepUnavailable(a, new Date(a.scheduled_at))) {
      db.prepare("UPDATE appointments SET ack_status='skipped_unavailable' WHERE id=?").run(a.id);
      queueMessage(db, { toKind: 'user', toId: a.rep_id, channel: 'email', template: 'mgmt_reassign_needed', subject: 'Reassignment needed', body: `Rep unavailable for appointment #${a.id}; please reassign.`, urgent: true });
      audit(db, { entity: 'appointment', entityId: a.id, field: 'ack', newValue: 'skipped_unavailable (rep day off)' });
      continue;
    }
    if (a.ack_tier === 0) {
      db.prepare("UPDATE appointments SET ack_tier=1, ack_tier1_at=? WHERE id=?").run(sqlDate(now), a.id);
      for (const ch of ['sms', 'email'])
        queueMessage(db, { toKind: 'user', toId: a.rep_id, channel: ch, template: 'rep_ack_overdue', subject: 'Appointment needs acknowledgement', body: `Please acknowledge appointment #${a.id} — it is past its deadline.`, urgent: true });
      audit(db, { entity: 'appointment', entityId: a.id, field: 'ack_tier', oldValue: 0, newValue: 1 });
    } else if (a.ack_tier === 1 && a.ack_tier1_at && (now - new Date(a.ack_tier1_at + 'Z')) > tier2h * 3600e3) {
      db.prepare('UPDATE appointments SET ack_tier=2 WHERE id=?').run(a.id);
      audit(db, { entity: 'appointment', entityId: a.id, field: 'ack_tier', oldValue: 1, newValue: 2, reason: 'no response after tier-1 reminder' });
    }
  }
  return rows.length;
}

function sweepResults(db, now = new Date()) {
  const tier2h = getSetting(db, 'tier2_after_hours');
  const rows = db.prepare(
    `SELECT * FROM appointments WHERE result_status IN ('pending','draft') AND result_deadline IS NOT NULL AND result_deadline < ?`
  ).all(sqlDate(now));
  for (const a of rows) {
    if (a.result_tier === 0) {
      db.prepare('UPDATE appointments SET result_tier=1, result_tier1_at=? WHERE id=?').run(sqlDate(now), a.id);
      for (const ch of ['sms', 'email'])
        queueMessage(db, { toKind: 'user', toId: a.rep_id, channel: ch, template: 'rep_result_overdue', subject: 'Appointment result overdue', body: `Please submit your post-appointment result for appointment #${a.id}.`, urgent: true });
      audit(db, { entity: 'appointment', entityId: a.id, field: 'result_tier', oldValue: 0, newValue: 1 });
    } else if (a.result_tier === 1 && a.result_tier1_at && (now - new Date(a.result_tier1_at + 'Z')) > tier2h * 3600e3) {
      db.prepare('UPDATE appointments SET result_tier=2 WHERE id=?').run(a.id);
      audit(db, { entity: 'appointment', entityId: a.id, field: 'result_tier', oldValue: 1, newValue: 2 });
    }
  }
  return rows.length;
}

// Outbox dispatch. With no live GHL/SMTP connection, "sending" records the message as sent
// in dev mode; the transport function is the single integration point to swap for GoHighLevel.
function dispatchOutbox(db, transport, now = new Date()) {
  const due = db.prepare(
    "SELECT * FROM outbox WHERE status IN ('queued','held_cooldown') AND scheduled_for <= ? ORDER BY id LIMIT 50"
  ).all(sqlDate(now));
  let sent = 0;
  for (const m of due) {
    try {
      transport(m); // throws on failure
      db.prepare("UPDATE outbox SET status='sent', sent_at=? WHERE id=?").run(sqlDate(now), m.id);
      sent++;
    } catch (e) {
      db.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(String(e.message || e), m.id);
      db.prepare('INSERT INTO integration_failures (source, payload, error) VALUES (?,?,?)')
        .run('outbox:' + m.channel, JSON.stringify({ outbox_id: m.id, template: m.template }), String(e.message || e));
    }
  }
  return sent;
}

const devTransport = (log = []) => (m) => { log.push({ id: m.id, channel: m.channel, template: m.template }); };

function start(db, { intervalMs = 60_000, transport } = {}) {
  const t = transport || devTransport();
  const tick = () => {
    try {
      sweepAcknowledgements(db);
      sweepResults(db);
      dispatchOutbox(db, t);
    } catch (e) {
      db.prepare('INSERT INTO integration_failures (source, error) VALUES (?,?)').run('scheduler', String(e.stack || e));
    }
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return { stop: () => clearInterval(handle), tick };
}

module.exports = { sweepAcknowledgements, sweepResults, dispatchOutbox, devTransport, start };
