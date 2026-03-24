const { loadDB, saveDB } = require("./db");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");

const OWNER_ID = "926063716057894953";
const R        = "<:Robux_logo:1485012977638838272>";

function getGlobal(key)        { const db = loadDB(); return db[key] ?? null; }
function setGlobal(key, value) { const db = loadDB(); db[key] = value; saveDB(db); }

function ensureUser(db, guildId, userId) {
  if (!db[guildId])         db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = { balance: 0 };
}
function addBalance(guildId, userId, amount) {
  const db = loadDB();
  ensureUser(db, guildId, userId);
  db[guildId][userId].balance = Math.max(0, Math.floor((db[guildId][userId].balance || 0) + amount));
  saveDB(db);
}

function isOwner(interaction) {
  return (interaction.user?.id || interaction.author?.id) === OWNER_ID;
}
function baseEmbed(title, color = 0xF4C542) {
  return new EmbedBuilder().setColor(color).setTitle(title).setTimestamp().setFooter({ text: "🎰 Casino Bot" });
}
function getAccountAge(userId) {
  const ms = Number((BigInt(userId) >> 22n) + 1420070400000n);
  return (Date.now() - ms) / (1000 * 60 * 60 * 24 * 30);
}
function progressBar(current, total, len = 14) {
  const pct = Math.min(1, total > 0 ? current / total : 0);
  return "█".repeat(Math.round(pct * len)) + "░".repeat(len - Math.round(pct * len));
}

// Which "event type" owns an invite code — used for isolation
function getInviteOwnership(inviteCode) {
  const db = loadDB();
  if (db.affiliateInvites?.[inviteCode])   return "affiliate";
  if (db.prizePoolInvites?.[inviteCode])   return "prizepool";
  if (db.guessCodeInvites?.[inviteCode])   return "guesscode";
  return null;
}

// ─── DAILY WAGER REQUIREMENT ──────────────────────────────────────────────────

function checkDailyWagerReq(guildId, userId) {
  const db = loadDB();
  const u  = db[guildId]?.[userId] || {};
  const totalDailyClaimed = u.totalDailyClaimed  || 0;
  const wageredSinceDaily = u.wageredSinceDaily  || 0;
  const required          = Math.floor(totalDailyClaimed * 0.5);
  const remaining         = Math.max(0, required - wageredSinceDaily);
  return { required, wageredSinceDaily, remaining, canClaim: remaining === 0 };
}

// ─── PROMO CODES ──────────────────────────────────────────────────────────────

async function cmdCreatePromo(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });

  const code    = interaction.options.getString("code").toUpperCase().trim();
  const amount  = interaction.options.getInteger("amount");
  const maxUses = interaction.options.getInteger("uses") || 0;
  const expStr  = interaction.options.getString("expires") || null;

  let expiresAt = null;
  if (expStr) {
    const m = expStr.match(/^(\d+)(h|d|m)$/);
    if (!m) return interaction.reply({ content: "❌ Invalid expires. Use `24h`, `7d`, `30m`.", flags: MessageFlags.Ephemeral });
    const mult = { m: 60000, h: 3600000, d: 86400000 };
    expiresAt = Date.now() + parseInt(m[1]) * mult[m[2]];
  }

  const db = loadDB();
  if (!db.promoCodes) db.promoCodes = {};
  if (db.promoCodes[code]) return interaction.reply({ content: `❌ Code \`${code}\` already exists.`, flags: MessageFlags.Ephemeral });

  db.promoCodes[code] = { amount, maxUses, uses: 0, usedBy: [], expiresAt, createdAt: Date.now() };
  saveDB(db);

  await interaction.reply({
    embeds: [baseEmbed("✅ Promo Created", 0x2ECC71).addFields(
      { name: "Code",     value: `\`${code}\``,                                        inline: true },
      { name: "Amount",   value: `${amount} ${R}`,                                     inline: true },
      { name: "Max Uses", value: maxUses === 0 ? "Unlimited" : `${maxUses}`,            inline: true },
      { name: "Expires",  value: expiresAt ? `<t:${Math.floor(expiresAt/1000)}:R>` : "Never", inline: true }
    )],
    flags: MessageFlags.Ephemeral
  });
}

async function cmdRedeemPromo(interaction, userId, guildId) {
  const code  = interaction.options?.getString("code")?.toUpperCase().trim();
  if (!code)  return interaction.reply({ content: "❌ Provide a code. Example: `/promo code:SUMMER`", flags: MessageFlags.Ephemeral });

  const db    = loadDB();
  const promo = db.promoCodes?.[code];

  if (!promo)                                           return interaction.reply({ embeds: [baseEmbed("❌ Invalid Code",  0xE74C3C).setDescription(`Code \`${code}\` does not exist.`)],              flags: MessageFlags.Ephemeral });
  if (promo.expiresAt && Date.now() > promo.expiresAt)  return interaction.reply({ embeds: [baseEmbed("❌ Expired",       0xE74C3C).setDescription("This promo code has expired.")],                   flags: MessageFlags.Ephemeral });
  if (promo.maxUses > 0 && promo.uses >= promo.maxUses) return interaction.reply({ embeds: [baseEmbed("❌ Used Up",       0xE74C3C).setDescription("This code has no uses remaining.")],              flags: MessageFlags.Ephemeral });
  if (promo.usedBy.includes(userId))                    return interaction.reply({ embeds: [baseEmbed("❌ Already Used",  0xE74C3C).setDescription("You've already redeemed this code.")],            flags: MessageFlags.Ephemeral });

  promo.usedBy.push(userId);
  promo.uses++;
  db.promoCodes[code] = promo;
  ensureUser(db, guildId, userId);
  db[guildId][userId].balance = (db[guildId][userId].balance || 0) + promo.amount;
  saveDB(db);

  await interaction.reply({
    embeds: [baseEmbed("🎉 Promo Redeemed!", 0x2ECC71)
      .setDescription(`Code \`${code}\` redeemed!`)
      .addFields(
        { name: "Received", value: `+${promo.amount} ${R}`,                         inline: true },
        { name: "Balance",  value: `${db[guildId][userId].balance.toLocaleString()} ${R}`, inline: true }
      )],
    flags: MessageFlags.Ephemeral
  });
}

// ─── AFFILIATE PROGRAM ────────────────────────────────────────────────────────

const AFF_PCT_REAL    = 0.005;
const AFF_PCT_DISPLAY = "1%";
const AFF_MIN_CLAIM   = 10;

function processAffiliateWager(guildId, userId, bet) {
  try {
    const db = loadDB();
    const u  = db[guildId]?.[userId];
    if (!u?.referredBy) return;
    const ref = u.referredBy;
    if (!db[guildId]?.[ref]) return;
    const earn = parseFloat((bet * AFF_PCT_REAL).toFixed(4));
    db[guildId][ref].affiliateEarnings      = parseFloat(((db[guildId][ref].affiliateEarnings || 0) + earn).toFixed(4));
    db[guildId][ref].affiliateTotalWagered  = (db[guildId][ref].affiliateTotalWagered || 0) + bet;
    saveDB(db);
  } catch {}
}

async function cmdAffiliatePanel(interaction, guildId) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("aff_create").setLabel("🔗 Create Link").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("aff_earnings").setLabel("📊 My Earnings").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aff_claim").setLabel("💰 Claim").setStyle(ButtonStyle.Success)
  );
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle("🤝 Affiliate Program")
    .setDescription(
      `Invite friends and earn **${AFF_PCT_DISPLAY}** of their wagers — forever!\n\n` +
      `1️⃣ Click **Create Link** to get your unique invite\n` +
      `2️⃣ Share it — when someone joins & gets verified, they're your referral\n` +
      `3️⃣ Earn **${AFF_PCT_DISPLAY}** of every bet they place\n` +
      `4️⃣ Click **Claim** when you have **${AFF_MIN_CLAIM}+ ${R}** pending\n\n` +
      `⚠️ Accounts under 5 months old do not count.\n⚠️ Rejoining members do not count.`
    ).setTimestamp().setFooter({ text: "🎰 Casino Bot • Affiliate Program" });
  await interaction.reply({ content: "✅ Panel sent!", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ embeds: [embed], components: [row] });
}

