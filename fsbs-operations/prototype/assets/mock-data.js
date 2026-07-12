/* Five Star Bath Solutions of Ottawa — shared mock data for static prototypes.
   No live systems are connected; this is realistic test data only. */
window.FSBS_MOCK = {
  appointments: [
    {
      customer: "Margaret Chen",
      phone: "+16135550101",
      address: "42 Birchwood Cres, Ottawa, ON",
      date: "Jul 14, 2026",
      time: "10:00 AM",
      projectType: "Tub-to-shower conversion",
      leadNotes: "Homeowner mentioned mobility concerns, interested in grab bars.",
      supportingInfo: "2 photos from initial phone call on file.",
      ack: true,
      ackLabel: "Received & reviewed",
      ackOverdue: false,
      resultSubmitted: false,
      resultOverdue: true,
      returnedForCorrection: null
    },
    {
      customer: "Robert & Diane Fournier",
      phone: "+16135550142",
      address: "118 Rideau Terrace, Ottawa, ON",
      date: "Jul 14, 2026",
      time: "2:30 PM",
      projectType: "Full bathroom remodel",
      leadNotes: "Referral from a past customer. Both homeowners will be present.",
      supportingInfo: "None yet.",
      ack: false,
      ackLabel: null,
      ackOverdue: true,
      resultSubmitted: false,
      resultOverdue: false,
      returnedForCorrection: "Please confirm the discount percentage — the number entered didn't match the initial/lowest price fields."
    },
    {
      customer: "Estelle Boudreau",
      phone: "+16135550187",
      address: "7 Fisher Ave, Ottawa, ON",
      date: "Jul 15, 2026",
      time: "9:00 AM",
      projectType: "Walk-in tub installation",
      leadNotes: "Accessibility-focused, daughter will attend on her behalf.",
      supportingInfo: "1 photo of existing bathroom layout.",
      ack: false,
      ackLabel: null,
      ackOverdue: false,
      resultSubmitted: false,
      resultOverdue: false,
      returnedForCorrection: null
    }
  ],

  project: {
    customerName: "Margaret Chen",
    address: "42 Birchwood Cres, Ottawa, ON",
    projectType: "Tub-to-shower conversion",
    languagePreference: "en",
    mainContact: { name: "Five Star Bath Solutions — Ottawa Office", phone: "+16135551234" },
    customerFacingStage: "Materials in progress",
    stages: ["Consultation completed","Proposal prepared","Contract signed","Project review","Measurements","Materials in progress","Installation scheduling","Installation confirmed","Installation in progress","Installation complete","Follow-up","Project complete"],
    currentStageIndex: 5,
    nextStep: "We're finalizing your materials order. We'll reach out with installation timing soon.",
    actionRequired: false,
    appointments: [
      { type: "Consultation", date: "Jun 10, 2026", time: "10:00 AM", status: "Completed" },
      { type: "Measurement visit", date: "Jun 24, 2026", time: "1:00 PM", status: "Completed" },
      { type: "Installation", date: "Aug 3, 2026", time: "Window: 8:00 AM – 10:00 AM arrival", status: "Tentative" }
    ],
    design: { version: 2, date: "Jun 10, 2026", note: "Updated after measurement visit to confirm shower footprint.", fileLabel: "3D Design — Birchwood Cres v2.pdf" },
    documents: [
      { name: "Your Proposal", date: "Jun 10, 2026" },
      { name: "Your Signed Contract", date: "Jun 12, 2026" },
      { name: "Preparation Guide", date: "Jun 12, 2026" },
      { name: "Warranty Information", date: "Jun 12, 2026" }
    ],
    payments: { contractAmount: 14250, deposit: 4275, paid: 4275, balance: 9975, dueNote: "Balance due on completion of installation." },
    scope: { projectType: "Tub-to-shower conversion", wallSystem: "Sentrel wall system — Arctic White", base: "Low-threshold acrylic base", door: "Frameless glass sliding door", fixtures: "Moen chrome fixture set", accessibility: "Grab bar package (2 bars)" },
    serviceCalls: []
  },

  serviceCallsQueue: [
    { id: "SC-1042", customer: "Harold Whitfield", address: "88 Melrose Ave, Ottawa, ON", category: "Active leak", urgency: "Emergency", stage: "Acknowledged", opened: "Jul 11, 2026 6:40 PM" },
    { id: "SC-1041", customer: "Linda Osei", address: "22 Kirkwood Ave, Ottawa, ON", category: "Cosmetic concern (caulking)", urgency: "Standard", stage: "Scheduled", opened: "Jul 9, 2026" },
    { id: "SC-1039", customer: "Margaret Chen", address: "42 Birchwood Cres, Ottawa, ON", category: "Customer education", urgency: "Informational", stage: "Resolved", opened: "Jun 30, 2026" }
  ],

  management: {
    overdueAcknowledgements: 1,
    overdueResults: 1,
    missingDesigns: 2,
    missingContracts: 0,
    handoffsIncomplete: 1,
    openServiceCalls: 3,
    agingServiceCallsOver48h: 1,
    integrationFailures: 1,
    aiDraftsPending: 2
  }
};
