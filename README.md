# RESET Assessment

The free assessment at **[reset.happyeverafter.asia](https://reset.happyeverafter.asia)** — the front door of the Happy Ever After funnel.

Ten questions, three minutes. Returns one of five relationship **patterns** (or a secure-baseline result), emails the taker a profile PDF, and writes them to Mailchimp as a subscriber.

Its only job is to turn strangers into email subscribers. It is not a revenue product.

---

## What it returns

Five fixed archetypes, taken from *Your Knight in Shining Armour*. **These names are canon — never rename, merge or add to them:**

- The Disconnected
- The Over-Giver
- The Controller
- The People-Pleaser
- The Splitter

Plus a **secure-baseline** result for takers who don't score into a wound pattern.

A result is a **dominant pattern**, with an optional **secondary**. It is **not** a RESET stage recommendation.

The profile PDF is available two ways: a download button on the results page (`/profiles/<tag>.pdf`), and a link in the confirmation email. **Website copy should promise the email**, because the results page is ephemeral — a refresh returns to the landing screen, so a taker who closes the tab has only the email.

The result page has four layers: **The Mirror → The Reframe → The Declaration Card → Your Next Step.** It is ephemeral; a refresh returns to the landing screen.

---

## Scoring

Two constants in `index.html` govern the whole thing:

| constant | value | effect |
|---|---|---|
| `PATTERN_FLOOR` | 3 | a pattern is only crowned if it reaches at least 3 answers |
| `MIN_SECURE_FOR_BASELINE` | 4 | if no pattern clears the floor and at least 4 answers were secure → secure result |

Every question carries **one zero-scoring secure option**. This matters: before it existed, noise was forced onto an archetype and the same person could get different results on repeat completions.

On the secure path the secondary is suppressed, and an all-secure sheet (10/10) routes to a `PLE` default that is cosmetic only — no pattern is shown.

Answer order is randomised per session with a Fisher–Yates shuffle, so position bias can't accumulate.

---

## Repo layout

```
public/           index.html (single-page app, vanilla JS) + profiles/<tag>.pdf
api/              Mailchimp relay function
vercel.json       domain redirects
```

`tools/` (not public) holds the PDF generator: `content.py` + `gen_profiles.py`.

---

## The pipeline

1. **Taker completes** `index.html` → `submitAndShowResults`
2. **Apps Script** receives the payload — live deployment `AKfycbzsapU-…`
3. Writes a row to the **Google Sheet**
4. Creates/updates the **Mailchimp** contact (datacentre `us8`, audience `cd6f17dc7e`)
5. Applies tags: `archetype-<pattern>` *or* `secure-baseline`, plus `assessment-completed` and `channel-*`
6. Sets merge fields `FNAME`, `PATTERN`, `SECONDARY`
7. Sends the **confirmation email**, which builds the profile link from `dominantTag` → `/profiles/<tag>.pdf`
8. The `archetype-*` tag being **added** triggers that archetype's Mailchimp Customer Journey

Secure takers receive a blank `dominantTag`, so no wound PDF is offered and they enter no wound journey.

---

## Tracking — live, not pending

Both pixels fire from `submitAndShowResults`:

- **Meta** `fbq` — `AssessmentStart`, `AssessmentComplete`, `Lead`
- **Google Ads** `gtag` conversion — `AW-18330519750/vOrdCPiultIcEMaR1qRE`

---

## Ad headlines

`AD_HEADLINES` supports matched entry headlines via `?h=1` … `?h=7`, so a paid ad's hook can be echoed on the landing screen. The seven are derived from Reddit pain-language research.

**Lead with pain-language, never framework-language.** "Which of the five patterns" is internal vocabulary, not market-recognised.

---

## Rules learned the hard way

**Deployment**

- Deploy Apps Script by editing the existing `AKfycbzsapU-` deployment → **New version.** Not a new deployment, and not just the description field.
- The **confirmation email must be HTML** (`htmlBody`). Plain text transport-wraps at ~76 characters and shatters on mobile. Keep a plain-text fallback.

**Mailchimp**

- Journeys trigger on a tag being **added** — the transition, not the presence. Re-adding an active tag is a no-op.
- **Never type a tag name.** Always select from the dropdown.
- Pausing a journey stops it listening; tag events during that window are lost.
- A broken trigger object travels with the flow. Fix by duplicating a working journey.
- Test with fresh plus-addresses and **never reuse a suffix.**

**PDFs**

- Render from an HTML **file** (`HTML(filename=…)`), never `HTML(string=…)` — string rendering paginates differently.
- Verify the rendered PDF, not the source.

**Working on this repo**

- **The deployed file is the source of truth.** Build against the raw GitHub URL, never a local or project copy — a project copy was found 42 lines stale on 29 July.

---

## Known staleness

`content.py` needs resyncing against the shipped profile PDFs. Not urgent, but the generator and the live PDFs have diverged.

---

## Related

- Website: [happyeverafter.asia](https://happyeverafter.asia) — Divi child theme, four hand-coded page templates
- Book: *Your Knight in Shining Armour: How to Become Your Own Champion*
- Author: Valentina Tudose — Emotional Patterns Architect, creator of the RESET Method™
