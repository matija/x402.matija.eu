import { Hono } from 'hono';
import { x402HTTPResourceServer, x402ResourceServer, HonoAdapter } from '@x402/hono';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { manPagePaywall } from './paywall.js';
import openApiSpec from '../openapi.json';

const app = new Hono();

const PAYMENT_ADDRESS = '0x91FdcfCAdfA7E660c70D9641257542deD2a2d384';
const POLYGON_NETWORK = 'eip155:137';
const SITE_URL = 'https://x402.matija.eu';

const ROBOTS_TXT = `User-agent: *
Allow: /

# AI crawlers
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /
`;

const LLMS_TXT = `# x402.matija.eu

> x402 Playground is a pay-per-request API on Cloudflare Workers using the x402 protocol.

## Core Pages

- [Home](${SITE_URL}/): Man-page overview of endpoints, payment flow, and configuration.
- [Payment Info](${SITE_URL}/payment-info): Machine-readable payment configuration.
- [OpenAPI](${SITE_URL}/openapi.json): OpenAPI 3.1 description of the service.

## Protected Endpoints

- [GET /api/data](${SITE_URL}/api/data): Example protected JSON response. Costs 1 USDC on Polygon.
- [GET /api/status](${SITE_URL}/api/status): Protected server status response. Costs 1 USDC on Polygon.

## Payment Details

- Protocol: x402 v2.
- Network: Polygon mainnet (eip155:137).
- Token: USDC.
- Price: 1 USDC per protected request.
- Facilitator: https://facilitator.payai.network.

## Crawl Policy

AI crawlers are welcome to index the public documentation endpoints. Protected API endpoints intentionally return HTTP 402 without payment.
`;

const LLMS_FULL_TXT = `# x402.matija.eu

x402.matija.eu is a Cloudflare Worker that demonstrates pay-per-request APIs using HTTP 402 and the x402 protocol.

## Site Summary

The service exposes public documentation endpoints and protected JSON API endpoints. Protected endpoints cost 1 USDC on Polygon mainnet. Clients without payment receive HTTP 402 with payment instructions.

## Public Endpoints

### GET /

URL: ${SITE_URL}/

Returns a man-page styled HTML page describing the service, endpoints, payment flow, and configuration.

### GET /payment-info

URL: ${SITE_URL}/payment-info

Returns machine-readable JSON with:

- protocol: x402
- version: 2
- network: eip155:137
- payment_address: ${PAYMENT_ADDRESS}
- token: USDC
- token_contract: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
- price: 1.0 USDC
- facilitator: https://facilitator.payai.network
- protected_endpoints: /api/data and /api/status

### GET /openapi.json

URL: ${SITE_URL}/openapi.json

Returns the OpenAPI 3.1 specification for the service.

## Protected Endpoints

### GET /api/data

URL: ${SITE_URL}/api/data

Returns example JSON after payment:

- message: "This is protected data"
- data.example: successful x402 payment message
- data.timestamp: current server timestamp

Without a valid payment, it returns HTTP 402 with a PAYMENT-REQUIRED header.

### GET /api/status

URL: ${SITE_URL}/api/status

Returns authenticated server status after payment:

- authenticated: true
- server_time: current server timestamp

Without a valid payment, it returns HTTP 402 with a PAYMENT-REQUIRED header.

## Payment Flow

1. Client requests a protected endpoint.
2. Server responds with HTTP 402 and a PAYMENT-REQUIRED header.
3. Client signs a gasless USDC transfer authorization.
4. Client retries the request with a PAYMENT-SIGNATURE header.
5. The facilitator verifies and settles the payment on-chain.
6. Server returns the protected resource.

Browser clients receive an interactive paywall page. Programmatic clients can use the x402 SDK or handle the headers directly.

## Implementation

- Runtime: Cloudflare Workers.
- Framework: Hono.
- Protocol: x402 v2.
- Network: Polygon mainnet (eip155:137).
- Payment scheme: exact EVM.
- Token: USDC.
- Facilitator: https://facilitator.payai.network.

## Crawl Policy

Public documentation endpoints are intended to be crawlable. AI crawlers are allowed in robots.txt. Protected API endpoints are discoverable, but access requires payment and may return HTTP 402 to crawlers.
`;

// Polygon USDC (PoS) — 1 USDC = 1_000_000 atomic units (6 decimals)
const POLYGON_USDC = {
  amount: '1000000',
  asset: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  extra: {
    name: 'USD Coin',
    version: '2',
  },
};

const routes = {
  'GET /api/data': {
    accepts: [
      {
        scheme: 'exact',
        network: POLYGON_NETWORK,
        price: POLYGON_USDC,
        payTo: PAYMENT_ADDRESS,
      },
    ],
    description: 'Protected data endpoint — pay 1 USDC on Polygon',
    mimeType: 'application/json',
  },
  'GET /api/status': {
    accepts: [
      {
        scheme: 'exact',
        network: POLYGON_NETWORK,
        price: POLYGON_USDC,
        payTo: PAYMENT_ADDRESS,
      },
    ],
    description: 'Account status endpoint — pay 1 USDC on Polygon',
    mimeType: 'application/json',
  },
};

const facilitatorClient = new HTTPFacilitatorClient({
  url: 'https://facilitator.payai.network',
});

const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register(POLYGON_NETWORK, new ExactEvmScheme());

const httpServer = new x402HTTPResourceServer(resourceServer, routes);
httpServer.registerPaywallProvider(manPagePaywall);

// Cloudflare Workers forbids fetch() in global scope, so we lazily
// initialize the facilitator connection on the first protected request.
let initPromise = null;

