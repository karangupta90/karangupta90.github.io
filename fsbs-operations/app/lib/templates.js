'use strict';
// Customer message templates — condensed from communications/customer-messages.md.
// Every message: what happened → what to know → act? → one link → office phone.
const { getSetting } = require('./db');

function render(db, key, vars = {}) {
  const phone = getSetting(db, 'office_phone');
  const company = getSetting(db, 'company_name');
  const link = vars.portalLink || '{PortalLink}';
  const T = {
    appointment_confirmation: {
      subject: `Your ${company} consultation — ${vars.date || ''}`,
      body: `Hi ${vars.firstName}, this is ${company}. Your bathroom consultation is confirmed for ${vars.date} at ${vars.time} at ${vars.address}. ${vars.repName} will be your consultant. Details: ${link}. Questions? Call us at ${phone}.`,
    },
    appointment_reminder: {
      subject: `Reminder: your consultation is tomorrow`,
      body: `Reminder: your ${company} consultation is tomorrow, ${vars.date} at ${vars.time}. Details: ${link}. Call ${phone} if anything's changed.`,
    },
    reschedule: {
      subject: `Your consultation has been moved`,
      body: `Your ${company} consultation has been moved to ${vars.date} at ${vars.time}. Everything else stays the same. Details: ${link}. Call ${phone} with questions.`,
    },
    cancellation: {
      subject: `Your consultation has been cancelled`,
      body: `Your ${company} consultation on ${vars.date} has been cancelled as requested. Want to book a new time? Call us at ${phone}.`,
    },
    post_sale_welcome: {
      subject: `Welcome! Here's what happens next for your bathroom project`,
      body: `Hi ${vars.firstName}, thank you for choosing ${company}. Next: our team reviews your project and confirms measurements, we order your materials, then we'll be in touch to schedule your installation. Track everything anytime: ${link}. Your contact: ${phone}.`,
    },
    contract_delivery: {
      subject: `Your signed ${company} contract is attached`,
      body: `Hi ${vars.firstName}, attached is your fully signed contract for your records. It's also saved permanently in your project page: ${link}. If anything looks incorrect, call us right away at ${phone}.`,
    },
    contract_delivery_no_attachment: {
      subject: `Your signed contract is ready in your project page`,
      body: `Hi ${vars.firstName}, your signed contract is ready and waiting for you securely at your project page — no attachment needed: ${link}. Call ${phone} with any questions.`,
    },
    install_tentative: {
      subject: `Installation timing — tentative`,
      body: `Hi ${vars.firstName}, we're working on scheduling your installation — right now we're holding a tentative window around ${vars.date}. This isn't confirmed yet; we'll message you as soon as it is. Details: ${link}. Call ${phone} with questions.`,
    },
    install_confirmed: {
      subject: `Your installation date is confirmed: ${vars.date || ''}`,
      body: `Your installation date is confirmed: ${vars.date}. We'll remind you about 2 weeks before, plus a final reminder before your crew arrives. Details: ${link}. Call ${phone} with questions.`,
    },
    install_two_week: {
      subject: `Your installation is coming up — ${vars.date || ''}`,
      body: `Just a reminder — your installation is confirmed for ${vars.date}. We'll send a short prep checklist soon (parking, access, what to expect). Details: ${link}. Questions? ${phone}.`,
    },
    install_prep: {
      subject: `Getting ready for your installation on ${vars.date || ''}`,
      body: `Hi ${vars.firstName}, your installation is almost here (${vars.date}). Please review your short prep checklist: ${link}. Call ${phone} with questions.`,
    },
    install_delay: {
      subject: `We need to adjust your installation date`,
      body: `We need to adjust your installation date. Your new date is ${vars.date} — sorry for the inconvenience. Full details: ${link}. Call ${phone} and we'll walk you through it.`,
    },
    install_complete: {
      subject: `Your installation is complete!`,
      body: `Your installation is complete! Thank you for choosing ${company}. Final details and your remaining balance (if any) are on your project page: ${link}. Anything not quite right? Call ${phone} — we want it right.`,
    },
    payment_reminder: {
      subject: `Balance reminder for your ${vars.projectType || 'bathroom'} project`,
      body: `Friendly reminder: your remaining balance of ${vars.balance} is due for your project at ${vars.address}. Review payment details at ${link}. Questions? Call ${phone} — we will never ask you to pay through a link outside your project page.`,
    },
    payment_received: {
      subject: `Payment received — thank you`,
      body: `Thank you! We've received your payment of ${vars.amount}. Your project page is updated: ${link}.`,
    },
    service_ack: {
      subject: `We received your service request`,
      body: `We received your service request and we're on it. Reference: ${vars.ref}. Status and next steps: ${link}. If this is an active leak or safety issue, call us right now at ${phone}.`,
    },
    service_scheduled: {
      subject: `Your service visit is scheduled`,
      body: `Your service visit is scheduled for ${vars.date}. Details: ${link}. Call ${phone} with questions.`,
    },
    service_resolved: {
      subject: `Your service request is resolved`,
      body: `Your service request (${vars.ref}) is marked resolved. If anything's still not right, reply or call ${phone} — we'll reopen it right away.`,
    },
    satisfaction_request: {
      subject: `How did we do?`,
      body: `Hi ${vars.firstName}, we'd love to know how your installation went — it takes a minute: ${link}. If anything wasn't right, tell us directly; we read every response. Call ${phone} anytime.`,
    },
    magic_link: {
      subject: `Your secure project page link`,
      body: `Hi ${vars.firstName}, here is your secure link to your ${company} project page: ${link}. It works for ${vars.days} days — you can always request a fresh one. Call ${phone} if you need help.`,
    },
  };
  const t = T[key];
  if (!t) throw new Error('Unknown template: ' + key);
  return t;
}

module.exports = { render };
