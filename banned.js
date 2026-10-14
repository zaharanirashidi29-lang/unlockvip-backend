const BANNED_PHONES = new Set(["255794244913"]);

function bannedPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("255") && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length >= 10) return "255" + digits.slice(1, 10);
  if (digits.length === 9) return "255" + digits;
  return digits;
}

function isBannedPhone(raw) {
  return BANNED_PHONES.has(bannedPhone(raw));
}

module.exports = { isBannedPhone, bannedPhone };
