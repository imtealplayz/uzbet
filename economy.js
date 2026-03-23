const { loadDB, saveDB } = require("./db");
const { EmbedBuilder, MessageFlags } = require("discord.js");

const R = "<:Robux_logo:1485012977638838272>";

const DEFAULT_USER = () => ({
  balance: 0,
  lastDaily: 0,
  totalWagered: 0,
  tipsReceived: 0,
  wageredSinceTip: 0,
  rakebackPending: 0,  // accumulated rakeback not yet claimed
  lastRakebackClaim: 0, // timestamp of last claim
  stats: {},
});

function getUser(guildId, userId) {
  const db = loadDB();
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = DEFAULT_USER();
  // migrate old users missing new fields
  const u = db[guildId][userId];
  if (u.totalWagered === undefined) u.totalWagered = 0;
  if (u.tipsReceived === undefined) u.tipsReceived = 0;
  if (u.wageredSinceTip === undefined) u.wageredSinceTip = 0;
  if (!u.stats) u.stats = {};
  saveDB(db);
  return u;
}

function saveUser(guildId, userId, userData) {
  const db = loadDB();
  if (!db[guildId]) db[guildId] = {};
  db[guildId][userId] = userData;
  saveDB(db);
}

function getBalance(guildId, userId) {
  return getUser(guildId, userId).balance ?? 0;
}

function setBalance(guildId, userId, amount) {
  const db = loadDB();
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = DEFAULT_USER();
  const u = db[guildId][userId];
  // Migrate missing fields
  if (u.totalWagered === undefined) u.totalWagered = 0;
  if (u.tipsReceived === undefined) u.tipsReceived = 0;
  if (u.wageredSinceTip === undefined) u.wageredSinceTip = 0;
  if (u.rakebackPending === undefined) u.rakebackPending = 0;
  if (u.lastRakebackClaim === undefined) u.lastRakebackClaim = 0;
  if (!u.stats) u.stats = {};
  // Never allow negative balance
  u.balance = Math.max(0, Math.floor(amount));
  db[guildId][userId] = u;
  saveDB(db);
}

function addBalance(guildId, userId, amount) {
  setBalance(guildId, userId, getBalance(guildId, userId) + amount);
}

function removeBalance(guildId, userId, amount) {
  setBalance(guildId, userId, getBalance(guildId, userId) - amount);
}

// ─── Rakeback ─────────────────────────────────────────────────────────────────

function getRakebackPct(totalWagered) {
  if (totalWagered >= 100000) return 0.04;
  if (totalWagered >= 50000)  return 0.03;
  if (totalWagered >= 25000)  return 0.02;
  if (totalWagered >= 10000)  return 0.015;
  if (totalWagered >= 5000)   return 0.01;
  if (totalWagered >= 1000)   return 0.005;
  return 0;
}

function getRakebackTierName(totalWagered) {
  if (totalWagered >= 100000) return "💎 Diamond (4%)";
  if (totalWagered >= 50000)  return "🔴 Ruby (3%)";
  if (totalWagered >= 25000)  return "🟣 Amethyst (2%)";
  if (totalWagered >= 10000)  return "🔵 Sapphire (1.5%)";
  if (totalWagered >= 5000)   return "🟢 Emerald (1%)";
  if (totalWagered >= 1000)   return "⚪ Silver (0.5%)";
  return `🔒 Locked (need ${(1000 - totalWagered).toLocaleString()} ${R} more)`;
}

// ─── Wager Role Milestones ────────────────────────────────────────────────────

const WAGER_MILESTONES = [1000, 5000, 10000, 25000, 50000, 75000, 100000];

function getWagerMilestone(totalWagered) {
  // Returns the highest milestone the user has reached, or null
  for (let i = WAGER_MILESTONES.length - 1; i >= 0; i--) {
    if (totalWagered >= WAGER_MILESTONES[i]) return WAGER_MILESTONES[i];
  }
  return null;
}

// ─── Stats Tracking ───────────────────────────────────────────────────────────

