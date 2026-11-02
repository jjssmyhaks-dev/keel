export type InviteState = {
  expired: boolean;
  accepted: boolean;
  emailMismatch: boolean;
  canAccept: boolean;
};

export function inviteState(input: {
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedEmail: string;
  sessionEmail?: string | null;
  now?: Date;
}): InviteState {
  const now = input.now ?? new Date();
  const expired = input.expiresAt < now;
  const accepted = Boolean(input.acceptedAt);
  const emailMismatch =
    Boolean(input.sessionEmail) &&
    input.sessionEmail!.toLowerCase() !== input.invitedEmail.toLowerCase();
  return {
    expired,
    accepted,
    emailMismatch,
    canAccept: Boolean(input.sessionEmail) && !expired && !accepted && !emailMismatch,
  };
}
