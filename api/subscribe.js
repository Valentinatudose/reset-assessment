// api/subscribe.js
// Vercel serverless function — Mailchimp relay
// The MAILCHIMP_API_KEY environment variable is set in Vercel dashboard
// It is NEVER exposed to the browser
export default async function handler(req, res) {
    // Allow CORS from your domain
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    const { email, firstName, lastName, tags, mergeFields } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    const API_KEY = process.env.MAILCHIMP_API_KEY;
    const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID || 'cd6f17dc7e';
    const DC = process.env.MAILCHIMP_DC || 'us8';
    if (!API_KEY) {
        return res.status(500).json({ error: 'Mailchimp API key not configured' });
    }

    const authHeader = `Basic ${Buffer.from(`anystring:${API_KEY}`).toString('base64')}`;
    const base = `https://${DC}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}`;
    const cleanTags = Array.isArray(tags) ? tags.filter(Boolean) : [];

    // Mailchimp ignores `tags` on PATCH/PUT — tags must be applied via the
    // dedicated /tags endpoint. This guarantees existing members (retakers)
    // still get their archetype tag, so they enter the right journey.
    async function applyTags(hash) {
        if (!cleanTags.length) return;
        await fetch(`${base}/members/${hash}/tags`, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: cleanTags.map(name => ({ name, status: 'active' })) })
        });
    }

    const memberData = {
        email_address: email,
        status: 'subscribed',
        merge_fields: mergeFields || {},
        tags: cleanTags
    };

    try {
        const response = await fetch(`${base}/members`, {
            method: 'POST',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify(memberData)
        });
        const data = await response.json();

        if (response.status === 200 || response.status === 201) {
            // New subscriber added — tags applied via the create call above
            return res.status(200).json({ success: true, status: 'subscribed' });
        } else if (response.status === 400 && data.title === 'Member Exists') {
            // Already subscribed — update merge fields, then apply tags separately
            const crypto = await import('crypto');
            const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');

            await fetch(`${base}/members/${hash}`, {
                method: 'PATCH',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify({ merge_fields: mergeFields || {} })
            });

            await applyTags(hash);

            return res.status(200).json({ success: true, status: 'updated' });
        } else {
            console.error('Mailchimp error:', data);
            return res.status(400).json({ error: data.detail || 'Mailchimp error', detail: data });
        }
    } catch (error) {
        console.error('Server error:', error);
        return res.status(500).json({ error: 'Server error', detail: error.message });
    }
}