function recordGame(guildId, userId, game, bet, profit) {
  const db = loadDB();
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = DEFAULT_USER();
  const u = db[guildId][userId];
  if (!u.stats) u.stats = {};
  if (!u.totalWagered) u.totalWagered = 0;
  if (u.wageredSinceTip === undefined) u.wageredSinceTip = 0;
  if (u.wageredSinceDaily === undefined) u.wageredSinceDaily = 0;
  if (u.rakebackPending === undefined) u.rakebackPending = 0;
  if (u.lastRakebackClaim === undefined) u.lastRakebackClaim = 0;
  if (!u.stats[game]) u.stats[game] = { wagered: 0, wins: 0, losses: 0, profit: 0 };

  const prevWagered = u.totalWagered;

  u.stats[game].wagered   += bet;
  u.totalWagered          += bet;
  u.wageredSinceTip       += bet;
  u.wageredSinceDaily     += bet;
  u.stats[game].profit    += profit;

  if (profit > 0) u.stats[game].wins++;
  else if (profit < 0) u.stats[game].losses++;

  // Rakeback
  const pct = getRakebackPct(u.totalWagered);
  if (pct > 0) {
    u.rakebackPending = parseFloat(((u.rakebackPending || 0) + bet * pct).toFixed(4));
  }

  // Check if user crossed a new wager milestone
  const prevMilestone = getWagerMilestone(prevWagered);
  const newMilestone  = getWagerMilestone(u.totalWagered);
  const crossedNewMilestone = newMilestone !== null && newMilestone !== prevMilestone;

  db[guildId][userId] = u;
  saveDB(db);

  // Affiliate earnings (lazy require to avoid circular dep)
  try {
    const { processAffiliateWager } = require("./features");
    processAffiliateWager(guildId, userId, bet);
  } catch { /* features not loaded yet */ }

  // Return whether a new milestone was crossed (used by games.js to trigger role assignment)
  return { crossedNewMilestone, newMilestone };
}

// ─── Embed Theme ──────────────────────────────────────────────────────────────

const COLORS = {
  gold:   0xF4C542,
  green:  0x2ECC71,
  red:    0xE74C3C,
  blue:   0x5865F2,
  purple: 0x9B59B6,
  rain:   0x48C9B0,
};

function baseEmbed(title, color = COLORS.gold) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot" });
}

// ─── Balance / Daily / Leaderboard ────────────────────────────────────────────

async function cmdBalance(interaction, userId, guildId, targetUser) {
  const uid = targetUser ? targetUser.id : userId;
  const bal = getBalance(guildId, uid);
  const user = targetUser || interaction.user;

  const embed = baseEmbed("💰 Wallet", COLORS.gold)
    .setDescription(`**${user.username}'s** balance`)
    .addFields({ name: "Balance", value: `${bal.toLocaleString()} ${R}`, inline: true });

  if (user && typeof user.displayAvatarURL === "function") {
    embed.setThumbnail(user.displayAvatarURL());
  }

  await interaction.reply({ embeds: [embed] });
}


