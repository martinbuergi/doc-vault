// Utility functions for DocVault Workers

import type { Env } from './types';

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Hash a password using Argon2id via Web Crypto
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );
  
  const hashArray = new Uint8Array(hash);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);
  
  return btoa(String.fromCharCode(...combined));
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const combined = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const storedHashBytes = combined.slice(16);
  
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256
  );
  
  const hashArray = new Uint8Array(hash);
  
  if (hashArray.length !== storedHashBytes.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < hashArray.length; i++) {
    result |= hashArray[i] ^ storedHashBytes[i];
  }
  
  return result === 0;
}

/**
 * Generate a JWT token
 */
export async function generateJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresIn: number = 86400 // 24 hours
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };
  
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(fullPayload)).replace(/=/g, '');
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${encodedHeader}.${encodedPayload}`)
  );
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * Verify and decode a JWT token
 */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signatureBytes = Uint8Array.from(
      atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );
    
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(`${encodedHeader}.${encodedPayload}`)
    );
    
    if (!valid) {
      return null;
    }
    
    const payload = JSON.parse(atob(encodedPayload));
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate an API key
 */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = `dvault_${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')}`;
  const prefix = key.substring(0, 12);
  
  return { key, prefix, hash: '' }; // Hash will be computed separately
}

/**
 * Hash an API key for storage
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(
  data: unknown,
  status: number = 200,
  corsOrigin: string = '*'
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  status: number = 400,
  corsOrigin: string = '*'
): Response {
  return jsonResponse({ error: message }, status, corsOrigin);
}

/**
 * Handle CORS preflight requests
 */
export function handleCors(corsOrigin: string = '*'): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Parse Authorization header
 */
export function parseAuthHeader(request: Request): { type: 'bearer' | 'basic' | null; value: string | null } {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return { type: null, value: null };
  }
  
  if (authHeader.startsWith('Bearer ')) {
    return { type: 'bearer', value: authHeader.substring(7) };
  }
  
  if (authHeader.startsWith('Basic ')) {
    return { type: 'basic', value: authHeader.substring(6) };
  }
  
  return { type: null, value: null };
}

/**
 * Get ISO timestamp
 */
export function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function isValidPassword(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  return { valid: true };
}

/**
 * Compute SHA-256 hash of content
 */
export async function sha256(content: ArrayBuffer | string): Promise<string> {
  const data = typeof content === 'string' 
    ? new TextEncoder().encode(content)
    : content;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
