export type AiErrorCode =
  | 'RATE_LIMIT_EXCEEDED'
  | 'AI_DISABLED'
  | 'NO_ITEMS_PARSED'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_REQUIRED'
  | 'PARSE_FAILED';

export class AiCommandError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AiCommandError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function classifyAiError(err: unknown): AiCommandError {
  if (err instanceof AiCommandError) {
    return err;
  }

  const msg = err instanceof Error ? err.message : String(err);

  if (/RATE_LIMIT|quota|Too Many Requests|429/i.test(msg)) {
    return new AiCommandError('RATE_LIMIT_EXCEEDED', msg, err);
  }
  if (/AI is disabled/i.test(msg)) {
    return new AiCommandError('AI_DISABLED', msg, err);
  }
  if (/Failed to fetch|Network error|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return new AiCommandError('NETWORK_ERROR', msg, err);
  }
  if (
    /Unauthorized|401|403|Forbidden|expired Google token/i.test(msg) ||
    (/invalid/i.test(msg) && /token/i.test(msg))
  ) {
    return new AiCommandError('AUTHENTICATION_REQUIRED', msg, err);
  }

  return new AiCommandError('PARSE_FAILED', msg, err);
}
