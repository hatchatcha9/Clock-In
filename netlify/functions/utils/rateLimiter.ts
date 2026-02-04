import type { HandlerEvent } from '@netlify/functions';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (in production, use Redis or similar)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

function getClientIdentifier(event: HandlerEvent): string {
  // Use IP address as identifier
  const ip = event.headers['x-forwarded-for'] ||
             event.headers['x-real-ip'] ||
             event.headers['client-ip'] ||
             'unknown';
  return ip.split(',')[0].trim();
}

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

export function checkRateLimit(
  event: HandlerEvent,
  config: RateLimitConfig
): { allowed: boolean; retryAfter?: number } {
  const identifier = getClientIdentifier(event);
  const now = Date.now();
  const key = `${identifier}:${event.path}`;

  let entry = rateLimitStore.get(key);

  if (!entry || entry.resetTime < now) {
    // Create new entry or reset expired one
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    return { allowed: true };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000); // seconds
    return { allowed: false, retryAfter };
  }

  // Increment count
  entry.count++;
  return { allowed: true };
}

// Preset configurations for different endpoint types
export const RATE_LIMITS = {
  AUTH: { windowMs: 15 * 60 * 1000, maxRequests: 5 }, // 5 requests per 15 minutes
  API: { windowMs: 60 * 1000, maxRequests: 100 }, // 100 requests per minute
  STRICT: { windowMs: 60 * 1000, maxRequests: 10 }, // 10 requests per minute
};
