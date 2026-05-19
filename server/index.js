const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

const CORS_HEADERS = {
  ...JSON_HEADERS,
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const DNS_EXISTS_CODE = 'DNS_EXISTS';
const PROTECTED_SUBDOMAIN_CODE = 'PROTECTED_SUBDOMAIN';
const UNMANAGED_DNS_CONFLICT_CODE = 'UNMANAGED_DNS_CONFLICT';
const UNMANAGED_CLEANUP_REFUSAL_CODE = 'UNMANAGED_CLEANUP_REFUSAL';
const INVALID_CONFIRMATION_PAYLOAD_CODE = 'INVALID_CONFIRMATION_PAYLOAD';
const INVALID_CLEANUP_SESSION_CODE = 'INVALID_CLEANUP_SESSION';
const CLEANUP_PREVIEW_VERSION = 'hport-cleanup-v1';
const MANAGED_TUNNEL_PREFIX = 'hport-';
const ACTIVE_TUNNEL_STATUSES = new Set(['healthy', 'degraded']);
const AUTO_CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/create-tunnel') {
        return await handleCreateTunnel(request, env);
      }

      if (request.method === 'DELETE' && url.pathname === '/cleanup') {
        return await handleSessionCleanup(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/audit') {
        return await handleAudit(env);
      }

      if (request.method === 'POST' && url.pathname === '/cleanup-preview') {
        return await handleCleanupPreview(env);
      }

      if (request.method === 'POST' && url.pathname === '/cleanup-confirm') {
        return await handleCleanupConfirm(request, env);
      }

      return new Response('H-PORT API Server is Operational', { status: 200 });
    } catch (error) {
      const status = error.statusCode || 500;
      return jsonResponse({
        success: false,
        code: error.code || 'INTERNAL_ERROR',
        error: error.message || 'Unexpected server error'
      }, status);
    }
  },

  async scheduled(event, env, ctx) {
    const task = runScheduledCleanup(event, env);
    if (ctx?.waitUntil) {
      ctx.waitUntil(task);
    }

    await task;
  }
};

async function handleCreateTunnel(request, env) {
  const body = await readJsonBody(request);
  const baseDomain = getBaseDomain(env);
  const protectedSubdomains = getProtectedSubdomains(env);
  const requestedSubdomain = normalizeSubdomain(body?.subdomain);
  const finalSubdomain = requestedSubdomain || createRandomSubdomain();
  validateSubdomain(finalSubdomain);
  assertSubdomainNotProtected(finalSubdomain, protectedSubdomains);

  const hostname = `${finalSubdomain}.${baseDomain}`;
  const existingDnsRecord = await findDnsRecordByName(env, hostname);
  const existingDnsInfo = existingDnsRecord
    ? describeDnsRecord(existingDnsRecord, baseDomain, protectedSubdomains)
    : null;

  if (existingDnsInfo) {
    if (existingDnsInfo.isProtected) {
      return jsonResponse({
        success: false,
        code: PROTECTED_SUBDOMAIN_CODE,
        error: `Subdomain ${finalSubdomain} is protected and cannot be reassigned`,
        subdomain: finalSubdomain,
        url: `https://${hostname}`
      }, 409);
    }

    if (!existingDnsInfo.isManaged) {
      return jsonResponse({
        success: false,
        code: UNMANAGED_DNS_CONFLICT_CODE,
        error: `Subdomain ${finalSubdomain} already has an unmanaged DNS record. H-PORT will not overwrite it.`,
        subdomain: finalSubdomain,
        url: `https://${hostname}`
      }, 409);
    }

    if (!body?.overwrite) {
      return jsonResponse({
        success: false,
        code: DNS_EXISTS_CODE,
        error: `Subdomain ${finalSubdomain} already has an H-PORT-managed DNS record`,
        subdomain: finalSubdomain,
        url: `https://${hostname}`
      }, 409);
    }
  }

  const sessionId = crypto.randomUUID();
  const tunnelName = buildManagedTunnelName(finalSubdomain, sessionId);
  const tunnel = await createTunnel(env, tunnelName);

  try {
    const tunnelToken = tunnel.token || await getTunnelToken(env, tunnel.id);
    const dnsRecord = await upsertDnsRecord(env, existingDnsRecord?.id, buildManagedDnsRecord(hostname, tunnel.id, finalSubdomain, sessionId));
    const previousTunnelId = extractTunnelId(existingDnsRecord?.content);

    if (body?.overwrite && previousTunnelId && previousTunnelId !== tunnel.id) {
      const previousTunnel = await getTunnel(env, previousTunnelId, { allowNotFound: true });
      const previousTunnelInfo = previousTunnel ? describeTunnel(previousTunnel, protectedSubdomains) : null;

      if (previousTunnelInfo?.isManaged && !previousTunnelInfo.isProtected) {
        await deleteTunnel(env, previousTunnelId);
      }
    }

    return jsonResponse({
      success: true,
      url: `https://${hostname}`,
      token: tunnelToken,
      tunnelId: tunnel.id,
      dnsId: dnsRecord.id,
      hostname,
      baseDomain,
      sessionId,
      replacedExisting: Boolean(existingDnsRecord)
    });
  } catch (error) {
    await deleteTunnel(env, tunnel.id).catch(() => {});
    throw error;
  }
}

