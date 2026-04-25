import * as cheerio from "cheerio";

const TRACKERS = [
  {
    platform: "Google Tag Manager",
    category: "Tag Management",
    method: "Client-side",
    patterns: ["googletagmanager.com/gtm.js", "gtm-"]
  },
  {
    platform: "GA4 / Google Analytics",
    category: "Analytics",
    method: "Client-side",
    patterns: ["gtag/js?id=g-", "google-analytics.com", "googletagmanager.com/gtag/js?id=g-", "_ga"]
  },
  {
    platform: "Google Ads",
    category: "Advertising",
    method: "Client-side",
    patterns: ["gtag/js?id=aw-", "googleadservices.com", "conversion_async.js", "_gcl_aw", "_gcl_gb"]
  },
  {
    platform: "Google Floodlight",
    category: "Advertising",
    method: "Client-side",
    patterns: ["doubleclick.net", "fls.doubleclick.net", "dc-"]
  },
  {
    platform: "Meta Pixel",
    category: "Advertising",
    method: "Client-side",
    patterns: ["connect.facebook.net", "fbevents.js", "fbq(", "_fbp", "_fbc"]
  },
  {
    platform: "TikTok Pixel",
    category: "Advertising",
    method: "Client-side",
    patterns: ["analytics.tiktok.com", "ttq", "ttclid"]
  },
  {
    platform: "Snapchat Pixel",
    category: "Advertising",
    method: "Client-side",
    patterns: ["sc-static.net", "snaptr", "sccid"]
  },
  {
    platform: "LinkedIn Insight Tag",
    category: "Advertising",
    method: "Client-side",
    patterns: ["snap.licdn.com", "insight.min.js", "li_fat_id", "linkedin"]
  },
  {
    platform: "Microsoft Ads",
    category: "Advertising",
    method: "Client-side",
    patterns: ["bat.bing.com", "bat.js", "_uet"]
  },
  {
    platform: "Hotjar",
    category: "Analytics",
    method: "Client-side",
    patterns: ["hotjar.com", "hotjar.js", "_hjsessionuser", "_hj"]
  },
  {
    platform: "Kepixel",
    category: "Tracking & Attribution",
    method: "Client-side / Server-side",
    patterns: ["kepixel", "app.kepixel.com"]
  }
];

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  return url.startsWith("http") ? url : `https://${url}`;
}

function detectTrackers(text) {
  const lower = text.toLowerCase();

  return TRACKERS.map((tracker) => {
    const evidence = tracker.patterns.filter((pattern) =>
      lower.includes(pattern.toLowerCase())
    );

    return {
      platform: tracker.platform,
      category: tracker.category,
      method: tracker.method,
      status: evidence.length ? "Found" : "Not publicly detected",
      evidence
    };
  });
}

function extractScripts($) {
  return $("script")
    .map((_, el) => {
      const src = $(el).attr("src") || "";
      const inline = $(el).html() || "";
      return {
        src,
        inline_preview: inline.slice(0, 500)
      };
    })
    .get();
}

function extractCookies(headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return [];

  return raw.split(/,(?=\s*[^;]+=)/).map((cookie) => {
    const [nameValue] = cookie.split(";");
    const [name, value] = nameValue.split("=");
    return {
      name: name?.trim(),
      value_preview: value ? value.slice(0, 20) : ""
    };
  });
}

function calculateScore(foundTrackers) {
  let score = 20;

  if (foundTrackers.length >= 1) score += 10;
  if (foundTrackers.length >= 3) score += 10;
  if (foundTrackers.some((t) => t.platform.includes("Google Ads"))) score += 10;
  if (foundTrackers.some((t) => t.platform.includes("GA4"))) score += 10;
  if (foundTrackers.some((t) => t.platform.includes("Meta"))) score += 10;
  if (foundTrackers.some((t) => t.platform.includes("Google Tag Manager"))) score += 10;
  if (foundTrackers.some((t) => t.platform.includes("Kepixel"))) score += 10;

  score -= 10;

  return Math.max(0, Math.min(100, score));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed. Use POST."
    });
  }

  try {
    const targetUrl = normalizeUrl(req.body?.url);

    if (!targetUrl) {
      return res.status(400).json({
        error: "Missing required field: url"
      });
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KepixelTrackingScanner/1.0; +https://kepixel.com)"
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);
    const scripts = extractScripts($);
    const cookies = extractCookies(response.headers);

    const combinedText = [
      html,
      ...scripts.map((s) => `${s.src}\n${s.inline_preview}`),
      ...cookies.map((c) => `${c.name}=${c.value_preview}`)
    ].join("\n");

    const trackerResults = detectTrackers(combinedText);
    const foundTrackers = trackerResults.filter((t) => t.status === "Found");

    const scriptsDetected = scripts
      .filter((s) =>
        /googletagmanager|google-analytics|googleadservices|doubleclick|facebook|fbevents|tiktok|snap|licdn|bing|hotjar|kepixel/i.test(
          s.src
        )
      )
      .map((s) => s.src);

    const cookiesDetected = cookies.filter((c) =>
      /^(?:_gcl|_ga|_fbp|_fbc|li_|_hj|_uet|ttclid|sc)/i.test(c.name || "")
    );

    const score = calculateScore(foundTrackers);

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

    recommendations.push("Server-side tracking is not visible from the public page. Use Kepixel/backend tracking for high-value events.");
    recommendations.push("Use Kepixel to preserve UTMs/click IDs, enrich events with first-party data, and route cleaner events to ad platforms.");

    return res.status(200).json({
      url: targetUrl,
      overall_score: score,
      tracking_health: score >= 70 ? "Good" : score >= 45 ? "Needs Fix" : "Poor",
      trackers_detected: trackerResults,
      trackers_found_count: foundTrackers.length,
      scripts_detected: scriptsDetected,
      cookies_detected: cookiesDetected,
      server_side_detected: false,
      server_side_note:
        "Server-side tracking and CAPI usually cannot be verified from a public HTML scan.",
      adblocker_risk: true,
      itp_risk: true,
      page_speed_score: null,
      recommendations
    });
  } catch (error) {
    return res.status(500).json({
      error: "Scan failed",
      message: error.message
    });
  }
}
