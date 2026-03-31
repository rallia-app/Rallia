import { InvitationHandler } from './handlers/invitation.ts';
import { MatchInterestHandler } from './handlers/match-interest.ts';
import { NotificationHandler } from './handlers/notification.ts';
import type {
  EmailContent,
  EmailRequest,
  EmailType,
  InvitationRecord,
  MatchInterestRecord,
  NotificationRecord,
} from './types.ts';

// Handler interface for type-safe email processing
export interface EmailHandler<T extends EmailRequest = EmailRequest> {
  validate(payload: unknown): T;
  getRecipient(payload: T): Promise<string>;
  getContent(payload: T): Promise<EmailContent>;
}

// Registry map connecting email types to their handlers
export const emailHandlers: Record<EmailType, EmailHandler> = {
  invitation: new InvitationHandler(),
  notification: new NotificationHandler(),
  match_interest: new MatchInterestHandler(),
};

// Type-safe handler lookup
export function getHandler(type: EmailType): EmailHandler {
  const handler = emailHandlers[type];
  if (!handler) {
    throw new Error(`No handler found for email type: ${type}`);
  }
  return handler;
}

// Type guard helpers for discriminated union
export function isInvitationRecord(request: EmailRequest): request is InvitationRecord {
  return request.emailType === 'invitation';
}

export function isNotificationRecord(request: EmailRequest): request is NotificationRecord {
  return request.emailType === 'notification';
}

export function isMatchInterestRecord(request: EmailRequest): request is MatchInterestRecord {
  return request.emailType === 'match_interest';
}