async function handleSessionCleanup(request, env) {
  const body = await readJsonBody(request);
  const sessionId = `${body?.sessionId || ''}`.trim();

  if (!sessionId) {
    return jsonResponse({
      success: false,
      code: INVALID_CLEANUP_SESSION_CODE,
      error: 'Session cleanup requires a valid sessionId'
    }, 400);
  }

  const baseDomain = getBaseDomain(env);
  const protectedSubdomains = getProtectedSubdomains(env);
  const results = [];

  if (body?.dnsId) {
    results.push(await cleanupSessionDnsRecord(env, body.dnsId, sessionId, baseDomain, protectedSubdomains));
  }

  if (body?.tunnelId) {
    results.push(await cleanupSessionTunnel(env, body.tunnelId, sessionId, protectedSubdomains));
  }

  return jsonResponse({
    success: results.every((item) => item.status !== 'failed'),
    results
  });
}

async function handleAudit(env) {
  const audit = await buildAudit(env);
  return jsonResponse({
    success: true,
    ...audit
  });
}

async function handleCleanupPreview(env) {
  const audit = await buildAudit(env);
  const preview = await buildCleanupPreview(env, audit);

  return jsonResponse({
    success: true,
    ...preview
  });
}

async function handleCleanupConfirm(request, env) {
  const body = await readJsonBody(request);

  if (body?.confirm !== true || !body?.previewToken || !Array.isArray(body?.items) || body.items.length === 0) {
    return jsonResponse({
      success: false,
      code: INVALID_CONFIRMATION_PAYLOAD_CODE,
      error: 'Cleanup confirmation requires confirm=true, a previewToken, and at least one preview item id'
    }, 400);
  }

  const snapshot = await verifyCleanupPreviewToken(env, body.previewToken);
  const requestedIds = [...new Set(body.items.map((item) => `${item}`.trim()).filter(Boolean))];
  const allowedIds = new Set(snapshot.items.map((item) => item.previewItemId));

  if (requestedIds.some((itemId) => !allowedIds.has(itemId))) {
    return jsonResponse({
      success: false,
      code: INVALID_CONFIRMATION_PAYLOAD_CODE,
      error: 'Cleanup confirmation included items that were not present in the preview payload'
    }, 400);
  }

  const currentAudit = await buildAudit(env);
  const currentPreview = await buildCleanupPreview(env, currentAudit);
  const currentItemMap = new Map(currentPreview.items.map((item) => [item.previewItemId, item]));
  const results = [];

  for (const previewItemId of requestedIds) {
    const currentItem = currentItemMap.get(previewItemId);

    if (!currentItem) {
      results.push({
        previewItemId,
        status: 'skipped',
        code: 'NO_LONGER_ELIGIBLE',
        message: 'Resource is no longer eligible for cleanup'
      });
      continue;
    }

    try {
      if (currentItem.classification === 'managed_orphan') {
        await deleteManagedPreviewItem(env, currentItem);
      } else if (currentItem.classification === 'unmanaged_candidate') {
        await deleteUnmanagedCandidatePreviewItem(env, currentItem);
      } else {
        results.push({
          previewItemId,
          status: 'skipped',
          code: UNMANAGED_CLEANUP_REFUSAL_CODE,
          message: 'Resource is not eligible for cleanup'
        });
        continue;
      }

      results.push({
        previewItemId,
        resourceType: currentItem.resourceType,
        status: 'deleted',
        classification: currentItem.classification,
        hostname: currentItem.hostname,
        subdomain: currentItem.subdomain
      });
    } catch (error) {
      results.push({
        previewItemId,
        resourceType: currentItem.resourceType,
        status: 'failed',
        classification: currentItem.classification,
        code: error.code || 'DELETE_FAILED',
        message: error.message
      });
    }
  }

  return jsonResponse({
    success: results.every((item) => item.status !== 'failed'),
    previewGeneratedAt: snapshot.generatedAt,
    results
  });
}

