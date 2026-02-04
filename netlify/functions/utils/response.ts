import { serialize, type CookieSerializeOptions } from 'cookie';

export interface CookieDefinition {
  name: string;
  value: string;
  options?: CookieSerializeOptions;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  cookies: CookieDefinition[] = []
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const response: {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    multiValueHeaders?: Record<string, string[]>;
  } = {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };

  if (cookies.length > 0) {
    response.multiValueHeaders = {
      'Set-Cookie': cookies.map((c) => serialize(c.name, c.value, c.options)),
    };
  }

  return response;
}

export function htmlResponse(statusCode: number, html: string) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
}

const isProduction = process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true';

export function makeAccessTokenCookie(token: string): CookieDefinition {
  return {
    name: 'accessToken',
    value: token,
    options: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 15 * 60, // 15 minutes in seconds
      path: '/',
    },
  };
}

export function makeRefreshTokenCookie(token: string): CookieDefinition {
  return {
    name: 'refreshToken',
    value: token,
    options: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      path: '/',
    },
  };
}

// Convert camelCase keys to snake_case for frontend compatibility
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toSnakeCase);
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnake(key)] = toSnakeCase(value);
    }
    return result;
  }
  return obj;
}

export function makeClearCookies(): CookieDefinition[] {
  return [
    {
      name: 'accessToken',
      value: '',
      options: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 0,
        path: '/',
      },
    },
    {
      name: 'refreshToken',
      value: '',
      options: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 0,
        path: '/',
      },
    },
  ];
}
