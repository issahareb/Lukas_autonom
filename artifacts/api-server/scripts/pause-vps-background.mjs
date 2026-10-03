import { Client } from "ssh2";
import { readFileSync } from "node:fs";
const enabled = name => process.env[name]?.trim().toLowerCase() === "true";
if (!enabled("LUKAS_BACKGROUND_PAUSED") || !enabled("LUKAS_PAUSE_VPS_BACKGROUND")) {
  console.log(JSON.stringify({ event: "vps_background_pause", mode: "inventory", skipped: true }));
} else {
  try {
    const remote = readFileSync(new URL("../../../vps/background_pause_inventory.py", import.meta.url), "utf8");
    const host = process.env.VPS_SSH_HOST?.trim(), privateKey = process.env.VPS_SSH_KEY;
    const port = Number(process.env.VPS_SSH_PORT || 22);
    if (!host || !privateKey || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("missing_or_invalid_ssh_config");
    const output = await new Promise((resolve, reject) => {
      const client = new Client();
      let finished = false;
      const timeout = setTimeout(() => finish(new Error("ssh_inventory_timeout")), 90000);
      function finish(error, value) {
        if (finished) return; finished = true; clearTimeout(timeout); client.end();
        if (error) reject(error); else resolve(value);
      }
      client.on("error", error => finish(new Error(error?.level === "client-authentication" ? "ssh_authentication_failed" : "ssh_connection_failed")));
      client.on("close", () => { if (!finished) finish(new Error("ssh_closed_before_inventory")); });
      client.on("ready", () => {
        client.exec("python3 - <<'LUKAS_READONLY_INVENTORY'\n" + remote + "\nLUKAS_READONLY_INVENTORY", (error, stream) => {
          if (error) return finish(new Error("ssh_inventory_start_failed"));
          let stdout = "";
          stream.on("data", chunk => { stdout += chunk.toString("utf8"); if (stdout.length > 65536) finish(new Error("inventory_output_too_large")); });
          stream.stderr.resume();
          stream.on("error", () => finish(new Error("ssh_inventory_stream_failed")));
          stream.on("close", code => {
            let value; try { value = JSON.parse(stdout); } catch { return finish(new Error("inventory_invalid_output")); }
            if (value?.mode !== "inventory" || value.paused !== false || typeof value.ok !== "boolean") return finish(new Error("inventory_invalid_shape"));
            finish(null, { ...value, exitCode: code });
          });
        });
      });
      try {
        client.connect({ host, port, username: process.env.VPS_SSH_USER?.trim() || "root",
          privateKey, readyTimeout: 15000, keepaliveInterval: 10000, keepaliveCountMax: 3 });
      } catch { finish(new Error("ssh_connection_failed")); }
    });
    console.log(JSON.stringify({ event: "vps_background_pause", ...output }));
    if (!output.ok || output.exitCode !== 0) process.exitCode = 1;
  } catch (error) {
    const safeCodes = new Set(["missing_or_invalid_ssh_config", "ssh_inventory_timeout", "ssh_authentication_failed",
      "ssh_connection_failed", "ssh_closed_before_inventory", "ssh_inventory_start_failed", "inventory_output_too_large",
      "ssh_inventory_stream_failed", "inventory_invalid_output", "inventory_invalid_shape"]);
    console.error(JSON.stringify({ event: "vps_background_pause", mode: "inventory", paused: false,
      ok: false, error: safeCodes.has(error?.message) ? error.message : "inventory_failed" }));
    process.exitCode = 1;
  }
}
