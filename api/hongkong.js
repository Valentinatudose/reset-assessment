// api/hongkong.js
// Vercel serverless function: Your RESET Begins, live in Hong Kong (12 Dec 2026) -> Mailchimp
// Same pattern and env vars as api/waitlist.js. See the notes there on why an
// existing contact's tag is removed and re-added (it makes "Contact tagged" fire).
// Tags: hk-dec26 for every registration, hk-1to1 if she also asked for a session.

import crypto from 'crypto';

const EVENT_TAG = 'hk-dec26';
const ONE_TO_ONE_TAG = 'hk-1to1';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, firstName, oneToOne, utm } = req.body || {};
    const tagNames = oneToOne ? [EVENT_TAG, ONE_TO_ONE_TAG] : [EVENT_TAG];
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
            body: JSON.stringify({ tags: tagNames.map(name => ({ name, status })) })
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
                tags: tagNames      // Fires "Contact tagged".
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
                    warning: 'Contact is not subscribed, so Mailchimp emails will NOT send. Write to her directly.'
                });
            }

            return res.status(200).json({ success: true, status: 'updated', tagged, isNew: false });
        }

        console.error('Mailchimp create error:', data);
        return res.status(400).json({ error: data.detail || 'Mailchimp error', detail: data });

    } catch (error) {
        console.error('Hong Kong signup server error:', error);
        return res.status(500).json({ error: 'Server error', detail: error.message });
    }
}
