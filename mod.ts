/**
 * DNS Failover Service for Deno Deploy
 * Supports multiple domains across different zones and multiple tunnels per domain
 */

interface DomainConfig {
  domain: string;
  zoneId: string;
  serviceUrl: string;
  tunnels: string[];
}

interface Tunnel {
  id: string;
  status: string;
}

interface DnsRecord {
  id: string;
  content: string;
}

interface CloudflareResponse {
  success: boolean;
  result: any;
  errors?: Array<{ message: string }>;
}

interface Environment {
  ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  DOMAINS_CONFIG: string;
}

const getTimestamp = (): string => new Date().toISOString();
const log = (message: string): void => console.log(`[${getTimestamp()}] ${message}`);

// Main handler for HTTP requests
export async function handler(request: Request): Promise<Response> {
  // Only allow POST requests for manual triggering
  if (request.method === 'POST') {
    try {
      const env = {
        ACCOUNT_ID: Deno.env.get('ACCOUNT_ID') || '',
        CLOUDFLARE_API_TOKEN: Deno.env.get('CLOUDFLARE_API_TOKEN') || '',
        TELEGRAM_BOT_TOKEN: Deno.env.get('TELEGRAM_BOT_TOKEN') || '',
        TELEGRAM_CHAT_ID: Deno.env.get('TELEGRAM_CHAT_ID') || '',
        DOMAINS_CONFIG: Deno.env.get('DOMAINS_CONFIG') || '[]',
      };

      // Start the failover process (don't await to return response quickly)
      handleFailover(env).catch(error => {
        console.error('Failover process failed:', error);
      });

      return new Response('Failover process initiated', { status: 200 });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }

  return new Response('Use POST to trigger failover check', { status: 200 });
}

// Scheduled task (run automatically on Deno Deploy cron)
export async function scheduledHandler() {
  const env = {
    ACCOUNT_ID: Deno.env.get('ACCOUNT_ID') || '',
    CLOUDFLARE_API_TOKEN: Deno.env.get('CLOUDFLARE_API_TOKEN') || '',
    TELEGRAM_BOT_TOKEN: Deno.env.get('TELEGRAM_BOT_TOKEN') || '',
    TELEGRAM_CHAT_ID: Deno.env.get('TELEGRAM_CHAT_ID') || '',
    DOMAINS_CONFIG: Deno.env.get('DOMAINS_CONFIG') || '[]',
  };

  await handleFailover(env);
}

async function handleFailover(env: Environment): Promise<void> {
  const accountId = env.ACCOUNT_ID;
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = env.TELEGRAM_CHAT_ID;
  const domainsConfig: DomainConfig[] = JSON.parse(env.DOMAINS_CONFIG);

  const headers = {
    'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Process each domain configuration in parallel
  await Promise.allSettled(
    domainsConfig.map(config => 
      handleDomainFailover(config, accountId, headers, telegramBotToken, telegramChatId, log)
    )
  );
}

async function handleDomainFailover(
  config: DomainConfig, 
  accountId: string, 
  headers: HeadersInit,
  telegramBotToken: string,
  telegramChatId: string,
  log: (message: string) => void
): Promise<void> {
  const { domain, zoneId, tunnels, serviceUrl } = config;
  
  // Generate tunnel CNAMEs
  const tunnelCnames = tunnels.map(tunnelId => `${tunnelId}.cfargotunnel.com`);
  
  log(`Processing domain: ${domain}`);

  try {
    // Step 1: Check if the domain is reachable
    const isReachable = await checkReachable(`https://${domain}`);
    
    if (isReachable) {
      log(`Domain ${domain} is reachable. No action needed.`);
      return;
    }

    log(`Domain ${domain} is unreachable. Initiating failover.`);
    await sendTelegramNotification(
      telegramBotToken, 
      telegramChatId, 
      `Domain ${domain} is unreachable. Initiating failover.`
    );

    // Step 2: Get current DNS record to determine current tunnel
    const dnsRecord = await getDnsRecord(zoneId, domain, headers);
    const currentCname = dnsRecord.content;
    
    // Find current tunnel index
    const currentTunnelIndex = tunnelCnames.findIndex(cname => cname === currentCname);
    
    // Determine next healthy tunnel (round-robin)
    let nextTunnelIndex = -1;
    let nextTunnelId: string | null = null;
    let nextTunnelCname: string | null = null;
    
    // Check tunnels in order starting from the next one
    for (let i = 1; i <= tunnels.length; i++) {
      const checkIndex = (currentTunnelIndex + i) % tunnels.length;
      const tunnelId = tunnels[checkIndex];
      const tunnelHealthy = await checkTunnelHealth(accountId, tunnelId, headers);
      
      if (tunnelHealthy) {
        nextTunnelIndex = checkIndex;
        nextTunnelId = tunnelId;
        nextTunnelCname = tunnelCnames[checkIndex];
        break;
      }
    }
    
    if (nextTunnelIndex === -1) {
      const message = `No healthy tunnels found for domain ${domain}. Aborting failover.`;
      log(message);
      await sendTelegramNotification(telegramBotToken, telegramChatId, message);
      return;
    }

    // Step 3: Add hostname rule to target tunnel
    await addTunnelRule(accountId, nextTunnelId, domain, serviceUrl, headers);
    log(`Added hostname rule to tunnel ${nextTunnelId} for domain ${domain}`);

    // Step 4: Update DNS to point to the target tunnel
    await updateDnsRecord(zoneId, dnsRecord.id, nextTunnelCname, headers);
    log(`Updated DNS for ${domain} to ${nextTunnelCname}`);

    // Step 5: Remove hostname rule from previous tunnel if it exists
    if (currentTunnelIndex !== -1) {
      const currentTunnelId = tunnels[currentTunnelIndex];
      await removeTunnelRule(accountId, currentTunnelId, domain, headers);
      log(`Removed hostname rule from tunnel ${currentTunnelId} for domain ${domain}`);
    }

    const message = `Failover completed for ${domain} to ${nextTunnelCname}`;
    log(message);
    await sendTelegramNotification(telegramBotToken, telegramChatId, message);

  } catch (error) {
    const errorMessage = `Failover process failed for ${domain}: ${(error as Error).message}`;
    log(errorMessage);
    await sendTelegramNotification(telegramBotToken, telegramChatId, errorMessage);
  }
}

async function checkReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow' as RequestRedirect,
    });
    
    clearTimeout(timeoutId);
    return response.status >= 200 && response.status < 400;
  } catch (error) {
    console.log(`[${getTimestamp()}] Reachability check failed for ${url}: ${(error as Error).message}`);
    return false;
  }
}

