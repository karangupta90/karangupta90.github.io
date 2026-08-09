'use strict';
// FSBS Operations — auth: staff sessions (scrypt) + customer magic links. Zero deps.
const crypto = require('node:crypto');
const { getSetting } = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- Staff sessions ---
function createSession(db, userId, days = 7) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha256(token), userId, expires);
  return token;
}
function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`
  ).get(sha256(token));
  return row || null;
}
function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
}

// --- Customer magic links ---
function issueMagicLink(db, customerId, label = 'primary') {
  const days = getSetting(db, 'magic_link_days') || 14;
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  db.prepare('INSERT INTO magic_links (customer_id, token_hash, label, expires_at) VALUES (?,?,?,?)')
    .run(customerId, sha256(token), label, expires);
  return token;
}
function resolveMagicLink(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT m.*, c.name customer_name FROM magic_links m JOIN customers c ON c.id = m.customer_id
     WHERE m.token_hash = ? AND m.revoked = 0 AND m.expires_at > datetime('now')`
  ).get(sha256(token));
  if (row) db.prepare("UPDATE magic_links SET last_used_at = datetime('now') WHERE id=?").run(row.id);
  return row || null;
}
function revokeCustomerLinks(db, customerId) {
  db.prepare('UPDATE magic_links SET revoked=1 WHERE customer_id=?').run(customerId);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = { hashPassword, verifyPassword, createSession, getSessionUser, destroySession, issueMagicLink, resolveMagicLink, revokeCustomerLinks, parseCookies, sha256 };
