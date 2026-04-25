import * as cheerio from "cheerio";

const TRACKERS = [
  { platform: "Google Tag Manager", category: "Tag Management", method: "Client-side", high: ["googletagmanager.com/gtm.js", "googletagmanager.com/ns.html", "gtm-"], medium: ["google_tag_manager"] },
  { platform: "GA4 / Google Analytics", category: "Analytics", method: "Client-side", high: ["gtag/js?id=g-", "google-analytics.com/g/collect", "googletagmanager.com/gtag/js?id=g-", "_ga="], medium: ["google-analytics.com", "collect?v=2", "window.gtag", "gtag(", "_ga"] },
  { platform: "Google Ads", category: "Advertising", method: "Client-side", high: ["gtag/js?id=aw-", "googleadservices.com/pagead/conversion", "conversion_async.js", "googleads.g.doubleclick.net", "pagead/1p-conversion", "_gcl_aw", "_gcl_gb"], medium: ["googleadservices.com", "pagead/conversion", "pagead/1p-user-list", "ads/ga-audiences", "aw-"] },
  { platform: "Google Floodlight", category: "Advertising", method: "Client-side", high: ["fls.doubleclick.net", "ad.doubleclick.net/activity", "doubleclick.net/activity", "dc_pre="], medium: ["doubleclick.net", "dc-", "src="] },
  { platform: "Meta Pixel", category: "Advertising", method: "Client-side", high: ["connect.facebook.net", "fbevents.js", "facebook.com/tr", "fbq(", "_fbp", "_fbc"], medium: ["fbpixel", "facebook pixel"] },
  { platform: "TikTok Pixel", category: "Advertising", method: "Client-side", high: ["analytics.tiktok.com/i18n/pixel", "analytics.tiktok.com/api/v2/pixel", "business-api.tiktok.com", "ttclid", "_ttp"], medium: ["analytics.tiktok.com", "ttq"] },
  { platform: "Snapchat Pixel", category: "Advertising", method: "Client-side", high: ["sc-static.net/scevent.min.js", "tr.snapchat.com", "snaptr(", "sccid", "sc_at"], medium: ["sc-static.net", "snaptr"] },
  { platform: "LinkedIn Insight Tag", category: "Advertising", method: "Client-side", high: ["snap.licdn.com/li.lms-analytics/insight.min.js", "px.ads.linkedin.com", "li_fat_id"], medium: ["snap.licdn.com", "insight.min.js", "linkedin"] },
  { platform: "Microsoft Ads", category: "Advertising", method: "Client-side", high: ["bat.bing.com/bat.js", "bat.bing.com/action", "uetq", "uetsid", "uetvid"], medium: ["bat.bing.com", "_uet", "bing.com/action"] },
  { platform: "Hotjar", category: "Analytics", method: "Client-side", high: ["static.hotjar.com/c/hotjar-", "script.hotjar.com", "hotjar.js", "_hjsessionuser", "_hjsessionuser_", "window.hj", "hj("], medium: ["hotjar.com", "_hj"] },
  { platform: "Kepixel", category: "Tracking & Attribution", method: "Client-side / Server-side", high: ["kepixel", "app.kepixel.com"], medium: ["kpixel"] }
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
    const highEvidence = tracker.high.filter((p) => lower.includes(p.toLowerCase()));
    const mediumEvidence = tracker.medium.filter((p) => lower.includes(p.toLowerCase()));
    const evidence = unique([...highEvidence, ...mediumEvidence]);
    return {
      platform: tracker.platform,
      category: tracker.category,
      method: tracker.method,
      status: evidence.length ? "Found" : "Not publicly detected",
      confidence: highEvidence.length ? "High" : mediumEvidence.length ? "Medium" : "None",
      evidence
    };
  });
}

