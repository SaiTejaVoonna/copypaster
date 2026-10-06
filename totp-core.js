// CopyPaster 2FA codes (TOTP, RFC 6238): the rules, no screen code. window.CPTotp
//
// A 2FA setup key is a shared secret: the site and this device both turn it
// and the current time into the same 6-digit code. The key is kept inside a
// Vault item, so it's encrypted on disk like a password. Codes are made here,
// on the device; nothing is sent anywhere.
(function () {
  "use strict";

  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const ALGOS = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

  // Base32 to bytes. Spaces, dashes, padding and case don't matter.
  function base32Decode(input) {
    const clean = String(input || "").toUpperCase().replace(/[\s=-]/g, "");
    if (!clean) throw new Error("The setup key is empty.");
    let bits = 0, value = 0;
    const out = [];
    for (const ch of clean) {
      const v = B32.indexOf(ch);
      if (v === -1) throw new Error("The setup key has a character that doesn't belong (only A–Z and 2–7).");
      value = (value << 5) | v;
      bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    if (out.length < 10) throw new Error("That setup key is too short. It's usually 16 or 32 characters.");
    return new Uint8Array(out);
  }
  function base32Encode(bytes) {
    let bits = 0, value = 0, out = "";
    for (const b of bytes) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
  }

  // Checks and tidies a 2FA setup: { secret, issuer, account, digits, period, algorithm }.
  function normalize(t) {
    const secret = String(t.secret || "").toUpperCase().replace(/[\s=-]/g, "");
    base32Decode(secret); // throws with a clear message if it isn't usable
    const digits = [6, 7, 8].includes(Number(t.digits)) ? Number(t.digits) : 6;
    const period = [15, 30, 60].includes(Number(t.period)) ? Number(t.period) : 30;
    const algorithm = ALGOS[String(t.algorithm || "SHA1").toUpperCase().replace("-", "")] ? String(t.algorithm || "SHA1").toUpperCase().replace("-", "") : "SHA1";
    const clip = (s) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    return { secret, issuer: clip(t.issuer), account: clip(t.account), digits, period, algorithm };
  }

  // Reads what a site gives you: an otpauth:// link (from the QR code) or a bare key.
  function parse(text) {
    const raw = String(text || "").trim();
    if (/^otpauth:\/\//i.test(raw)) {
      let url;
      try { url = new URL(raw); } catch { throw new Error("That otpauth link isn't complete."); }
      if (url.host.toLowerCase() !== "totp") throw new Error("Only time-based codes (TOTP) are supported, not counter-based ones.");
      const label = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const [labelIssuer, account] = label.includes(":") ? label.split(/:(.*)/s) : ["", label];
      const p = url.searchParams;
      return normalize({ secret: p.get("secret"), issuer: p.get("issuer") || labelIssuer, account, digits: p.get("digits"), period: p.get("period"), algorithm: p.get("algorithm") });
    }
    return normalize({ secret: raw });
  }

  function toLink(t) {
    const label = encodeURIComponent((t.issuer ? t.issuer + ":" : "") + (t.account || "account"));
    const q = new URLSearchParams({ secret: t.secret, digits: String(t.digits), period: String(t.period), algorithm: t.algorithm });
    if (t.issuer) q.set("issuer", t.issuer);
    return "otpauth://totp/" + label + "?" + q.toString();
  }

  async function hotp(keyBytes, counter, digits = 6, algorithm = "SHA1") {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: ALGOS[algorithm] || "SHA-1" }, false, ["sign"]);
    const msg = new ArrayBuffer(8);
    const view = new DataView(msg);
    view.setUint32(0, Math.floor(counter / 0x100000000));
    view.setUint32(4, counter >>> 0);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
    const off = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % Math.pow(10, digits)).padStart(digits, "0");
  }

  // The code for a moment in time (ms), and how many seconds it has left.
  async function code(t, now = Date.now()) {
    const n = normalize(t);
    const step = Math.floor(now / 1000 / n.period);
    const value = await hotp(base32Decode(n.secret), step, n.digits, n.algorithm);
    const left = n.period - Math.floor(now / 1000) % n.period;
    return { code: value, left, period: n.period };
  }

  // "123456" → "123 456", easier to read and type.
  const pretty = (c) => (c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c.length === 8 ? c.slice(0, 4) + " " + c.slice(4) : c);

  window.CPTotp = { base32Decode, base32Encode, normalize, parse, toLink, hotp, code, pretty };
})();
