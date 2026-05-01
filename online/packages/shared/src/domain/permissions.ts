import type { CheckRow, CheckTargetRow, MatchMemberRow, MatchRow } from "../types/index.js";

export function canMasterEditMatch(
  match: Pick<MatchRow, "master_user_id">,
  userId: string,
): boolean {
  return match.master_user_id === userId;
}

export function isMatchMember(
  members: Pick<MatchMemberRow, "user_id">[],
  userId: string,
): boolean {
  return members.some((m) => m.user_id === userId);
}

export function canUserRespondToCheck(input: {
  userId: string;
  check: Pick<CheckRow, "status">;
  target: Pick<CheckTargetRow, "user_id" | "response_status"> | undefined;
}): boolean {
  if (!input.target) return false;
  if (input.target.user_id !== input.userId) return false;
  if (input.check.status !== "open") return false;
  return input.target.response_status === "pending";
}