async function handleAffiliateButton(interaction, userId, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { customId } = interaction;

  // Always derive guildId from the interaction itself — never trust passed value alone
  const resolvedGuildId = interaction.guildId || guildId;
  if (!resolvedGuildId) return interaction.editReply({ content: "❌ This must be used inside a server." });

  const db = loadDB();
  ensureUser(db, resolvedGuildId, userId);
  const u = db[resolvedGuildId][userId];

  if (customId === "aff_create") {
    let url = u.affiliateInviteUrl || null;
    if (!url) {
      try {
        const ch = interaction.channel
          || await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
        if (!ch) return interaction.editReply({ content: "❌ Could not find channel. Please try again." });
        const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Affiliate:${userId}` });
        url = inv.url;
        const db2 = loadDB();
        if (!db2.affiliateInvites) db2.affiliateInvites = {};
        ensureUser(db2, resolvedGuildId, userId);
        db2.affiliateInvites[inv.code]                       = userId;
        db2[resolvedGuildId][userId].affiliateInviteUrl  = url;
        db2[resolvedGuildId][userId].affiliateInviteCode = inv.code;
        saveDB(db2);
      } catch (err) {
        console.error("❌ Affiliate invite creation error:", err);
        return interaction.editReply({ content: `❌ Could not create invite. Error: \`${err?.message || err}\`` });
      }
    }
    await interaction.editReply({
      embeds: [baseEmbed("🔗 Your Affiliate Link", 0x5865F2)
        .setDescription(`Your unique referral link:\n\n**${url}**\n\nAnyone who joins using this link and is verified counts as your referral!`)
        .addFields({ name: "Total Referrals", value: `${u.affiliateReferrals || 0}`, inline: true })]
    });
  }

  else if (customId === "aff_earnings") {
    if (!u.affiliateInviteUrl) return interaction.editReply({ content: "❌ Create your affiliate link first!" });
    await interaction.editReply({
      embeds: [baseEmbed("📊 Affiliate Earnings", 0x5865F2).addFields(
        { name: "Referrals",           value: `${u.affiliateReferrals || 0}`,                                    inline: true },
        { name: "Their Total Wagered", value: `${(u.affiliateTotalWagered || 0).toLocaleString()} ${R}`,         inline: true },
        { name: "Pending Earnings",    value: `${(u.affiliateEarnings || 0).toFixed(2)} ${R}`,                   inline: true },
        { name: "Rate",                value: AFF_PCT_DISPLAY,                                                   inline: true },
        { name: "Min Claim",           value: `${AFF_MIN_CLAIM} ${R}`,                                           inline: true }
      )]
    });
  }

  else if (customId === "aff_claim") {
    if (!u.affiliateInviteUrl) return interaction.editReply({ content: "❌ Create your affiliate link first!" });
    const claimable = Math.floor(u.affiliateEarnings || 0);
    if (claimable < AFF_MIN_CLAIM) {
      return interaction.editReply({
        embeds: [baseEmbed("❌ Not Enough", 0xE74C3C)
          .setDescription(`Need at least **${AFF_MIN_CLAIM} ${R}**.\nYou have **${(u.affiliateEarnings || 0).toFixed(2)} ${R}** pending.`)]
      });
    }
    const db2 = loadDB();
    ensureUser(db2, resolvedGuildId, userId);
    db2[resolvedGuildId][userId].affiliateEarnings = (db2[resolvedGuildId][userId].affiliateEarnings || 0) - claimable;
    db2[resolvedGuildId][userId].balance           = (db2[resolvedGuildId][userId].balance || 0) + claimable;
    saveDB(db2);
    await interaction.editReply({
      embeds: [baseEmbed("✅ Claimed!", 0x2ECC71).addFields(
        { name: "Claimed",     value: `+${claimable} ${R}`,                                                    inline: true },
        { name: "New Balance", value: `${db2[resolvedGuildId][userId].balance.toLocaleString()} ${R}`,         inline: true }
      )]
    });
  }
}

async function handleAffiliateMemberJoin(member, client, cachedInvitesBefore, invitesAfter) {
  try {
    const guildId = member.guild.id;
    const userId  = member.user.id;
    if (getAccountAge(userId) < 5) return false;

    const db = loadDB();
    if ((db.leftMembers || []).includes(userId)) return false;

    if (!invitesAfter) invitesAfter = await member.guild.invites.fetch().catch(() => null);
    if (!invitesAfter) return false;

    const affiliateInvites = db.affiliateInvites || {};

    for (const [code, referrerId] of Object.entries(affiliateInvites)) {
      const after  = invitesAfter.get(code);
      const before = cachedInvitesBefore?.get(code);
      const usedNow  = after && before && after.uses > before.uses;
      const newInvite = after && !before;
      if (!usedNow && !newInvite) continue;

      const ownership = getInviteOwnership(code);
      if (ownership && ownership !== "affiliate") continue;

      ensureUser(db, guildId, userId);
      ensureUser(db, guildId, referrerId);
      db[guildId][userId].referredBy = referrerId;
      db[guildId][referrerId].affiliateReferrals = (db[guildId][referrerId].affiliateReferrals || 0) + 1;
      saveDB(db);

      const referrer = await client.users.fetch(referrerId).catch(() => null);
      if (referrer) referrer.send({ embeds: [baseEmbed("🤝 New Referral!", 0x2ECC71)
        .setDescription(`**${member.user.username}** joined via your affiliate link!\n\nYou'll earn **${AFF_PCT_DISPLAY}** of their wagers.`)] }).catch(() => {});
      member.user.send({ embeds: [baseEmbed("👋 Welcome!", 0x5865F2)
        .setDescription("You joined via an affiliate link! Use `/wheel` for a free spin to get started.")] }).catch(() => {});
      return true;
    }
    return false;
  } catch (err) { console.error("Affiliate join error:", err); return false; }
}

function handleMemberLeave(member) {
  const db = loadDB();
  if (!db.leftMembers) db.leftMembers = [];
  if (!db.leftMembers.includes(member.user.id)) {
    db.leftMembers.push(member.user.id);
    saveDB(db);
  }
}

async function cmdSetVerifyRole(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const role = interaction.options.getRole("role");
  setGlobal("verifiedRoleId", role.id);
  await interaction.reply({ content: `✅ Verified role set to **${role.name}**`, flags: MessageFlags.Ephemeral });
}

// ─── PRIZE POOL ───────────────────────────────────────────────────────────────

const PP_REWARD = 20;

function getPrizePool()     { return getGlobal("prizePool") || { active: false, total: 0, remaining: 0, panelMsgId: null, panelChannelId: null }; }
function savePrizePool(p)   { setGlobal("prizePool", p); }

function buildPrizepoolEmbed(pool) {
  const bar = progressBar(pool.remaining, pool.total || 1);
  const pct = pool.total > 0 ? ((pool.remaining / pool.total) * 100).toFixed(1) : "0.0";
  return new EmbedBuilder()
    .setColor(pool.remaining > 0 ? 0xF4C542 : 0x95A5A6)
    .setTitle("🏆 Prize Pool")
    .setDescription(pool.remaining > 0
      ? `Invite friends with your personal link and earn **${PP_REWARD} ${R}** per valid invite!\n\n**Account must be 5+ months old to count.**`
      : "The prize pool is empty. Check back later!")
    .addFields(
      { name: "Progress",   value: `\`${bar}\` ${pct}%`,         inline: false },
      { name: "Remaining",  value: `${pool.remaining} ${R}`,      inline: true  },
      { name: "Total",      value: `${pool.total} ${R}`,          inline: true  },
      { name: "Per Invite", value: `${PP_REWARD} ${R}`,           inline: true  }
    )
    .setTimestamp().setFooter({ text: "🎰 Casino Bot • Prize Pool" });
}

async function updatePrizepoolPanel(client, guild) {
  try {
    const pool = getPrizePool();
    if (!pool.panelMsgId || !pool.panelChannelId) return;
    const ch  = await guild.channels.fetch(pool.panelChannelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(pool.panelMsgId).catch(() => null);
    if (!msg) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("pp_getlink").setLabel("🔗 Get My Link").setStyle(ButtonStyle.Primary).setDisabled(!pool.active),
      new ButtonBuilder().setCustomId("pp_myearnings").setLabel("📊 My Earnings").setStyle(ButtonStyle.Secondary)
    );
    await msg.edit({ embeds: [buildPrizepoolEmbed(pool)], components: [row] }).catch(() => {});
  } catch (err) { console.error("Prizepool panel update error:", err); }
}

async function cmdPrizepoolCreate(interaction, client) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const amount = interaction.options.getInteger("amount");
  const pool   = getPrizePool();
  pool.total     = (pool.total || 0) + amount;
  pool.remaining = (pool.remaining || 0) + amount;
  pool.active    = pool.remaining > 0;
  savePrizePool(pool);
  await updatePrizepoolPanel(client, interaction.guild);
  await interaction.reply({
    embeds: [baseEmbed("✅ Prize Pool Updated", 0x2ECC71).addFields(
      { name: "Added",     value: `+${amount} ${R}`, inline: true },
      { name: "Remaining", value: `${pool.remaining} ${R}`, inline: true }
    )],
    flags: MessageFlags.Ephemeral
  });
}

async function cmdPrizepoolPanel(interaction, client) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const pool = getPrizePool();
  const row  = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pp_getlink").setLabel("🔗 Get My Link").setStyle(ButtonStyle.Primary).setDisabled(!pool.active),
    new ButtonBuilder().setCustomId("pp_myearnings").setLabel("📊 My Earnings").setStyle(ButtonStyle.Secondary)
  );
  await interaction.reply({ content: "✅ Prize pool panel sent!", flags: MessageFlags.Ephemeral });
  const msg = await interaction.channel.send({ embeds: [buildPrizepoolEmbed(pool)], components: [row] });
  pool.panelMsgId     = msg.id;
  pool.panelChannelId = interaction.channelId;
  savePrizePool(pool);
}

async function handlePrizepoolButton(interaction, userId, guildId, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const pool = getPrizePool();

  if (interaction.customId === "pp_getlink") {
    if (!pool.active || pool.remaining <= 0)
      return interaction.editReply({ content: "❌ The prize pool is currently empty!" });

    const db = loadDB();
    ensureUser(db, guildId, userId);

    // Each user gets their own unique link; create it if they don't have one
    let url = db[guildId][userId].prizePoolInviteUrl || null;
    if (!url) {
      try {
        const ch = interaction.channel
          || await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
        if (!ch) return interaction.editReply({ content: "❌ Could not find channel. Please try again." });
        const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `PrizePool:${userId}` });
        url = inv.url;
        const db2 = loadDB();
        if (!db2.prizePoolInvites) db2.prizePoolInvites = {};
        db2.prizePoolInvites[inv.code]          = userId;
        db2[guildId][userId].prizePoolInviteUrl  = url;
        db2[guildId][userId].prizePoolInviteCode = inv.code;
        saveDB(db2);
      } catch (err) {
        console.error("❌ Prizepool invite creation error:", err);
        return interaction.editReply({ content: `❌ Could not create invite. Error: \`${err?.message || err}\`` });
      }
    }

    const u = db[guildId][userId];
    await interaction.editReply({
      embeds: [baseEmbed("🔗 Your Prize Pool Link", 0xF4C542)
        .setDescription(`Share this link to earn **${PP_REWARD} ${R}** per valid invite!\n\n**${url}**`)
        .addFields(
          { name: "Your Invites", value: `${u.prizePoolInvites || 0}`, inline: true },
          { name: "Earned",       value: `${u.prizePoolEarned || 0} ${R}`, inline: true },
          { name: "Pool Left",    value: `${pool.remaining} ${R}`, inline: true }
        )]
    });
  }

  else if (interaction.customId === "pp_myearnings") {
    const db = loadDB();
    const u  = db[guildId]?.[userId] || {};
    await interaction.editReply({
      embeds: [baseEmbed("📊 My Prize Pool Earnings", 0xF4C542).addFields(
        { name: "Invites", value: `${u.prizePoolInvites || 0}`, inline: true },
        { name: "Earned",  value: `${u.prizePoolEarned  || 0} ${R}`, inline: true }
      )]
    });
  }
}

