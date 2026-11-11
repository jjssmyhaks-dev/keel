type MailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(input: MailInput) {
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      console.warn(`[authab:email] RESEND_API_KEY is not set; suppressed “${input.subject}” to ${input.to}.`);
      return { delivered: false, reason: "no_provider" };
    }
    console.info(`\n[authab:email] To: ${input.to}\nSubject: ${input.subject}\n${input.text ?? stripHtml(input.html)}\n`);
    return { delivered: false, reason: "console" };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Authab <hello@authab.dev>",
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("[authab:email] provider error", response.status, body);
    return { delivered: false, reason: "provider_error" };
  }
  return { delivered: true };
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function emailLayout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;padding:48px 24px">
    <div style="font-family:Georgia,serif;font-size:24px;letter-spacing:-.5px;margin-bottom:32px">AUTHAB<span style="font-family:monospace;font-size:10px;vertical-align:super;margin-left:4px;color:#8b8b8b">TM</span></div>
    <div style="background:#fff;border:1px solid #e5e3de;padding:32px">
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;margin:0 0 16px;letter-spacing:-.5px">${title}</h1>
      <div style="font-size:14px;line-height:1.7;color:#3c3c3c">${body}</div>
    </div>
    <p style="font-size:11px;color:#999;margin-top:24px">Authab — identity, vault and governance for AI agents.</p>
  </div></body></html>`;
}

export function appUrl(path = "") {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
