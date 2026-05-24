import { FIREBASE_CONFIG } from "../../utils/constants.js";

const FUNCTIONS_REGION = "asia-south1";
const FUNCTIONS_EMULATOR_HOST = "127.0.0.1";
const FUNCTIONS_EMULATOR_PORT = 5001;
const FUNCTIONS_EMULATOR_QUERY_KEY = "functionsEmulator";

let firebaseContext = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isLocalLikeHost(hostname) {
  const normalized = normalizeString(hostname).toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost")
  );
}

function shouldUseFunctionsEmulator() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const queryValue = normalizeString(params.get(FUNCTIONS_EMULATOR_QUERY_KEY)).toLowerCase();
    return queryValue === "1" || queryValue === "true" || queryValue === "yes";
  } catch (error) {
    void error;
    return false;
  }
}

export async function initializeFirebaseClient() {
  if (firebaseContext) {
    return firebaseContext;
  }

  const [appSdk, authSdk, functionsSdk, firestoreSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
  ]);

  const firebaseApp = appSdk.initializeApp(FIREBASE_CONFIG);
  const auth = authSdk.getAuth(firebaseApp);
  const functions = functionsSdk.getFunctions(firebaseApp, FUNCTIONS_REGION);
  const db = firestoreSdk.getFirestore(firebaseApp);
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (
    typeof window !== "undefined" &&
    isLocalLikeHost(window.location.hostname) &&
    shouldUseFunctionsEmulator() &&
    typeof functionsSdk.connectFunctionsEmulator === "function"
  ) {
    functionsSdk.connectFunctionsEmulator(functions, FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
  }

  firebaseContext = {
    auth,
    db,
    functions,
    provider,
    authSdk,
    functionsSdk,
    firestoreSdk
  };
  return firebaseContext;
}

export async function processRedirectResult() {
  const { auth, authSdk } = await initializeFirebaseClient();
  try {
    await authSdk.getRedirectResult(auth);
  } catch (error) {
    const code = normalizeString(error?.code).toLowerCase();
    if (code === "auth/no-auth-event") {
      return null;
    }
    throw error;
  }
  return null;
}

export async function signInWithGoogle() {
  const { auth, provider, authSdk } = await initializeFirebaseClient();
  const canUsePopup = typeof window !== "undefined" && window.innerWidth >= 900;

  if (canUsePopup) {
    try {
      return await authSdk.signInWithPopup(auth, provider);
    } catch (error) {
      const code = normalizeString(error?.code).toLowerCase();
      if (code !== "auth/popup-blocked") {
        throw error;
      }
    }
  }

  await authSdk.signInWithRedirect(auth, provider);
  return null;
}

export async function signOutCurrentUser() {
  const { auth, authSdk } = await initializeFirebaseClient();
  await authSdk.signOut(auth);
}

export async function onAuthStateChange(callback) {
  const { auth, authSdk } = await initializeFirebaseClient();
  return authSdk.onAuthStateChanged(auth, callback);
}

export async function callBackendFunction(name, data = {}) {
  const { functions, functionsSdk } = await initializeFirebaseClient();
  const fn = functionsSdk.httpsCallable(functions, name);
  const response = await fn(data);
  return response?.data || null;
}
