export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/create-tunnel') {
      try {
        const { subdomain, overwrite = false } = await request.json();
        const finalSubdomain = normalizeSubdomain(subdomain) || createRandomSubdomain();
        const fullHostname = `${finalSubdomain}.hcu-lab.me`;
        const existingDnsRecord = await findDnsRecord(env, fullHostname);

        if (existingDnsRecord && !overwrite) {
          return jsonResponse({
            success: false,
            code: 'DNS_EXISTS',
            error: `Subdomain ${finalSubdomain} is already in use`,
            subdomain: finalSubdomain,
            url: `https://${fullHostname}`
          }, headers, 409);
        }

        const tunnelName = `hport-${Date.now()}`;
        const tunnelPassword = createTunnelSecret();

        const tunnelRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/tunnels`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tunnelName, tunnel_secret: tunnelPassword })
        });
        
        const tunnelData = await tunnelRes.json();
        if (!tunnelData.success) {
          return jsonResponse({
            success: false,
            error: tunnelData.errors?.[0]?.message || 'Cloudflare rejected tunnel creation'
          }, headers, 400);
        }

        const tunnelId = tunnelData.result.id;
        const currentContent = `${tunnelId}.cfargotunnel.com`;
        const previousTunnelId = extractTunnelId(existingDnsRecord?.content);

        const dnsRes = await upsertDnsRecord(env, existingDnsRecord?.id, {
          type: 'CNAME',
          name: fullHostname,
          content: currentContent,
          proxied: true
        });

        const dnsData = await dnsRes.json();
        if (!dnsData.success) {
          await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/tunnels/${tunnelId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
          });

          return jsonResponse({
            success: false,
            error: dnsData.errors?.[0]?.message || 'DNS configuration failed'
          }, headers, 400);
        }

        if (overwrite && previousTunnelId && previousTunnelId !== tunnelId) {
          await deleteTunnel(env, previousTunnelId);
        }

        return jsonResponse({
          success: true,
          url: `https://${fullHostname}`,
          token: btoa(JSON.stringify({ a: env.CF_ACCOUNT_ID, t: tunnelId, s: tunnelPassword })),
          tunnelId,
          dnsId: dnsData.result.id,
          replacedExisting: Boolean(existingDnsRecord)
        }, headers);

      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, headers, 500);
      }
    }

    if (request.method === 'DELETE' && url.pathname === '/cleanup') {
      try {
        const { tunnelId, dnsId } = await request.json();

        if (dnsId) {
          await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records/${dnsId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
          });
        }

        if (tunnelId) {
          await deleteTunnel(env, tunnelId);
        }

        return jsonResponse({ success: true }, headers);
      } catch (e) {
        return jsonResponse({ success: false, error: 'Cleanup failed' }, headers, 500);
      }
    }

    return new Response('H-PORT API Server is Operational', { status: 200 });
  }
};

function normalizeSubdomain(subdomain) {
  if (!subdomain || typeof subdomain !== 'string') {
    return '';
  }

  return subdomain.trim().toLowerCase();
}

function createRandomSubdomain() {
  return `lab-${Math.random().toString(36).substring(2, 8)}`;
}

function createTunnelSecret() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).substring(0, 32);
}

function jsonResponse(payload, headers, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

async function findDnsRecord(env, hostname) {
  const dnsRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    { headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` } }
  );
  const dnsData = await dnsRes.json();

  if (!dnsData.success) {
    throw new Error(dnsData.errors?.[0]?.message || 'Failed to query existing DNS records');
  }

  return dnsData.result?.[0] || null;
}

function upsertDnsRecord(env, dnsId, record) {
  const method = dnsId ? 'PUT' : 'POST';
  const endpoint = dnsId
    ? `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records/${dnsId}`
    : `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`;

  return fetch(endpoint, {
    method,
    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  });
}

function extractTunnelId(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const match = content.match(/^([a-f0-9-]+)\.cfargotunnel\.com$/i);
  return match?.[1] || null;
}

function deleteTunnel(env, tunnelId) {
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/tunnels/${tunnelId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
  });
}
