const IN_APP_UA_RULES = [
  {
    id: "facebook-messenger",
    label: "Facebook or Messenger",
    regex: /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A|MESSENGER)\b/i
  },
  {
    id: "instagram",
    label: "Instagram",
    regex: /\bInstagram\b/i
  },
  {
    id: "line",
    label: "LINE",
    regex: /\bLine\/|\bLine\b/i
  },
  {
    id: "wechat",
    label: "WeChat",
    regex: /\bMicroMessenger\b/i
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    regex: /\bLinkedInApp\b/i
  },
  {
    id: "twitter",
    label: "X or Twitter",
    regex: /\bTwitter\b/i
  },
  {
    id: "tiktok",
    label: "TikTok",
    regex: /\bTikTok\b/i
  },
  {
    id: "snapchat",
    label: "Snapchat",
    regex: /\bSnapchat\b/i
  }
];

const ANDROID_WEBVIEW_REGEX = /;\s*wv\)|\bwv\b|Version\/[\d.]+.*Chrome\/[\d.]+.*Mobile\s+Safari\/[\d.]+/i;
const IOS_KNOWN_BROWSER_TOKEN_REGEX = /\b(CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo)\b/i;

function getPlatformFromUserAgent(userAgent) {
  if (/\bAndroid\b/i.test(userAgent)) {
    return "android";
  }
  if (/\b(iPhone|iPad|iPod)\b/i.test(userAgent)) {
    return "ios";
  }
  if (/\b(Windows NT|Macintosh|Linux)\b/i.test(userAgent)) {
    return "desktop";
  }
  return "unknown";
}

/**
 * Detects if current environment is an embedded/in-app browser where Google OAuth is likely blocked.
 * Returns a structured result so callers can decide how strict they want to be.
 */
export function detectInAppBrowserEnvironment(userAgent = navigator.userAgent) {
  const ua = String(userAgent || "");
  const platform = getPlatformFromUserAgent(ua);

  const matchedRule = IN_APP_UA_RULES.find((rule) => rule.regex.test(ua)) || null;
  if (matchedRule) {
    return {
      platform,
      classification: "blocked",
      shouldBlockGoogleAuth: true,
      isUncertain: false,
      detectedApp: matchedRule.label,
      reason: `Matched known in-app browser signature: ${matchedRule.id}.`,
      matchedRuleId: matchedRule.id
    };
  }

  const isAndroidWebView = platform === "android" && ANDROID_WEBVIEW_REGEX.test(ua);
  if (isAndroidWebView) {
    return {
      platform,
      classification: "blocked",
      shouldBlockGoogleAuth: true,
      isUncertain: false,
      detectedApp: "Embedded Android WebView",
      reason: "Detected Android WebView tokens in user-agent.",
      matchedRuleId: "android-webview"
    };
  }

  const hasAppleWebKit = /\bAppleWebKit\b/i.test(ua);
  const hasSafariToken = /\bSafari\b/i.test(ua);
  const hasKnownIOSBrowserToken = IOS_KNOWN_BROWSER_TOKEN_REGEX.test(ua);
  const looksLikeIOSEmbeddedWebView = platform === "ios" && hasAppleWebKit && !hasSafariToken && !hasKnownIOSBrowserToken;

  if (looksLikeIOSEmbeddedWebView) {
    return {
      platform,
      classification: "uncertain",
      shouldBlockGoogleAuth: false,
      isUncertain: true,
      detectedApp: "Possible iOS embedded WebView",
      reason: "iOS WebKit user-agent without Safari/mainstream browser tokens.",
      matchedRuleId: "ios-webview-heuristic"
    };
  }

  return {
    platform,
    classification: "supported",
    shouldBlockGoogleAuth: false,
    isUncertain: false,
    detectedApp: "Supported browser",
    reason: "No in-app browser signature detected.",
    matchedRuleId: null
  };
}

export function getInAppBrowserInstructions() {
  return {
    android: [
      "Open the in-app menu (three dots or app menu icon).",
      "Tap \"Open in browser\" or \"Open in Chrome\".",
      "If unavailable, copy this link and paste it in Chrome."
    ],
    ios: [
      "Open the in-app menu (three dots or share menu).",
      "Tap \"Open in Browser\" or \"Open in Safari\".",
      "If unavailable, copy this link and open it in Safari."
    ]
  };
}

/**
 * Best-effort Android deep link to hand off current URL to Chrome.
 * This may not work in every in-app browser, so caller should keep manual fallback options.
 */
export function buildAndroidOpenInBrowserUrl(targetUrl = window.location.href, userAgent = navigator.userAgent) {
  if (!/\bAndroid\b/i.test(String(userAgent || ""))) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl, window.location.href);
  } catch (error) {
    return null;
  }

  const scheme = parsedUrl.protocol.replace(":", "");
  if (!scheme || (scheme !== "http" && scheme !== "https")) {
    return null;
  }

  const hostWithPath = `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  return `intent://${hostWithPath}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}