async function runScheduledCleanup(event, env) {
  const now = Number(event?.scheduledTime || Date.now());
  const audit = await buildAudit(env, { now });
  const deletions = [];

  for (const item of audit.managedOrphanDnsRecords) {
    if (!item.isExpired) continue;
    await deleteDnsRecord(env, item.id);
    deletions.push({ resourceType: 'dns_record', id: item.id, subdomain: item.subdomain });
  }

  for (const item of audit.managedOrphanTunnels) {
    if (!item.isExpired) continue;
    await deleteTunnel(env, item.id);
    deletions.push({ resourceType: 'tunnel', id: item.id, subdomain: item.subdomain });
  }

  return { success: true, deletedCount: deletions.length, deletions };
}

async function buildAudit(env, { now = Date.now() } = {}) {
  const baseDomain = getBaseDomain(env);
  const protectedSubdomains = getProtectedSubdomains(env);
  const [dnsRecords, tunnels] = await Promise.all([
    listDnsRecordsUnderBaseDomain(env, baseDomain),
    listTunnels(env)
  ]);

  const dnsInfos = dnsRecords
    .map((record) => describeDnsRecord(record, baseDomain, protectedSubdomains))
    .filter(Boolean);
  const tunnelInfos = tunnels.map((tunnel) => describeTunnel(tunnel, protectedSubdomains));
  const tunnelMap = new Map(tunnelInfos.map((item) => [item.id, item]));
  const managedDnsByTunnelId = new Map();
  const protectedFindings = [];
  const managedOrphanDnsRecords = [];
  const unmanagedCandidates = [];

  for (const dnsInfo of dnsInfos) {
    if (dnsInfo.isProtected) {
      protectedFindings.push({
        classification: 'protected',
        resourceType: 'dns_record',
        id: dnsInfo.id,
        hostname: dnsInfo.hostname,
        subdomain: dnsInfo.subdomain,
        reason: 'protected_subdomain'
      });
      continue;
    }

    if (dnsInfo.isManaged) {
      if (dnsInfo.linkedTunnelId) {
        const references = managedDnsByTunnelId.get(dnsInfo.linkedTunnelId) || [];
        references.push(dnsInfo);
        managedDnsByTunnelId.set(dnsInfo.linkedTunnelId, references);
      }

      const linkedTunnel = dnsInfo.linkedTunnelId ? tunnelMap.get(dnsInfo.linkedTunnelId) : null;
      const linkedTunnelIsHealthy = linkedTunnel?.isManaged && linkedTunnel.isActive;

      if (!linkedTunnelIsHealthy) {
        const orphanedAt = getManagedDnsOrphanedAt(dnsInfo.updatedAt, linkedTunnel?.lastInactiveAt, linkedTunnel?.createdAt);
        managedOrphanDnsRecords.push({
          classification: 'managed_orphan',
          resourceType: 'dns_record',
          id: dnsInfo.id,
          hostname: dnsInfo.hostname,
          subdomain: dnsInfo.subdomain,
          sessionId: dnsInfo.sessionId,
          linkedTunnelId: dnsInfo.linkedTunnelId,
          tunnelStatus: linkedTunnel?.status || 'missing',
          orphanedAt: orphanedAt ? new Date(orphanedAt).toISOString() : null,
          isExpired: isExpiredForAutoCleanup(orphanedAt, now),
          reason: linkedTunnel
            ? 'managed_dns_points_to_inactive_tunnel'
            : 'managed_dns_points_to_missing_tunnel'
        });
      }

      continue;
    }

    if (dnsInfo.isCandidate) {
      unmanagedCandidates.push({
        classification: 'unmanaged_candidate',
        resourceType: 'dns_record',
        id: dnsInfo.id,
        hostname: dnsInfo.hostname,
        subdomain: dnsInfo.subdomain,
        linkedTunnelId: dnsInfo.linkedTunnelId,
        reason: 'matches_test_candidate_rule'
      });
    }
  }

  const managedActiveTunnels = [];
  const managedOrphanTunnels = [];

  for (const tunnelInfo of tunnelInfos) {
    if (tunnelInfo.isProtected) {
      protectedFindings.push({
        classification: 'protected',
        resourceType: 'tunnel',
        id: tunnelInfo.id,
        subdomain: tunnelInfo.subdomain,
        tunnelName: tunnelInfo.name,
        reason: 'protected_subdomain'
      });
      continue;
    }

    if (!tunnelInfo.isManaged) {
      continue;
    }

    const attachedDnsRecords = managedDnsByTunnelId.get(tunnelInfo.id) || [];

    if (attachedDnsRecords.length === 0) {
      const orphanedAt = tunnelInfo.lastInactiveAt || tunnelInfo.createdAt || null;
      managedOrphanTunnels.push({
        classification: 'managed_orphan',
        resourceType: 'tunnel',
        id: tunnelInfo.id,
        subdomain: tunnelInfo.subdomain,
        sessionId: tunnelInfo.sessionId,
        tunnelName: tunnelInfo.name,
        status: tunnelInfo.status,
        orphanedAt: orphanedAt ? new Date(orphanedAt).toISOString() : null,
        isExpired: isExpiredForAutoCleanup(orphanedAt, now),
        reason: 'managed_tunnel_has_no_managed_dns'
      });
      continue;
    }

    if (tunnelInfo.isActive) {
      managedActiveTunnels.push({
        classification: 'managed_safe',
        resourceType: 'tunnel',
        id: tunnelInfo.id,
        subdomain: tunnelInfo.subdomain,
        sessionId: tunnelInfo.sessionId,
        tunnelName: tunnelInfo.name,
        status: tunnelInfo.status,
        hostnames: attachedDnsRecords.map((item) => item.hostname)
      });
    }
  }

  return {
    baseDomain,
    scannedAt: new Date().toISOString(),
    protectionMode: 'strict',
    cleanupScope: 'managed-only',
    protectedSubdomains: [...protectedSubdomains].sort(),
    candidateRule: ['test*', '*test'],
    counts: {
      managed_safe: managedActiveTunnels.length,
      managed_orphan_dns: managedOrphanDnsRecords.length,
      managed_orphan_tunnels: managedOrphanTunnels.length,
      unmanaged_candidate: unmanagedCandidates.length,
      protected: protectedFindings.length
    },
    managedActiveTunnels,
    managedOrphanDnsRecords,
    managedOrphanTunnels,
    unmanagedCandidates,
    protectedFindings
  };
}