app.use(async (c, next) => {
  const adapter = new HonoAdapter(c);
  const context = {
    adapter,
    path: c.req.path,
    method: c.req.method,
    paymentHeader: adapter.getHeader('payment-signature') || adapter.getHeader('x-payment'),
  };

  if (!httpServer.requiresPayment(context)) {
    return next();
  }

  if (!initPromise) {
    initPromise = httpServer.initialize();
  }
  await initPromise;

  const result = await httpServer.processHTTPRequest(context);

  switch (result.type) {
    case 'no-payment-required':
      return next();

    case 'payment-error': {
      const { response } = result;
      Object.entries(response.headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      if (response.isHtml) {
        return c.html(response.body, response.status);
      }
      return c.json(response.body || {}, response.status);
    }

    case 'payment-verified': {
      const { paymentPayload, paymentRequirements, declaredExtensions } = result;
      await next();

      let res = c.res;
      if (res.status >= 400) {
        return;
      }

      const responseBody = new Uint8Array(await res.clone().arrayBuffer());
      c.res = undefined;

      try {
        const settleResult = await httpServer.processSettlement(
          paymentPayload,
          paymentRequirements,
          declaredExtensions,
          { request: context, responseBody },
        );

        if (!settleResult.success) {
          const { response } = settleResult;
          const body = response.isHtml
            ? String(response.body ?? '')
            : JSON.stringify(response.body ?? {});
          res = new Response(body, {
            status: response.status,
            headers: response.headers,
          });
        } else {
          Object.entries(settleResult.headers).forEach(([key, value]) => {
            res.headers.set(key, value);
          });
        }
      } catch (error) {
        console.error(error);
        res = c.json({}, 402);
      }

      c.res = res;
      return;
    }
  }
});

app.get('/', (c) => {
  const a = (path, label) => `<a href="${path}">${label || path}</a>`;

  return c.html(`<!doctype html>
<title>x402.matija.eu</title>
<style>
  body { max-width: 72ch; margin: 2rem auto; padding: 0 1rem;
         font: 14px/1.6 monospace; color: #111; background: #fff; }
  a { color: #2563eb; }
  h1, h2 { font-size: 14px; font-weight: bold; margin: 1.5em 0 0; }
  pre { margin: 0; white-space: pre-wrap; }
  .dim { color: #666; }
  .tag { color: #b91c1c; }
</style>
<pre>
<h1>x402 Playground</h1>
<h2>NAME</h2>
    x402.matija.eu — pay-per-request API using the x402 protocol

<h2>SYNOPSIS</h2>
    ${a('/')}
    ${a('/payment-info')}
    ${a('/api/data')}
    ${a('/api/status')}

<h2>DESCRIPTION</h2>
    This service gates API endpoints behind x402 micropayments.
    Requests without payment receive HTTP 402 with a PAYMENT-REQUIRED
    header. Browsers get an interactive paywall; programmatic clients
    get machine-readable payment instructions.

<h2>ENDPOINTS</h2>
    GET ${a('/')}
        This page.

    GET ${a('/payment-info')}
        Machine-readable JSON with the payment configuration:
        network, token, price, facilitator URL, and payment flow.

    GET ${a('/api/data')}                                    <span class="tag">[protected]</span>
        Returns example JSON data. Costs 1 USDC on Polygon.
        Without payment you get HTTP 402 + payment instructions.

    GET ${a('/api/status')}                                  <span class="tag">[protected]</span>
        Returns server status. Costs 1 USDC on Polygon.

<h2>PAYMENT FLOW</h2>
    1. Request a protected endpoint.
    2. Receive HTTP 402 + PAYMENT-REQUIRED header (base64 JSON).
    3. Sign a USDC transferWithAuthorization with your wallet.
    4. Resend the request with the PAYMENT-SIGNATURE header.
    5. The facilitator verifies + settles the payment on-chain.
    6. Receive the protected resource.

    In a browser, steps 2–5 are handled by the built-in paywall UI.
    Just open a <span class="tag">[protected]</span> link above and pay with your wallet.

<h2>CONFIGURATION</h2>
    Protocol        x402 v2
    Network         Polygon mainnet (eip155:137)
    Token           USDC (${POLYGON_USDC.asset})
    Price           1 USDC per request
    Pay to          ${PAYMENT_ADDRESS}
    Facilitator     <a href="https://facilitator.payai.network">https://facilitator.payai.network</a>

<h2>SEE ALSO</h2>
    x402 protocol   <a href="https://docs.x402.org">https://docs.x402.org</a>
</pre>`);
});

app.get('/openapi.json', (c) => {
  return c.json(openApiSpec);
});

app.get('/robots.txt', (c) => {
  return c.text(ROBOTS_TXT);
});

app.get('/llms.txt', (c) => {
  return c.text(LLMS_TXT);
});

app.get('/llms-full.txt', (c) => {
  return c.text(LLMS_FULL_TXT);
});

app.get('/payment-info', (c) => {
  return c.json({
    protocol: 'x402',
    version: 2,
    network: POLYGON_NETWORK,
    payment_address: PAYMENT_ADDRESS,
    token: 'USDC',
    token_contract: POLYGON_USDC.asset,
    price: '1.0 USDC',
    facilitator: 'https://facilitator.payai.network',
    protected_endpoints: ['/api/data', '/api/status'],
  });
});

app.get('/api/data', (c) => {
  return c.json({
    message: 'This is protected data',
    data: {
      example: 'You have successfully paid with x402 on Polygon!',
      timestamp: new Date().toISOString(),
    },
  });
});

app.get('/api/status', (c) => {
  return c.json({
    authenticated: true,
    server_time: new Date().toISOString(),
  });
});

export default app;
