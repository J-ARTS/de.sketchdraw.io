import type { ValidationIssue } from './types';

export class DomainValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[], message?: string) {
    const normalizedIssues =
      issues.length > 0
        ? issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          }))
        : [
            {
              path: '',
              code: 'VALIDATION_FAILED',
              message: message ?? 'Document validation failed.',
            },
          ];
    const summary =
      message ??
      normalizedIssues
        .map((issue) => `${issue.path || '<root>'}: [${issue.code}] ${issue.message}`)
        .join('; ');
    super(summary);
    this.name = 'DomainValidationError';
    this.issues = normalizedIssues;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DomainConflictError extends Error {
  readonly code: string;
  readonly currentRevision?: number;

  constructor(code: string, message: string, currentRevision?: number) {
    super(message);
    this.name = 'DomainConflictError';
    this.code = code;
    if (currentRevision !== undefined) {
      this.currentRevision = currentRevision;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
