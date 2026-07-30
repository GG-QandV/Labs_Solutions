/** Configurable email template — NOT hardcoded inside the send logic. */
export interface EmailTemplate {
  from: string;
  subject: string;
  text: string;   // {reportNumber} placeholder supported
  html?: string;
}

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  from: "Reports <reports@solutions.dpdns.org>",
  subject: "Your PDF report is ready",
  text: "Hello! Your PDF report {reportNumber} is ready \u2014 please find the file attached.",
};

export interface SendOptions {
  apiKey: string;               // RESEND_API_KEY secret
  to: string;
  template?: EmailTemplate;
  vars?: Record<string, string>;
  attachment?: { filename: string; bytes: Uint8Array };
  /** used instead of attachment when the PDF exceeds the attachment limit */
  downloadUrl?: string;
}

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Sends via Resend REST API (works from Workers, no SDK needed). */
export async function sendReportEmail(opts: SendOptions): Promise<{ ok: boolean; id?: string; error?: string }> {
  const t = opts.template ?? DEFAULT_EMAIL_TEMPLATE;
  const vars = opts.vars ?? {};
  let text = fill(t.text, vars);
  if (opts.downloadUrl) text += `\n\nDownload link (valid 24h): ${opts.downloadUrl}`;

  const body: Record<string, unknown> = {
    from: t.from,
    to: [opts.to],
    subject: fill(t.subject, vars),
    text
  };
  if (opts.attachment) {
    body.attachments = [{ filename: opts.attachment.filename, content: toBase64(opts.attachment.bytes) }];
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${err.slice(0, 300)}` };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: data.id };
}
