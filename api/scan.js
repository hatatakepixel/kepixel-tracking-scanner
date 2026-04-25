import * as cheerio from "cheerio";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const TRACKERS = [
  {
    platform: "Google Tag Manager",
    category: "Tag Management",
    method: "Client-side",
    highConfidencePatterns: ["googletagmanager.com/gtm.js", "googletagmanager.com/ns.html", "gtm-"],
    mediumConfidencePatterns: ["google_tag_manager"]
  },
  {
    platform: "GA4 / Google Analytics",
    category: "Analytics",
    method: "Client-side",
    highConfidencePatterns: ["gtag/js?id=g-", "google-analytics.com/g/collect", "analytics.google.com", "googletagmanager.com/gtag/js?id=g-", "measurement_id", "_ga="],
    mediumConfidencePatterns: ["google-analytics.com", "collect?v=2", "window.gtag", "gtag(", "_ga"]
  },
  {
    platform: "Google Ads",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["gtag/js?id=aw-", "googleadservices.com/pagead/conversion", "conversion_async.js", "googleads.g.doubleclick.net/pagead", "pagead/1p-conversion", "_gcl_aw", "_gcl_gb"],
    mediumConfidencePatterns: ["googleads.g.doubleclick.net", "googleadservices.com", "pagead/conversion", "aw-"]
  },
  {
    platform: "Google Floodlight",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["fls.doubleclick.net", "ad.doubleclick.net/activity", "doubleclick.net/activity", "dc_pre="],
    mediumConfidencePatterns: ["doubleclick.net", "dc-", "src="]
  },
  {
    platform: "Meta Pixel",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["connect.facebook.net", "fbevents.js", "facebook.com/tr", "fbq(", "_fbp", "_fbc"],
    mediumConfidencePatterns: ["fbpixel", "facebook pixel"]
  },
  {
    platform: "TikTok Pixel",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["analytics.tiktok.com/i18n/pixel", "analytics.tiktok.com/api/v2/pixel", "business-api.tiktok.com", "ttclid", "_ttp"],
    mediumConfidencePatterns: ["analytics.tiktok.com", "ttq"]
  },
  {
    platform: "Snapchat Pixel",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["sc-static.net/scevent.min.js", "tr.snapchat.com", "snaptr(", "sccid", "sc_at"],
    mediumConfidencePatterns: ["sc-static.net", "snaptr"]
  },
  {
    platform: "LinkedIn Insight Tag",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["snap.licdn.com/li.lms-analytics/insight.min.js", "px.ads.linkedin.com", "li_fat_id", "linkedin_oauth", "linkedin"],
    mediumConfidencePatterns: ["snap.licdn.com", "insight.min.js", "linkedin"]
  },
  {
    platform: "Microsoft Ads",
    category: "Advertising",
    method: "Client-side",
    highConfidencePatterns: ["bat.bing.com/bat.js", "bat.bing.com/action", "uetq", "uetsid", "uetvid"],
    mediumConfidencePatterns: ["bat.bing.com", "_uet", "bing.com/action"]
  },
  {
    platform: "Hotjar",
    category: "Analytics",
    method: "Client-side",
    highConfidencePatterns: ["static.hotjar.com/c/hotjar-", "script.hotjar.com", "hotjar.js", "_hjsessionuser", "_hjSessionUser", "window.hj", "hj("],
    mediumConfidencePatterns: ["hotjar.com", "_hj"]
  },
  {
    platform: "Kepixel",
    category: "Tracking & Attribution",
    method: "Client-side / Server-side",
    highConfidencePatterns: ["kepixel", "app.kepixel.com"],
    mediumConfidencePatterns: ["kpixel"]
  }
];

const SCRIPT_REGEX = /googletagmanager|google-analytics|googleadservices|googleads|doubleclick|pagead|facebook|fbevents|tiktok|snapchat|sc-static|licdn|linkedin|bing|hotjar|kepixel/i;
const COOKIE_REGEX = /^(?:_gcl|_ga|_gid|_fbp|_fbc|li_|bcookie|bscookie|lidc|_hj|_uet|uetsid|uetvid|ttclid|_ttp|sc|sc_at)/i;

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectTrackers(text) {
  const lower = text.toLowerCase();

  return TRACKERS.map((tracker) => {
    const highEvidence = tracker.highConfidencePatterns.filter((pattern) =>
      lower.includes(pattern.toLowerCase())
    );

    const mediumEvidence = tracker.mediumConfidencePatterns.filter((pattern) =>
      lower.includes(pattern.toLowerCase())
    );

    const evidence = unique([...highEvidence, ...mediumEvidence]);
    const confidence = highEvidence.length ? "High" : mediumEvidence.length ? "Medium" : "None";

    return {
      platform: tracker.platform,
      category: tracker.category,
      method: tracker.method,
      status: evidence.length ? "Found" : "Not publicly detected",
      confidence,
      evidence
    };
  });
}