async function handlePrizepoolMemberJoin(member, client, cachedInvitesBefore, invitesAfter) {
  try {
    const guildId = member.guild.id;
    const userId  = member.user.id;

    const db = loadDB();
    if ((db.leftMembers || []).includes(userId)) return false;

    const pool = getPrizePool();
    if (!pool.active || pool.remaining <= 0) return false;

    if (!invitesAfter) invitesAfter = await member.guild.invites.fetch().catch(() => null);
    if (!invitesAfter) return false;

    const ppInvites = db.prizePoolInvites || {};

    for (const [code, referrerId] of Object.entries(ppInvites)) {
      const after  = invitesAfter.get(code);
      const before = cachedInvitesBefore?.get(code);
      if (!(after && before && after.uses > before.uses) && !(after && !before)) continue;

      const ownership = getInviteOwnership(code);
      if (ownership && ownership !== "prizepool") continue;

      ensureUser(db, guildId, userId);
      db[guildId][userId].prizePoolInviteUsed  = true;
      db[guildId][userId].prizePoolReferredBy  = referrerId;
      saveDB(db);
      console.log(`✅ [PrizePool] ${member.user.username} matched prizepool invite from ${referrerId}`);
      return true;
    }
    return false;
  } catch (err) { console.error("Prizepool join error:", err); return false; }
}

// Delete all bot-created invites for a specific event type
async function cleanupInvites(guild, eventType) {
  const db      = loadDB();
  const keyMap  = { affiliate: "affiliateInvites", prizepool: "prizePoolInvites", guesscode: "guessCodeInvites" };
  const key     = keyMap[eventType];
  if (!key || !db[key]) return;

  const guildInvites = await guild.invites.fetch().catch(() => null);
  if (!guildInvites) return;

  for (const code of Object.keys(db[key])) {
    const inv = guildInvites.get(code);
    if (inv) await inv.delete(`Cleanup: ${eventType}`).catch(() => {});
  }

  db[key] = {};
  saveDB(db);
}

// ─── GUESS THE CODE ───────────────────────────────────────────────────────────

const CODE_CHARS     = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_REVEAL_INV = 4;

function generateCode() {
  let c = "";
  for (let i = 0; i < 8; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
function codeDisplay(full, revealed) {
  return full.split("").map((c, i) => revealed.includes(i) ? `**${c}**` : `\\_`).join("  ");
}

function buildCodeEmbed(cd) {
  const color = cd.solvedBy ? 0x2ECC71 : cd.active ? 0xF4C542 : 0x95A5A6;
  const title = cd.solvedBy ? "🔓 Code Solved!" : "🔐 Guess the Code";
  let desc    = `\`${codeDisplay(cd.fullCode, cd.revealed)}\`\n\n`;

  if (cd.solvedBy) {
    desc += `**<@${cd.solvedBy}>** cracked the code!\n\nFull code: **\`${cd.fullCode}\`**`;
  } else {
    desc +=
      `Guess the 8-character code to win **${cd.prize} ${R}**!\n\n` +
      `📨 Get your personal invite link via the button below.\n` +
      `Each valid invite reveals **1 more character** (max ${MAX_REVEAL_INV} extra).\n\n` +
      `Use \`/guess\` to submit your answer.`;
  }
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc)
    .addFields(
      { name: "Revealed", value: `${cd.revealed.length} / 8`, inline: true },
      { name: "Prize",    value: `${cd.prize} ${R}`,           inline: true },
      { name: "Invites",  value: `${cd.inviteCount}`,          inline: true }
    )
    .setTimestamp().setFooter({ text: "🎰 Casino Bot • Guess the Code" });
}

function buildCodeRow(active) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("code_getlink").setLabel("🔗 Get My Link").setStyle(ButtonStyle.Primary).setDisabled(!active),
    new ButtonBuilder().setCustomId("code_howto").setLabel("❓ How to Play").setStyle(ButtonStyle.Secondary)
  );
}

async function updateCodePanel(client, guild) {
  try {
    const cd = getGlobal("guessCode");
    if (!cd?.panelMsgId) return;
    const ch  = await guild.channels.fetch(cd.panelChannelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(cd.panelMsgId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [buildCodeEmbed(cd)], components: [buildCodeRow(cd.active)] }).catch(() => {});
  } catch (err) { console.error("Code panel update error:", err); }
}

async function cmdCreateCode(interaction, client) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });

  const existing = getGlobal("guessCode");
  if (existing?.active) return interaction.reply({ content: "❌ A code is already active! Use `/admin endcode` first.", flags: MessageFlags.Ephemeral });

  const prize    = interaction.options.getInteger("prize");
  const fullCode = generateCode();
  const positions = Array.from({ length: 8 }, (_, i) => i).sort(() => Math.random() - 0.5);
  const revealed  = positions.slice(0, 2).sort((a, b) => a - b);

  // Clear old guessCode invites from DB
  const db = loadDB();
  db.guessCodeInvites = {};
  saveDB(db);

  const cd = {
    active: true, fullCode, revealed, prize,
    inviteCount: 0,
    solvedBy: null, solvedAt: null,
    panelMsgId: null, panelChannelId: null,
  };
  setGlobal("guessCode", cd);

  const embed  = buildCodeEmbed(cd);
  const row    = buildCodeRow(true);
  const msg    = await interaction.channel.send({ embeds: [embed], components: [row] });
  cd.panelMsgId     = msg.id;
  cd.panelChannelId = interaction.channelId;
  setGlobal("guessCode", cd);

  await interaction.reply({ content: `✅ Code created! Prize: **${prize} ${R}**`, flags: MessageFlags.Ephemeral });
}

async function handleCodeButton(interaction, userId, guildId, client) {
  const { customId } = interaction;

  if (customId === "code_howto") {
    return interaction.reply({
      embeds: [baseEmbed("❓ How to Play", 0x5865F2)
        .setDescription(
          "1️⃣ Click **Get My Link** to get your personal invite link.\n" +
          "2️⃣ Share it — each valid join (5+ month account) reveals 1 more character (max 4 extra).\n" +
          "3️⃣ Use `/guess` to submit your guess anytime.\n" +
          "4️⃣ First correct guess wins the prize!\n\n" +
          "🔠 The code is 8 characters (A-Z, 2-9)."
        )],
      flags: MessageFlags.Ephemeral
    });
  }

  if (customId === "code_getlink") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cd = getGlobal("guessCode");
    if (!cd?.active) return interaction.editReply({ content: "❌ No active code event." });

    const db = loadDB();
    ensureUser(db, guildId, userId);

    // Each user gets their own unique invite link
    let url = db[guildId][userId].guessCodeInviteUrl || null;
    if (!url) {
      try {
        const ch = interaction.channel
          || await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
        if (!ch) return interaction.editReply({ content: "❌ Could not find channel. Please try again." });
        const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `GuessCode:${userId}` });
        url = inv.url;
        const db2 = loadDB();
        if (!db2.guessCodeInvites) db2.guessCodeInvites = {};
        db2.guessCodeInvites[inv.code]           = userId;
        db2[guildId][userId].guessCodeInviteUrl   = url;
        db2[guildId][userId].guessCodeInviteCode  = inv.code;
        saveDB(db2);
      } catch (err) {
        console.error("❌ GuessCode invite creation error:", err);
        return interaction.editReply({ content: `❌ Could not create invite. Error: \`${err?.message || err}\`` });
      }
    }

    await interaction.editReply({
      embeds: [baseEmbed("🔗 Your Guess the Code Link", 0xF4C542)
        .setDescription(`Share this link — each valid join reveals 1 more character!\n\n**${url}**\n\nUse \`/guess\` once you think you know the code!`)]
    });
  }
}