async function buildCleanupPreview(env, audit) {
  const items = [
    ...audit.managedOrphanDnsRecords.map((item) => ({
      previewItemId: `dns:${item.id}`,
      classification: item.classification,
      resourceType: item.resourceType,
      id: item.id,
      hostname: item.hostname,
      subdomain: item.subdomain,
      orphanedAt: item.orphanedAt,
      isExpired: item.isExpired,
      reason: item.reason
    })),
    ...audit.managedOrphanTunnels.map((item) => ({
      previewItemId: `tunnel:${item.id}`,
      classification: item.classification,
      resourceType: item.resourceType,
      id: item.id,
      subdomain: item.subdomain,
      tunnelName: item.tunnelName,
      orphanedAt: item.orphanedAt,
      isExpired: item.isExpired,
      reason: item.reason
    })),
    ...audit.unmanagedCandidates.map((item) => ({
      previewItemId: `dns:${item.id}`,
      classification: item.classification,
      resourceType: item.resourceType,
      id: item.id,
      hostname: item.hostname,
      subdomain: item.subdomain,
      reason: item.reason
    }))
  ];

  const generatedAt = new Date().toISOString();
  const previewToken = await signCleanupPreviewToken(env, {
    version: CLEANUP_PREVIEW_VERSION,
    generatedAt,
    baseDomain: audit.baseDomain,
    items: items.map((item) => ({
      previewItemId: item.previewItemId,
      classification: item.classification,
      resourceType: item.resourceType,
      id: item.id
    }))
  });

  return {
    baseDomain: audit.baseDomain,
    generatedAt,
    previewToken,
    counts: {
      managed_orphan_dns: audit.managedOrphanDnsRecords.length,
      managed_orphan_tunnels: audit.managedOrphanTunnels.length,
      unmanaged_candidate: audit.unmanagedCandidates.length
    },
    items
  };
}

