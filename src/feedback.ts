// Feedback — POST /api/feedback (Express + Resend backend), with mailto/clipboard
// fallback if the endpoint is unreachable. Pauses the game while the modal is open.

const TARGET_EMAIL = "yashar@yashimosh.com";
const ENDPOINT = "/api/feedback";

export function setupFeedback() {
  const openTriggers = document.querySelectorAll<HTMLElement>("[data-fb-open]");
  const modal = document.getElementById("fb-modal");
  const cancel = document.getElementById("fb-cancel");
  const copyBtn = document.getElementById("fb-copy");
  const sendBtn = document.getElementById("fb-send");
  const nameInput = document.getElementById("fb-name") as HTMLInputElement | null;
  const emailInput = document.getElementById("fb-email") as HTMLInputElement | null;
  const msgInput = document.getElementById("fb-msg") as HTMLTextAreaElement | null;
  const toast = document.getElementById("fb-toast");

  if (!modal || !cancel || !copyBtn || !sendBtn || !nameInput || !emailInput || !msgInput || !toast) return;

  const open = () => {
    modal.classList.add("show");
    window.dispatchEvent(new CustomEvent("game:pause"));
    setTimeout(() => msgInput.focus(), 50);
  };
  const close = () => {
    modal.classList.remove("show");
    window.dispatchEvent(new CustomEvent("game:resume"));
  };

  openTriggers.forEach(el => el.addEventListener("click", (e) => { e.preventDefault(); open(); }));
  cancel.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  // Listen for an external close request (Escape from main.ts).
  window.addEventListener("feedback:close", close);

  const isEmailValid = (s: string) => s.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const buildBody = (): { subject: string; body: string; name: string; email: string; msg: string } | null => {
    const name = (nameInput.value || "").trim();
    const email = (emailInput.value || "").trim();
    const msg = (msgInput.value || "").trim();
    if (!msg) {
      flash(toast, "needs a message");
      msgInput.focus();
      return null;
    }
    if (!isEmailValid(email)) {
      flash(toast, "email looks off — leave blank or fix");
      emailInput.focus();
      return null;
    }
    const subject = "Border Run — feedback";
    const body =
      `from: ${name || "anonymous"}\n` +
      (email ? `email: ${email}\n` : "") +
      `url: ${location.href}\n` +
      `ua: ${navigator.userAgent}\n` +
      `\n${msg}\n`;
    return { subject, body, name, email, msg };
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
          email: built.email,
          message: built.msg,
          url: location.href,
          ua: navigator.userAgent,
        }),
      });
      if (res.ok) {
        flash(toast, "sent — thanks");
        msgInput.value = "";
        nameInput.value = "";
        emailInput.value = "";
        setTimeout(close, 700);
        return;
      }
      const data = await res.json().catch(() => ({}));
      console.warn("feedback endpoint:", res.status, data);
    } catch (err) {
      console.warn("feedback fetch failed:", err);
    } finally {
      sendBtn.removeAttribute("disabled");
    }

    // Fallback: copy to clipboard + open mailto. Feedback is never lost.
    try { await navigator.clipboard.writeText(`Subject: ${built.subject}\n\n${built.body}`); } catch {}
    window.location.href = `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(built.subject)}&body=${encodeURIComponent(built.body)}`;
    flash(toast, "couldn't reach server — opening mail client / copied to clipboard");
    setTimeout(() => {
      msgInput.value = "";
      nameInput.value = "";
      emailInput.value = "";
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
