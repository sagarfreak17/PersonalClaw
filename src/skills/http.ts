/**
 * HTTP/API Skill — Make web requests from PersonalClaw.
 *
 * Supports GET, POST, PUT, PATCH, DELETE with headers, body, and auth.
 * Great for REST API interactions, webhooks, and data fetching.
 */

import axios from 'axios';
import { Skill, SkillMeta } from '../types/skill.js';

export const httpSkill: Skill = {
  name: 'http_request',
  description: `Make HTTP requests to APIs and web services.
- method: GET, POST, PUT, PATCH, DELETE (default: GET)
- url: The full URL to request
- headers: Optional JSON object of headers (e.g. {"Authorization": "Bearer token"})
- body: Optional request body (string or JSON)
- timeout: Optional timeout in ms (default: 15000)

Use for: REST APIs, webhooks, downloading data, health checks, API testing.
Returns: status code, headers, and response body (truncated to 10KB).`,
  parameters: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        description: 'HTTP method (default: GET).',
      },
      url: {
        type: 'string',
        description: 'The full URL to request.',
      },
      headers: {
        type: 'string',
        description: 'JSON string of headers (e.g. \'{"Content-Type": "application/json"}\').',
      },
      body: {
        type: 'string',
        description: 'Request body — raw string or JSON string.',
      },
      timeout: {
        type: 'number',
        description: 'Request timeout in milliseconds (default: 15000).',
      },
    },
    required: ['url'],
  },
  run: async ({ method, url, headers, body, timeout }: {
    method?: string;
    url: string;
    headers?: string;
    body?: string;
    timeout?: number;
  }, _meta: SkillMeta) => {
    try {
      // Parse headers if provided
      let parsedHeaders: Record<string, string> = {};
      if (headers) {
        try {
          parsedHeaders = JSON.parse(headers);
        } catch {
          return { success: false, error: 'Invalid JSON in headers parameter.' };
        }
      }

      // Parse body — try JSON first, fall back to string
      let parsedBody: any = body;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          // Keep as string
        }
      }

      const startTime = Date.now();
      const response = await axios({
        method: (method || 'GET').toUpperCase(),
        url,
        headers: parsedHeaders,
        data: parsedBody,
        timeout: timeout || 15000,
        validateStatus: () => true, // Don't throw on non-2xx
        maxRedirects: 5,
        responseType: 'text',
      });

      const elapsed = Date.now() - startTime;

      // Truncate large responses
      let responseData = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2);

      if (responseData.length > 10000) {
        responseData = responseData.substring(0, 10000) + '\n... [truncated, total length: ' + responseData.length + ' chars]';
      }

      // Extract useful response headers
      const respHeaders: Record<string, string> = {};
      const interestingHeaders = ['content-type', 'content-length', 'server', 'x-request-id', 'x-ratelimit-remaining', 'location', 'set-cookie'];
      for (const h of interestingHeaders) {
        if (response.headers[h]) {
          respHeaders[h] = String(response.headers[h]);
        }
      }

      return {
        success: response.status >= 200 && response.status < 400,
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
        body: responseData,
        elapsed_ms: elapsed,
      };
    } catch (error: any) {
      if (error.code === 'ECONNABORTED') {
        return { success: false, error: `Request timed out after ${timeout || 15000}ms` };
      }
      if (error.code === 'ENOTFOUND') {
        return { success: false, error: `DNS lookup failed for URL: ${url}` };
      }
      if (error.code === 'ECONNREFUSED') {
        return { success: false, error: `Connection refused: ${url}` };
      }
      return { success: false, error: error.message };
    }
  },
};
