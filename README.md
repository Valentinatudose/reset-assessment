# RESET Assessment — Vercel Deployment

**Your Hidden Pattern Blueprint** — the free RESET Method assessment at happyeverafter.asia

## What this does

A 13-question assessment that profiles the user's dominant pattern, RESET stage recommendation, and readiness level. On completion it:
1. Displays a personalised results page
2. Offers a PDF download of the profile
3. Subscribes the user to Mailchimp with pattern-specific tags (for automated email sequences)
4. Submits data to Google Sheets (via existing Apps Script)

## Project structure

```
/api/subscribe.js     — Vercel serverless function (Mailchimp relay, key stays private)
/public/index.html    — The assessment itself
/vercel.json          — Vercel routing config
```

## Environment variables (set in Vercel dashboard, never in code)

| Variable | Description |
|---|---|
| `MAILCHIMP_API_KEY` | Mailchimp API key — rotate if ever exposed |
| `MAILCHIMP_AUDIENCE_ID` | `cd6f17dc7e` |
| `MAILCHIMP_DC` | `us8` |

## Mailchimp tags applied on completion

**Pattern tags** (one per user):
- `pattern-prove-worth`
- `pattern-holding-old`
- `pattern-feeling-lost`
- `pattern-resisting-change`
- `pattern-disconnected`
- `pattern-embracing-new`

**RESET step tags:**
- `reset-erase` / `reset-set` / `reset-empower` / `reset-recognise` / `reset-transform`

**Readiness tags:**
- `readiness-deep` / `readiness-building` / `readiness-starting`

**Always applied:**
- `assessment-completed`

## Mailchimp Customer Journeys

Six automated sequences — one per pattern tag. Each has 4 emails:
- Day 0: Pattern deepdive + "does this land?"
- Day 3: Book mention (*Your Knight in Shining Armour*)
- Day 7: Transformation story + diagnostic session CTA
- Day 14: Check-in / re-engage

## To update the assessment

Edit `/public/index.html` and push to GitHub. Vercel redeploys automatically.

## Links

- Live assessment: your Vercel URL
- Mailchimp audience: us8.admin.mailchimp.com
- Google Sheet: your existing Apps Script URL
- Book: amazon.com/dp/B0GSQ6VSMF
- Website: happyeverafter.asia
