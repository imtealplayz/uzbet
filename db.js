/**
 * db.js — MongoDB persistence layer
 * Drop-in replacement for the old fs/data.json pattern.
 *
 * Exposes the same loadDB() / saveDB() API the rest of the
 * code already uses, so nothing else needs to change structurally.
 *
 * Architecture:
 * - One MongoDB document holds the entire bot state (same shape as data.json)
 * - An in-memory cache means loadDB() is always synchronous and instant
 * - saveDB() writes to the cache immediately, then persists to MongoDB async
 * in the background — no await needed at call sites
 */
 
const mongoose = require("mongoose");
 
// ─── Schema ───────────────────────────────────────────────────────────────────
 
// We store everything as a single flexible document — mirrors data.json exactly
const botDataSchema = new mongoose.Schema(
 { _id: { type: String, default: "bot_data" } },
 { strict: false } // allow any fields
);
 
const BotData = mongoose.model("BotData", botDataSchema);
 
// ─── In-memory cache ──────────────────────────────────────────────────────────
 
let cache = {};
let connected = false;
let saveQueued = false;
 
// ─── Connect ──────────────────────────────────────────────────────────────────
 
async function connectDB() {
 const uri = process.env.MONGODB_URI;
 if (!uri) {
 console.error("❌ MONGODB_URI environment variable is not set!");
 process.exit(1);
 }
 
 try {
 await mongoose.connect(uri, {
 dbName: "casinobot",
 });
 console.log("✅ Connected to MongoDB");
 connected = true;
 
 // Load existing data into cache
 const doc = await BotData.findById("bot_data").lean();
 if (doc) {
 const { _id, __v, ...data } = doc;
 cache = data;
 console.log(`📦 Loaded existing data from MongoDB (${Object.keys(cache).length} keys)`);
 } else {
 cache = {};
 console.log("📦 No existing data found — starting fresh");
 }
 } catch (err) {
 console.error("❌ MongoDB connection failed:", err.message);
 process.exit(1);
 }
}
 
// ─── loadDB ───────────────────────────────────────────────────────────────────
// Synchronous — returns the in-memory cache instantly
// Identical interface to the old fs-based loadDB()
 
function loadDB() {
 return cache;
}
 
// ─── saveDB ───────────────────────────────────────────────────────────────────
// Writes to cache immediately (synchronous for callers)
// Persists to MongoDB in the background — batches rapid saves into one write
 
function saveDB(data) {
 // Update cache in place
 cache = data;
 
 // Batch saves — if one is already queued, the latest cache will be written
 if (saveQueued) return;
 saveQueued = true;
 
 setImmediate(async () => {
 saveQueued = false;
 if (!connected) return;
 try {
 await BotData.findByIdAndUpdate(
 "bot_data",
 { $set: { ...cache } },
 { upsert: true, strict: false }
 );
 } catch (err) {
 console.error("❌ MongoDB save error:", err.message);
 }
 });
}
 
// ─── Exports ──────────────────────────────────────────────────────────────────
 
module.exports = { connectDB, loadDB, saveDB };

