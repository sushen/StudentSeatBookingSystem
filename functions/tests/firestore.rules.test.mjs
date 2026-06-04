import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const rulesPath = path.resolve(rootDir, "firestore.rules");

async function main() {
  const rules = fs.readFileSync(rulesPath, "utf8");

  const testEnv = await initializeTestEnvironment({
    projectId: "demo-student-seat-booking",
    firestore: {
      rules
    }
  });

  try {
    const userId = "userA";
    const userDb = testEnv.authenticatedContext(userId, {
      email: "userA@example.com"
    }).firestore();
    const adminDb = testEnv.authenticatedContext("admin1", {
      email: "sushen.biswas.aga@gmail.com"
    }).firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "bookings", `${userId}_phase1`), {
        bookingId: `${userId}_phase1`,
        userId,
        status: "pending",
        phaseId: "phase1"
      });
      await setDoc(doc(db, "affiliateStats", userId), {
        userId,
        totalInvites: 1,
        conversions: 0
      });
      await setDoc(doc(db, "referralEvents", `referrer_${userId}`), {
        eventId: `referrer_${userId}`,
        referrerId: "referrer",
        userId,
        status: "joined",
        isConverted: false
      });
    });

    // Students can create their own pending booking request.
    await assertSucceeds(
      setDoc(doc(userDb, "bookings", `${userId}_phase2`), {
        bookingId: `${userId}_phase2`,
        id: `${userId}_phase2`,
        userId,
        uid: userId,
        status: "pending",
        requestStatus: "pending",
        bookingStatus: "pending",
        phaseId: "phase2"
      })
    );

    await assertFails(
      setDoc(doc(userDb, "bookings", `${userId}_phase3`), {
        bookingId: `${userId}_phase3`,
        userId,
        status: "approved",
        phaseId: "phase3"
      })
    );

    await assertFails(
      setDoc(doc(userDb, "bookings", "otherUser_phase2"), {
        bookingId: "otherUser_phase2",
        userId: "otherUser",
        status: "pending",
        phaseId: "phase2"
      })
    );

    await assertFails(
      getDoc(doc(userDb, "bookings", "otherUser_phase1"))
    );

    await assertSucceeds(
      updateDoc(doc(adminDb, "bookings", `${userId}_phase1`), {
        status: "approved"
      })
    );
    await assertSucceeds(getDoc(doc(userDb, "bookings", `${userId}_phase1`)));
    await assertSucceeds(getDoc(doc(adminDb, "bookings", `${userId}_phase1`)));

    // Referral and affiliate aggregates are backend-authoritative.
    await assertFails(
      setDoc(doc(userDb, "referralEvents", `any_${userId}`), {
        userId,
        referrerId: "referrer",
        status: "joined"
      })
    );
    await assertFails(
      updateDoc(doc(userDb, "affiliateStats", userId), {
        totalInvites: 999
      })
    );

    // Profile/progress ownership is still user-authorized.
    await assertSucceeds(
      setDoc(doc(userDb, "users", userId), {
        name: "User A"
      }, { merge: true })
    );
    await assertSucceeds(
      setDoc(doc(userDb, "users", userId, "progress", "phase1"), {
        phaseId: "phase1",
        completedCount: 1
      }, { merge: true })
    );

    console.log("Firestore rules tests passed.");
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((error) => {
  console.error("Firestore rules tests failed.");
  console.error(error);
  process.exitCode = 1;
});