function calculateScore(foundTrackers, serverSideDetected) {
  let score = 12;

  if (foundTrackers.length >= 1) score += 8;
  if (foundTrackers.length >= 3) score += 10;
  if (foundTrackers.length >= 5) score += 8;
  if (foundTrackers.some((t) => t.platform.includes("Google Ads"))) score += 8;
  if (foundTrackers.some((t) => t.platform.includes("GA4"))) score += 8;
  if (foundTrackers.some((t) => t.platform.includes("Meta"))) score += 8;
  if (foundTrackers.some((t) => t.platform.includes("Google Tag Manager"))) score += 8;
  if (foundTrackers.some((t) => t.platform.includes("Kepixel"))) score += 10;
  if (serverSideDetected) score += 15;
  if (!serverSideDetected) score -= 8;

  return Math.max(0, Math.min(100, score));
}

function getRecommendations(foundTrackers, serverSideDetected) {
  const recommendations = [];

  if (!foundTrackers.some((t) => t.platform.includes("Google Tag Manager"))) {
    recommendations.push("GTM was not publicly detected. Verify or install GTM to manage tracking centrally.");
  }

  if (!foundTrackers.some((t) => t.platform.includes("GA4"))) {
    recommendations.push("GA4 was not publicly detected. Verify or add GA4 events and key events.");
  }

  if (!foundTrackers.some((t) => t.platform.includes("Google Ads"))) {
    recommendations.push("Google Ads tracking was not publicly detected. Add or verify conversion tracking and enhanced conversions.");
  }

  if (!foundTrackers.some((t) => t.platform.includes("Meta"))) {
    recommendations.push("Meta Pixel was not publicly detected. Add Pixel + CAPI if Meta Ads are used.");
  }

  if (!serverSideDetected) {
    recommendations.push("No public server-side tracking evidence was detected. Use Kepixel/backend tracking for high-value events such as Lead, Purchase, DemoSubmitted, Signup, QualifiedLead, OpportunityCreated, and CustomerWon.");
  }

  recommendations.push("Use Kepixel to preserve UTMs/click IDs, enrich events with first-party data, unify users, and route cleaner server-side events to ad platforms.");

  return recommendations;
}

async function safeClickConsent(page) {
  const selectors = [
    "button#onetrust-accept-btn-handler",
    "button[aria-label*='Accept']",
    "button[aria-label*='accept']",
    "button:has-text('Accept')",
    "button:has-text('Accept all')",
    "button:has-text('Allow all')",
    "button:has-text('Agree')"
  ];

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click({ delay: 30 });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function scanWithBrowser(targetUrl) {
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");

    const requests = [];
    const responses = [];
    const failedRequests = [];

    page.on("request", (request) => requests.push(request.url()));
    page.on("response", (response) => responses.push(response.url()));
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" }));

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await safeClickConsent(page);
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // Try lightweight interaction to trigger lazy-loaded tags.
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (_) {}

    const html = await page.content();
    const scripts = await page.$$eval("script", (els) =>
      els.map((el) => ({ src: el.src || "", inline_preview: (el.innerHTML || "").slice(0, 1200) }))
    );

    const cookies = await page.cookies();

    const browserSignals = await page.evaluate(() => {
      return {
        hasDataLayer: Array.isArray(window.dataLayer),
        dataLayerLength: Array.isArray(window.dataLayer) ? window.dataLayer.length : 0,
        hasGtag: typeof window.gtag === "function",
        hasFbq: typeof window.fbq === "function",
        hasTtq: typeof window.ttq === "object" || typeof window.ttq === "function",
        hasSnaptr: typeof window.snaptr === "function",
        hasUetq: Array.isArray(window.uetq),
        hasHj: typeof window.hj === "function",
        dataLayerPreview: Array.isArray(window.dataLayer) ? JSON.stringify(window.dataLayer).slice(0, 2000) : ""
      };
    });

    return { html, scripts, cookies, requests, responses, failedRequests, browserSignals };
  } finally {
    await browser.close();
  }
}