async function cmdLeaderboard(interaction, guildId) {
  const db = loadDB();
  const guild = db[guildId] || {};

  const sorted = Object.entries(guild)
    .filter(([, d]) => typeof d === "object" && (d.totalWagered || 0) > 0)
    .sort(([, a], [, b]) => (b.totalWagered || 0) - (a.totalWagered || 0))
    .slice(0, 10);

  if (!sorted.length) {
    return interaction.reply({ embeds: [baseEmbed("🏆 Leaderboard", COLORS.gold).setDescription("No players have wagered yet!")] });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const rows = await Promise.all(sorted.map(async ([uid, data], i) => {
    let name;
    try { const u = await interaction.client.users.fetch(uid); name = u.username; }
    catch { name = "Unknown"; }
    return `${medals[i] || `**${i + 1}.**`} **${name}** — ${(data.totalWagered || 0).toLocaleString()} ${R} wagered`;
  }));

  await interaction.reply({ embeds: [baseEmbed("🏆 Top Wagerers", COLORS.gold).setDescription(rows.join("\n"))] });
}

// ─── Profile ──────────────────────────────────────────────────────────────────

async function cmdProfile(interaction, userId, guildId, targetUser) {
  const uid = targetUser ? targetUser.id : userId;
  const user = targetUser || interaction.user;
  const u = getUser(guildId, uid);

  const GAME_LABELS = {
    slots: "🎰 Slots", coinflip: "🪙 Coinflip", roulette: "🎡 Roulette",
    blackjack: "🃏 Blackjack", crash: "📈 Crash", mines: "💣 Mines",
    towers: "🗼 Towers", keno: "🎱 Keno",
  };

  const stats = u.stats || {};
  const totalWagered = u.totalWagered || 0;
  let totalWins = 0, totalLosses = 0;

  const gameLines = Object.entries(GAME_LABELS).map(([key, label]) => {
    const s = stats[key];
    if (!s || s.wagered === 0) return null;
    const total = s.wins + s.losses;
    const winPct = total > 0 ? ((s.wins / total) * 100).toFixed(1) : "0.0";
    totalWins += s.wins;
    totalLosses += s.losses;
    return `${label}\n> Wagered: **${s.wagered.toLocaleString()} ${R}** | W/L: **${s.wins}/${s.losses}** | Win%: **${winPct}%**`;
  }).filter(Boolean);

  const overallTotal = totalWins + totalLosses;
  const overallWinPct = overallTotal > 0 ? ((totalWins / overallTotal) * 100).toFixed(1) : "0.0";

  const embed = baseEmbed(`📊 ${user.username}'s Profile`, COLORS.blue)
    .setThumbnail(typeof user.displayAvatarURL === "function" ? user.displayAvatarURL() : null)
    .addFields(
      { name: "💰 Balance",      value: `${(u.balance || 0).toLocaleString()} ${R}`,  inline: true },
      { name: "🎲 Total Wagered", value: `${totalWagered.toLocaleString()} ${R}`,      inline: true },
      { name: "📈 Overall W/L",   value: `**${totalWins}/${totalLosses}** — Win rate: **${overallWinPct}%**`, inline: false },
    );

  if (gameLines.length > 0) {
    embed.addFields({ name: "🎮 Game Breakdown", value: gameLines.join("\n\n"), inline: false });
  } else {
    embed.addFields({ name: "🎮 Game Breakdown", value: "_No games played yet._", inline: false });
  }

  await interaction.reply({ embeds: [embed] });
}

// ─── Tip ──────────────────────────────────────────────────────────────────────

async function cmdTip(interaction, userId, guildId, targetUser, amount) {
  amount = parseInt(amount);

  if (!targetUser) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid", COLORS.red).setDescription("Usage: `/tip @user amount`")], flags: MessageFlags.Ephemeral });
  }
  if (!amount || isNaN(amount) || amount < 1) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Amount", COLORS.red).setDescription("Please provide a valid tip amount.")], flags: MessageFlags.Ephemeral });
  }
  if (targetUser.id === userId) {
    return interaction.reply({ embeds: [baseEmbed("❌ Nice Try", COLORS.red).setDescription("You can't tip yourself!")], flags: MessageFlags.Ephemeral });
  }

  const senderData = getUser(guildId, userId);
  const bal = senderData.balance || 0;

  if (bal < amount) {
    return interaction.reply({ embeds: [baseEmbed("❌ Insufficient Funds", COLORS.red).setDescription(`You only have **${bal.toLocaleString()} ${R}**.`)], flags: MessageFlags.Ephemeral });
  }

  // Wager requirement: must wager 50% of all coins received (daily claimed + tips received)
  // This prevents alt accounts from funneling coins to a main without playing
  const totalReceived   = (senderData.totalDailyClaimed || 0) + (senderData.tipsReceived || 0);
  const totalWagered    = senderData.totalWagered || 0;
  const required        = Math.floor(totalReceived * 0.5);
  const remaining       = Math.max(0, required - totalWagered);

  if (remaining > 0) {
    return interaction.reply({
      embeds: [baseEmbed("❌ Wager Requirement", COLORS.red)
        .setDescription(
          `You must wager **50%** of your received coins before tipping.\n\n` +
          `📥 Total received: **${totalReceived.toLocaleString()} ${R}**\n` +
          `🎲 Required wager: **${required.toLocaleString()} ${R}**\n` +
          `✅ You've wagered: **${totalWagered.toLocaleString()} ${R}**\n` +
          `⏳ Still need: **${remaining.toLocaleString()} ${R}** more wager`
        )],
      flags: MessageFlags.Ephemeral
    });
  }

  // Transfer
  removeBalance(guildId, userId, amount);

  // Add to recipient and track their tips received
  const recipientData = getUser(guildId, targetUser.id);
  recipientData.balance      = (recipientData.balance || 0) + amount;
  recipientData.tipsReceived = (recipientData.tipsReceived || 0) + amount;
  saveUser(guildId, targetUser.id, recipientData);

  // DM sender
  try {
    const senderUser = interaction.user || interaction.author;
    if (senderUser) {
      senderUser.send({ embeds: [baseEmbed("💸 Tip Sent!", COLORS.green)
        .setDescription(`You tipped <@${targetUser.id}> **${amount.toLocaleString()} ${R}**!`)
        .addFields({ name: "Your Balance", value: `${getBalance(guildId, userId).toLocaleString()} ${R}`, inline: true })]
      }).catch(() => {});
    }
  } catch {}

  // DM recipient
  try {
    const client = interaction.client;
    if (client) {
      const recipUser = await client.users.fetch(targetUser.id).catch(() => null);
      if (recipUser) {
        recipUser.send({ embeds: [baseEmbed("🎁 You Received a Tip!", COLORS.green)
          .setDescription(`**${(interaction.user || interaction.author)?.username || "Someone"}** tipped you **${amount.toLocaleString()} ${R}**!`)
          .addFields({ name: "New Balance", value: `${recipientData.balance.toLocaleString()} ${R}`, inline: true })]
        }).catch(() => {});
      }
    }
  } catch {}

  const newBal = getBalance(guildId, userId);
  await interaction.reply({
    embeds: [baseEmbed("💸 Tip Sent!", COLORS.green)
      .setDescription(`You tipped <@${targetUser.id}> **${amount.toLocaleString()} ${R}**!`)
      .addFields(
        { name: "Amount",       value: `${amount.toLocaleString()} ${R}`, inline: true },
        { name: "Your Balance", value: `${newBal.toLocaleString()} ${R}`, inline: true }
      )]
  });
}

