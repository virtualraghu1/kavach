export function parseResidentQr(value: string, origin: string): string | null {
  const text = value.trim();
  if (/^[0-9a-f]{64}$/i.test(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    if (url.origin !== origin || url.pathname !== "/" || url.search) return null;
    return /^#enroll=([0-9a-f]{64})$/i.exec(url.hash)?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function residentQrUrl(token: string, origin: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Invalid enrollment QR.");
  return `${origin}/#enroll=${token}`;
}