async function cleanupSessionDnsRecord(env, dnsId, sessionId, baseDomain, protectedSubdomains) {
  const dnsRecord = await getDnsRecord(env, dnsId, { allowNotFound: true });

  if (!dnsRecord) {
    return {
      resourceType: 'dns_record',
      id: dnsId,
      status: 'skipped',
      code: 'NOT_FOUND',
      message: 'DNS record no longer exists'
    };
  }

  const dnsInfo = describeDnsRecord(dnsRecord, baseDomain, protectedSubdomains);

  if (!dnsInfo?.isManaged || !sessionIdsMatch(dnsInfo.sessionId, sessionId)) {
    return {
      resourceType: 'dns_record',
      id: dnsId,
      status: 'skipped',
      code: UNMANAGED_CLEANUP_REFUSAL_CODE,
      message: 'DNS record is not owned by the active H-PORT session'
    };
  }

  if (dnsInfo.isProtected) {
    return {
      resourceType: 'dns_record',
      id: dnsId,
      status: 'skipped',
      code: PROTECTED_SUBDOMAIN_CODE,
      message: 'Protected subdomains cannot be cleaned up automatically'
    };
  }

  await deleteDnsRecord(env, dnsId);
  return {
    resourceType: 'dns_record',
    id: dnsId,
    status: 'deleted',
    hostname: dnsInfo.hostname
  };
}

