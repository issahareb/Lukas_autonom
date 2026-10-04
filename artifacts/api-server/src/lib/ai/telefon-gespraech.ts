/** Transcript fragments are incremental. Keep only the current speaker's short tail. */
export class TelefonGespraech {
  private role = "";
  private text = "";
  private farewell = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly started = Date.now();
  private done = false;
  constructor(private end: (reason: "mailbox" | "verabschiedet") => void) {}
  observe(role: "user" | "assistant", delta: string) {
    if (this.done) return;
    if (role !== this.role) { this.text = ""; this.role = role; }
    this.text = (this.text + delta).slice(-1200);
    clearTimeout(this.timer);
    if (role === "user") {
      this.farewell = false;
      // Strong announcement phrases, only near call start. Merely mentioning a mailbox is not enough.
      if (Date.now() - this.started < 60000 && /(?:sprechen sie|hinterlassen sie|hinterlasse bitte).{0,60}(?:nach dem (?:signal|piep)ton|nach dem ton)|(?:hier ist|das ist|sie haben|willkommen bei|verbunden mit).{0,50}(?:die mailbox|der mailbox|den anrufbeantworter)|please (?:leave|record) (?:a |your )message.{0,50}(?:tone|beep)/i.test(this.text)) {
        this.done = true; this.end("mailbox");
      }
      return;
    }
    if (/(?:^|[.!?]\s*|\s)(?:tschüss|tschüs|auf wiederhören|auf wiedersehen|bis dann|goodbye|bye bye)[.!\s]*$/i.test(this.text)) this.farewell = true;
    // Any further assistant words postpone hangup; any input speech cancels it.
    if (this.farewell) {
      this.timer = setTimeout(() => { this.done = true; this.end("verabschiedet"); }, 5000);
      this.timer.unref();
    }
  }
  cancel() { clearTimeout(this.timer); this.farewell = false; }
  close() { this.done = true; this.cancel(); }
}