async function checkTunnelHealth(accountId: string, tunnelId: string, headers: HeadersInit): Promise<boolean> {
  try {
    const response = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}`,
      { headers }
    );
    
    const data: CloudflareResponse = await response.json();
    
    if (!data.success) {
      console.log(`Tunnel API response not successful for ${tunnelId}`);
      return false;
    }
    
    const tunnel: Tunnel = data.result;
    console.log(`Tunnel ${tunnelId} status: ${tunnel.status}`);
    
    return tunnel.status === 'healthy';
    
  } catch (error) {
    console.log(`Tunnel health check failed for tunnel ${tunnelId}: ${(error as Error).message}`);
    return false;
  }
}

async function addTunnelRule(
  accountId: string, 
  tunnelId: string, 
  domain: string, 
  serviceUrl: string, 
  headers: HeadersInit
): Promise<boolean> {
  try {
    // Get current tunnel configuration
    const response = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      { headers }
    );

    const data: CloudflareResponse = await response.json();
    if (!data.success) {
      throw new Error(`Failed to get tunnel config: ${data.errors?.[0]?.message || 'Unknown error'}`);
    }

    const config = data.result.config || { ingress: [] };
    let ingress = config.ingress || [];

    // Remove existing rule for this domain if it exists
    ingress = ingress.filter((rule: any) => rule.hostname !== domain);

    // Add new rule at the beginning
    ingress.unshift({
      hostname: domain,
      service: serviceUrl,
      originRequest: {},
    });

    // Ensure fallback rule exists
    const hasFallback = ingress.some((rule: any) => !rule.hostname && rule.service === 'http_status:404');
    if (!hasFallback) {
      ingress.push({ service: 'http_status:404' });
    }

    // Update tunnel configuration
    const updateResponse = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config: { ingress } }),
      }
    );

    const updateData: CloudflareResponse = await updateResponse.json();
    if (!updateData.success) {
      throw new Error(`Failed to update tunnel: ${updateData.errors?.[0]?.message || 'Unknown error'}`);
    }

    return true;
  } catch (error) {
    console.error(`Error adding tunnel rule: ${(error as Error).message}`);
    throw error;
  }
}

async function removeTunnelRule(
  accountId: string, 
  tunnelId: string, 
  domain: string, 
  headers: HeadersInit
): Promise<boolean> {
  try {
    // Get current tunnel configuration
    const response = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      { headers }
    );

    const data: CloudflareResponse = await response.json();
    if (!data.success) {
      throw new Error(`Failed to get tunnel config: ${data.errors?.[0]?.message || 'Unknown error'}`);
    }

    const config = data.result.config || { ingress: [] };
    let ingress = config.ingress || [];

    // Remove rule for this domain
    ingress = ingress.filter((rule: any) => rule.hostname !== domain);

    // Ensure fallback rule exists
    const hasFallback = ingress.some((rule: any) => !rule.hostname && rule.service === 'http_status:404');
    if (!hasFallback) {
      ingress.push({ service: 'http_status:404' });
    }

    // Update tunnel configuration
    const updateResponse = await fetchWithRetry(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config: { ingress } }),
      }
    );

    const updateData: CloudflareResponse = await updateResponse.json();
    if (!updateData.success) {
      throw new Error(`Failed to update tunnel: ${updateData.errors?.[0]?.message || 'Unknown error'}`);
    }

    return true;
  } catch (error) {
    console.error(`Error removing tunnel rule: ${(error as Error).message}`);
    throw error;
  }
}

async function getDnsRecord(zoneId: string, domain: string, headers: HeadersInit): Promise<DnsRecord> {
  const response = await fetchWithRetry(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=CNAME&name=${domain}`,
    { headers }
  );

  const data: CloudflareResponse = await response.json();

  if (!data.success || data.result.length === 0) {
    throw new Error(`No CNAME record found for ${domain}`);
  }

  return data.result[0];
}

async function updateDnsRecord(zoneId: string, recordId: string, newContent: string, headers: HeadersInit): Promise<void> {
  const response = await fetchWithRetry(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ content: newContent }),
    }
  );

  const data: CloudflareResponse = await response.json();

  if (!data.success) {
    throw new Error(`Failed to update DNS record: ${data.errors?.[0]?.message || 'Unknown error'}`);
  }
}

async function sendTelegramNotification(botToken: string, chatId: string, message: string): Promise<void> {
  try {
    const response = await fetchWithRetry(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );

    const data = await response.json();
    if (!data.ok) {
      console.error(`[${getTimestamp()}] Telegram notification failed: ${data.description}`);
    }
  } catch (error) {
    console.error(`[${getTimestamp()}] Telegram notification error: ${(error as Error).message}`);
  }
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[${getTimestamp()}] Rate limit hit, retrying after ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }
  throw new Error('Failed to fetch after retries');
}