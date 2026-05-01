/** Sufijos del selector (el primero es el default). */
export const LOGIN_EMAIL_DOMAIN_SUFFIXES: readonly string[] = [
  "@gmail.com",
  "@hotmail.com",
  "@outlook.com",
  "@yahoo.com",
  "@yahoo.com.ar",
  "@icloud.com",
  "@live.com",
];

/** Valor interno del selector «Otro dominio». */
export const LOGIN_EMAIL_CUSTOM = "__custom__" as const;

export const RECENT_LOGIN_EMAILS_KEY = "dxd_recent_login_emails";
export const MAX_RECENT_LOGIN_EMAILS = 8;

export function buildLoginEmail(input: {
  localPart: string;
  domainChoice: string;
  customDomain: string;
}): string {
  const raw = input.localPart.trim();
  if (!raw) return "";
  const beforeAt = raw.includes("@") ? (raw.split("@")[0] ?? "").trim() : raw;
  const local = beforeAt.replace(/\s+/g, "");
  if (!local) return "";
  if (input.domainChoice === LOGIN_EMAIL_CUSTOM) {
    const dom = input.customDomain.trim().replace(/^@+/, "").replace(/\s+/g, "");
    return dom ? `${local}@${dom}` : "";
  }
  return `${local}${input.domainChoice}`;
}

export function parseLoginEmail(
  full: string,
  presets: readonly string[] = LOGIN_EMAIL_DOMAIN_SUFFIXES,
): { localPart: string; domainChoice: string; customDomain: string } {
  const t = full.trim();
  const defaultChoice = presets[0] ?? "@gmail.com";
  if (!t) {
    return { localPart: "", domainChoice: defaultChoice, customDomain: "" };
  }
  const lower = t.toLowerCase();
  const at = lower.indexOf("@");
  if (at < 0) {
    return { localPart: t, domainChoice: defaultChoice, customDomain: "" };
  }
  const local = t.slice(0, at).trim();
  const suffix = lower.slice(at);
  for (const p of presets) {
    if (suffix === p.toLowerCase()) {
      return { localPart: local, domainChoice: p, customDomain: "" };
    }
  }
  return { localPart: local, domainChoice: LOGIN_EMAIL_CUSTOM, customDomain: t.slice(at + 1).trim() };
}

export function pushRecentLoginEmail(
  list: string[],
  email: string,
  max: number = MAX_RECENT_LOGIN_EMAILS,
): string[] {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) return list;
  return [e, ...list.filter((x) => x.toLowerCase() !== e)].slice(0, max);
}