async function cleanupSessionTunnel(env, tunnelId, sessionId, protectedSubdomains) {
  const tunnel = await getTunnel(env, tunnelId, { allowNotFound: true });

  if (!tunnel) {
    return {
      resourceType: 'tunnel',
      id: tunnelId,
      status: 'skipped',
      code: 'NOT_FOUND',
      message: 'Tunnel no longer exists'
    };
  }

  const tunnelInfo = describeTunnel(tunnel, protectedSubdomains);

  if (!tunnelInfo.isManaged || !sessionIdsMatch(tunnelInfo.sessionId, sessionId)) {
    return {
      resourceType: 'tunnel',
      id: tunnelId,
      status: 'skipped',
      code: UNMANAGED_CLEANUP_REFUSAL_CODE,
      message: 'Tunnel is not owned by the active H-PORT session'
    };
  }

  if (tunnelInfo.isProtected) {
    return {
      resourceType: 'tunnel',
      id: tunnelId,
      status: 'skipped',
      code: PROTECTED_SUBDOMAIN_CODE,
      message: 'Protected subdomains cannot be cleaned up automatically'
    };
  }

  await deleteTunnel(env, tunnelId);
  return {
    resourceType: 'tunnel',
    id: tunnelId,
    status: 'deleted',
    subdomain: tunnelInfo.subdomain
  };
}

async function deleteManagedPreviewItem(env, item) {
  if (item.resourceType === 'dns_record') {
    await deleteDnsRecord(env, item.id);
    return;
  }

  if (item.resourceType === 'tunnel') {
    await deleteTunnel(env, item.id);
    return;
  }

  throw createHttpError('Unsupported managed resource type', 400, UNMANAGED_CLEANUP_REFUSAL_CODE);
}

async function deleteUnmanagedCandidatePreviewItem(env, item) {
  if (item.resourceType !== 'dns_record') {
    throw createHttpError('Only candidate DNS records can be removed as unmanaged resources', 400, UNMANAGED_CLEANUP_REFUSAL_CODE);
  }

  await deleteDnsRecord(env, item.id);
}

function getBaseDomain(env) {
  const candidate = `${env.PUBLIC_BASE_DOMAIN || ''}`
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');

  if (!candidate) {
    throw createHttpError('PUBLIC_BASE_DOMAIN is not configured', 500);
  }

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(candidate)) {
    throw createHttpError('PUBLIC_BASE_DOMAIN is invalid', 500);
  }

  return candidate;
}

function getProtectedSubdomains(env) {
  const raw = `${env.PROTECTED_SUBDOMAINS || ''}`.trim();

  if (!raw) {
    return new Set();
  }

  const values = raw.startsWith('[')
    ? JSON.parse(raw)
    : raw.split(/[,\n]/);

  return new Set(values
    .map((value) => normalizeSubdomain(value))
    .filter(Boolean));
}

function normalizeSubdomain(subdomain) {
  if (!subdomain || typeof subdomain !== 'string') {
    return '';
  }

  return subdomain.trim().toLowerCase();
}

function validateSubdomain(subdomain) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) {
    throw createHttpError('Subdomain must contain only letters, numbers, or hyphens', 400);
  }
}

function assertSubdomainNotProtected(subdomain, protectedSubdomains) {
  if (protectedSubdomains.has(subdomain)) {
    throw createHttpError(`Subdomain ${subdomain} is protected and cannot be used by H-PORT`, 409, PROTECTED_SUBDOMAIN_CODE);
  }
}

function createRandomSubdomain() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(36).padStart(2, '0')).join('').slice(0, 6);
  return `lab-${suffix}`;
}

function buildManagedTunnelName(subdomain, sessionId) {
  return `${MANAGED_TUNNEL_PREFIX}${subdomain}--${sessionId}`;
}

function buildManagedDnsRecord(hostname, tunnelId, subdomain, sessionId) {
  return {
    type: 'CNAME',
    name: hostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
    comment: `hport-managed session=${sessionId} subdomain=${subdomain}`
  };
}

function describeDnsRecord(record, baseDomain, protectedSubdomains) {
  const hostname = `${record?.name || ''}`.trim().toLowerCase();
  const subdomain = getSubdomainForHostname(hostname, baseDomain);

  if (!subdomain) {
    return null;
  }

  return {
    id: record.id,
    hostname,
    subdomain,
    linkedTunnelId: extractTunnelId(record.content),
    sessionId: getCommentValue(record.comment, 'session'),
    isManaged: hasManagedDnsMarker(record.comment),
    isProtected: protectedSubdomains.has(subdomain),
    isCandidate: matchesAllowedCandidateRule(subdomain),
    updatedAt: parseTimestamp(record.modified_on || record.comment_modified_on || record.created_on)
  };
}

