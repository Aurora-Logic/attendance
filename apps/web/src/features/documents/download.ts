import { ensureAccessToken, getAccessToken } from '@/lib/api/client';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

/**
 * A file the API streams behind the bearer token — an Excel copy of a
 * document — saved through a transient anchor. Not `apiRequest`: that parses
 * JSON, and a workbook is bytes.
 */
export async function downloadDocumentFile(path: string, filename: string): Promise<void> {
  if (getAccessToken() === null) await ensureAccessToken();
  const token = getAccessToken();
  const response = await fetch(`${API_BASE}${path}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` }, credentials: 'include' });
  if (!response.ok) {
    throw new Error(response.status === 403 ? 'You cannot download this document.' : `The server answered ${String(response.status)}.`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
