/**
 * ChatKeep — personal chat/message record vault API.
 * Stores messages YOU save (paste, type, or share). Does not scrape other apps.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const PORT = Number(process.env.MESSAGE_VAULT_PORT || process.env.PORT || 4055);
const ACCESS_CODE =
  process.env.MESSAGE_VAULT_ACCESS_CODE ||
  process.env.CHATKEEP_ACCESS_CODE ||
  "keepchat";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const recordSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true },
    contact: { type: String, default: "", index: true },
    body: { type: String, required: true },
    direction: {
      type: String,
      enum: ["in", "out", "note"],
      default: "note"
    },
    source: { type: String, default: "manual" },
    tags: { type: [String], default: [] },
    chatAt: { type: Date, default: Date.now, index: true },
    clientId: { type: String, index: true },
    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

recordSchema.index({ contact: 1, chatAt: -1 });
recordSchema.index({ updatedAt: -1 });

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, unique: true },
    name: { type: String, default: "Phone" },
    lastSeenAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

let Record;
let Device;
let memoryStore = null;

function useMemoryFallback(reason) {
  console.warn("ChatKeep using in-memory store:", reason);
  const records = [];
  const devices = new Map();
  memoryStore = {
    async upsertDevice(deviceId, name) {
      const existing = devices.get(deviceId) || { deviceId, name: name || "Phone" };
      existing.name = name || existing.name;
      existing.lastSeenAt = new Date();
      devices.set(deviceId, existing);
      return existing;
    },
    async listDevices() {
      return [...devices.values()].sort(
        (a, b) => b.lastSeenAt - a.lastSeenAt
      );
    },
    async createRecord(doc) {
      const row = {
        _id: crypto.randomBytes(12).toString("hex"),
        ...doc,
        updatedAt: new Date()
      };
      records.unshift(row);
      return row;
    },
    async findByClientId(clientId) {
      return records.find((r) => r.clientId === clientId) || null;
    },
    async listRecords({ q, contact, since, limit }) {
      let rows = [...records];
      if (contact) {
        const c = contact.toLowerCase();
        rows = rows.filter((r) => String(r.contact || "").toLowerCase().includes(c));
      }
      if (q) {
        const needle = q.toLowerCase();
        rows = rows.filter(
          (r) =>
            String(r.body || "").toLowerCase().includes(needle) ||
            String(r.contact || "").toLowerCase().includes(needle) ||
            (r.tags || []).some((t) => String(t).toLowerCase().includes(needle))
        );
      }
      if (since) {
        const t = new Date(since).getTime();
        rows = rows.filter((r) => new Date(r.updatedAt).getTime() > t);
      }
      rows.sort((a, b) => new Date(b.chatAt) - new Date(a.chatAt));
      return rows.slice(0, limit);
    },
    async updateRecord(id, patch) {
      const idx = records.findIndex((r) => String(r._id) === String(id));
      if (idx < 0) return null;
      records[idx] = { ...records[idx], ...patch, updatedAt: new Date() };
      return records[idx];
    },
    async deleteRecord(id) {
      const idx = records.findIndex((r) => String(r._id) === String(id));
      if (idx < 0) return false;
      records.splice(idx, 1);
      return true;
    },
    async stats() {
      const contacts = new Set(records.map((r) => r.contact).filter(Boolean));
      return {
        total: records.length,
        contacts: contacts.size,
        devices: devices.size
      };
    }
  };
}

function requireAccess(req, res, next) {
  const code = String(
    req.headers["x-access-code"] || req.query.accessCode || req.body?.accessCode || ""
  ).trim();
  if (code !== ACCESS_CODE) {
    return res.status(401).json({ success: false, error: "Invalid access code" });
  }
  return next();
}

function normalizeTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : String(tags).split(",");
  return [
    ...new Set(
      list
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    )
  ];
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "ChatKeep",
    store: memoryStore ? "memory" : "mongodb",
    time: new Date().toISOString()
  });
});

app.post("/api/devices/register", requireAccess, async (req, res) => {
  try {
    const deviceId =
      String(req.body?.deviceId || "").trim() || crypto.randomBytes(8).toString("hex");
    const name = String(req.body?.name || "Phone").trim().slice(0, 64) || "Phone";

    let device;
    if (memoryStore) {
      device = await memoryStore.upsertDevice(deviceId, name);
    } else {
      device = await Device.findOneAndUpdate(
        { deviceId },
        { $set: { name, lastSeenAt: new Date() } },
        { upsert: true, new: true }
      );
    }

    res.json({ success: true, device });
  } catch (error) {
    console.error("device register:", error.message);
    res.status(500).json({ success: false, error: "Failed to register device" });
  }
});

app.get("/api/devices", requireAccess, async (_req, res) => {
  try {
    const devices = memoryStore
      ? await memoryStore.listDevices()
      : await Device.find().sort({ lastSeenAt: -1 }).lean();
    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to list devices" });
  }
});

app.get("/api/records", requireAccess, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const contact = String(req.query.contact || "").trim();
    const since = req.query.since ? String(req.query.since) : null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    const records = memoryStore
      ? await memoryStore.listRecords({ q, contact, since, limit })
      : await (async () => {
          const filter = {};
          if (contact) filter.contact = new RegExp(contact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          if (q) {
            filter.$or = [
              { body: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
              { contact: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
              { tags: q.toLowerCase() }
            ];
          }
          if (since) filter.updatedAt = { $gt: new Date(since) };
          return Record.find(filter).sort({ chatAt: -1 }).limit(limit).lean();
        })();

    res.json({ success: true, records, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error("list records:", error.message);
    res.status(500).json({ success: false, error: "Failed to load records" });
  }
});

app.post("/api/records", requireAccess, async (req, res) => {
  try {
    const body = String(req.body?.body || "").trim();
    if (!body) {
      return res.status(400).json({ success: false, error: "Message body is required" });
    }

    const deviceId = String(req.body?.deviceId || "").trim() || "unknown";
    const clientId = String(req.body?.clientId || "").trim() || null;
    const contact = String(req.body?.contact || "").trim().slice(0, 120);
    const direction = ["in", "out", "note"].includes(req.body?.direction)
      ? req.body.direction
      : "note";
    const source = String(req.body?.source || "manual").trim().slice(0, 40);
    const tags = normalizeTags(req.body?.tags);
    const chatAt = req.body?.chatAt ? new Date(req.body.chatAt) : new Date();

    if (clientId) {
      const existing = memoryStore
        ? await memoryStore.findByClientId(clientId)
        : await Record.findOne({ clientId }).lean();
      if (existing) {
        return res.json({ success: true, record: existing, deduped: true });
      }
    }

    if (memoryStore) {
      await memoryStore.upsertDevice(deviceId, req.body?.deviceName);
    } else {
      await Device.findOneAndUpdate(
        { deviceId },
        { $set: { lastSeenAt: new Date(), name: req.body?.deviceName || "Phone" } },
        { upsert: true }
      );
    }

    const doc = {
      deviceId,
      contact,
      body: body.slice(0, 20000),
      direction,
      source,
      tags,
      chatAt: Number.isNaN(chatAt.getTime()) ? new Date() : chatAt,
      clientId
    };

    const record = memoryStore
      ? await memoryStore.createRecord(doc)
      : await Record.create(doc);

    res.status(201).json({ success: true, record });
  } catch (error) {
    console.error("create record:", error.message);
    res.status(500).json({ success: false, error: "Failed to save record" });
  }
});

app.post("/api/records/bulk", requireAccess, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: "No records to sync" });
    }

    const deviceId = String(req.body?.deviceId || "").trim() || "unknown";
    const saved = [];
    const skipped = [];

    for (const item of items.slice(0, 200)) {
      const body = String(item?.body || "").trim();
      if (!body) continue;

      const clientId = String(item?.clientId || "").trim() || null;
      if (clientId) {
        const existing = memoryStore
          ? await memoryStore.findByClientId(clientId)
          : await Record.findOne({ clientId }).lean();
        if (existing) {
          skipped.push(existing);
          continue;
        }
      }

      const chatAt = item?.chatAt ? new Date(item.chatAt) : new Date();
      const doc = {
        deviceId,
        contact: String(item?.contact || "").trim().slice(0, 120),
        body: body.slice(0, 20000),
        direction: ["in", "out", "note"].includes(item?.direction) ? item.direction : "note",
        source: String(item?.source || "sync").trim().slice(0, 40),
        tags: normalizeTags(item?.tags),
        chatAt: Number.isNaN(chatAt.getTime()) ? new Date() : chatAt,
        clientId
      };

      const record = memoryStore
        ? await memoryStore.createRecord(doc)
        : await Record.create(doc);
      saved.push(record);
    }

    if (memoryStore) {
      await memoryStore.upsertDevice(deviceId, req.body?.deviceName);
    } else {
      await Device.findOneAndUpdate(
        { deviceId },
        { $set: { lastSeenAt: new Date(), name: req.body?.deviceName || "Phone" } },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      saved: saved.length,
      skipped: skipped.length,
      records: saved
    });
  } catch (error) {
    console.error("bulk sync:", error.message);
    res.status(500).json({ success: false, error: "Failed to sync records" });
  }
});

app.patch("/api/records/:id", requireAccess, async (req, res) => {
  try {
    const patch = {};
    if (req.body?.body != null) patch.body = String(req.body.body).trim().slice(0, 20000);
    if (req.body?.contact != null) patch.contact = String(req.body.contact).trim().slice(0, 120);
    if (["in", "out", "note"].includes(req.body?.direction)) patch.direction = req.body.direction;
    if (req.body?.tags != null) patch.tags = normalizeTags(req.body.tags);
    if (req.body?.chatAt) {
      const d = new Date(req.body.chatAt);
      if (!Number.isNaN(d.getTime())) patch.chatAt = d;
    }
    patch.updatedAt = new Date();

    const record = memoryStore
      ? await memoryStore.updateRecord(req.params.id, patch)
      : await Record.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true }).lean();

    if (!record) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, record });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update record" });
  }
});

app.delete("/api/records/:id", requireAccess, async (req, res) => {
  try {
    const ok = memoryStore
      ? await memoryStore.deleteRecord(req.params.id)
      : Boolean(await Record.findByIdAndDelete(req.params.id));

    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete record" });
  }
});

app.get("/api/stats", requireAccess, async (_req, res) => {
  try {
    const stats = memoryStore
      ? await memoryStore.stats()
      : {
          total: await Record.countDocuments(),
          contacts: (await Record.distinct("contact")).filter(Boolean).length,
          devices: await Device.countDocuments()
        };
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to load stats" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await mongoose.connect(uri);
      Record = mongoose.model("ChatKeepRecord", recordSchema);
      Device = mongoose.model("ChatKeepDevice", deviceSchema);
      console.log("ChatKeep MongoDB connected");
    } catch (error) {
      useMemoryFallback(error.message);
    }
  } else {
    useMemoryFallback("MONGODB_URI not set");
  }

  app.listen(PORT, () => {
    console.log(`ChatKeep running on http://0.0.0.0:${PORT}`);
    console.log(`Open on your phone (same Wi‑Fi) and use access code to sync.`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