function describeTunnel(tunnel, protectedSubdomains) {
  const managedNameParts = parseManagedTunnelName(tunnel.name);
  const metadata = tunnel.metadata && typeof tunnel.metadata === 'object' ? tunnel.metadata : {};
  const subdomain = managedNameParts?.subdomain || normalizeSubdomain(metadata.subdomain);
  const sessionId = managedNameParts?.sessionId || `${metadata.sessionId || ''}`.trim() || null;
  const isManaged = Boolean(managedNameParts || metadata.owner === 'hport' || metadata.managedBy === 'hport');

  return {
    id: tunnel.id,
    name: tunnel.name,
    status: tunnel.status || 'unknown',
    subdomain,
    sessionId,
    isManaged,
    isProtected: Boolean(subdomain && protectedSubdomains.has(subdomain)),
    isActive: ACTIVE_TUNNEL_STATUSES.has(tunnel.status) || Boolean(tunnel.conns_active_at && !tunnel.conns_inactive_at),
    createdAt: parseTimestamp(tunnel.created_at),
    lastInactiveAt: parseTimestamp(tunnel.conns_inactive_at)
  };
}

function parseManagedTunnelName(name) {
  const match = `${name || ''}`.match(/^hport-([a-z0-9-]+)--([0-9a-f-]{36})$/i);

  if (!match) {
    return null;
  }

  return {
    subdomain: match[1].toLowerCase(),
    sessionId: match[2].toLowerCase()
  };
}

function hasManagedDnsMarker(comment) {
  return `${comment || ''}`.toLowerCase().startsWith('hport-managed');
}

function getCommentValue(comment, key) {
  const match = `${comment || ''}`.match(new RegExp(`${key}=([^\\s]+)`, 'i'));
  return match?.[1]?.trim().toLowerCase() || null;
}

function sessionIdsMatch(left, right) {
  return `${left || ''}`.trim().toLowerCase() === `${right || ''}`.trim().toLowerCase();
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getManagedDnsOrphanedAt(...values) {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value)) || null;
}

function isExpiredForAutoCleanup(orphanedAt, now) {
  return typeof orphanedAt === 'number' && Number.isFinite(orphanedAt) && now - orphanedAt >= AUTO_CLEANUP_MAX_AGE_MS;
}

function getSubdomainForHostname(hostname, baseDomain) {
  if (!hostname.endsWith(`.${baseDomain}`)) {
    return null;
  }

  const suffixLength = baseDomain.length + 1;
  const subdomain = hostname.slice(0, -suffixLength);
  return validateDerivedSubdomain(subdomain) ? subdomain : null;
}

function validateDerivedSubdomain(subdomain) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain);
}

function matchesAllowedCandidateRule(subdomain) {
  return /^test/i.test(subdomain) || /test$/i.test(subdomain);
}

function extractTunnelId(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const match = content.match(/^([a-z0-9-]+)\.cfargotunnel\.com$/i);
  return match?.[1] || null;
}

async function findDnsRecordByName(env, hostname) {
  const response = await cloudflareApi(env, 'zone', '/dns_records', {
    query: { 'name.exact': hostname, per_page: 100 }
  });

  return response.result?.[0] || null;
}

async function getDnsRecord(env, dnsId, { allowNotFound = false } = {}) {
  const response = await cloudflareApi(env, 'zone', `/dns_records/${dnsId}`, { allowNotFound });
  return response?.result || null;
}

async function listDnsRecordsUnderBaseDomain(env, baseDomain) {
  return await paginateCloudflare(env, 'zone', '/dns_records', {
    'name.endswith': `.${baseDomain}`,
    per_page: 100
  });
}