// ─── Rain ─────────────────────────────────────────────────────────────────────

const activeRains = new Map();

async function cmdRain(interaction, userId, guildId, amount, duration) {
  amount = parseInt(amount);
  duration = parseInt(duration);

  if (!amount || isNaN(amount) || amount < 1) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Amount", COLORS.red).setDescription(`Minimum rain amount is **1 ${R}**.\n\nUsage: \`$rain <amount> <seconds>\`\nExample: \`$rain 50 60\``)], flags: MessageFlags.Ephemeral });
  }
  if (!duration || isNaN(duration) || duration < 10 || duration > 300) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Duration", COLORS.red).setDescription("Duration must be between **10s** and **300s**.\n\nUsage: `$rain <amount> <seconds>`")], flags: MessageFlags.Ephemeral });
  }

  const bal = getBalance(guildId, userId);
  if (bal < amount) {
    return interaction.reply({ embeds: [baseEmbed("❌ Insufficient Funds", COLORS.red).setDescription(`You need **${amount.toLocaleString()} ${R}** but only have **${bal.toLocaleString()} ${R}**.`)], flags: MessageFlags.Ephemeral });
  }
  if (activeRains.has(guildId)) {
    return interaction.reply({ embeds: [baseEmbed("⛈️ Rain Active", COLORS.red).setDescription("There's already an active rain! Wait for it to end.")], flags: MessageFlags.Ephemeral });
  }

  removeBalance(guildId, userId, amount);
  const endsTimestamp = Math.floor((Date.now() + duration * 1000) / 1000);

  const embed = baseEmbed("🎉 Coin Rain!", COLORS.rain)
    .setDescription(
      `**<@${userId}>** is making it rain!\n\n` +
      `React with 🎉 below to join and grab your share!\n` +
      `*(Host can also react to join)*\n\n` +
      `⏰ Ends <t:${endsTimestamp}:R>\n` +
      `💰 Prize Pool: **${amount.toLocaleString()} ${R}**`
    );

  // Send as a standalone channel message so the bot's message is clean
  let channel;
  if (typeof interaction.fetchReply === "function") {
    // slash command — get channel from interaction
    channel = interaction.channel;
    await interaction.reply({ content: "🎉 Rain started!", flags: MessageFlags.Ephemeral }); // ephemeral ack
  } else {
    channel = interaction.channel;
  }

  const msg = await channel.send({ embeds: [embed] });
  await msg.react("🎉").catch(() => {});
  activeRains.set(guildId, { senderId: userId, amount });

  setTimeout(async () => {
    activeRains.delete(guildId);
    const freshMsg = await msg.fetch().catch(() => null);
    if (!freshMsg) return;

    const reaction = freshMsg.reactions.cache.get("🎉");
    const collectors = new Set();

    if (reaction) {
      const users = await reaction.users.fetch().catch(() => null);
      if (users) users.forEach(u => { if (!u.bot) collectors.add(u.id); });
    }

    if (collectors.size === 0) {
      const endEmbed = baseEmbed("🎉 Rain Ended — Nobody Joined", COLORS.red)
        .setDescription(`Nobody reacted to the rain!\n\n💸 **${amount.toLocaleString()} ${R}** was lost.`);
      return freshMsg.edit({ embeds: [endEmbed] }).catch(() => {});
    }

    const share = Math.floor(amount / collectors.size);
    for (const uid of collectors) addBalance(guildId, uid, share);

    const endEmbed = baseEmbed("🎉 Rain Ended!", COLORS.green)
      .setDescription(
        `Rain has ended! **${amount.toLocaleString()} ${R}** has been divided among **${collectors.size}** user(s) and every user received **${share.toLocaleString()} ${R}**.\n\n` +
        `🎉 ${[...collectors].map(uid => `<@${uid}>`).join(", ")}`
      );
    await freshMsg.edit({ embeds: [endEmbed] }).catch(() => {});
  }, duration * 1000);
}

