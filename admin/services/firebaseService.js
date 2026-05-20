import { ADMIN_EMAIL_ALIASES, FIREBASE_CONFIG } from "../utils/constants.js";
import { normalizeEmail } from "../utils/normalizers.js";

let context = null;

export async function initializeFirebase() {
  if (context) {
    return context;
  }

  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
  ]);

  const firebaseApp = appSdk.initializeApp(FIREBASE_CONFIG);
  const auth = authSdk.getAuth(firebaseApp);
  const db = firestoreSdk.getFirestore(firebaseApp);
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  context = {
    auth,
    db,
    provider,
    authSdk,
    firestoreSdk
  };

  return context;
}

export async function signInWithGoogle() {
  const firebase = await initializeFirebase();
  const { auth, provider, authSdk } = firebase;
  const canUsePopup = typeof window !== "undefined" && window.innerWidth >= 900;

  if (canUsePopup) {
    try {
      return await authSdk.signInWithPopup(auth, provider);
    } catch (error) {
      if (String(error?.code || "").toLowerCase() !== "auth/popup-blocked") {
        throw error;
      }
    }
  }

  await authSdk.signInWithRedirect(auth, provider);
  return null;
}

export async function processRedirectResult() {
  const firebase = await initializeFirebase();
  const { auth, authSdk } = firebase;
  try {
    await authSdk.getRedirectResult(auth);
  } catch (error) {
    if (String(error?.code || "").toLowerCase() === "auth/no-auth-event") {
      return null;
    }
    throw error;
  }
  return null;
}

export async function signOutCurrentUser() {
  const firebase = await initializeFirebase();
  const { auth, authSdk } = firebase;
  await authSdk.signOut(auth);
}

export async function onAuthStateChange(callback) {
  const firebase = await initializeFirebase();
  const { auth, authSdk } = firebase;
  return authSdk.onAuthStateChanged(auth, callback);
}

export async function isAdminUser(user) {
  if (!user) {
    return false;
  }

  const firebase = await initializeFirebase();
  const { authSdk } = firebase;

  let tokenResult = null;
  try {
    tokenResult = await authSdk.getIdTokenResult(user, false);
  } catch (error) {
    tokenResult = null;
  }

  if (tokenResult?.claims?.admin === true) {
    return true;
  }

  const emailFromUser = normalizeEmail(user.email);
  const emailFromClaim = normalizeEmail(tokenResult?.claims?.email);
  return ADMIN_EMAIL_ALIASES.has(emailFromUser) || ADMIN_EMAIL_ALIASES.has(emailFromClaim);
}
