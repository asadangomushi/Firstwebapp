// 予定に保存するリンクの扱い。

/** 入力された文字列を安全なURLにする。http(s) とメール以外は受け付けない。 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** URLから、分かりやすい名前を付ける（Googleドキュメントやメールなど） */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return 'メール';
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'docs.google.com') {
      if (u.pathname.startsWith('/document')) return 'Googleドキュメント';
      if (u.pathname.startsWith('/spreadsheets')) return 'Googleスプレッドシート';
      if (u.pathname.startsWith('/presentation')) return 'Googleスライド';
      if (u.pathname.startsWith('/forms')) return 'Googleフォーム';
      return 'Googleドキュメント';
    }
    if (host === 'drive.google.com') return 'Googleドライブ';
    if (host === 'mail.google.com') return 'Gmail';
    if (host === 'classroom.google.com') return 'Google Classroom';
    return host;
  } catch {
    return 'リンク';
  }
}
