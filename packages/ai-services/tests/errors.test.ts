import { describe, it, expect } from 'vitest';
import { classifyAiError, AiCommandError } from '../src/errors';

describe('classifyAiError', () => {
  it('returns same instance if already an AiCommandError', () => {
    const original = new AiCommandError('AI_DISABLED', 'Already classified');
    const result = classifyAiError(original);
    expect(result).toBe(original);
  });

  it('classifies rate limit errors', () => {
    const err = new Error('Quota exceeded 429 Too Many Requests');
    const classified = classifyAiError(err);
    expect(classified.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('classifies AI disabled errors', () => {
    const err = new Error('AI is disabled by user');
    const classified = classifyAiError(err);
    expect(classified.code).toBe('AI_DISABLED');
  });

  it('classifies network errors', () => {
    const err = new Error('Failed to fetch from proxy: ECONNREFUSED');
    const classified = classifyAiError(err);
    expect(classified.code).toBe('NETWORK_ERROR');
  });

  it('classifies authentication errors including invalid token variations without ReDoS', () => {
    expect(classifyAiError(new Error('401 Unauthorized')).code).toBe('AUTHENTICATION_REQUIRED');
    expect(classifyAiError(new Error('403 Forbidden')).code).toBe('AUTHENTICATION_REQUIRED');
    expect(classifyAiError(new Error('expired Google token')).code).toBe('AUTHENTICATION_REQUIRED');
    expect(classifyAiError(new Error('Invalid access token provided')).code).toBe('AUTHENTICATION_REQUIRED');
    expect(classifyAiError(new Error('The provided token is invalid')).code).toBe('AUTHENTICATION_REQUIRED');

    // ReDoS resistance check: long repetitive string should evaluate instantaneously
    const pathological = 'invalid '.repeat(1000) + 'something';
    expect(classifyAiError(new Error(pathological)).code).toBe('PARSE_FAILED');

    const pathologicalWithToken = 'invalid '.repeat(1000) + 'token';
    expect(classifyAiError(new Error(pathologicalWithToken)).code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('falls back to PARSE_FAILED for unknown errors', () => {
    const err = new Error('Unrecognized syntax');
    const classified = classifyAiError(err);
    expect(classified.code).toBe('PARSE_FAILED');
  });
});
