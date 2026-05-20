export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAjeXX12GP2CJJk-vuwG_otllf_rbDbbWs",
  authDomain: "shaplachottor-5295e.firebaseapp.com",
  projectId: "shaplachottor-5295e",
  storageBucket: "shaplachottor-5295e.firebasestorage.app",
  messagingSenderId: "68593164378"
};

export const ADMIN_EMAIL_ALIASES = new Set([
  "sushen.biswas.aga@gmail.com",
  "sushen.biswas.aga@googlemail.com"
]);

export const BOOKING_STATUS = {
  pending: "pending",
  reviewing: "reviewing",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  expired: "expired"
};

export const KNOWN_BOOKING_STATUSES = new Set(Object.values(BOOKING_STATUS));
export const ACTIVE_REVIEWABLE_STATUSES = new Set([BOOKING_STATUS.pending, BOOKING_STATUS.reviewing]);
export const TERMINAL_BOOKING_STATUSES = new Set([
  BOOKING_STATUS.approved,
  BOOKING_STATUS.rejected,
  BOOKING_STATUS.cancelled,
  BOOKING_STATUS.expired
]);

export const DEFAULT_TOTAL_SEATS = 100;

export const CANONICAL_PHASES = [
  {
    phaseId: "phase1",
    title: "Foundations",
    description: "Learn core programming fundamentals required for all future phases.",
    level: "Beginner",
    order: 1,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase2",
    title: "Data Analysis",
    description: "Master practical data analysis techniques for AI and trading workflows.",
    level: "Beginner",
    order: 2,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase3",
    title: "Object-Oriented Programming",
    description: "Build reusable systems and strong architecture using OOP principles.",
    level: "Intermediate",
    order: 3,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase4",
    title: "System Design",
    description: "Design scalable services and robust backend flows for production systems.",
    level: "Intermediate",
    order: 4,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase5",
    title: "Simulation & Data Systems",
    description: "Build simulation pipelines and data systems for model-backed decisions.",
    level: "Advanced",
    order: 5,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  },
  {
    phaseId: "phase6",
    title: "Production Engineering",
    description: "Ship production-grade AI workflows with reliability and monitoring.",
    level: "Advanced",
    order: 6,
    totalSeats: DEFAULT_TOTAL_SEATS,
    bookedSeats: 0
  }
];

export const LEGACY_PHASE_ID_MAP = new Map([
  ["phase_1", "phase1"],
  ["phase_2", "phase2"],
  ["phase_3", "phase3"],
  ["phase_4", "phase4"],
  ["phase_5", "phase5"],
  ["phase_6", "phase6"]
]);

export const FEATURE_UNLOCK_GATES = [
  { featureId: "tradingBot", minProgress: 30, title: "Trading Bot" },
  { featureId: "investment", minProgress: 60, title: "Investment" },
  { featureId: "affiliate", minProgress: 100, title: "Affiliate" }
];

export const MS_IN_DAY = 24 * 60 * 60 * 1000;
export const INACTIVITY_DAYS_WARNING = 7;
export const INACTIVITY_DAYS_HIGH_RISK = 14;
export const STALLED_PHASE_DAYS = 10;
export const OCCUPANCY_ALERT_THRESHOLD = 90;

export const CHART_COLORS = {
  blue: "#5EA1FF",
  cyan: "#5DE6D9",
  violet: "#A98DFF",
  green: "#44D483",
  amber: "#F5B24A",
  red: "#FF6C7A",
  slate: "#99A4BF",
  lineGrid: "rgba(130, 148, 184, 0.18)",
  text: "#CBD5E8",
  textMuted: "#8B98B7"
};
