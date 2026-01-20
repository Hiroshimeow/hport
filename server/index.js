export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*' 
    };
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        headers: { 
          ...headers, 
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        } 
      });
    }

    // --- Endpoint: Create Tunnel & DNS ---
    if (request.method === 'POST' && url.pathname === '/create-tunnel') {
      try {
        const { subdomain } = await request.json();
        const finalSubdomain = subdomain || `lab-${Math.random().toString(36).substring(7)}`;
        const tunnelName = `hport-${Date.now()}`;
        const tunnelPassword = btoa(crypto.getRandomValues(new Uint8Array(32))).substring(0, 32);

        // 1. Create a Cloudflare Tunnel
        const tunnelRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/tunnels`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tunnelName, tunnel_secret: tunnelPassword })
        });
        
        const tunnelData = await tunnelRes.json();
        if (!tunnelData.success) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: tunnelData.errors?.[0]?.message || "Cloudflare rejected tunnel creation" 
          }), { status: 400, headers });
        }

        const tunnelId = tunnelData.result.id;

        // 2. Create DNS Record (CNAME) for the subdomain
        const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CNAME',
            name: `${finalSubdomain}.hcu-lab.me`,
            content: `${tunnelId}.cfargotunnel.com`,
            proxied: true
          })
        });
        
        const dnsData = await dnsRes.json();
        if (!dnsData.success) {
          // Cleanup tunnel if DNS registration fails
          await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/tunnels/${tunnelId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
          });
          return new Response(JSON.stringify({ 
            success: false, 
            error: dnsData.errors?.[0]?.message || "DNS configuration failed" 
          }), { status: 400, headers });
        }

        return new Response(JSON.stringify({
          success: true,
          url: `https://${finalSubdomain}.hcu-lab.me`,
          token: btoa(JSON.stringify({ a: env.CF_ACCOUNT_ID, t: tunnelId, s: tunnelPassword })),
          tunnelId: tunnelId,
          dnsId: dnsData.result.id 
        }), { headers });

      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers });
      }
    }

    // --- Endpoint: Cleanup (Delete Tunnel & DNS) ---
    if (request.method === 'DELETE' && url.pathname === '/cleanup') {
      try {
        const { tunnelId, dnsId } = await request.json();
        
        // Delete DNS record
        await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records/${dnsId}`, {
          method: 'DELETE', 
          headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
        });

        // Delete Tunnel
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/tunnels/${tunnelId}`, {
          method: 'DELETE', 
          headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` }
        });

        return new Response(JSON.stringify({ success: true }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: "Cleanup failed" }), { status: 500, headers });
      }
    }

    return new Response('H-PORT API Server is Operational', { status: 200 });
  }
};