async function cmdGuess(interaction, userId, guildId) {
  const guess = interaction.options.getString("code").toUpperCase().trim();
  const cd    = getGlobal("guessCode");

  if (!cd?.active) return interaction.reply({ embeds: [baseEmbed("❌ No Active Code", 0xE74C3C).setDescription("No active code event right now!")], flags: MessageFlags.Ephemeral });
  if (guess.length !== 8) return interaction.reply({ embeds: [baseEmbed("❌ Invalid", 0xE74C3C).setDescription("The code must be exactly 8 characters.")], flags: MessageFlags.Ephemeral });

  if (guess === cd.fullCode) {
    cd.active   = false;
    cd.solvedBy = userId;
    cd.solvedAt = Date.now();
    cd.revealed = Array.from({ length: 8 }, (_, i) => i);
    setGlobal("guessCode", cd);

    addBalance(guildId, userId, cd.prize);
    await updateCodePanel(interaction.client, interaction.guild);

    // Cleanup all guess code invites
    await cleanupInvites(interaction.guild, "guesscode").catch(() => {});
    // Also clear per-user guessCodeInviteUrl/Code for this session
    const db = loadDB();
    if (db[guildId]) {
      for (const uid of Object.keys(db[guildId])) {
        delete db[guildId][uid].guessCodeInviteUrl;
        delete db[guildId][uid].guessCodeInviteCode;
      }
      saveDB(db);
    }

    await interaction.reply({
      embeds: [baseEmbed("🎉 Correct! You Won!", 0x2ECC71)
        .setDescription(`You cracked \`${cd.fullCode}\`!\n\n**+${cd.prize} ${R}** added to your balance!`)
        .addFields({ name: "Balance", value: `${(loadDB()[guildId]?.[userId]?.balance || 0).toLocaleString()} ${R}`, inline: true })]
    });
  } else {
    await interaction.reply({
      embeds: [baseEmbed("❌ Wrong", 0xE74C3C)
        .setDescription(`**\`${guess}\`** is incorrect.\n\nCurrent hint: \`${codeDisplay(cd.fullCode, cd.revealed)}\``)],
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleCodeMemberJoin(member, client, cachedInvitesBefore, invitesAfter) {
  try {
    const cd = getGlobal("guessCode");
    if (!cd?.active) return false;

    const userId  = member.user.id;
    const guildId = member.guild.id;

    const db = loadDB();
    if ((db.leftMembers || []).includes(userId)) return false;

    if (!invitesAfter) invitesAfter = await member.guild.invites.fetch().catch(() => null);
    if (!invitesAfter) return false;

    const codeInvites = db.guessCodeInvites || {};

    for (const [code] of Object.entries(codeInvites)) {
      const after  = invitesAfter.get(code);
      const before = cachedInvitesBefore?.get(code);
      if (!(after && before && after.uses > before.uses) && !(after && !before)) continue;

      const ownership = getInviteOwnership(code);
      if (ownership && ownership !== "guesscode") continue;

      cd.inviteCount++;
      if (cd.revealed.length < 2 + MAX_REVEAL_INV) {
        const hidden = Array.from({ length: 8 }, (_, i) => i).filter(i => !cd.revealed.includes(i));
        if (hidden.length > 0) {
          cd.revealed.push(hidden[Math.floor(Math.random() * hidden.length)]);
          cd.revealed.sort((a, b) => a - b);
        }
      }
      const db2 = loadDB();
      ensureUser(db2, guildId, userId);
      const inviterId = db.guessCodeInvites?.[code];
      if (inviterId) db2[guildId][userId].guessCodeReferredBy = inviterId;
      saveDB(db2);
      setGlobal("guessCode", cd);
      await updateCodePanel(client, member.guild);
      console.log(`✅ [GuessCode] ${member.user.username} matched guesscode invite from ${inviterId}`);
      return true;
    }
    return false;
  } catch (err) { console.error("Code join error:", err); return false; }
}

async function cmdEndCode(interaction, client) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const cd = getGlobal("guessCode");
  if (!cd?.active) return interaction.reply({ content: "❌ No active code.", flags: MessageFlags.Ephemeral });
  cd.active   = false;
  cd.revealed = Array.from({ length: 8 }, (_, i) => i);
  setGlobal("guessCode", cd);
  await updateCodePanel(client, interaction.guild);
  await cleanupInvites(interaction.guild, "guesscode").catch(() => {});
  // Clear per-user guess code invite urls
  const db = loadDB();
  if (db[interaction.guild.id]) {
    for (const uid of Object.keys(db[interaction.guild.id])) {
      delete db[interaction.guild.id][uid].guessCodeInviteUrl;
      delete db[interaction.guild.id][uid].guessCodeInviteCode;
    }
    saveDB(db);
  }
  await interaction.reply({ content: `✅ Code ended. Full code: \`${cd.fullCode}\``, flags: MessageFlags.Ephemeral });
}

// ─── PRIZEPOOL RESET ──────────────────────────────────────────────────────────

async function cmdPrizepoolReset(interaction, client) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });

  // Delete all prizepool invites from Discord
  await cleanupInvites(interaction.guild, "prizepool").catch(() => {});

  // Clear prizePoolInvites and per-user prizepool data from DB
  const db = loadDB();
  db.prizePoolInvites = {};
  const guildId = interaction.guild.id;
  if (db[guildId]) {
    for (const uid of Object.keys(db[guildId])) {
      if (typeof db[guildId][uid] === "object") {
        delete db[guildId][uid].prizePoolInviteUrl;
        delete db[guildId][uid].prizePoolInviteCode;
        delete db[guildId][uid].prizePoolEarned;
        delete db[guildId][uid].prizePoolInvites;
      }
    }
  }

  // Reset the pool itself
  const pool = { active: false, total: 0, remaining: 0, panelMsgId: db.prizePool?.panelMsgId || null, panelChannelId: db.prizePool?.panelChannelId || null };
  db.prizePool = pool;
  saveDB(db);

  // Update the panel embed
  await updatePrizepoolPanel(client, interaction.guild);

  await interaction.reply({
    embeds: [baseEmbed("✅ Prize Pool Reset", 0x2ECC71)
      .setDescription("Prize pool has been reset to 0. All invite links deleted. User earnings cleared.")],
    flags: MessageFlags.Ephemeral
  });
}

// ─── WAGER ROLES ──────────────────────────────────────────────────────────────

const WAGER_ROLE_MILESTONES = [1000, 5000, 10000, 25000, 50000, 75000, 100000];

async function cmdSetWagerRole(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });

  const milestone = interaction.options.getInteger("milestone");
  const role      = interaction.options.getRole("role");

  if (!WAGER_ROLE_MILESTONES.includes(milestone)) {
    return interaction.reply({
      content: `❌ Invalid milestone. Choose from: ${WAGER_ROLE_MILESTONES.map(m => m.toLocaleString()).join(", ")}`,
      flags: MessageFlags.Ephemeral
    });
  }

  const db = loadDB();
  if (!db.wagerRoles) db.wagerRoles = {};
  db.wagerRoles[String(milestone)] = role.id;
  saveDB(db);

  await interaction.reply({
    embeds: [baseEmbed("✅ Wager Role Set", 0x2ECC71)
      .setDescription(`Users who reach **${milestone.toLocaleString()} ${R}** wagered will receive **${role.name}**.`)
      .addFields({ name: "Current Wager Roles", value: buildWagerRolesDisplay(db.wagerRoles, interaction.guild) })],
    flags: MessageFlags.Ephemeral
  });
}

function buildWagerRolesDisplay(wagerRoles, guild) {
  if (!wagerRoles || !Object.keys(wagerRoles).length) return "_None set yet_";
  return WAGER_ROLE_MILESTONES
    .filter(m => wagerRoles[String(m)])
    .map(m => {
      const roleId = wagerRoles[String(m)];
      return `**${m.toLocaleString()}** wagered → <@&${roleId}>`;
    })
    .join("\n") || "_None set_";
}

async function cmdViewWagerRoles(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const db = loadDB();
  await interaction.reply({
    embeds: [baseEmbed("🏷️ Wager Roles", 0x5865F2)
      .setDescription("Roles automatically assigned when users hit wager milestones.")
      .addFields({ name: "Current Setup", value: buildWagerRolesDisplay(db.wagerRoles || {}, interaction.guild) })],
    flags: MessageFlags.Ephemeral
  });
}

// ─── VERIFY PANEL ─────────────────────────────────────────────────────────────

async function cmdVerifyPanel(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });

  const roleId = getGlobal("verifiedRoleId");
  if (!roleId) return interaction.reply({ content: "❌ Set a verify role first with `/admin setrole`.", flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle("✅ Verify Yourself")
    .setDescription(
      "Welcome! Click the button below to verify your account and gain access to the server.\n\n" +
      "⚠️ **Requirements:**\n" +
      "• Your Discord account must be **5+ months old**\n" +
      "• You must not be a previously banned or rejoining member\n\n" +
      "Click **Verify** to get started!"
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • Verification" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_click")
      .setLabel("✅ Verify")
      .setStyle(ButtonStyle.Success)
  );

  await interaction.reply({ content: "✅ Verify panel sent!", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ embeds: [embed], components: [row] });
}