async function scanWithFetch(targetUrl) {
  const response = await fetch(targetUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; KepixelTrackingScanner/2.1; +https://kepixel.com)" }
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  const scripts = $("script")
    .map((_, el) => ({ src: $(el).attr("src") || "", inline_preview: ($(el).html() || "").slice(0, 1200) }))
    .get();

  const rawCookie = response.headers.get("set-cookie");
  const cookies = rawCookie
    ? rawCookie.split(/,(?=\s*[^;]+=)/).map((cookie) => {
        const [nameValue] = cookie.split(";");
        const [name, value] = nameValue.split("=");
        return { name: name?.trim(), value: value ? value.slice(0, 20) : "", domain: "response-header" };
      })
    : [];

  return {
    html,
    scripts,
    cookies,
    requests: [],
    responses: [],
    failedRequests: [],
    browserSignals: {
      hasDataLayer: false,
      dataLayerLength: 0,
      hasGtag: false,
      hasFbq: false,
      hasTtq: false,
      hasSnaptr: false,
      hasUetq: false,
      hasHj: false,
      dataLayerPreview: ""
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const targetUrl = normalizeUrl(req.body?.url);
  if (!targetUrl) return res.status(400).json({ error: "Missing required field: url" });

  let scanMode = "browser";
  let scan;

  try {
    scan = await scanWithBrowser(targetUrl);
  } catch (browserError) {
    scanMode = "fetch_fallback";
    scan = await scanWithFetch(targetUrl);
    scan.browser_error = browserError.message;
  }

  try {
    const scriptsText = scan.scripts.map((s) => `${s.src}\n${s.inline_preview}`).join("\n");
    const cookiesText = scan.cookies.map((c) => `${c.name}=${c.value || c.value_preview || ""};${c.domain || ""}`).join("\n");
    const networkText = [...scan.requests, ...scan.responses].join("\n");
    const failedText = (scan.failedRequests || []).map((r) => `${r.url} ${r.failure}`).join("\n");
    const browserSignalsText = JSON.stringify(scan.browserSignals || {});

    const combinedText = [scan.html, scriptsText, cookiesText, networkText, failedText, browserSignalsText].join("\n");

    const trackerResults = detectTrackers(combinedText);
    const foundTrackers = trackerResults.filter((t) => t.status === "Found");

    const scriptsDetected = unique(scan.scripts.map((s) => s.src).filter((src) => SCRIPT_REGEX.test(src)));
    const networkRequestsDetected = unique([...scan.requests, ...scan.responses].filter((url) => SCRIPT_REGEX.test(url))).slice(0, 200);
    const failedTrackingRequests = unique((scan.failedRequests || []).map((r) => r.url).filter((url) => SCRIPT_REGEX.test(url))).slice(0, 50);

    const cookiesDetected = scan.cookies
      .filter((c) => COOKIE_REGEX.test(c.name || ""))
      .map((c) => ({ name: c.name, domain: c.domain || "", expires: c.expires || null }));

    const serverSideDetected = false;
    const score = calculateScore(foundTrackers, serverSideDetected);

    return res.status(200).json({
      url: targetUrl,
      scanner_version: "2.1-browser-rendering-enhanced",
      scan_mode: scanMode,
      overall_score: score,
      tracking_health: score >= 70 ? "Good" : score >= 45 ? "Needs Fix" : "Poor",
      trackers_detected: trackerResults,
      trackers_found_count: foundTrackers.length,
      scripts_detected: scriptsDetected,
      network_requests_detected: networkRequestsDetected,
      failed_tracking_requests: failedTrackingRequests,
      cookies_detected: cookiesDetected,
      browser_signals: scan.browserSignals,
      server_side_detected: serverSideDetected,
      server_side_note: "Server-side tracking and CAPI usually cannot be verified from a public browser scan.",
      adblocker_risk: true,
      itp_risk: true,
      page_speed_score: null,
      recommendations: getRecommendations(foundTrackers, serverSideDetected),
      browser_error: scan.browser_error || null
    });
  } catch (error) {
    return res.status(500).json({ error: "Scan failed", message: error.message });
  }
}