async function upsertDnsRecord(env, dnsId, record) {
  const response = await cloudflareApi(
    env,
    'zone',
    dnsId ? `/dns_records/${dnsId}` : '/dns_records',
    {
      method: dnsId ? 'PUT' : 'POST',
      body: record
    }
  );

  return response.result;
}

async function deleteDnsRecord(env, dnsId) {
  await cloudflareApi(env, 'zone', `/dns_records/${dnsId}`, { method: 'DELETE' });
}

async function createTunnel(env, name) {
  const response = await cloudflareApi(env, 'account', '/cfd_tunnel', {
    method: 'POST',
    body: {
      name,
      config_src: 'cloudflare'
    }
  });

  return response.result;
}

async function getTunnel(env, tunnelId, { allowNotFound = false } = {}) {
  const response = await cloudflareApi(env, 'account', `/cfd_tunnel/${tunnelId}`, { allowNotFound });
  return response?.result || null;
}

async function listTunnels(env) {
  return await paginateCloudflare(env, 'account', '/cfd_tunnel', { per_page: 100 });
}

async function deleteTunnel(env, tunnelId) {
  await cloudflareApi(env, 'account', `/cfd_tunnel/${tunnelId}`, { method: 'DELETE' });
}

async function getTunnelToken(env, tunnelId) {
  const response = await cloudflareApi(env, 'account', `/cfd_tunnel/${tunnelId}/token`);

  if (!response?.result) {
    throw createHttpError('Failed to obtain tunnel token', 502);
  }

  return response.result;
}

async function paginateCloudflare(env, scope, path, baseQuery = {}) {
  const items = [];
  let page = 1;

  while (true) {
    const response = await cloudflareApi(env, scope, path, {
      query: {
        ...baseQuery,
        page
      }
    });

    items.push(...(response.result || []));

    const totalPages = response.result_info?.total_pages || 1;
    if (page >= totalPages) {
      break;
    }

    page += 1;
  }

  return items;
}

async function cloudflareApi(env, scope, path, {
  method = 'GET',
  query = {},
  body,
  allowNotFound = false
} = {}) {
  const base = scope === 'account'
    ? `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}`
    : `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}`;
  const url = new URL(`${base}${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, `${value}`);
    }
  }

  const headers = {
    Authorization: `Bearer ${env.CF_API_TOKEN}`
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);

  if (allowNotFound && (response.status === 404 || payload?.errors?.[0]?.code === 7003 || payload?.errors?.[0]?.code === 81044)) {
    return null;
  }

  if (!payload?.success) {
    throw createHttpError(
      payload?.errors?.[0]?.message || 'Cloudflare API request failed',
      response.status || 502
    );
  }

  return payload;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw createHttpError('Request body must be valid JSON', 400, 'INVALID_JSON');
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function createHttpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function signCleanupPreviewToken(env, payload) {
  const serializedPayload = JSON.stringify(payload);
  const encodedPayload = toBase64Url(serializedPayload);
  const signature = await createHmacSignature(env.CF_API_TOKEN, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyCleanupPreviewToken(env, token) {
  const [encodedPayload, signature] = `${token || ''}`.split('.');

  if (!encodedPayload || !signature) {
    throw createHttpError('Cleanup preview token is invalid', 400, INVALID_CONFIRMATION_PAYLOAD_CODE);
  }

  const expectedSignature = await createHmacSignature(env.CF_API_TOKEN, encodedPayload);
  if (signature !== expectedSignature) {
    throw createHttpError('Cleanup preview token signature is invalid', 400, INVALID_CONFIRMATION_PAYLOAD_CODE);
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload));
  if (payload.version !== CLEANUP_PREVIEW_VERSION || !Array.isArray(payload.items)) {
    throw createHttpError('Cleanup preview token payload is invalid', 400, INVALID_CONFIRMATION_PAYLOAD_CODE);
  }

  return payload;
}

async function createHmacSignature(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(signature);
}

function toBase64Url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}