async function handleVerifyButton(interaction, userId, guildId, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const db = loadDB();

  // Rejoin check
  const leftMembers = db.leftMembers || [];
  if (leftMembers.includes(userId)) {
    return interaction.editReply({
      embeds: [baseEmbed("❌ Cannot Verify", 0xE74C3C)
        .setDescription("You appear to be a returning member. Please contact an admin for manual verification.")]
    });
  }

  // Account age check (5+ months)
  const ageMths = getAccountAge(userId);
  if (ageMths < 5) {
    const createdAt = new Date(Number((BigInt(userId) >> 22n) + 1420070400000n));
    const needed    = new Date(createdAt.getTime() + 5 * 30 * 24 * 60 * 60 * 1000);
    return interaction.editReply({
      embeds: [baseEmbed("❌ Account Too New", 0xE74C3C)
        .setDescription(
          `Your Discord account is only **${ageMths.toFixed(1)} months** old.\n\n` +
          `You need an account that is at least **5 months old** to verify.\n\n` +
          `Try again after <t:${Math.floor(needed.getTime() / 1000)}:D>.`
        )]
    });
  }

  // Get the verified role
  const roleId = getGlobal("verifiedRoleId");
  if (!roleId) {
    return interaction.editReply({ content: "❌ No verify role configured. Contact an admin." });
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return interaction.editReply({ content: "❌ Could not find your member data." });

  // Check if already verified
  if (member.roles.cache.has(roleId)) {
    return interaction.editReply({
      embeds: [baseEmbed("✅ Already Verified", 0x2ECC71)
        .setDescription("You are already verified!")]
    });
  }

  // Assign role
  try {
    await member.roles.add(roleId, "Self-verified via bot");
  } catch (err) {
    console.error("❌ Role assignment error:", err);
    return interaction.editReply({ content: `❌ Failed to assign role. Error: \`${err?.message || err}\`` });
  }

  // ── Determine invite source and send appropriate invite link ──
  ensureUser(db, guildId, userId);
  const u = db[guildId][userId];
  let inviteSourceMsg = "";
  let inviteForUser   = null; // the invite URL to send back to the newly verified user

  // 1. Affiliate referral
  if (u.referredBy) {
    const referrer = await client.users.fetch(u.referredBy).catch(() => null);
    inviteSourceMsg = referrer
      ? `\n\n🤝 You joined via **${referrer.username}'s** affiliate link.`
      : "\n\n🤝 You joined via an affiliate link.";

    // Give the new user their own affiliate link to share
    try {
      const inv = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Affiliate:${userId}` });
      const db2 = loadDB();
      if (!db2.affiliateInvites) db2.affiliateInvites = {};
      db2.affiliateInvites[inv.code]         = userId;
      db2[guildId][userId].affiliateInviteUrl  = inv.url;
      db2[guildId][userId].affiliateInviteCode = inv.code;
      saveDB(db2);
      inviteForUser = inv.url;
    } catch { /* invite creation failed — not critical */ }
  }

  // 2. Prize pool referral — credit the inviter NOW (on verify, not on join)
  else if (u.prizePoolInviteUsed) {
    const ppReferrerId = u.prizePoolReferredBy || null;
    const ref = ppReferrerId ? await client.users.fetch(ppReferrerId).catch(() => null) : null;
    inviteSourceMsg = ref
      ? `\n\n🏆 You joined via **${ref.username}'s** prize pool link.`
      : "\n\n🏆 You joined via a prize pool link.";

    // Credit the referrer now that the user is verified
    if (ppReferrerId) {
      const pool = getPrizePool();
      if (pool.active && pool.remaining > 0) {
        const db3 = loadDB();
        ensureUser(db3, guildId, ppReferrerId);
        const reward    = Math.min(PP_REWARD, pool.remaining);
        pool.remaining -= reward;
        pool.active     = pool.remaining > 0;
        db3[guildId][ppReferrerId].balance         = (db3[guildId][ppReferrerId].balance || 0) + reward;
        db3[guildId][ppReferrerId].prizePoolEarned  = (db3[guildId][ppReferrerId].prizePoolEarned || 0) + reward;
        db3[guildId][ppReferrerId].prizePoolInvites = (db3[guildId][ppReferrerId].prizePoolInvites || 0) + 1;
        setGlobal("prizePool", pool);
        saveDB(db3);

        // Update the panel
        await updatePrizepoolPanel(client, interaction.guild);

        // If pool empty, clean up invites
        if (pool.remaining <= 0) await cleanupInvites(interaction.guild, "prizepool").catch(() => {});

        // DM the referrer
        if (ref) ref.send({ embeds: [baseEmbed("🏆 Prize Pool Reward!", 0xF4C542)
          .setDescription(`**${interaction.user.username}** joined via your prize pool link and just verified!\n\n**+${reward} ${R}** added to your balance!`)] }).catch(() => {});
      }
    }

    // Give the new verified user their own prize pool invite link
    const pool2 = getPrizePool();
    if (pool2.active && pool2.remaining > 0) {
      try {
        const ch = interaction.channel || await client.channels.fetch(interaction.channelId).catch(() => null);
        if (ch) {
          const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `PrizePool:${userId}` });
          const db2 = loadDB();
          if (!db2.prizePoolInvites) db2.prizePoolInvites = {};
          ensureUser(db2, guildId, userId);
          db2.prizePoolInvites[inv.code]           = userId;
          db2[guildId][userId].prizePoolInviteUrl   = inv.url;
          db2[guildId][userId].prizePoolInviteCode  = inv.code;
          saveDB(db2);
          inviteForUser = inv.url;
        }
      } catch { /* not critical */ }
    }
  }

  // 3. Guess-the-code referral
  else if (u.guessCodeReferredBy) {
    const ref = await client.users.fetch(u.guessCodeReferredBy).catch(() => null);
    inviteSourceMsg = ref
      ? `\n\n🔐 You joined via **${ref.username}'s** guess-the-code link.`
      : "\n\n🔐 You joined via a guess-the-code link.";

    // Give the new user their own guess-the-code invite link
    const cd = getGlobal("guessCode");
    if (cd?.active) {
      try {
        const inv = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `GuessCode:${userId}` });
        const db2 = loadDB();
        if (!db2.guessCodeInvites) db2.guessCodeInvites = {};
        db2.guessCodeInvites[inv.code]           = userId;
        db2[guildId][userId].guessCodeInviteUrl   = inv.url;
        db2[guildId][userId].guessCodeInviteCode  = inv.code;
        saveDB(db2);
        inviteForUser = inv.url;
      } catch { /* not critical */ }
    }
  }

  saveDB(db);

  await interaction.editReply({
    embeds: [baseEmbed("✅ Verified!", 0x2ECC71)
      .setDescription(
        `You have been successfully verified and granted access to the server!${inviteSourceMsg}\n\n` +
        `Use \`/wheel\` for a free spin or ask an admin to deposit coins to get started! 🎰` +
        (inviteForUser ? `\n\n🔗 **Your personal invite link:**\n${inviteForUser}\nShare it to earn rewards!` : "")
      )]
  });
}

// ─── USER HELP ────────────────────────────────────────────────────────────────

async function cmdHelp(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0xF4C542)
    .setTitle("🎰 Casino Bot — Commands")
    .addFields(
      {
        name: "💰 Economy",
        value:
          "`/balance [@user]` — Check your or someone's balance\n" +
          "`/profile [@user]` — View gambling stats & W/L breakdown\n" +
          "`/leaderboard` — Top 10 players by total wagered\n" +
          "`/tip @user <amount>` — Send coins to another player\n" +
          "`/rain <amount> <seconds>` — Split coins among reactors (🎉)",
        inline: false,
      },
      {
        name: "🎮 Games",
        value:
          "`/slots <bet>` — 3 reels, match for prizes (×2 to ×20)\n" +
          "`/coinflip <bet> <heads|tails>` — 50/50, double or nothing\n" +
          "`/roulette <bet> <type>` — red/black/green/even/odd/0–36\n" +
          "`/blackjack <bet>` — Beat the dealer, BJ pays ×2.5\n" +
          "`/crash <bet>` — Cash out before the multiplier crashes\n" +
          "`/mines <bet> <mines>` — Avoid mines, cash out anytime\n" +
          "`/towers <bet> [easy|medium|hard]` — Climb 8 floors\n" +
          "`/keno <bet> <picks>` — Pick 2–10 numbers (1–80)\n" +
          "`/limbo <bet> <target>` — Hit your target multiplier",
        inline: false,
      },
      {
        name: "🎁 Rewards",
        value:
          "`/rakeback` — Claim % back on all bets (unlocks at 1000 wagered)\n" +
          "`/wheel` — Free spin every 24h. Win Robux or bonus items\n" +
          "　Bonus items auto-apply to your next game automatically",
        inline: false,
      },
      {
        name: "🎟️ Events & Other",
        value:
          "`/promo <code>` — Redeem a promo code for free coins\n" +
          "`/affiliate` — Earn 0.5% of your referrals' bets forever\n" +
          "`/prizepool` — Invite friends to earn from the prize pool\n" +
          "`/guess <code>` — Crack the 8-char code to win the prize\n" +
          "`/withdraw <amount> <asset_id>` — Cash out to real Robux\n" +
          "`/withdrawpanel` — How to withdraw guide\n" +
          "`/unfreeze` — Clear a frozen game (no refund)",
        inline: false,
      },
      {
        name: "ℹ️ Notes",
        value:
          "• 10% house fee shown on every win\n" +
          "• 5s cooldown between games\n" +
          "• Account must be 5+ months old to verify & use invite systems",
        inline: false,
      }
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • Good luck!" });

  await interaction.reply({ embeds: [embed] });
}

// ─── ADMIN HELP ───────────────────────────────────────────────────────────────

async function cmdAdminHelp(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xE74C3C).setTitle("🛡️ Admin Commands")
      .setDescription("Only visible to the server owner.")
      .addFields(
        { name: "💰 Economy",      value: "`/admin give`  `/admin take`\n`/deposit @user amount` — credit a manual deposit (applies active deposit bonus)\n`/givespins @user amount` — manually give wheel spins" },
        { name: "🎟️ Promo",        value: "`/admin createpromo code amount uses expires`" },
        { name: "🤝 Affiliate",    value: "`/admin affiliatepanel`  `/admin setrole role`" },
        { name: "🏆 Prize Pool",   value: "`/admin prizepoolcreate amount`\n`/admin prizepoolpanel`\n`/admin prizepoolreset`" },
        { name: "🔐 Guess Code",   value: "`/admin createcode prize`  `/admin endcode`" },
        { name: "✅ Verify",       value: "`/admin verifypanel`  `/admin setrole role`" },
        { name: "🏷️ Wager Roles",  value: "`/admin wagerrole milestone role`\n`/admin viewwagerroles`" },
        { name: "💸 Withdrawals",  value: "`/admin setwithdrawchannel channel`\n`/admin setwithdrawmin amount`\n`/withdrawpanel` (user-facing info panel)" }
      )
      .setTimestamp().setFooter({ text: "🎰 Casino Bot • Admin" })],
    flags: MessageFlags.Ephemeral
  });
}

// ─── INVITE TRACKING COMMANDS ─────────────────────────────────────────────────

async function cmdInvited(interaction, userId, guildId, targetUser) {
  const uid  = targetUser ? targetUser.id : userId;
  const name = targetUser ? targetUser.username : interaction.user.username;
  const db   = loadDB();
  const guildData = db[guildId] || {};

  // Find all users referred by this person across all systems
  const referred = [];
  for (const [uid2, udata] of Object.entries(guildData)) {
    if (typeof udata !== "object") continue;
    const systems = [];
    if (udata.referredBy          === uid) systems.push("Affiliate");
    if (udata.prizePoolReferredBy === uid) systems.push("Prize Pool");
    if (udata.guessCodeReferredBy === uid) systems.push("Guess Code");
    if (systems.length > 0) referred.push({ uid: uid2, systems });
  }

  const u = guildData[uid] || {};
  const affReferrals = u.affiliateReferrals || 0;
  const ppInvites    = u.prizePoolInvites   || 0;
  const extraSpins   = u.wheelExtraSpins    || 0;

  const lines = referred.length > 0
    ? referred.map(r => `<@${r.uid}> — *${r.systems.join(", ")}*`).join("\n")
    : "_No recorded referrals yet_";

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📨 ${name}'s Invites`)
    .addFields(
      { name: "🤝 Affiliate Referrals", value: `${affReferrals}`, inline: true },
      { name: "🏆 Prize Pool Invites",  value: `${ppInvites}`,    inline: true },
      { name: "🎡 Wheel Bonus Spins",   value: `${extraSpins}`,   inline: true },
      { name: `👥 People Referred (${referred.length})`, value: lines.slice(0, 1024), inline: false }
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • Invite Tracker" });

  await interaction.reply({ embeds: [embed] });
}

async function cmdInviter(interaction, userId, guildId, targetUser) {
  const uid  = targetUser ? targetUser.id : userId;
  const name = targetUser ? targetUser.username : interaction.user.username;
  const db   = loadDB();
  const u    = db[guildId]?.[uid] || {};

  const affRef  = u.referredBy          || null;
  const ppRef   = u.prizePoolReferredBy || null;
  const codeRef = u.guessCodeReferredBy || null;

  if (!affRef && !ppRef && !codeRef) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle(`🔍 ${name}'s Inviter`)
        .setDescription("No inviter found — this user didn't join via any tracked invite link.")
        .setTimestamp()
        .setFooter({ text: "🎰 Casino Bot • Invite Tracker" })]
    });
  }

  const fields = [];
  if (affRef)  fields.push({ name: "🤝 Affiliate Inviter",  value: `<@${affRef}>`,  inline: true });
  if (ppRef)   fields.push({ name: "🏆 Prize Pool Inviter", value: `<@${ppRef}>`,   inline: true });
  if (codeRef) fields.push({ name: "🔐 Guess Code Inviter", value: `<@${codeRef}>`, inline: true });

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🔍 ${name}'s Inviter`)
    .addFields(...fields)
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • Invite Tracker" });

  await interaction.reply({ embeds: [embed] });
}

