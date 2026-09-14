// api/waitlist.js
// Vercel serverless function — RESET Live waitlist → Mailchimp
// Uses the same env vars as api/subscribe.js:
// MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID / MAILCHIMP_DC (set in the Vercel dashboard).
//
// ── WHY THIS IS A SEPARATE FILE (read before merging it into subscribe.js) ───
// subscribe.js is load-bearing for the assessment and carries its own warning.
// This endpoint exists because the waitlist has a different problem:
//
// MOST waitlist signups are EXISTING contacts — they already took the assessment
// and are on the list. subscribe.js handles existing contacts by calling
// POST /members/{hash}/tags, which sets the tag but does NOT fire Mailchimp's
// "Contact tagged" journey trigger (verified 8 Jul 2026 — the Diana case).
// A waitlist welcome journey triggered on `reset_live_waitlist` would therefore
// silently fail for exactly the people we most want it to reach: tag applied,
// contact segmented correctly, no emails ever sent.
//
// The fix is the one already documented in subscribe.js: for an existing contact,
// REMOVE the tag then RE-ADD it. Remove → add is a fresh "tag added" event and
// does fire the trigger. That is what fixed Diana by hand.
//
// New contacts take the normal path: tags in the POST /members creation body.
// ────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

const WAITLIST_TAG = 'reset_live_waitlist';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, firstName, utm } = req.body || {};
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }

    const API_KEY = process.env.MAILCHIMP_API_KEY;
    const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID || 'cd6f17dc7e';
    const DC = process.env.MAILCHIMP_DC || 'us8';
    if (!API_KEY) return res.status(500).json({ error: 'Mailchimp API key not configured' });

    const authHeader = `Basic ${Buffer.from(`anystring:${API_KEY}`).toString('base64')}`;
    const base = `https://${DC}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}`;
    const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

    // Only set UTM merge fields when we actually have a value — sending empty
    // strings would wipe the acquisition data already stored against an
    // assessment-origin contact.
    const mergeFields = {};
    if (firstName) mergeFields.FNAME = firstName;
    if (utm && utm.utmSource)   mergeFields.UTMSRC  = utm.utmSource;
    if (utm && utm.utmMedium)   mergeFields.UTMMED  = utm.utmMedium;
    if (utm && utm.utmCampaign) mergeFields.UTMCAMP = utm.utmCampaign;

    async function setTag(status) {
        const r = await fetch(`${base}/members/${hash}/tags`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ tags: [{ name: WAITLIST_TAG, status }] })
        });
        return r.ok;
    }

    try {
        // ---- NEW CONTACT: tag in the creation body. This fires the journey. ----
        const create = await fetch(`${base}/members`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                email_address: email,
                status: 'subscribed',
                merge_fields: mergeFields,
                tags: [WAITLIST_TAG]      // ← load-bearing. Fires "Contact tagged".
            })
        });
        const data = await create.json();

        if (create.ok) {
            return res.status(200).json({ success: true, status: 'subscribed', isNew: true });
        }

        // ---- EXISTING CONTACT: remove → re-add so the trigger fires. ----
        if (create.status === 400 && data.title === 'Member Exists') {
            // Merge fields first. No `status` sent: Mailchimp forbids resubscribing
            // an unsubscribed contact via the API, and sending it would 400.
            const patch = await fetch(`${base}/members/${hash}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ merge_fields: mergeFields })
            });
            const member = await patch.json();

            // Remove, brief pause, re-add. The pause matters: Mailchimp can collapse
            // a remove and an add issued in the same instant into no event at all.
            await setTag('inactive');
            await new Promise(r => setTimeout(r, 1200));
            const tagged = await setTag('active');

            if (patch.ok && member.status !== 'subscribed') {
                // Already on file but not subscribed. Their name is recorded, but no
                // journey email can reach them — surface it rather than reporting success.
                return res.status(200).json({
                    success: true,
                    status: member.status,       // 'unsubscribed' | 'pending' | 'cleaned'
                    tagged,
                    warning: 'Contact is not subscribed — waitlist emails will NOT send. They must opt back in themselves.'
                });
            }

            return res.status(200).json({ success: true, status: 'updated', tagged, isNew: false });
        }

        console.error('Mailchimp create error:', data);
        return res.status(400).json({ error: data.detail || 'Mailchimp error', detail: data });

    } catch (error) {
        console.error('Waitlist server error:', error);
        return res.status(500).json({ error: 'Server error', detail: error.message });
    }
}