// ─── Admin ────────────────────────────────────────────────────────────────────

const OWNER_ID = "926063716057894953";

async function cmdGive(interaction, guildId, targetUser, amount) {
  if (interaction.user?.id !== OWNER_ID && interaction.author?.id !== OWNER_ID) {
    return interaction.reply({ embeds: [baseEmbed("❌ No Permission", COLORS.red).setDescription("You don't have permission to use this command.")], flags: MessageFlags.Ephemeral });
  }
  amount = parseInt(amount);
  if (!targetUser || isNaN(amount) || amount < 1) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid", COLORS.red).setDescription("Usage: `$give @user <amount>`")], flags: MessageFlags.Ephemeral });
  }
  addBalance(guildId, targetUser.id, amount);
  await interaction.reply({
    embeds: [baseEmbed("✅ Coins Given", COLORS.green).addFields(
      { name: "User", value: `<@${targetUser.id}>`, inline: true },
      { name: "Given", value: `+${amount.toLocaleString()} ${R}`, inline: true },
      { name: "New Balance", value: `${getBalance(guildId, targetUser.id).toLocaleString()} ${R}`, inline: true }
    )]
  });
}

async function cmdTake(interaction, guildId, targetUser, amount) {
  if (interaction.user?.id !== OWNER_ID && interaction.author?.id !== OWNER_ID) {
    return interaction.reply({ embeds: [baseEmbed("❌ No Permission", COLORS.red).setDescription("You don't have permission to use this command.")], flags: MessageFlags.Ephemeral });
  }
  amount = parseInt(amount);
  if (!targetUser || isNaN(amount) || amount < 1) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid", COLORS.red).setDescription("Usage: `$take @user <amount>`")], flags: MessageFlags.Ephemeral });
  }
  removeBalance(guildId, targetUser.id, amount);
  await interaction.reply({
    embeds: [baseEmbed("✅ Coins Taken", COLORS.red).addFields(
      { name: "User", value: `<@${targetUser.id}>`, inline: true },
      { name: "Taken", value: `-${amount.toLocaleString()} ${R}`, inline: true },
      { name: "New Balance", value: `${getBalance(guildId, targetUser.id).toLocaleString()} ${R}`, inline: true }
    )]
  });
}

// ─── Rakeback ─────────────────────────────────────────────────────────────────

