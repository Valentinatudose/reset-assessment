// api/subscribe.js
// Vercel serverless function — Mailchimp relay
// MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID / MAILCHIMP_DC are set in the Vercel dashboard.
// The API key is NEVER exposed to the browser.

import crypto from 'crypto';

export default async function handler(req, res) {
    // --- CORS ---
    // NOTE: '*' lets any website (or bot) POST to this relay. For light hardening,
    // lock this to 'https://reset.happyeverafter.asia'. CORS won't stop curl/bots,
    // but it stops other sites' browsers from using your Mailchimp relay.
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

    // Apply archetype tags via the DEDICATED /tags endpoint.
    // This is what makes the "tag added" transition fire — which is what starts
    // the Mailchimp Customer Journey. Tags set inside the member create/update
    // body do NOT reliably fire that trigger, which is the whole ball game:
    // a subscriber can be tagged and still never enter the journey.
    //
    // OPTIONAL — force re-trigger on retake: to make a repeat taker re-enter the
    // journey, remove the tag then re-add it (remove -> add = a fresh "added" event).
    // Left OFF by default: re-adding an already-active tag is a no-op, so a
    // same-archetype retake won't re-spam the 4-email sequence. Turn this on only
    // if you decide retakes should restart the journey.
    async function applyTags() {
        if (!cleanTags.length) return true;

        // const RETRIGGER_ON_RETAKE = false;
        // if (RETRIGGER_ON_RETAKE) {
        //     await fetch(`${base}/members/${hash}/tags`, {
        //         method: 'POST',
        //         headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        //         body: JSON.stringify({ tags: cleanTags.map(name => ({ name, status: 'inactive' })) })
        //     });
        // }

        const r = await fetch(`${base}/members/${hash}/tags`, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: cleanTags.map(name => ({ name, status: 'active' })) })
        });
        if (!r.ok) {
            const detail = await r.json().catch(() => ({}));
            console.error('Tag apply failed:', detail);
            return false;
        }
        return true;
    }

    try {
        // Upsert. PUT + status_if_new creates a brand-new contact as SUBSCRIBED,
        // and leaves an existing contact's status untouched. We deliberately do
        // NOT send `status`: Mailchimp forbids resubscribing an unsubscribed
        // contact via the API (they must opt back in themselves), and sending it
        // would 400. status_if_new sidesteps the "Member Exists" dance entirely.
        const upsert = await fetch(`${base}/members/${hash}`, {
            method: 'PUT',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email_address: email,
                status_if_new: 'subscribed',
                merge_fields: mergeFields || {}
            })
        });
        const data = await upsert.json();

        if (!upsert.ok) {
            console.error('Mailchimp upsert error:', data);
            return res.status(400).json({ error: data.detail || 'Mailchimp error', detail: data });
        }

        // Tag AFTER the contact exists, so the journey trigger fires reliably —
        // for new subscribers AND returning ones.
        const tagged = await applyTags();

        // Surface the REAL subscription status. If it isn't 'subscribed'
        // (e.g. a previously-unsubscribed lead like Lorna), the journey cannot
        // send to them — return that instead of silently reporting success.
        if (data.status !== 'subscribed') {
            return res.status(200).json({
                success: true,
                status: data.status,   // 'unsubscribed' | 'pending' | 'cleaned'
                tagged,
                warning: 'Contact is not subscribed — journey emails will NOT send. They must opt back in themselves.'
            });
        }

        return res.status(200).json({ success: true, status: 'subscribed', tagged });
    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: 'Server error', detail: error.message });
    }
}
