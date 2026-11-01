/** The part of `window.location` the links need. */
export interface LocationLike {
  origin: string;
  pathname: string;
}

function link(prefix: string, token: string, where: LocationLike): string {
  return `${where.origin}${where.pathname}#/${prefix}/${token}`;
}

/** Link a new user opens to create their account. */
export function buildInviteLink(token: string, where: LocationLike = window.location): string {
  return link("einladung", token, where);
}

/** Link a user opens to choose a new password. */
export function buildPasswordResetLink(token: string, where: LocationLike = window.location): string {
  return link("passwort", token, where);
}