async function cmdRakeback(interaction, userId, guildId) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const u = getUser(guildId, userId);
  const totalWagered = u.totalWagered || 0;
  const pending = parseFloat((u.rakebackPending || 0).toFixed(2));
  const lastClaim = u.lastRakebackClaim || 0;
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  const canClaim = now - lastClaim >= cooldown;
  const timeLeft = cooldown - (now - lastClaim);
  const hrs = Math.floor(timeLeft / 3600000);
  const mins = Math.floor((timeLeft % 3600000) / 60000);

  const tier = getRakebackTierName(totalWagered);
  const pct = getRakebackPct(totalWagered);
  const nextTierInfo = pct === 0
    ? `Wager **${(1000 - totalWagered).toLocaleString()} ${R}** more to unlock rakeback.`
    : pct < 0.10
      ? (() => {
          const thresholds = [1000, 5000, 10000, 25000, 50000, 100000];
          const next = thresholds.find(t => t > totalWagered);
          return next ? `Wager **${(next - totalWagered).toLocaleString()} ${R}** more to reach next tier.` : "Max tier reached!";
        })()
      : "💎 **MAX TIER** reached!";

  const claimable    = Math.floor(pending);
  const pendingDisplay = pending.toFixed(2);

  const embed = baseEmbed("💰 Rakeback", COLORS.gold)
    .addFields(
      { name: "🏷️ Your Tier",     value: tier,                                      inline: false },
      { name: "🎲 Total Wagered",  value: `${totalWagered.toLocaleString()} ${R}`,  inline: true  },
      { name: "📦 Pending",        value: `${pendingDisplay} ${R}`,                 inline: true  },
      { name: "📈 Next Tier",      value: nextTierInfo,                              inline: false },
      { name: "⏰ Claim Status",   value: canClaim
          ? claimable > 0 ? "✅ Ready to claim!" : "Nothing to claim yet — keep wagering!"
          : `⏳ Next claim in **${hrs}h ${mins}m**`,
        inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("rakeback_claim")
      .setLabel(`💸 Claim ${claimable.toLocaleString()}`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canClaim || claimable === 0)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleRakebackClaim(interaction, userId, guildId) {
  const db = loadDB();
  if (!db[guildId]?.[userId]) return interaction.reply({ content: "No data found.", flags: MessageFlags.Ephemeral });
  const u = db[guildId][userId];

  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  if (now - (u.lastRakebackClaim || 0) < cooldown) {
    return interaction.reply({ content: "You already claimed your rakeback in the last 24h!", flags: MessageFlags.Ephemeral });
  }

  const claimable = Math.floor(u.rakebackPending || 0);
  if (claimable === 0) {
    return interaction.reply({ content: "Nothing to claim yet!", flags: MessageFlags.Ephemeral });
  }

  u.rakebackPending = (u.rakebackPending || 0) - claimable;
  u.lastRakebackClaim = now;
  u.balance = (u.balance || 0) + claimable;
  db[guildId][userId] = u;
  saveDB(db);

  const embed = baseEmbed("💰 Rakeback Claimed!", COLORS.green)
    .setDescription(`You claimed your rakeback!`)
    .addFields(
      { name: "Claimed",      value: `+${claimable.toLocaleString()} ${R}`, inline: true },
      { name: "New Balance",  value: `${u.balance.toLocaleString()} ${R}`,  inline: true }
    );

  await interaction.update({ embeds: [embed], components: [] });
}

// ─── WHEEL ────────────────────────────────────────────────────────────────────

// Bonus item keys used in user profile for auto-apply
const WHEEL_BONUS_KEYS = {
  "Respin Token":       "respin",
  "Deposit Boost +10%": "deposit10",
  "Deposit Boost +25%": "deposit25",
  "Cashback 5%":        "cashback5",
  "x2 Multiplier":      "multiplier2x",
};

const WHEEL_ITEMS = [
  // ── Bonus items (super common) ──────────────────────────────────────────────
  { label: "Respin Token",       value: 0,    type: "bonus",  icon: "🔄", weight: 28  },
  { label: "Deposit Boost +10%", value: 0,    type: "bonus",  icon: "📈", weight: 24  },
  { label: "Deposit Boost +25%", value: 0,    type: "bonus",  icon: "🚀", weight: 20  },
  { label: "Cashback 5%",        value: 0,    type: "bonus",  icon: "💸", weight: 18  },
  { label: "x2 Multiplier",      value: 0,    type: "bonus",  icon: "⚡", weight: 16  },
  // ── Coin prizes (increasingly rare) ────────────────────────────────────────
  { label: "5 Robux",            value: 5,    type: "coins",  icon: "💰", weight: 10  },
  { label: "10 Robux",           value: 10,   type: "coins",  icon: "💎", weight: 6   },
  { label: "25 Robux",           value: 25,   type: "coins",  icon: "💎", weight: 4   },
  { label: "50 Robux",           value: 50,   type: "coins",  icon: "🏅", weight: 2.5 },
  { label: "100 Robux",          value: 100,  type: "coins",  icon: "🥇", weight: 1.5 },
  { label: "200 Robux",          value: 200,  type: "coins",  icon: "👑", weight: 0.8 },
  { label: "3000 Robux",         value: 3000, type: "coins",  icon: "🎰", weight: 0.1 },
];

function spinWheel() {
  const total = WHEEL_ITEMS.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of WHEEL_ITEMS) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return WHEEL_ITEMS[0];
}

// BloxWager-style: vertical list, arrow points at winner
function buildWheelDisplay(highlightLabel, spinning = false) {
  // Show a window of 5 items centred on the highlight
  const idx = WHEEL_ITEMS.findIndex(i => i.label === highlightLabel);
  const total = WHEEL_ITEMS.length;
  const lines = [];
  for (let offset = -2; offset <= 2; offset++) {
    const i = ((idx + offset) % total + total) % total;
    const item = WHEEL_ITEMS[i];
    if (offset === 0) {
      lines.push(`▶  ${item.icon} **${item.label}**  ◀`);
    } else {
      lines.push(`　  ${item.icon} ${item.label}`);
    }
  }
  return `\`\`\`\n┌─────────────────────┐\n│  WHEEL OF FORTUNE   │\n└─────────────────────┘\`\`\`\n` + lines.join("\n");
}

async function cmdWheel(interaction, userId, guildId) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const db = loadDB();
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) db[guildId][userId] = DEFAULT_USER();
  const u = db[guildId][userId];

  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  const lastSpin = u.lastWheelSpin || 0;
  const diff = now - lastSpin;
  const extraSpins = u.wheelExtraSpins || 0;

  // Check cooldown
  if (diff < cooldown && extraSpins === 0) {
    const nextTs = Math.floor((lastSpin + cooldown) / 1000);
    const embed = baseEmbed("🎡 Wheel of Fortune", COLORS.purple)
      .setDescription(`You already spun the wheel!\n\n⏰ Next free spin: <t:${nextTs}:R>\n\n💡 Invite someone with your link to get a bonus spin!`);
    return interaction.reply({ embeds: [embed] });
  }

  // Deduct a spin
  if (extraSpins > 0) {
    u.wheelExtraSpins = extraSpins - 1;
  } else {
    u.lastWheelSpin = now;
  }

  // Spin
  const result = spinWheel();

  // Award coins if it's a coin prize
  if (result.type === "coins" && result.value > 0) {
    u.balance = (u.balance || 0) + result.value;
  }

  // Award bonus item: store in activeBonus (overwrites any existing one)
  // Respin Token is special — adds to wheelExtraSpins instead
  if (result.type === "bonus") {
    const bonusKey = WHEEL_BONUS_KEYS[result.label];
    if (bonusKey === "respin") {
      u.wheelExtraSpins = (u.wheelExtraSpins || 0) + 1;
    } else if (bonusKey) {
      u.activeBonus = bonusKey;
    }
  }

  db[guildId][userId] = u;
  saveDB(db);

  // Generate invite link
  let inviteUrl = null;
  try {
    const channel = interaction.channel || interaction.message?.channel;
    if (channel) {
      const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: "Wheel spin invite" });
      inviteUrl = invite.url;
    }
  } catch { /* invite creation failed */ }

  if (inviteUrl) {
    const db2 = loadDB();
    if (db2[guildId]?.[userId]) {
      db2[guildId][userId].wheelInviteUrl = inviteUrl;
      saveDB(db2);
    }
  }

  // ── Animation: scroll through items stopping on result ──
  const resultIdx = WHEEL_ITEMS.findIndex(i => i.label === result.label);
  const total = WHEEL_ITEMS.length;

  // Build 5 animation frames — random labels, last two approach result
  const frameLabels = [
    WHEEL_ITEMS[Math.floor(Math.random() * total)].label,
    WHEEL_ITEMS[Math.floor(Math.random() * total)].label,
    WHEEL_ITEMS[Math.floor(Math.random() * total)].label,
    WHEEL_ITEMS[((resultIdx - 1) % total + total) % total].label,
    WHEEL_ITEMS[resultIdx].label,
  ];

  const spinEmbed = (lbl, spinNum) => new (require("discord.js").EmbedBuilder)()
    .setColor(0xF4C542)
    .setTitle(`🎡 Wheel of Fortune — Spin #${spinNum || ""}`)
    .setDescription(buildWheelDisplay(lbl, true))
    .setFooter({ text: `🎰 Casino Bot • 🔴 STOPPING` })
    .setTimestamp();

  // Build spin number for display (cosmetic only)
  const spinNum = Math.floor(Math.random() * 90000) + 10000;

  // Active bonus display helper
  const bonusLabel = {
    deposit10:    "📈 Deposit Boost +10% — applies to your next game win!",
    deposit25:    "🚀 Deposit Boost +25% — applies to your next game win!",
    cashback5:    "💸 Cashback 5% — if you lose next game, get 5% of bet back!",
    multiplier2x: "⚡ x2 Multiplier — doubles your next game win!",
  };

  const resultEmbed = new (require("discord.js").EmbedBuilder)()
    .setColor(result.value === 3000 ? 0xF4C542 : result.type === "coins" ? 0x2ECC71 : 0x9B59B6)
    .setTitle(result.value === 3000 ? `🎡 Spin #${spinNum} — JACKPOT! 🎉` : `🎡 Spin #${spinNum} — Result!`)
    .setDescription(buildWheelDisplay(result.label))
    .addFields(
      {
        name: result.type === "coins" ? "💰 Prize" : "🎁 Bonus",
        value: result.type === "coins"
          ? `**+${result.value.toLocaleString()} ${R}** added to your balance!`
          : result.label === "Respin Token"
            ? `🔄 **Respin Token** — added **+1 free spin** to your account! Use \`/wheel\` anytime.`
            : bonusLabel[WHEEL_BONUS_KEYS[result.label]] || `**${result.label}**`,
        inline: false
      },
      { name: "Balance", value: `${(u.balance || 0).toLocaleString()} ${R}`, inline: true },
      { name: "Extra Spins", value: `${u.wheelExtraSpins || 0}`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot • 🟢 STOPPED" });

  // Send initial frame
  let msg;
  if (typeof interaction.fetchReply === "function") {
    await interaction.reply({ embeds: [spinEmbed(frameLabels[0], spinNum)] });
    msg = await interaction.fetchReply();
  } else {
    msg = await interaction.reply({ embeds: [spinEmbed(frameLabels[0], spinNum)] });
  }

  // Sequential frames
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const delays = [700, 700, 900, 1100];

  for (let i = 1; i < frameLabels.length; i++) {
    await sleep(delays[i - 1]);
    await msg.edit({ embeds: [spinEmbed(frameLabels[i], spinNum)] }).catch(() => {});
  }

  await sleep(1200);
  await msg.edit({ embeds: [resultEmbed] }).catch(() => {});

  // Send invite embed after result
  if (inviteUrl) {
    const inviteEmbed = new (require("discord.js").EmbedBuilder)()
      .setColor(0x5865F2)
      .setTitle("🔗 Get a Bonus Spin!")
      .setDescription(`Share this link — when someone joins using your link, you get **+1 free wheel spin**!\n\n${inviteUrl}`)
      .setFooter({ text: "🎰 Casino Bot" });

    const channel = interaction.channel || msg.channel;
    if (channel) channel.send({ embeds: [inviteEmbed] }).catch(() => {});
    const user = interaction.user || interaction.author;
    if (user) user.send({ embeds: [inviteEmbed] }).catch(() => {});
  }
}

// Called when someone joins via an invite — grant a spin
async function grantWheelSpin(guildId, inviterUserId) {
  const db = loadDB();
  if (!db[guildId]?.[inviterUserId]) return;
  const u = db[guildId][inviterUserId];
  u.wheelExtraSpins = (u.wheelExtraSpins || 0) + 1;
  db[guildId][inviterUserId] = u;
  saveDB(db);
}

module.exports = {
  R,
  WAGER_MILESTONES,
  WHEEL_BONUS_KEYS,
  getBalance, addBalance, removeBalance, setBalance,
  recordGame, getRakebackPct, getRakebackTierName,
  cmdBalance, cmdLeaderboard, cmdProfile,
  cmdTip, cmdRain, cmdGive, cmdTake,
  cmdRakeback, handleRakebackClaim,
  cmdWheel, grantWheelSpin,
  COLORS, baseEmbed,
};
