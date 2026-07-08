// api/subscribe.js
// Vercel serverless function — Mailchimp relay
// MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID / MAILCHIMP_DC are set in the Vercel dashboard.
// The API key is NEVER exposed to the browser.
//
// ── WHY THIS SHAPE (read before "improving" it) ─────────────────────────────
// Tags MUST be included in the POST /members creation body. Empirically, that is
// what fires Mailchimp's "Contact tagged" journey trigger for a brand-new contact.
// Applying the tag afterwards via the dedicated POST /members/{hash}/tags endpoint
// sets the tag on the profile but does NOT fire the trigger — the contact ends up
// subscribed, correctly tagged, and silently outside the journey. Verified 8 Jul 2026:
// Diana was created + tagged via /tags at 10:19 and never entered; the identical tag
// added by hand at 13:18 entered her immediately. Do not "clean this up" by moving
// tagging out of the create call.
// ────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

export default async function handler(req, res) {
    // --- CORS ---
    // NOTE: '*' lets any site (or bot) POST to this relay. To harden, restrict to
    // 'https://reset.happyeverafter.asia'. Won't stop curl/bots, but stops other
    // sites' browsers from using your Mailchimp relay.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, mergeFields, tags } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const API_KEY = process.env.MAILCHIMP_API_KEY;
    const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID || 'cd6f17dc7e';
    const DC = process.env.MAILCHIMP_DC || 'us8';
    if (!API_KEY) return res.status(500).json({ error: 'Mailchimp API key not configured' });

    const authHeader = `Basic ${Buffer.from(`anystring:${API_KEY}`).toString('base64')}`;
    const base = `https://${DC}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}`;
    const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    const cleanTags = Array.isArray(tags) ? tags.filter(Boolean) : [];

    const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

    // Tag an EXISTING member. Mailchimp ignores `tags` on PATCH, so the dedicated
    // endpoint is the only option here. Returns whether it succeeded.
    async function applyTags() {
        if (!cleanTags.length) return true;
        const r = await fetch(`${base}/members/${hash}/tags`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ tags: cleanTags.map(name => ({ name, status: 'active' })) })
        });
        if (!r.ok) {
            console.error('Tag apply failed:', await r.json().catch(() => ({})));
            return false;
        }
        return true;
    }

    try {
        // ---- NEW CONTACT: create with tags in the body. This fires the journey. ----
        const create = await fetch(`${base}/members`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                email_address: email,
                status: 'subscribed',
                merge_fields: mergeFields || {},
                tags: cleanTags            // ← load-bearing. Fires "Contact tagged".
            })
        });
        const data = await create.json();

        if (create.ok) {
            return res.status(200).json({ success: true, status: 'subscribed', tagged: true, isNew: true });
        }

        // ---- EXISTING CONTACT (retake, or a previously-unsubscribed lead) ----
        if (create.status === 400 && data.title === 'Member Exists') {
            // Update merge fields. We deliberately do NOT send `status`: Mailchimp
            // forbids resubscribing an unsubscribed contact via the API (they must
            // opt back in themselves), and sending it would 400.
            const patch = await fetch(`${base}/members/${hash}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ merge_fields: mergeFields || {} })
            });
            const member = await patch.json();

            const tagged = await applyTags();

            // Surface the REAL status. If it isn't 'subscribed' (a Lorna-class lead
            // who unsubscribed long ago), the journey cannot email them — report it
            // instead of silently returning success.
            if (patch.ok && member.status !== 'subscribed') {
                return res.status(200).json({
                    success: true,
                    status: member.status,   // 'unsubscribed' | 'pending' | 'cleaned'
                    tagged,
                    warning: 'Contact is not subscribed — journey emails will NOT send. They must opt back in themselves.'
                });
            }

            // NOTE ON RETAKES: re-adding an already-active tag is a no-op and will NOT
            // re-trigger the journey. To force re-entry you must remove the tag, wait,
            // then re-add it (remove -> add = a fresh "tag added" event; this is exactly
            // what fixed Diana by hand). Left off by default so a same-archetype retake
            // doesn't re-spam the 4-email sequence. Enable only if that's the desired
            // product behaviour.
            return res.status(200).json({ success: true, status: 'updated', tagged, isNew: false });
        }

        console.error('Mailchimp create error:', data);
        return res.status(400).json({ error: data.detail || 'Mailchimp error', detail: data });

    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: 'Server error', detail: error.message });
    }
}