// ─── DEPOSIT (admin/owner) ────────────────────────────────────────────────────

async function cmdDeposit(interaction, guildId, targetUser, amount, client) {
  // Owner OR Administrator permission
  const hasAdmin = interaction.member?.permissions?.has?.("Administrator");
  if (!isOwner(interaction) && !hasAdmin) {
    return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  }
  if (!targetUser || !amount || amount < 1) {
    return interaction.reply({ content: "❌ Usage: `/deposit @user amount`", flags: MessageFlags.Ephemeral });
  }

  const db = loadDB();
  ensureUser(db, guildId, targetUser.id);
  const u = db[guildId][targetUser.id];

  // Check for active deposit bonus
  const bonus    = u.activeBonus || null;
  let finalAmount = amount;
  let bonusMsg    = "";
  let bonusLine   = "";

  if (bonus === "deposit10") {
    const extra = Math.floor(amount * 0.10);
    finalAmount  = amount + extra;
    bonusMsg     = `\n📈 *Deposit Boost +10% applied! (+${extra.toLocaleString()} ${R})*`;
    bonusLine    = `+10% Deposit Boost active — +${extra.toLocaleString()} ${R} bonus!`;
    delete db[guildId][targetUser.id].activeBonus;
  } else if (bonus === "deposit25") {
    const extra = Math.floor(amount * 0.25);
    finalAmount  = amount + extra;
    bonusMsg     = `\n🚀 *Deposit Boost +25% applied! (+${extra.toLocaleString()} ${R})*`;
    bonusLine    = `+25% Deposit Boost active — +${extra.toLocaleString()} ${R} bonus!`;
    delete db[guildId][targetUser.id].activeBonus;
  }

  db[guildId][targetUser.id].balance = (u.balance || 0) + finalAmount;
  saveDB(db);

  const newBal = db[guildId][targetUser.id].balance;

  // ── DM the user ──
  try {
    const discordUser = await client.users.fetch(targetUser.id);
    const dmEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle("💰 Deposit Received!")
      .setDescription(
        `Your deposit has been credited to your account!${bonusMsg}`
      )
      .addFields(
        { name: "💵 Deposited",   value: `${amount.toLocaleString()} ${R}`,      inline: true },
        { name: "✅ Credited",    value: `+${finalAmount.toLocaleString()} ${R}`, inline: true },
        { name: "💰 New Balance", value: `${newBal.toLocaleString()} ${R}`,       inline: true },
        ...(bonusLine ? [{ name: "🎁 Bonus Applied", value: bonusLine, inline: false }] : [])
      )
      .setTimestamp()
      .setFooter({ text: "🎰 Casino Bot • Deposits" });
    await discordUser.send({ embeds: [dmEmbed] }).catch(() => {});
  } catch { /* DMs closed — not critical */ }

  // ── Reply to admin ──
  await interaction.reply({
    embeds: [baseEmbed("✅ Deposit Credited", 0x2ECC71)
      .addFields(
        { name: "User",        value: `<@${targetUser.id}>`,                inline: true },
        { name: "Deposited",   value: `${amount.toLocaleString()} ${R}`,    inline: true },
        { name: "Credited",    value: `+${finalAmount.toLocaleString()} ${R}`, inline: true },
        { name: "New Balance", value: `${newBal.toLocaleString()} ${R}`,    inline: true },
        ...(bonusLine ? [{ name: "Bonus", value: bonusLine, inline: false }] : [])
      )],
    flags: MessageFlags.Ephemeral
  });
}



const WITHDRAW_TAX         = 0.30;
const WITHDRAW_MIN_DEFAULT = 10;
const WITHDRAW_COOLDOWN    = 24 * 60 * 60 * 1000;

function getWithdrawMin()     { return getGlobal("withdrawMin") ?? WITHDRAW_MIN_DEFAULT; }
function getWithdrawChannel() { return getGlobal("withdrawChannelId") ?? null; }

function genTxId() {
  return `WD-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

// ── /withdraw panel ──────────────────────────────────────────────────────────

async function cmdWithdrawPanel(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setColor(0xF4C542)
    .setTitle("💸 How to Withdraw Your Robux")
    .setDescription(
      "Want to convert your in-bot Robux balance into **real Robux**? Here's how:\n\n" +
      "**Step 1 — Get your Asset ID**\n" +
      "You need to have a **Gamepass** on Roblox that we can purchase to send you Robux.\n" +
      "> 1. Go to [roblox.com](https://www.roblox.com) and open **Create → Experiences**\n" +
      "> 2. Open any of your games (or create a free one)\n" +
      "> 3. Go to **Passes** and create a new Gamepass\n" +
      "> 4. Set the **price** to exactly the amount you want to receive *(after 30% tax)*\n" +
      "> 5. Copy the **Asset ID** from the gamepass URL — it looks like: `https://www.roblox.com/game-pass/**12345678**/name`\n\n" +
      "**Step 2 — Submit your withdrawal**\n" +
      "> Use the command: `/withdraw amount: <amount> asset_id: <your gamepass ID>`\n" +
      "> Example: `/withdraw amount:100 asset_id:12345678`\n\n" +
      "**Step 3 — Confirm in DMs**\n" +
      "> The bot will DM you a summary showing how much you'll receive after the **30% Roblox tax**.\n" +
      "> Confirm or cancel from there.\n\n" +
      "**Step 4 — Wait for processing**\n" +
      "> Once confirmed, an admin will purchase your gamepass within **6–8 hours**.\n" +
      "> Roblox then processes the payment within **5–7 days**.\n\n" +
      "⚠️ **Important Notes:**\n" +
      `• Minimum withdrawal: **${getWithdrawMin()} ${R}**\n` +
      "• Roblox takes **30% tax** — you receive 70% of your withdrawal amount\n" +
      "• Make sure your gamepass is **public** and priced correctly before withdrawing\n" +
      "• You can cancel your withdrawal anytime before an admin processes it\n" +
      "• Only **one pending withdrawal** at a time per user"
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

  await interaction.reply({ content: "✅ Withdrawal panel sent!", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ embeds: [embed] });
}

// ── /admin setwithdrawchannel ─────────────────────────────────────────────────

