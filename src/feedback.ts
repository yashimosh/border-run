// Feedback — small modal that POSTs to /api/feedback. If the server endpoint
// isn't configured (e.g. RESEND_API_KEY missing), falls back to mailto + clipboard.
// The endpoint is served by the same container (server.js) so no CORS.

const TARGET_EMAIL = "yashar@yashimosh.com";
const ENDPOINT = "/api/feedback";

export function setupFeedback() {
  const openBtn = document.getElementById("fb-open");
  const modal = document.getElementById("fb-modal");
  const cancel = document.getElementById("fb-cancel");
  const copyBtn = document.getElementById("fb-copy");
  const sendBtn = document.getElementById("fb-send");
  const nameInput = document.getElementById("fb-name") as HTMLInputElement | null;
  const msgInput = document.getElementById("fb-msg") as HTMLTextAreaElement | null;
  const toast = document.getElementById("fb-toast");

  if (!openBtn || !modal || !cancel || !copyBtn || !sendBtn || !nameInput || !msgInput || !toast) return;

  const open = () => {
    modal.classList.add("show");
    setTimeout(() => msgInput.focus(), 50);
  };
  const close = () => modal.classList.remove("show");

  openBtn.addEventListener("click", open);
  cancel.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && modal.classList.contains("show")) close();
  });

  const buildBody = (): { subject: string; body: string; name: string; msg: string } | null => {
    const name = (nameInput.value || "").trim();
    const msg = (msgInput.value || "").trim();
    if (!msg) {
      flash(toast, "needs a message");
      msgInput.focus();
      return null;
    }
    const subject = "Border Run — feedback";
    const body =
      `from: ${name || "anonymous"}\n` +
      `url: ${location.href}\n` +
      `ua: ${navigator.userAgent}\n` +
      `\n${msg}\n`;
    return { subject, body, name, msg };
  };

  copyBtn.addEventListener("click", async () => {
    const built = buildBody();
    if (!built) return;
    const formatted = `Subject: ${built.subject}\n\n${built.body}`;
    try {
      await navigator.clipboard.writeText(formatted);
      flash(toast, "copied — paste it to me at " + TARGET_EMAIL);
    } catch {
      flash(toast, "couldn't copy — try Send instead");
    }
  });

  sendBtn.addEventListener("click", async () => {
    const built = buildBody();
    if (!built) return;
    sendBtn.setAttribute("disabled", "true");
    flash(toast, "sending…");

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: built.name,
          message: built.msg,
          url: location.href,
          ua: navigator.userAgent,
        }),
      });
      if (res.ok) {
        flash(toast, "sent — thanks");
        msgInput.value = "";
        nameInput.value = "";
        setTimeout(close, 700);
        return;
      }
      // Server responded but couldn't send (e.g. 503 not configured) — fall through to mailto.
      const data = await res.json().catch(() => ({}));
      console.warn("feedback endpoint:", res.status, data);
    } catch (err) {
      console.warn("feedback fetch failed:", err);
    } finally {
      sendBtn.removeAttribute("disabled");
    }

    // Fallback: copy to clipboard + open mailto.
    try { await navigator.clipboard.writeText(`Subject: ${built.subject}\n\n${built.body}`); } catch {}
    window.location.href = `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(built.subject)}&body=${encodeURIComponent(built.body)}`;
    flash(toast, "couldn't reach server — opening mail client / copied to clipboard");
    setTimeout(() => {
      msgInput.value = "";
      nameInput.value = "";
      close();
    }, 1400);
  });
}

let toastTimer: number | undefined;
function flash(el: HTMLElement, text: string) {
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}
