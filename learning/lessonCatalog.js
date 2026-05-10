const LESSONS_BY_PHASE = {
  phase1: [
    {
      lessonId: "phase1_lesson1",
      title: "AI-to-AI Workflow",
      blocks: {
        concept: "A workflow is a sequence. You first define context, then objective, then expected output and constraints.",
        example: "Context -> analyze booking lifecycle. Objective -> detect stuck pending requests. Output -> concise actions.",
        exercise: "Write a four-step workflow for solving one real lab task.",
        reflection: "Which workflow step made your output more reliable?"
      }
    },
    {
      lessonId: "phase1_lesson2",
      title: "Prompting & AI Conversation",
      blocks: {
        concept: "Strong prompts are explicit about role, task, constraints, and expected structure.",
        example: "Act as backend reviewer. Validate booking transition from pending to reviewing with failure cases.",
        exercise: "Draft one short prompt for analysis and one for implementation.",
        reflection: "How did response quality change after you added structure?"
      }
    },
    {
      lessonId: "phase1_lesson3",
      title: "Python Basics",
      blocks: {
        concept: "Python basics include variables, control flow, functions, and simple data structures.",
        example: "Use a list of booking docs and filter only pending items with a loop and condition.",
        exercise: "Write a function that returns the next unlocked lesson id for a phase.",
        reflection: "Which Python concept felt most useful for your app logic?"
      }
    },
    {
      lessonId: "phase1_lesson4",
      title: "Thinking in Code",
      blocks: {
        concept: "Thinking in code means breaking one large goal into small deterministic steps.",
        example: "Goal: unlock a phase. Steps: check prerequisites, validate status, update records, confirm state.",
        exercise: "Break one feature into at least five implementation steps.",
        reflection: "Which step was ambiguous before decomposition?"
      }
    }
  ],
  phase2: [
    {
      lessonId: "phase2_lesson1",
      title: "Data Shape and Field Contracts",
      blocks: {
        concept: "Analysis starts with stable contracts. You need canonical field names and explicit fallback aliases.",
        example: "Use `phaseId` as canonical and normalize `phase` / `phaseKey` aliases during reads.",
        exercise: "Map canonical fields and legacy aliases for one collection.",
        reflection: "Which field mismatch could silently break analytics?"
      }
    },
    {
      lessonId: "phase2_lesson2",
      title: "Status Lifecycle Analytics",
      blocks: {
        concept: "A lifecycle is a sequence. Measurements should track transitions, not isolated states.",
        example: "Track pending -> reviewing -> approved and pending -> reviewing -> rejected separately.",
        exercise: "Define the transition metrics that indicate moderation quality.",
        reflection: "Which transition is the strongest signal of process bottlenecks?"
      }
    },
    {
      lessonId: "phase2_lesson3",
      title: "Expiry and Time Windows",
      blocks: {
        concept: "Time-based state changes must be deterministic and centrally enforced.",
        example: "A 15-minute pending window should expire even if no client is online.",
        exercise: "Describe a cleanup strategy that prevents stale pending records.",
        reflection: "What data quality risk appears when expiry is client-only?"
      }
    }
  ],
  phase3: [
    {
      lessonId: "phase3_lesson1",
      title: "Transaction Boundaries",
      blocks: {
        concept: "Multi-document mutations need transactional authority to preserve consistency under concurrency.",
        example: "Approving a booking updates booking status, phase seat count, and user unlockedPhases atomically.",
        exercise: "List all documents touched by an approval mutation and why each is required.",
        reflection: "What corruption risk appears if any write is skipped?"
      }
    },
    {
      lessonId: "phase3_lesson2",
      title: "Idempotent Mutation Design",
      blocks: {
        concept: "Critical operations should be safe under retries and duplicate client events.",
        example: "Reject should fail cleanly when a booking is no longer pending/reviewing.",
        exercise: "Write precondition checks for approve, reject, and cancel flows.",
        reflection: "Which precondition prevents the highest-impact race condition?"
      }
    },
    {
      lessonId: "phase3_lesson3",
      title: "Frontend-Backend Responsibility Split",
      blocks: {
        concept: "UI should orchestrate user flow; backend should own lifecycle-critical state transitions.",
        example: "Client validates input format, callable function enforces role and lifecycle integrity.",
        exercise: "Split one existing client-heavy flow into UI and authority layers.",
        reflection: "What logic is unsafe when left entirely on the client?"
      }
    }
  ],
  phase4: [
    {
      lessonId: "phase4_lesson1",
      title: "Progressive Access Architecture",
      blocks: {
        concept: "Access should be gated by progression contracts that mirror educational intent.",
        example: "Next-phase booking requires completion of prior phase lessons.",
        exercise: "Define gate checks for phase entry, lesson completion, and booking requests.",
        reflection: "Which gate most directly enforces educational pacing?"
      }
    },
    {
      lessonId: "phase4_lesson2",
      title: "Moderation Workflow Modeling",
      blocks: {
        concept: "Moderation is a state machine with explicit operator actions and audit points.",
        example: "Pending bookings may enter reviewing before approval or rejection.",
        exercise: "Model admin actions and resulting state transitions without adding new lifecycle names.",
        reflection: "Where should audit metadata be recorded for moderation events?"
      }
    },
    {
      lessonId: "phase4_lesson3",
      title: "Cross-Platform Contract Safety",
      blocks: {
        concept: "When web and Android share data, schema drift must be managed explicitly.",
        example: "Write canonical fields and compatibility aliases in one payload builder.",
        exercise: "Document one compatibility strategy for legacy field readers.",
        reflection: "What breaks first when canonical and alias fields diverge?"
      }
    }
  ],
  phase5: [
    {
      lessonId: "phase5_lesson1",
      title: "Consistency Monitoring",
      blocks: {
        concept: "Derived counters such as bookedSeats require periodic reconciliation.",
        example: "Compare approved bookings per phase against phases.bookedSeats and repair drift.",
        exercise: "Design a reconciliation report payload for admin operations.",
        reflection: "What causes seat counters to drift in distributed clients?"
      }
    },
    {
      lessonId: "phase5_lesson2",
      title: "Failure-Resilient Cleanup",
      blocks: {
        concept: "Background cleanup jobs should be retry-safe and bounded.",
        example: "Expire stale pending/reviewing bookings in a scheduled task using deterministic filters.",
        exercise: "Define filters that target only eligible stale bookings.",
        reflection: "What side effect must never happen during cleanup?"
      }
    },
    {
      lessonId: "phase5_lesson3",
      title: "Auditability and Operational Signals",
      blocks: {
        concept: "Operational workflows need clear event history for support and moderation trust.",
        example: "Store approvedBy/rejectedBy/cancelledBy and corresponding timestamps.",
        exercise: "List operator metadata needed for incident review.",
        reflection: "Which moderation event is hardest to investigate without metadata?"
      }
    }
  ],
  phase6: [
    {
      lessonId: "phase6_lesson1",
      title: "Production Readiness Criteria",
      blocks: {
        concept: "Production systems require explicit readiness checks across security, lifecycle, and recoverability.",
        example: "Ensure only trusted functions can mutate critical booking states.",
        exercise: "Draft a production checklist for this platform’s critical flows.",
        reflection: "Which checklist item is most likely to regress first?"
      }
    },
    {
      lessonId: "phase6_lesson2",
      title: "User Privacy Lifecycle",
      blocks: {
        concept: "Account deletion must cascade through all user-owned data and authentication identity.",
        example: "Delete users doc, progress subcollections, bookings, referral events, affiliate stats, and auth user.",
        exercise: "Define an irreversible deletion flow with explicit confirmation.",
        reflection: "What privacy risk remains if subcollection deletion is omitted?"
      }
    },
    {
      lessonId: "phase6_lesson3",
      title: "Continuous Platform Alignment",
      blocks: {
        concept: "Cross-platform parity requires explicit synchronization checkpoints across clients and backend.",
        example: "Validate that web-created lifecycle events remain Android-readable without parser changes.",
        exercise: "Write three parity checks for schema, transitions, and gating behavior.",
        reflection: "Which parity check should run before each release?"
      }
    }
  ]
};

export function getLessonsForPhase(phaseId) {
  return (LESSONS_BY_PHASE[phaseId] || []).map((lesson) => ({ ...lesson, blocks: { ...lesson.blocks } }));
}

export function getLessonById(phaseId, lessonId) {
  const lessons = LESSONS_BY_PHASE[phaseId] || [];
  const lesson = lessons.find((item) => item.lessonId === lessonId);
  if (!lesson) {
    return null;
  }
  return { ...lesson, blocks: { ...lesson.blocks } };
}

export function getLessonCountForPhase(phaseId) {
  return (LESSONS_BY_PHASE[phaseId] || []).length;
}

export function getLessonCatalogPhaseIds() {
  return Object.keys(LESSONS_BY_PHASE);
}