async function cmdSetWithdrawChannel(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const channel = interaction.options.getChannel("channel");
  setGlobal("withdrawChannelId", channel.id);
  await interaction.reply({ content: `✅ Withdrawal admin channel set to <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
}

// ── /admin setwithdrawmin ─────────────────────────────────────────────────────

async function cmdSetWithdrawMin(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
  const min = interaction.options.getInteger("amount");
  setGlobal("withdrawMin", min);
  await interaction.reply({ content: `✅ Minimum withdrawal set to **${min} ${R}**.`, flags: MessageFlags.Ephemeral });
}

// ── /withdraw (user command) ──────────────────────────────────────────────────

async function cmdWithdraw(interaction, userId, guildId, client) {
  const amount  = interaction.options.getInteger("amount");
  const assetId = interaction.options.getString("asset_id").trim();
  const min     = getWithdrawMin();

  // Must have a withdraw channel set
  const withdrawChannelId = getWithdrawChannel();
  if (!withdrawChannelId) {
    return interaction.reply({
      embeds: [baseEmbed("❌ Withdrawals Unavailable", 0xE74C3C)
        .setDescription("Withdrawals are not set up yet. Please contact an admin.")],
      flags: MessageFlags.Ephemeral
    });
  }

  // Amount validation
  if (amount < min) {
    return interaction.reply({
      embeds: [baseEmbed("❌ Below Minimum", 0xE74C3C)
        .setDescription(`Minimum withdrawal is **${min} ${R}**. You tried to withdraw **${amount} ${R}**.`)],
      flags: MessageFlags.Ephemeral
    });
  }

  const db = loadDB();
  ensureUser(db, guildId, userId);
  const u = db[guildId][userId];

  // Balance check
  if ((u.balance || 0) < amount) {
    return interaction.reply({
      embeds: [baseEmbed("❌ Insufficient Balance", 0xE74C3C)
        .setDescription(`You need **${amount.toLocaleString()} ${R}** but only have **${(u.balance || 0).toLocaleString()} ${R}**.`)],
      flags: MessageFlags.Ephemeral
    });
  }

  // One pending at a time
  if (u.pendingWithdrawal) {
    return interaction.reply({
      embeds: [baseEmbed("❌ Already Pending", 0xE74C3C)
        .setDescription(`You already have a pending withdrawal of **${u.pendingWithdrawal.amount} ${R}**.\nCancel it or wait for an admin to process it first.`)],
      flags: MessageFlags.Ephemeral
    });
  }

  // 24h cooldown
  const lastWithdraw = u.lastWithdraw || 0;
  const cdRemaining  = WITHDRAW_COOLDOWN - (Date.now() - lastWithdraw);
  if (cdRemaining > 0 && lastWithdraw > 0) {
    const hrs  = Math.floor(cdRemaining / 3600000);
    const mins = Math.floor((cdRemaining % 3600000) / 60000);
    return interaction.reply({
      embeds: [baseEmbed("⏳ Cooldown", 0xE74C3C)
        .setDescription(`You can withdraw again in **${hrs}h ${mins}m**.`)],
      flags: MessageFlags.Ephemeral
    });
  }

  // Wager requirement (same as tip: must have wagered 50% of received coins)
  const totalReceived  = (u.totalDailyClaimed || 0) + (u.tipsReceived || 0);
  const totalWagered   = u.totalWagered || 0;
  const required       = Math.floor(totalReceived * 0.5);
  const remaining      = Math.max(0, required - totalWagered);
  if (remaining > 0) {
    return interaction.reply({
      embeds: [baseEmbed("❌ Wager Requirement", 0xE74C3C)
        .setDescription(
          `You must fulfil your wager requirement before withdrawing.\n\n` +
          `📥 Total received (daily + tips): **${totalReceived.toLocaleString()} ${R}**\n` +
          `🎲 Required wager (50%): **${required.toLocaleString()} ${R}**\n` +
          `✅ Wagered so far: **${totalWagered.toLocaleString()} ${R}**\n` +
          `⏳ Still need: **${remaining.toLocaleString()} ${R}** more wager`
        )],
      flags: MessageFlags.Ephemeral
    });
  }

  // All checks passed — deduct balance and create pending tx
  const netAmount = Math.floor(amount * (1 - WITHDRAW_TAX));
  const taxAmount = amount - netAmount;
  const txId      = genTxId();

  db[guildId][userId].balance = Math.max(0, (u.balance || 0) - amount);
  db[guildId][userId].pendingWithdrawal = {
    txId, amount, netAmount, taxAmount, assetId,
    guildId, userId,
    status: "awaiting_user",  // awaiting_user → pending_admin → done / cancelled
    createdAt: Date.now(),
    adminMsgId: null,
    adminChannelId: withdrawChannelId,
    userMsgId: null,
    userDmChannelId: null,
  };
  saveDB(db);

  // ── DM the user a confirmation ──
  let dmChannel;
  try {
    const discordUser = await client.users.fetch(userId);
    dmChannel = await discordUser.createDM();
  } catch {
    // If DMs are closed, refund and abort
    db[guildId][userId].balance = (db[guildId][userId].balance || 0) + amount;
    delete db[guildId][userId].pendingWithdrawal;
    saveDB(db);
    return interaction.reply({
      embeds: [baseEmbed("❌ DMs Closed", 0xE74C3C)
        .setDescription("Please enable DMs from server members so the bot can send you the withdrawal confirmation.")],
      flags: MessageFlags.Ephemeral
    });
  }

  const confirmEmbed = new EmbedBuilder()
    .setColor(0xF4C542)
    .setTitle("💸 Withdrawal Confirmation")
    .setDescription(
      `Please review your withdrawal request and confirm or cancel below.\n\n` +
      `> ⚠️ This process usually takes **6–8 hours**.\n` +
      `> Once your gamepass is purchased, Roblox processes payment in **5–7 days**.`
    )
    .addFields(
      { name: "🆔 Transaction ID",  value: `\`${txId}\``,                    inline: false },
      { name: "💰 You're Withdrawing", value: `**${amount.toLocaleString()} ${R}**`, inline: true },
      { name: "🏛️ Roblox Tax (30%)", value: `-${taxAmount.toLocaleString()} ${R}`,  inline: true },
      { name: "✅ You Will Receive", value: `**${netAmount.toLocaleString()} Robux**`, inline: true },
      { name: "🎮 Asset ID",         value: `\`${assetId}\``,                inline: true },
      { name: "📋 Status",           value: "⏳ Awaiting your confirmation",  inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wd_confirm_${txId}`)
      .setLabel("✅ Confirm Withdrawal")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`wd_cancel_${txId}`)
      .setLabel("❌ Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  let dmMsg;
  try {
    dmMsg = await dmChannel.send({ embeds: [confirmEmbed], components: [row] });
  } catch {
    // DM failed — refund
    db[guildId][userId].balance = (db[guildId][userId].balance || 0) + amount;
    delete db[guildId][userId].pendingWithdrawal;
    saveDB(db);
    return interaction.reply({
      embeds: [baseEmbed("❌ Could Not DM You", 0xE74C3C)
        .setDescription("Failed to send you a DM. Please enable DMs from server members and try again.")],
      flags: MessageFlags.Ephemeral
    });
  }

  // Store DM message reference
  const db2 = loadDB();
  if (db2[guildId]?.[userId]?.pendingWithdrawal) {
    db2[guildId][userId].pendingWithdrawal.userMsgId       = dmMsg.id;
    db2[guildId][userId].pendingWithdrawal.userDmChannelId = dmChannel.id;
    saveDB(db2);
  }

  await interaction.reply({
    embeds: [baseEmbed("📬 Check Your DMs!", 0x2ECC71)
      .setDescription(`A confirmation has been sent to your DMs.\nReview and confirm your withdrawal there.\n\n**${amount.toLocaleString()} ${R}** has been held from your balance pending confirmation.`)],
    flags: MessageFlags.Ephemeral
  });
}

// ── Button handler for withdrawal (user DM buttons + admin buttons) ───────────

async function handleWithdrawButton(interaction, client) {
  const { customId, user } = interaction;

  // ── User: Confirm withdrawal ──────────────────────────────────────────────
  if (customId.startsWith("wd_confirm_")) {
    const txId = customId.replace("wd_confirm_", "");
    await interaction.deferUpdate();

    // Find the tx in data
    const db = loadDB();
    let txUser = null, txGuildId = null;
    outer: for (const [gId, gData] of Object.entries(db)) {
      if (typeof gData !== "object") continue;
      for (const [uId, uData] of Object.entries(gData)) {
        if (uData?.pendingWithdrawal?.txId === txId) {
          txUser = uId; txGuildId = gId; break outer;
        }
      }
    }

    if (!txUser) {
      return interaction.editReply({ embeds: [baseEmbed("❌ Transaction Not Found", 0xE74C3C).setDescription("This transaction no longer exists.")], components: [] }).catch(() => {});
    }

    const tx = db[txGuildId][txUser].pendingWithdrawal;

    // Only the owner of the tx can confirm
    if (user.id !== txUser) return interaction.followUp({ content: "❌ This is not your withdrawal.", flags: MessageFlags.Ephemeral }).catch(() => {});
    if (tx.status !== "awaiting_user") return interaction.followUp({ content: "❌ This withdrawal has already been processed.", flags: MessageFlags.Ephemeral }).catch(() => {});

    // Update status
    tx.status = "pending_admin";
    db[txGuildId][txUser].pendingWithdrawal = tx;
    saveDB(db);

    // Update user DM — show pending, cancel still active
    const pendingEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("💸 Withdrawal Submitted!")
      .setDescription(
        `Your withdrawal has been submitted to our admins.\n\n` +
        `> ⏳ Your gamepass will be purchased within **6–8 hours**.\n` +
        `> 💳 Roblox processes the payment in **5–7 days** after purchase.\n\n` +
        `You can still cancel using the button below **until an admin processes it**.`
      )
      .addFields(
        { name: "🆔 Transaction ID",    value: `\`${tx.txId}\``,                       inline: false },
        { name: "💰 Withdrawn",          value: `${tx.amount.toLocaleString()} ${R}`,   inline: true },
        { name: "✅ You Will Receive",   value: `${tx.netAmount.toLocaleString()} Robux`, inline: true },
        { name: "🎮 Asset ID",           value: `\`${tx.assetId}\``,                   inline: true },
        { name: "📋 Status",             value: "⏳ Pending admin processing",           inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`wd_cancel_${txId}`)
        .setLabel("❌ Cancel Withdrawal")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({ embeds: [pendingEmbed], components: [cancelRow] }).catch(() => {});

    // ── Post to admin channel ──
    try {
      const adminChannel = await client.channels.fetch(tx.adminChannelId).catch(() => null);
      if (!adminChannel) return;

      const discordUser = await client.users.fetch(txUser).catch(() => null);
      const username    = discordUser ? `${discordUser.username} (<@${txUser}>)` : `<@${txUser}>`;

      const adminEmbed = new EmbedBuilder()
        .setColor(0xF4C542)
        .setTitle("💸 New Withdrawal Request")
        .setDescription(`A user has requested a withdrawal. Please purchase their gamepass and confirm below.`)
        .addFields(
          { name: "👤 User",              value: username,                               inline: true  },
          { name: "🆔 Transaction ID",    value: `\`${tx.txId}\``,                       inline: true  },
          { name: "💰 Amount Withdrawn",  value: `${tx.amount.toLocaleString()} ${R}`,   inline: true  },
          { name: "🏛️ Tax (30%)",          value: `-${tx.taxAmount.toLocaleString()} ${R}`, inline: true },
          { name: "✅ They Receive",       value: `**${tx.netAmount.toLocaleString()} Robux**`, inline: true },
          { name: "🎮 Asset ID",           value: `\`${tx.assetId}\``,                   inline: true  },
          { name: "🔗 Gamepass URL",       value: `https://www.roblox.com/game-pass/${tx.assetId}`, inline: false },
          { name: "📋 Status",             value: "⏳ Awaiting admin action",             inline: false }
        )
        .setTimestamp()
        .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

      const adminRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`wd_approve_${txId}`)
          .setLabel("✅ Approve — Gamepass Purchased")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`wd_deny_${txId}`)
          .setLabel("❌ Deny & Refund User")
          .setStyle(ButtonStyle.Danger)
      );

      const adminMsg = await adminChannel.send({ embeds: [adminEmbed], components: [adminRow] });

      // Save admin msg reference
      const db3 = loadDB();
      if (db3[txGuildId]?.[txUser]?.pendingWithdrawal) {
        db3[txGuildId][txUser].pendingWithdrawal.adminMsgId = adminMsg.id;
        saveDB(db3);
      }
    } catch (err) {
      console.error("❌ Could not post to admin withdrawal channel:", err);
    }
  }

  // ── User: Cancel withdrawal ───────────────────────────────────────────────
  else if (customId.startsWith("wd_cancel_")) {
    const txId = customId.replace("wd_cancel_", "");
    await interaction.deferUpdate();

    const db = loadDB();
    let txUser = null, txGuildId = null;
    outer: for (const [gId, gData] of Object.entries(db)) {
      if (typeof gData !== "object") continue;
      for (const [uId, uData] of Object.entries(gData)) {
        if (uData?.pendingWithdrawal?.txId === txId) {
          txUser = uId; txGuildId = gId; break outer;
        }
      }
    }

    if (!txUser) {
      return interaction.editReply({ embeds: [baseEmbed("❌ Not Found", 0xE74C3C).setDescription("Transaction not found or already processed.")], components: [] }).catch(() => {});
    }

    const tx = db[txGuildId][txUser].pendingWithdrawal;
    if (user.id !== txUser) return interaction.followUp({ content: "❌ This is not your withdrawal.", flags: MessageFlags.Ephemeral }).catch(() => {});
    if (tx.status === "done") return interaction.editReply({ embeds: [baseEmbed("❌ Already Processed", 0xE74C3C).setDescription("This withdrawal has already been approved and cannot be cancelled.")], components: [] }).catch(() => {});

    // Refund
    db[txGuildId][txUser].balance = (db[txGuildId][txUser].balance || 0) + tx.amount;
    delete db[txGuildId][txUser].pendingWithdrawal;
    saveDB(db);

    // Update user DM
    const cancelledEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle("💸 Withdrawal Cancelled")
      .setDescription(`Your withdrawal has been cancelled.\n\n**${tx.amount.toLocaleString()} ${R}** has been refunded to your balance.`)
      .addFields(
        { name: "🆔 Transaction ID", value: `\`${tx.txId}\``, inline: true },
        { name: "💰 Refunded",        value: `+${tx.amount.toLocaleString()} ${R}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

    await interaction.editReply({ embeds: [cancelledEmbed], components: [] }).catch(() => {});

    // Update admin channel message if it exists
    if (tx.adminMsgId && tx.adminChannelId) {
      try {
        const adminChannel = await client.channels.fetch(tx.adminChannelId).catch(() => null);
        const adminMsg     = adminChannel ? await adminChannel.messages.fetch(tx.adminMsgId).catch(() => null) : null;
        if (adminMsg) {
          const updatedEmbed = EmbedBuilder.from(adminMsg.embeds[0])
            .setColor(0xE74C3C)
            .setTitle("💸 Withdrawal Cancelled by User")
            .spliceFields(adminMsg.embeds[0].fields.length - 1, 1, { name: "📋 Status", value: "❌ Cancelled by user — no action needed", inline: false });
          await adminMsg.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});
        }
      } catch (err) { console.error("Could not update admin msg on user cancel:", err); }
    }
  }

  // ── Admin: Approve withdrawal ─────────────────────────────────────────────
  else if (customId.startsWith("wd_approve_")) {
    if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
    const txId = customId.replace("wd_approve_", "");
    await interaction.deferUpdate();

    const db = loadDB();
    let txUser = null, txGuildId = null;
    outer: for (const [gId, gData] of Object.entries(db)) {
      if (typeof gData !== "object") continue;
      for (const [uId, uData] of Object.entries(gData)) {
        if (uData?.pendingWithdrawal?.txId === txId) {
          txUser = uId; txGuildId = gId; break outer;
        }
      }
    }

    if (!txUser) {
      return interaction.editReply({ embeds: [baseEmbed("❌ Not Found", 0xE74C3C).setDescription("Transaction not found.")], components: [] }).catch(() => {});
    }

    const tx = db[txGuildId][txUser].pendingWithdrawal;
    if (tx.status === "done") {
      return interaction.editReply({ content: "Already processed." }).catch(() => {});
    }

    // Mark done, set cooldown
    tx.status = "done";
    db[txGuildId][txUser].pendingWithdrawal = null;
    delete db[txGuildId][txUser].pendingWithdrawal;
    db[txGuildId][txUser].lastWithdraw = Date.now();
    saveDB(db);

    // Update admin message
    const approvedAdminEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x2ECC71)
      .setTitle("💸 Withdrawal — Approved ✅")
      .spliceFields(interaction.message.embeds[0].fields.length - 1, 1, { name: "📋 Status", value: `✅ Approved by <@${interaction.user.id}>`, inline: false });
    await interaction.editReply({ embeds: [approvedAdminEmbed], components: [] }).catch(() => {});

    // DM the user
    try {
      const discordUser = await client.users.fetch(txUser).catch(() => null);
      if (discordUser) {
        // Disable cancel button on user's DM message
        if (tx.userMsgId && tx.userDmChannelId) {
          try {
            const dmCh  = await client.channels.fetch(tx.userDmChannelId).catch(() => null);
            const dmMsg = dmCh ? await dmCh.messages.fetch(tx.userMsgId).catch(() => null) : null;
            if (dmMsg) {
              const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`wd_cancel_${txId}`)
                  .setLabel("❌ Cancel Withdrawal")
                  .setStyle(ButtonStyle.Danger)
                  .setDisabled(true)
              );
              await dmMsg.edit({ components: [disabledRow] }).catch(() => {});
            }
          } catch { /* not critical */ }
        }

        // Send success DM
        const successEmbed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle("✅ Withdrawal Approved!")
          .setDescription(
            `Your withdrawal has been processed! Your gamepass has been purchased.\n\n` +
            `> 💳 Roblox will deliver **${tx.netAmount.toLocaleString()} Robux** to your account within **5–7 days**.\n` +
            `> This is Roblox's standard payment processing time and is outside our control.`
          )
          .addFields(
            { name: "🆔 Transaction ID", value: `\`${tx.txId}\``,                        inline: true },
            { name: "✅ Amount",          value: `${tx.netAmount.toLocaleString()} Robux`, inline: true },
            { name: "🎮 Asset ID",        value: `\`${tx.assetId}\``,                     inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

        await discordUser.send({ embeds: [successEmbed] }).catch(() => {});
      }
    } catch (err) { console.error("Could not DM user on approval:", err); }
  }

  // ── Admin: Deny withdrawal ────────────────────────────────────────────────
  else if (customId.startsWith("wd_deny_")) {
    if (!isOwner(interaction)) return interaction.reply({ content: "❌ No permission.", flags: MessageFlags.Ephemeral });
    const txId = customId.replace("wd_deny_", "");
    await interaction.deferUpdate();

    const db = loadDB();
    let txUser = null, txGuildId = null;
    outer: for (const [gId, gData] of Object.entries(db)) {
      if (typeof gData !== "object") continue;
      for (const [uId, uData] of Object.entries(gData)) {
        if (uData?.pendingWithdrawal?.txId === txId) {
          txUser = uId; txGuildId = gId; break outer;
        }
      }
    }

    if (!txUser) {
      return interaction.editReply({ embeds: [baseEmbed("❌ Not Found", 0xE74C3C).setDescription("Transaction not found.")], components: [] }).catch(() => {});
    }

    const tx = db[txGuildId][txUser].pendingWithdrawal;
    if (tx.status === "done") {
      return interaction.editReply({ content: "Already processed." }).catch(() => {});
    }

    // Refund the user
    db[txGuildId][txUser].balance = (db[txGuildId][txUser].balance || 0) + tx.amount;
    delete db[txGuildId][txUser].pendingWithdrawal;
    saveDB(db);

    // Update admin message
    const deniedAdminEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xE74C3C)
      .setTitle("💸 Withdrawal — Denied ❌")
      .spliceFields(interaction.message.embeds[0].fields.length - 1, 1, { name: "📋 Status", value: `❌ Denied by <@${interaction.user.id}> — user refunded`, inline: false });
    await interaction.editReply({ embeds: [deniedAdminEmbed], components: [] }).catch(() => {});

    // DM the user
    try {
      const discordUser = await client.users.fetch(txUser).catch(() => null);
      if (discordUser) {
        // Disable buttons on user's DM message
        if (tx.userMsgId && tx.userDmChannelId) {
          try {
            const dmCh  = await client.channels.fetch(tx.userDmChannelId).catch(() => null);
            const dmMsg = dmCh ? await dmCh.messages.fetch(tx.userMsgId).catch(() => null) : null;
            if (dmMsg) await dmMsg.edit({ components: [] }).catch(() => {});
          } catch { /* not critical */ }
        }

        const deniedEmbed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle("❌ Withdrawal Cancelled by Admin")
          .setDescription(
            `Your withdrawal request has been cancelled by an admin.\n\n` +
            `**${tx.amount.toLocaleString()} ${R}** has been refunded to your balance.\n\n` +
            `If you believe this is a mistake, please contact an admin.`
          )
          .addFields(
            { name: "🆔 Transaction ID", value: `\`${tx.txId}\``,                      inline: true },
            { name: "💰 Refunded",        value: `+${tx.amount.toLocaleString()} ${R}`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "🎰 Casino Bot • Withdrawals" });

        await discordUser.send({ embeds: [deniedEmbed] }).catch(() => {});
      }
    } catch (err) { console.error("Could not DM user on denial:", err); }
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  checkDailyWagerReq,
  cmdHelp,
  cmdCreatePromo, cmdRedeemPromo,
  cmdAffiliatePanel, handleAffiliateButton,
  handleAffiliateMemberJoin, handleMemberLeave,
  processAffiliateWager, cmdSetVerifyRole,
  cmdPrizepoolCreate, cmdPrizepoolPanel,
  handlePrizepoolButton, handlePrizepoolMemberJoin,
  updatePrizepoolPanel, cleanupInvites,
  cmdPrizepoolReset,
  cmdCreateCode, cmdGuess, cmdEndCode,
  handleCodeButton, handleCodeMemberJoin,
  cmdVerifyPanel, handleVerifyButton,
  cmdSetWagerRole, cmdViewWagerRoles,
  cmdWithdraw, cmdWithdrawPanel,
  cmdSetWithdrawChannel, cmdSetWithdrawMin,
  handleWithdrawButton,
  cmdDeposit,
  cmdInvited, cmdInviter,
  cmdAdminHelp,
};
