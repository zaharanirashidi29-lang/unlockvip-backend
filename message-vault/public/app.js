(() => {
  const STORAGE_KEY = "chatkeep.v1";
  const API = "";

  const els = {
    gate: document.getElementById("gate"),
    vault: document.getElementById("vault"),
    unlockForm: document.getElementById("unlock-form"),
    accessCode: document.getElementById("access-code"),
    deviceName: document.getElementById("device-name"),
    gateError: document.getElementById("gate-error"),
    deviceLabel: document.getElementById("device-label"),
    syncStatus: document.getElementById("sync-status"),
    syncBtn: document.getElementById("sync-btn"),
    lockBtn: document.getElementById("lock-btn"),
    compose: document.getElementById("compose"),
    contact: document.getElementById("contact"),
    direction: document.getElementById("direction"),
    body: document.getElementById("body"),
    tags: document.getElementById("tags"),
    search: document.getElementById("search"),
    refreshBtn: document.getElementById("refresh-btn"),
    list: document.getElementById("record-list"),
    empty: document.getElementById("empty-state"),
    sendSms: document.getElementById("send-sms"),
    sendWa: document.getElementById("send-wa"),
    importFile: document.getElementById("import-file")
  };

  let state = loadState();

  function loadState() {
    try {
      return (
        JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {
          accessCode: "",
          deviceId: crypto.randomUUID(),
          deviceName: "My phone",
          records: [],
          lastSyncedAt: null
        }
      );
    } catch {
      return {
        accessCode: "",
        deviceId: crypto.randomUUID(),
        deviceName: "My phone",
        records: [],
        lastSyncedAt: null
      };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setStatus(text) {
    els.syncStatus.textContent = text;
  }

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Access-Code": state.accessCode,
      ...(options.headers || {})
    };
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function uid() {
    return crypto.randomUUID();
  }

  function formatWhen(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function mergeRecords(serverRecords = []) {
    const byKey = new Map();
    for (const r of state.records) {
      const key = r.clientId || r._id || r.id;
      byKey.set(key, r);
    }
    for (const r of serverRecords) {
      const key = r.clientId || r._id;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...r, pending: false });
        continue;
      }
      const localUpdated = new Date(existing.updatedAt || existing.chatAt || 0).getTime();
      const remoteUpdated = new Date(r.updatedAt || r.chatAt || 0).getTime();
      if (remoteUpdated >= localUpdated || existing.pending) {
        byKey.set(key, { ...existing, ...r, pending: false });
      }
    }
    state.records = [...byKey.values()].sort(
      (a, b) => new Date(b.chatAt) - new Date(a.chatAt)
    );
    saveState();
  }

  function filteredRecords() {
    const q = els.search.value.trim().toLowerCase();
    if (!q) return state.records;
    return state.records.filter((r) => {
      return (
        String(r.body || "").toLowerCase().includes(q) ||
        String(r.contact || "").toLowerCase().includes(q) ||
        (r.tags || []).some((t) => String(t).toLowerCase().includes(q))
      );
    });
  }

  function renderList() {
    const rows = filteredRecords();
    els.list.innerHTML = "";
    els.empty.hidden = rows.length > 0;

    for (const record of rows) {
      const li = document.createElement("li");
      li.className = "record";
      const dir = record.direction || "note";
      const key = record.clientId || record._id || "";
      const tags = (record.tags || [])
        .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
        .join("");

      li.innerHTML = `
        <div class="record-head">
          <div class="record-contact">${escapeHtml(record.contact || "Untitled")}</div>
          <div class="record-meta">${escapeHtml(formatWhen(record.chatAt))}${
            record.pending ? " · pending" : ""
          }</div>
        </div>
        <p class="record-body">${escapeHtml(record.body || "")}</p>
        ${tags ? `<div class="tags">${tags}</div>` : ""}
        <div class="record-foot">
          <span class="pill ${escapeHtml(dir)}">${escapeHtml(dir)}</span>
          <div class="record-actions">
            <button type="button" class="link-btn" data-sms="${escapeHtml(key)}">Messages</button>
            <button type="button" class="link-btn" data-wa="${escapeHtml(key)}">WhatsApp</button>
            <button type="button" class="danger-btn" data-del="${escapeHtml(key)}">Delete</button>
          </div>
        </div>
      `;
      els.list.appendChild(li);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  async function registerDevice() {
    await api("/api/devices/register", {
      method: "POST",
      body: JSON.stringify({
        deviceId: state.deviceId,
        name: state.deviceName
      })
    });
  }

  async function syncNow({ quiet = false } = {}) {
    if (!state.accessCode) return;
    try {
      if (!quiet) setStatus("Syncing…");
      await registerDevice();

      const pending = state.records.filter((r) => r.pending);
      if (pending.length) {
        await api("/api/records/bulk", {
          method: "POST",
          body: JSON.stringify({
            deviceId: state.deviceId,
            deviceName: state.deviceName,
            records: pending.map((r) => ({
              clientId: r.clientId,
              contact: r.contact,
              body: r.body,
              direction: r.direction,
              source: r.source || "phone",
              tags: r.tags || [],
              chatAt: r.chatAt
            }))
          })
        });
        for (const r of pending) r.pending = false;
      }

      const data = await api(
        `/api/records?limit=300${
          state.lastSyncedAt
            ? ""
            : ""
        }`
      );
      mergeRecords(data.records || []);
      state.lastSyncedAt = data.syncedAt || new Date().toISOString();
      saveState();
      renderList();
      setStatus(`Synced · ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setStatus(`Offline / sync failed · ${error.message}`);
      renderList();
    }
  }

  function readIncomingShare() {
    const params = new URLSearchParams(location.search);
    const title = (params.get("title") || "").trim();
    const url = (params.get("url") || "").trim();
    const text = (params.get("text") || params.get("body") || "").trim();
    const body = [text, url].filter(Boolean).join("\n").trim();
    if (!body && !title) return null;
    return { contact: title, body: body || title };
  }

  function applyIncomingShare() {
    const raw = sessionStorage.getItem("chatkeep.incoming");
    if (!raw) return;
    sessionStorage.removeItem("chatkeep.incoming");
    try {
      const incoming = JSON.parse(raw);
      if (incoming.contact) els.contact.value = incoming.contact;
      if (incoming.body) els.body.value = incoming.body;
      els.direction.value = "in";
      setStatus("Shared in from your message app. Tap Keep to store it.");
    } catch {
      sessionStorage.removeItem("chatkeep.incoming");
    }
  }

  function showVault() {
    els.gate.hidden = true;
    els.vault.hidden = false;
    els.deviceLabel.textContent = state.deviceName || "Phone";
    els.deviceName.value = state.deviceName || "My phone";
    renderList();
    applyIncomingShare();
    syncNow();
  }

  function showGate() {
    els.vault.hidden = true;
    els.gate.hidden = false;
    els.accessCode.value = "";
    els.deviceName.value = state.deviceName || "My phone";
  }

  els.unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    els.gateError.hidden = true;
    const code = els.accessCode.value.trim();
    const name = els.deviceName.value.trim() || "My phone";
    if (!code) return;

    state.accessCode = code;
    state.deviceName = name;
    if (!state.deviceId) state.deviceId = uid();
    saveState();

    try {
      await registerDevice();
      showVault();
    } catch (error) {
      els.gateError.textContent = error.message || "Could not open vault";
      els.gateError.hidden = false;
    }
  });

  els.compose.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = els.body.value.trim();
    if (!body) return;

    const record = {
      clientId: uid(),
      contact: els.contact.value.trim(),
      body,
      direction: els.direction.value,
      source: "phone",
      tags: els.tags.value
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      chatAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pending: true,
      deviceId: state.deviceId
    };

    state.records.unshift(record);
    saveState();
    els.body.value = "";
    els.tags.value = "";
    renderList();
    setStatus("Saved on this phone · syncing…");

    try {
      const data = await api("/api/records", {
        method: "POST",
        body: JSON.stringify({
          ...record,
          deviceName: state.deviceName
        })
      });
      record.pending = false;
      if (data.record?._id) record._id = data.record._id;
      saveState();
      setStatus("Kept · synced");
      renderList();
    } catch {
      setStatus("Kept offline · will sync when online");
    }
  });

  function phoneDigits(contact) {
    const digits = String(contact || "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return "";
    if (digits.startsWith("0") && digits.length === 10) return `255${digits.slice(1)}`;
    return digits;
  }

  function openMessages({ contact, body }) {
    const phone = phoneDigits(contact);
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const sep = ios ? "&" : "?";
    const target = phone ? `sms:+${phone}` : "sms:";
    window.location.href = body ? `${target}${sep}body=${encodeURIComponent(body)}` : target;
  }

  function openWhatsApp({ contact, body }) {
    const phone = phoneDigits(contact);
    const text = encodeURIComponent(body || "");
    const href = phone
      ? `https://wa.me/${phone}?text=${text}`
      : `https://api.whatsapp.com/send?text=${text}`;
    window.open(href, "_blank", "noopener");
  }

  function draftMessage() {
    return {
      contact: els.contact.value.trim(),
      body: els.body.value.trim()
    };
  }

  function parseChatExport(text) {
    const records = [];
    let current = null;
    const lineRe =
      /^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APMapm]{2})?)\s+-\s+([^:]+):\s(.*)$/;

    for (const line of String(text || "").split(/\r?\n/)) {
      const match = line.match(lineRe);
      if (match) {
        if (current) records.push(current);
        current = {
          contact: match[3].trim().slice(0, 120),
          body: match[4],
          chatAt: new Date().toISOString(),
          direction: "in",
          source: "message-export",
          tags: ["imported"]
        };
        continue;
      }
      if (current && line.trim()) current.body += `\n${line}`;
    }
    if (current) records.push(current);
    return records.filter((record) => record.body.trim());
  }

  function queueRecords(items, source) {
    const now = new Date().toISOString();
    for (const item of items) {
      state.records.unshift({
        clientId: uid(),
        contact: item.contact || "",
        body: item.body,
        direction: item.direction || "in",
        source: item.source || source,
        tags: item.tags || [],
        chatAt: item.chatAt || now,
        updatedAt: now,
        pending: true,
        deviceId: state.deviceId
      });
    }
    saveState();
    renderList();
  }

  els.sendSms.addEventListener("click", () => {
    const draft = draftMessage();
    if (!draft.body && !draft.contact) {
      setStatus("Type a message or pick a saved one first");
      return;
    }
    openMessages(draft);
  });

  els.sendWa.addEventListener("click", () => {
    const draft = draftMessage();
    if (!draft.body && !draft.contact) {
      setStatus("Type a message or pick a saved one first");
      return;
    }
    openWhatsApp(draft);
  });

  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = "";
    if (!file) return;
    const text = await file.text();
    const parsed = parseChatExport(text);
    if (!parsed.length) {
      setStatus("No chat lines found. Export the chat as a .txt file from WhatsApp.");
      return;
    }
    queueRecords(parsed.slice(0, 200), "message-export");
    setStatus(`Imported ${Math.min(parsed.length, 200)} messages · syncing…`);
    syncNow({ quiet: true });
  });

  els.list.addEventListener("click", async (event) => {
    const sms = event.target.closest("[data-sms]");
    const wa = event.target.closest("[data-wa]");
    if (sms || wa) {
      const key = (sms || wa).getAttribute(sms ? "data-sms" : "data-wa");
      const record = state.records.find((r) => (r.clientId || r._id) === key);
      if (!record) return;
      if (sms) openMessages(record);
      else openWhatsApp(record);
      return;
    }

    const btn = event.target.closest("[data-del]");
    if (!btn) return;
    const key = btn.getAttribute("data-del");
    const record = state.records.find((r) => (r.clientId || r._id) === key);
    if (!record) return;
    if (!confirm("Delete this record?")) return;

    state.records = state.records.filter((r) => (r.clientId || r._id) !== key);
    saveState();
    renderList();

    if (record._id) {
      try {
        await api(`/api/records/${record._id}`, { method: "DELETE" });
      } catch {
        setStatus("Deleted locally · server delete pending next sync");
      }
    }
  });

  els.search.addEventListener("input", renderList);
  els.syncBtn.addEventListener("click", () => syncNow());
  els.refreshBtn.addEventListener("click", () => syncNow());
  els.lockBtn.addEventListener("click", () => {
    state.accessCode = "";
    saveState();
    showGate();
  });

  window.addEventListener("online", () => syncNow({ quiet: true }));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const incomingShare = readIncomingShare();
  if (incomingShare) {
    sessionStorage.setItem("chatkeep.incoming", JSON.stringify(incomingShare));
    history.replaceState({}, "", "/");
  }

  if (state.accessCode) {
    showVault();
  } else {
    showGate();
  }
})();