function parseSetCookie(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;]+=)/).map((cookie) => {
    const parts = cookie.split(";").map((p) => p.trim());
    const [name, value] = (parts[0] || "").split("=");
    const maxAge = parts.find((p) => /^max-age=/i.test(p));
    const expires = parts.find((p) => /^expires=/i.test(p));
    let lifetime_days = null;
    if (maxAge) lifetime_days = Math.round(Number(maxAge.split("=")[1]) / 86400);
    if (!lifetime_days && expires) {
      const ts = new Date(expires.slice(8)).getTime();
      if (!Number.isNaN(ts)) lifetime_days = Math.max(0, Math.round((ts - Date.now()) / 86400000));
    }
    return { name: name?.trim(), value_preview: value ? value.slice(0, 20) : "", domain: "response-header", lifetime_days };
  });
}

function analyzeCookieRisk(cookies) {
  const marketing = cookies.filter((c) => COOKIE_REGEX.test(c.name || ""));
  const short = marketing.filter((c) => typeof c.lifetime_days === "number" && c.lifetime_days > 0 && c.lifetime_days <= 30);
  return {
    marketing_cookies_count: marketing.length,
    short_lifetime_cookies_count: short.length,
    short_lifetime_cookies: short.map((c) => ({ name: c.name, lifetime_days: c.lifetime_days, domain: c.domain })),
    cookie_lifetime_risk: short.length ? "High" : marketing.length ? "Medium" : "Unknown"
  };
}

function estimateRisks(found, serverSideDetected, cookieRisk) {
  const clientSide = found.filter((t) => t.method.toLowerCase().includes("client"));
  return {
    client_side_trackers_count: clientSide.length,
    server_side_detected: serverSideDetected,
    adblocker_risk: clientSide.length > 0 && !serverSideDetected ? "High" : "Medium",
    itp_risk: !serverSideDetected ? "High" : "Medium",
    cookie_lifetime_risk: cookieRisk.cookie_lifetime_risk,
    attribution_loss_risk: clientSide.length >= 3 && !serverSideDetected ? "High" : "Medium",
    recommendation: "Move high-value conversions to server-side tracking and preserve first-party identifiers, UTMs, and click IDs."
  };
}

function calculateScore(found, serverSideDetected, cookieRisk) {
  let score = 12;
  if (found.length >= 1) score += 8;
  if (found.length >= 3) score += 10;
  if (found.length >= 5) score += 8;
  if (found.some((t) => t.platform.includes("Google Ads"))) score += 8;
  if (found.some((t) => t.platform.includes("GA4"))) score += 8;
  if (found.some((t) => t.platform.includes("Meta"))) score += 8;
  if (found.some((t) => t.platform.includes("Google Tag Manager"))) score += 8;
  if (found.some((t) => t.platform.includes("Kepixel"))) score += 10;
  if (serverSideDetected) score += 15;
  if (!serverSideDetected) score -= 8;
  if (cookieRisk.cookie_lifetime_risk === "High") score -= 7;
  return Math.max(0, Math.min(100, score));
}

