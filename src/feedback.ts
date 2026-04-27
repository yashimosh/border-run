// Feedback — small modal that opens a mailto: with a prefilled body, also
// copies the formatted message to clipboard as a fallback. No backend, no
// secrets, no infra. Upgrade path: replace `submit()` with a fetch to a CF
// Worker that forwards to Telegram/email when feedback volume warrants.

const TARGET_EMAIL = "yashar@yashimosh.com";

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
    // Always copy to clipboard first as a guaranteed fallback.
    try { await navigator.clipboard.writeText(`Subject: ${built.subject}\n\n${built.body}`); } catch {}
    const mailto = `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(built.subject)}&body=${encodeURIComponent(built.body)}`;
    window.location.href = mailto;
    flash(toast, "opening your mail client (or paste from clipboard)");
    // Clear and close after a short delay.
    setTimeout(() => {
      msgInput.value = "";
      nameInput.value = "";
      close();
    }, 800);
  });
}

let toastTimer: number | undefined;
function flash(el: HTMLElement, text: string) {
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}
