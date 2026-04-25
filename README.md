# KePixel Tracking Scanner

KePixel Tracking Scanner is a lightweight API-based tracking audit tool built to scan websites and detect common marketing tracking signals.

It is designed to help performance marketers, founders, and technical teams quickly understand whether a website has the basic tracking foundations needed for better attribution, conversion measurement, and ad platform optimization.

---

## What It Does

The scanner checks a website URL and looks for signals related to:

- Meta Pixel
- Meta Conversions API indicators
- TikTok Pixel
- Snapchat Pixel
- Google Tag Manager
- Google Analytics / GA4
- Google Ads tracking
- Common tracking scripts
- Basic website tracking readiness

The goal is not only to detect tags, but also to support a practical KePixel activation plan for improving tracking quality and attribution.

---

## Main Use Case

This project can be used as a backend API for:

- GPT Actions
- Internal audit tools
- Tracking diagnostic dashboards
- Lead generation tools
- Website tracking reports
- KePixel activation plan generation

Example use case:

A user submits a website URL, and the scanner returns a structured audit result that can be used to generate recommendations for Meta, TikTok, Snapchat, Google Ads, and GA4.

---

## API Endpoint

Production endpoint:

```txt
https://kepixel-tracking-scanner.vercel.app/api/scan