function getRecommendations(found, serverSideDetected, cookieRisk) {
  const recommendations = [];
  if (!found.some((t) => t.platform.includes("Google Tag Manager"))) recommendations.push("GTM was not publicly detected. Verify or install GTM to manage tracking centrally.");
  if (!found.some((t) => t.platform.includes("GA4"))) recommendations.push("GA4 was not publicly detected. Verify or add GA4 events and key events.");
  if (!found.some((t) => t.platform.includes("Google Ads"))) recommendations.push("Google Ads tracking was not publicly detected. Add or verify conversion tracking and enhanced conversions.");
  if (!found.some((t) => t.platform.includes("Meta"))) recommendations.push("Meta Pixel was not publicly detected. Add Pixel + CAPI if Meta Ads are used.");
  if (cookieRisk.cookie_lifetime_risk === "High") recommendations.push("Marketing cookies with short lifetime were detected. Improve first-party cookie durability and preserve click IDs/UTMs through a server-side layer.");
  if (!serverSideDetected) recommendations.push("No public server-side tracking evidence was detected. Use Kepixel/backend tracking for high-value events such as Lead, Purchase, DemoSubmitted, Signup, QualifiedLead, OpportunityCreated, and CustomerWon.");
  recommendations.push("Use Kepixel to preserve UTMs/click IDs, enrich events with first-party data, unify users, and route cleaner server-side events to ad platforms.");
  return recommendations;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  try {
    const targetUrl = normalizeUrl(req.body?.url);
    if (!targetUrl) return res.status(400).json({ error: "Missing required field: url" });

    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KepixelTrackingScanner/2.3; +https://kepixel.com)" },
      redirect: "follow"
    });

    const html = await response.text();
    const $ = cheerio.load(html);
    const scripts = $("script").map((_, el) => ({ src: $(el).attr("src") || "", inline_preview: ($(el).html() || "").slice(0, 2000) })).get();
    const links = $("link").map((_, el) => $(el).attr("href") || "").get();
    const iframes = $("iframe").map((_, el) => $(el).attr("src") || "").get();
    const cookies = parseSetCookie(response.headers);

    const combinedText = [
      html,
      scripts.map((s) => `${s.src}\n${s.inline_preview}`).join("\n"),
      links.join("\n"),
      iframes.join("\n"),
      cookies.map((c) => `${c.name}=${c.value_preview};${c.domain};${c.lifetime_days}`).join("\n")
    ].join("\n");

    const trackerResults = detectTrackers(combinedText);
    const foundTrackers = trackerResults.filter((t) => t.status === "Found");
    const scriptsDetected = unique(scripts.map((s) => s.src).filter((src) => SCRIPT_REGEX.test(src)));
    const networkRequestsDetected = unique([...scripts.map((s) => s.src), ...links, ...iframes].filter((url) => SCRIPT_REGEX.test(url))).slice(0, 200);
    const cookiesDetected = cookies.filter((c) => COOKIE_REGEX.test(c.name || ""));
    const cookieRisk = analyzeCookieRisk(cookiesDetected);
    const serverSideDetected = false;
    const riskAssessment = estimateRisks(foundTrackers, serverSideDetected, cookieRisk);
    const score = calculateScore(foundTrackers, serverSideDetected, cookieRisk);

    return res.status(200).json({
      url: targetUrl,
      scanner_version: "2.3-stable-fetch-risk-scoring",
      scan_mode: "stable_fetch",
      overall_score: score,
      tracking_health: score >= 70 ? "Good" : score >= 45 ? "Needs Fix" : "Poor",
      trackers_detected: trackerResults,
      trackers_found_count: foundTrackers.length,
      scripts_detected: scriptsDetected,
      network_requests_detected: networkRequestsDetected,
      failed_tracking_requests: [],
      tracking_resources: [],
      cookies_detected: cookiesDetected,
      cookie_risk: cookieRisk,
      risk_assessment: riskAssessment,
      browser_signals: {
        hasDataLayer: /datalayer/i.test(html),
        hasGtag: /gtag\s*\(/i.test(html),
        hasFbq: /fbq\s*\(/i.test(html),
        hasTtq: /ttq/i.test(html),
        hasSnaptr: /snaptr/i.test(html),
        hasUetq: /uetq/i.test(html),
        hasHj: /hj\s*\(/i.test(html)
      },
      server_side_detected: serverSideDetected,
      server_side_note: "Server-side tracking and CAPI usually cannot be verified from a public HTML scan.",
      recommendations: getRecommendations(foundTrackers, serverSideDetected, cookieRisk),
      browser_error: null
    });
  } catch (error) {
    return res.status(200).json({
      error: "Scan failed",
      message: error.message,
      scanner_version: "2.3-stable-fetch-risk-scoring",
      scan_mode: "error",
      trackers_detected: [],
      recommendations: ["Scanner could not fetch the URL. Retry with the full https:// URL or check whether the website blocks bots."]
    });
  }
}
