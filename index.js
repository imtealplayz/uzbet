const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Collection, MessageFlags } = require("discord.js");
const { connectDB, loadDB, saveDB } = require("./db");
const {
  cmdBalance, cmdLeaderboard, cmdProfile,
  cmdTip, cmdRain, cmdGive, cmdTake,
  cmdRakeback, handleRakebackClaim,
  cmdWheel, grantWheelSpin, cmdGiveSpins,
  baseEmbed, COLORS
} = require("./economy");
const {
  cmdSlots, cmdCoinflip, cmdRoulette, cmdBlackjack,
  cmdCrash, cmdMines, cmdTowers, cmdKeno, cmdLimbo,
  handleBlackjack, handleMines, handleTowers,
  cmdUnfreeze,
} = require("./games");
const {
  cmdCreatePromo, cmdRedeemPromo,
  cmdAffiliatePanel, handleAffiliateButton,
  handleAffiliateMemberJoin, handleMemberLeave,
  cmdSetVerifyRole,
  cmdPrizepoolCreate, cmdPrizepoolPanel,
  handlePrizepoolButton, handlePrizepoolMemberJoin,
  cmdPrizepoolReset,
  cmdCreateCode, cmdGuess, cmdEndCode,
  handleCodeButton, handleCodeMemberJoin,
  cmdVerifyPanel, handleVerifyButton,
  cmdSetWagerRole, cmdViewWagerRoles,
  cmdWithdraw, cmdWithdrawPanel,
  cmdSetWithdrawChannel, cmdSetWithdrawMin,
  cmdSetDepositLogChannel, cmdSetWithdrawLogChannel,
  handleWithdrawButton,
  cmdDeposit,
  cmdResetStats,
  cmdMyLinks,
  cmdInvited, cmdInviter,
  cmdHelp,
  cmdAdminHelp,
} = require("./features");

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing BOT_TOKEN or CLIENT_ID in Replit Secrets!");
  process.exit(1);
}

// ─── Slash Commands ───────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder().setName("balance").setDescription("Check your coin balance")
    .addUserOption(o => o.setName("user").setDescription("Check another user")),

  new SlashCommandBuilder().setName("leaderboard").setDescription("Top 10 richest players"),

  new SlashCommandBuilder().setName("profile").setDescription("View your gambling profile and stats")
    .addUserOption(o => o.setName("user").setDescription("View another user's profile")),

  new SlashCommandBuilder().setName("tip").setDescription("Tip another player coins")
    .addUserOption(o => o.setName("user").setDescription("User to tip").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to tip").setRequired(true)),

  new SlashCommandBuilder().setName("rain").setDescription("Make it rain coins!")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to rain (min 100)").setRequired(true))
    .addIntegerOption(o => o.setName("duration").setDescription("Duration in seconds (10–300)").setRequired(true)),

  new SlashCommandBuilder().setName("deposit").setDescription("Admin: Credit a user's manual Robux deposit")
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName("user").setDescription("User to credit").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount they deposited").setRequired(true)),

  new SlashCommandBuilder().setName("give").setDescription("Admin: Give coins to a user")
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),

  new SlashCommandBuilder().setName("take").setDescription("Admin: Take coins from a user")
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),

  new SlashCommandBuilder().setName("slots").setDescription("Spin the slot machine")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet (min 10)").setRequired(true)),

  new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin, double or nothing")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addStringOption(o => o.setName("choice").setDescription("Heads or tails").setRequired(true)
      .addChoices({ name: "🟡 Heads", value: "heads" }, { name: "⚪ Tails", value: "tails" })),

  new SlashCommandBuilder().setName("roulette").setDescription("Spin the roulette wheel")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addStringOption(o => o.setName("type").setDescription("red / black / green / even / odd / 0-36").setRequired(true)),

  new SlashCommandBuilder().setName("blackjack").setDescription("Play blackjack against the dealer")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true)),

  new SlashCommandBuilder().setName("crash").setDescription("Cash out before the multiplier crashes")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true)),

  new SlashCommandBuilder().setName("mines").setDescription("Uncover gems, avoid mines!")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addIntegerOption(o => o.setName("mines").setDescription("Number of mines (1–20)").setRequired(true)),

  new SlashCommandBuilder().setName("towers").setDescription("Climb the tower, pick safe tiles")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addStringOption(o => o.setName("difficulty").setDescription("easy / medium / hard").setRequired(false)
      .addChoices(
        { name: "🟢 Easy (1 bomb)", value: "easy" },
        { name: "🟡 Medium (1-2 bombs)", value: "medium" },
        { name: "🔴 Hard (2 bombs)", value: "hard" }
      )),

  new SlashCommandBuilder().setName("keno").setDescription("Pick numbers and match the draw!")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addStringOption(o => o.setName("picks").setDescription("2–10 numbers (1–80), comma separated. e.g: 3,7,15,22").setRequired(true)),

  new SlashCommandBuilder().setName("limbo").setDescription("Set a target multiplier and see if the result hits it!")
    .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true))
    .addNumberOption(o => o.setName("target").setDescription("Target multiplier (1.01–100)").setRequired(true)),

  new SlashCommandBuilder().setName("rakeback").setDescription("Check and claim your rakeback rewards"),

  new SlashCommandBuilder().setName("wheel").setDescription("Spin the wheel of fortune! (Once every 24h, or use an invite spin)"),

  new SlashCommandBuilder().setName("resetstats").setDescription("Owner: Reset a user's stats")
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName("user").setDescription("User to reset").setRequired(true)),

  new SlashCommandBuilder().setName("givespins").setDescription("Owner: Give wheel spins to a user")
    .setDefaultMemberPermissions(0)
    .addUserOption(o => o.setName("user").setDescription("User to give spins to").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Number of spins to give").setRequired(true)),

  new SlashCommandBuilder().setName("unfreeze").setDescription("Clear a frozen game — no refund will be given"),

  new SlashCommandBuilder().setName("withdraw").setDescription("Withdraw your Robux balance to your Roblox account")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw (min 10)").setRequired(true))
    .addStringOption(o => o.setName("asset_id").setDescription("Your Roblox gamepass Asset ID").setRequired(true)),

  new SlashCommandBuilder().setName("withdrawpanel").setDescription("Send the withdrawal info panel in this channel"),

  new SlashCommandBuilder().setName("mylinks").setDescription("View all your personal invite links in one place"),

  new SlashCommandBuilder().setName("invited").setDescription("See who a user has invited")
    .addUserOption(o => o.setName("user").setDescription("User to check (default: yourself)")),

  new SlashCommandBuilder().setName("inviter").setDescription("See who invited a user")
    .addUserOption(o => o.setName("user").setDescription("User to check (default: yourself)")),

  new SlashCommandBuilder().setName("help").setDescription("View all available commands and how to use them"),

  new SlashCommandBuilder().setName("promo").setDescription("Redeem a promo code")
    .addStringOption(o => o.setName("code").setDescription("The promo code").setRequired(true)),

  new SlashCommandBuilder().setName("affiliate").setDescription("View affiliate program panel"),

  new SlashCommandBuilder().setName("prizepool").setDescription("View the prize pool"),

  new SlashCommandBuilder().setName("guess").setDescription("Guess the current code to win a prize!")
    .addStringOption(o => o.setName("code").setDescription("Your 8-character guess").setRequired(true)),

  // ─── Admin-only slash commands ───────────────────────────────────────────────
  new SlashCommandBuilder().setName("admin")
    .setDescription("Admin commands")
    .setDefaultMemberPermissions(0)
    .addSubcommand(s => s.setName("help").setDescription("View all admin commands"))
    .addSubcommand(s => s.setName("setrole").setDescription("Set the verified role for affiliate")
      .addRoleOption(o => o.setName("role").setDescription("The role to count as verified").setRequired(true)))
    .addSubcommand(s => s.setName("createpromo").setDescription("Create a promo code")
      .addStringOption(o => o.setName("code").setDescription("Promo code").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Robux reward").setRequired(true))
      .addIntegerOption(o => o.setName("uses").setDescription("Max uses (0 = unlimited)"))
      .addStringOption(o => o.setName("expires").setDescription("Expiry e.g. 24h, 7d, 30m")))
    .addSubcommand(s => s.setName("affiliatepanel").setDescription("Send the affiliate panel in this channel"))
    .addSubcommand(s => s.setName("prizepoolcreate").setDescription("Add to the prize pool")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to add").setRequired(true)))
    .addSubcommand(s => s.setName("prizepoolpanel").setDescription("Send the prize pool panel in this channel"))
    .addSubcommand(s => s.setName("createcode").setDescription("Create a guess-the-code puzzle")
      .addIntegerOption(o => o.setName("prize").setDescription("Prize for the winner").setRequired(true)))
    .addSubcommand(s => s.setName("endcode").setDescription("End the current code puzzle"))
    .addSubcommand(s => s.setName("verifypanel").setDescription("Send the verify panel in this channel"))
    .addSubcommand(s => s.setName("prizepoolreset").setDescription("Reset the prize pool to zero and delete all invites"))
    .addSubcommand(s => s.setName("wagerrole").setDescription("Set a role for a wager milestone")
      .addIntegerOption(o => o.setName("milestone").setDescription("Wager milestone (1000/5000/10000/25000/50000/75000/100000)").setRequired(true)
        .addChoices(
          { name: "1,000 wagered",    value: 1000   },
          { name: "5,000 wagered",    value: 5000   },
          { name: "10,000 wagered",   value: 10000  },
          { name: "25,000 wagered",   value: 25000  },
          { name: "50,000 wagered",   value: 50000  },
          { name: "75,000 wagered",   value: 75000  },
          { name: "100,000 wagered",  value: 100000 }
        ))
      .addRoleOption(o => o.setName("role").setDescription("Role to assign").setRequired(true)))
    .addSubcommand(s => s.setName("viewwagerroles").setDescription("View all configured wager roles"))
    .addSubcommand(s => s.setName("setwithdrawchannel").setDescription("Set the channel where withdrawal requests are sent")
      .addChannelOption(o => o.setName("channel").setDescription("Admin channel for withdrawal requests").setRequired(true)))
    .addSubcommand(s => s.setName("setwithdrawmin").setDescription("Set the minimum withdrawal amount")
      .addIntegerOption(o => o.setName("amount").setDescription("Minimum Robux amount").setRequired(true)))
    .addSubcommand(s => s.setName("setdepositlogchannel").setDescription("Set the public deposit log channel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to post deposit logs in").setRequired(true)))
    .addSubcommand(s => s.setName("setwithdrawlogchannel").setDescription("Set the public withdrawal log channel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to post withdrawal logs in").setRequired(true))),

].map(c => c.toJSON());

// ─── Register Commands ────────────────────────────────────────────────────────

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("📡 Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err.message);
  }
}

// ─── Cooldowns ────────────────────────────────────────────────────────────────

const cooldowns = new Collection();
const COOLDOWN_MS = {
  slots: 5000, coinflip: 5000, roulette: 5000,
  blackjack: 5000, crash: 5000, mines: 5000,
  towers: 5000, keno: 5000, rain: 10000, limbo: 5000,
};

function checkCooldown(userId, cmd) {
  const key = `${userId}-${cmd}`;
  const now = Date.now();
  const cd = COOLDOWN_MS[cmd] || 3000;
  if (cooldowns.has(key)) {
    const exp = cooldowns.get(key);
    if (now < exp) return Math.ceil((exp - now) / 1000);
  }
  cooldowns.set(key, now + cd);
  return 0;
}

// ─── Slash Handler ────────────────────────────────────────────────────────────

async function handleSlash(interaction) {
  const { commandName, user, guildId } = interaction;
  const userId = user.id;

  const gameCmds = ["slots","coinflip","roulette","blackjack","crash","mines","towers","keno","rain","limbo"];
  if (gameCmds.includes(commandName)) {
    const wait = checkCooldown(userId, commandName);
    if (wait > 0) {
      return interaction.reply({
        embeds: [baseEmbed("⏳ Slow Down!", COLORS.red).setDescription(`Use **/${commandName}** again in **${wait}s**.`)],
        flags: MessageFlags.Ephemeral
      });
    }
  }

  switch (commandName) {
    case "mylinks":     return cmdMyLinks(interaction, userId, guildId);
    case "invited":     return cmdInvited(interaction, userId, guildId, interaction.options.getUser("user"));
    case "inviter":     return cmdInviter(interaction, userId, guildId, interaction.options.getUser("user"));
    case "help":        return cmdHelp(interaction);
    case "resetstats":  return cmdResetStats(interaction, guildId, interaction.options.getUser("user"));
    case "givespins":   return cmdGiveSpins(interaction, guildId, interaction.options.getUser("user"), interaction.options.getInteger("amount"));
    case "unfreeze":    return cmdUnfreeze(interaction, userId, guildId);
    case "withdraw":    return cmdWithdraw(interaction, userId, guildId, interaction.client);
    case "withdrawpanel": return cmdWithdrawPanel(interaction);
    case "balance":     return cmdBalance(interaction, userId, guildId, interaction.options.getUser("user"));
    case "leaderboard": return cmdLeaderboard(interaction, guildId);
    case "profile":     return cmdProfile(interaction, userId, guildId, interaction.options.getUser("user"));
    case "tip":         return cmdTip(interaction, userId, guildId, interaction.options.getUser("user"), interaction.options.getInteger("amount"));
    case "rain":        return cmdRain(interaction, userId, guildId, interaction.options.getInteger("amount"), interaction.options.getInteger("duration"));
    case "deposit":     return cmdDeposit(interaction, guildId, interaction.options.getUser("user"), interaction.options.getInteger("amount"), interaction.client);
    case "give":        return cmdGive(interaction, guildId, interaction.options.getUser("user"), interaction.options.getInteger("amount"));
    case "take":        return cmdTake(interaction, guildId, interaction.options.getUser("user"), interaction.options.getInteger("amount"));
    case "slots":       return cmdSlots(interaction, userId, guildId, interaction.options.getInteger("bet"));
    case "coinflip":    return cmdCoinflip(interaction, userId, guildId, interaction.options.getInteger("bet"), interaction.options.getString("choice"));
    case "roulette":    return cmdRoulette(interaction, userId, guildId, interaction.options.getInteger("bet"), interaction.options.getString("type"));
    case "blackjack":   return cmdBlackjack(interaction, userId, guildId, interaction.options.getInteger("bet"));
    case "crash":       return cmdCrash(interaction, userId, guildId, interaction.options.getInteger("bet"));
    case "mines":       return cmdMines(interaction, userId, guildId, interaction.options.getInteger("bet"), interaction.options.getInteger("mines"));
    case "towers":      return cmdTowers(interaction, userId, guildId, interaction.options.getInteger("bet"), interaction.options.getString("difficulty") || "easy");
    case "keno":        return cmdKeno(interaction, userId, guildId, interaction.options.getInteger("bet"), interaction.options.getString("picks"));
    case "limbo":       return cmdLimbo(interaction, userId, guildId, interaction.options.getInteger("bet"), interaction.options.getNumber("target"));
    case "rakeback":    return cmdRakeback(interaction, userId, guildId);
    case "wheel":       return cmdWheel(interaction, userId, guildId);
    case "promo":       return cmdRedeemPromo(interaction, userId, guildId);
    case "affiliate":   return interaction.reply({ content: "Use the affiliate panel buttons!", flags: MessageFlags.Ephemeral });
    case "prizepool":   return interaction.reply({ content: "Use the prize pool panel buttons!", flags: MessageFlags.Ephemeral });
    case "guess":       return cmdGuess(interaction, userId, guildId);
    case "admin": {
      const sub = interaction.options.getSubcommand();
      if (sub === "help")           return cmdAdminHelp(interaction);
      if (sub === "setrole")        return cmdSetVerifyRole(interaction);
      if (sub === "createpromo")    return cmdCreatePromo(interaction);
      if (sub === "affiliatepanel") return cmdAffiliatePanel(interaction, guildId);
      if (sub === "prizepoolcreate") return cmdPrizepoolCreate(interaction, interaction.client);
      if (sub === "prizepoolpanel") return cmdPrizepoolPanel(interaction, interaction.client);
      if (sub === "createcode")     return cmdCreateCode(interaction, interaction.client);
      if (sub === "endcode")        return cmdEndCode(interaction, interaction.client);
      if (sub === "verifypanel")    return cmdVerifyPanel(interaction);
      if (sub === "prizepoolreset") return cmdPrizepoolReset(interaction, interaction.client);
      if (sub === "wagerrole")            return cmdSetWagerRole(interaction);
      if (sub === "viewwagerroles")       return cmdViewWagerRoles(interaction);
      if (sub === "setwithdrawchannel")   return cmdSetWithdrawChannel(interaction);
      if (sub === "setwithdrawmin")       return cmdSetWithdrawMin(interaction);
      if (sub === "setdepositlogchannel") return cmdSetDepositLogChannel(interaction);
      if (sub === "setwithdrawlogchannel") return cmdSetWithdrawLogChannel(interaction);
      break;
    }
  }
}

// ─── Button Router ────────────────────────────────────────────────────────────

async function handleButton(interaction) {
  const { customId, user, guildId } = interaction;
  if (customId.startsWith("bj_"))                                         return handleBlackjack(interaction);
  if (customId.startsWith("mines_"))                                      return handleMines(interaction);
  if (customId.startsWith("tower_pick_") || customId === "tower_cashout") return handleTowers(interaction);
  if (customId === "rakeback_claim")                                       return handleRakebackClaim(interaction, user.id, guildId);
  if (customId.startsWith("aff_"))                                        return handleAffiliateButton(interaction, user.id, guildId);
  if (customId.startsWith("pp_"))                                         return handlePrizepoolButton(interaction, user.id, guildId, interaction.client);
  if (customId.startsWith("code_"))                                       return handleCodeButton(interaction, user.id, guildId, interaction.client);
  if (customId === "verify_click")                                        return handleVerifyButton(interaction, user.id, guildId, interaction.client);
  if (customId.startsWith("wd_"))                                         return handleWithdrawButton(interaction, interaction.client);
}

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
  ]
});

// ─── Invite Cache (for tracking which invite was used on join) ────────────────

const inviteCache = new Map(); // guildId -> Collection of invites

function getInviteUseSnapshots(db) {
  if (!db.inviteUseSnapshots || typeof db.inviteUseSnapshots !== "object") db.inviteUseSnapshots = {};
  return db.inviteUseSnapshots;
}

function getGuildInviteSnapshot(db, guildId) {
  const root = getInviteUseSnapshots(db);
  if (!root[guildId] || typeof root[guildId] !== "object") root[guildId] = {};
  return root[guildId];
}

function updateGuildInviteSnapshotFromCollection(db, guildId, invitesCollection) {
  const snap = getGuildInviteSnapshot(db, guildId);
  if (!invitesCollection) return snap;

  // Replace snapshot with the latest known uses for all current invites.
  // This is safe: it doesn't delete any of your existing bot data keys,
  // it only maintains a per-guild mapping of code -> lastKnownUses.
  const next = {};
  for (const [code, inv] of invitesCollection) next[code] = Number(inv?.uses || 0);
  getInviteUseSnapshots(db)[guildId] = next;
  return next;
}

function detectUsedInviteCode(invitesAfter, snapshotBefore) {
  if (!invitesAfter) return null;

  let bestCode = null;
  let bestDelta = 0;

  for (const [code, inv] of invitesAfter) {
    const afterUses = Number(inv?.uses || 0);
    const beforeUses = Number(snapshotBefore?.[code] || 0);
    const delta = afterUses - beforeUses;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestCode = code;
    }
  }

  // A join should increment exactly one invite by +1.
  return bestDelta > 0 ? bestCode : null;
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`ℹ️ [Games] activeGames map cleared on startup — any frozen games are now auto-released (users can start fresh)`);
  // Pre-cache all invites
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (invites) inviteCache.set(guild.id, invites);
    console.log(`📋 [InviteCache] Cached ${invites?.size ?? 0} invites for guild ${guild.id}`);

    // Persist a baseline snapshot so invite attribution keeps working after restarts.
    // (Fixes the "all invites credit one person" problem caused by unreliable fallback.)
    try {
      const db = loadDB();
      updateGuildInviteSnapshotFromCollection(db, guild.id, invites);
      saveDB(db);
    } catch (err) {
      console.error("Invite snapshot init error:", err);
    }
  }
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleSlash(interaction);
    if (interaction.isButton())           return await handleButton(interaction);
  } catch (err) {
    console.error("Interaction error:", err);
    const msg = { embeds: [baseEmbed("❌ Error", COLORS.red).setDescription("Something went wrong. Please try again.")], flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    const guildId  = member.guild.id;
    const userId   = member.user.id;
    const cachedBefore = inviteCache.get(guildId) || new Map();

    // Load persistent snapshot from DB (survives bot restarts)
    const dbBefore = loadDB();
    const snapshotBefore = getGuildInviteSnapshot(dbBefore, guildId);

    // Fetch current invites
    const invitesAfter = await member.guild.invites.fetch().catch(() => null);
    if (invitesAfter) inviteCache.set(guildId, invitesAfter);

    console.log(`👋 [Join] ${member.user.username} (${userId}) | before:${cachedBefore.size} after:${invitesAfter?.size ?? "null"}`);

    // ── Determine which invite code was used ──────────────────────────────────
    // We compare against a persistent snapshot stored in MongoDB, so it works
    // correctly even if the bot restarts and the in-memory cache is empty.
    let usedInviteCode = detectUsedInviteCode(invitesAfter, snapshotBefore);

    // Fallback to in-memory cache diff (still useful if snapshot is missing/new)
    if (!usedInviteCode && invitesAfter) {
      for (const [code, invite] of invitesAfter) {
        const before = cachedBefore.get(code);
        if (before && invite.uses > before.uses) {
          usedInviteCode = code;
          break;
        }
      }
    }

    if (usedInviteCode && invitesAfter) {
      console.log(`🔗 [Join] Code detected: ${usedInviteCode}`);
    }

    // Update snapshot after processing (so next join compares correctly)
    if (invitesAfter) {
      try {
        const dbAfter = loadDB();
        updateGuildInviteSnapshotFromCollection(dbAfter, guildId, invitesAfter);
        saveDB(dbAfter);
      } catch (err) {
        console.error("Invite snapshot update error:", err);
      }
    }

    if (!usedInviteCode) {
      console.log(`⚠️ [Join] Could not detect invite code for ${member.user.username}`);
    } else {
      console.log(`✅ [Join] Using invite code: ${usedInviteCode}`);
    }

    // ── Wheel spin tracking ───────────────────────────────────────────────────
    let wheelSpinGranted = false;
    if (usedInviteCode) {
      const db        = loadDB();
      const guildData = db[guildId] || {};
      for (const [uid, udata] of Object.entries(guildData)) {
        if (typeof udata !== "object") continue;
        const userWheelCode = udata.wheelInviteCode || udata.wheelInviteUrl?.split("/").pop() || null;
        if (!userWheelCode || userWheelCode !== usedInviteCode) continue;
        console.log(`🎡 [WheelInvite] Granting spin to ${uid}`);
        await grantWheelSpin(guildId, uid);
        wheelSpinGranted = true;
        const inviter = await client.users.fetch(uid).catch(() => null);
        if (inviter) inviter.send({ embeds: [new (require("discord.js").EmbedBuilder)()
          .setColor(0x2ECC71).setTitle("🎡 Bonus Spin!")
          .setDescription(`**${member.user.username}** joined using your invite!\n\nYou've been awarded **+1 wheel spin**. Use \`/wheel\` to spin!`)
          .setTimestamp().setFooter({ text: "🎰 Casino Bot" })]}).catch(() => {});
        break;
      }
    }

    // ── Affiliate / prizepool / guesscode ─────────────────────────────────────
    const affMatched  = await handleAffiliateMemberJoin(member, client, cachedBefore, invitesAfter, usedInviteCode);
    const ppMatched   = await handlePrizepoolMemberJoin(member, client, cachedBefore, invitesAfter, usedInviteCode);
    const codeMatched = await handleCodeMemberJoin(member, client, cachedBefore, invitesAfter, usedInviteCode);

    console.log(`📊 [Join] wheel:${wheelSpinGranted} aff:${affMatched} pp:${ppMatched} code:${codeMatched}`);

    // ── No match DM ──────────────────────────────────────────────────────────
    if (!wheelSpinGranted && !affMatched && !ppMatched && !codeMatched) {
      member.user.send({ embeds: [new (require("discord.js").EmbedBuilder)()
        .setColor(0x5865F2).setTitle("👋 Welcome!")
        .setDescription(`Welcome to the server!\n\nYour invite link didn't qualify for any active reward programs.\n\nUse \`/wheel\` for a free daily spin to get started! 🎡`)
        .setTimestamp().setFooter({ text: "🎰 Casino Bot" })]
      }).catch(() => {});
    }

  } catch (err) {
    console.error("guildMemberAdd error:", err);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    await handleMemberLeave(member);
  } catch (err) {
    console.error("guildMemberRemove error:", err);
  }
});

// Connect to MongoDB first, then start the bot
connectDB().then(() => {
  client.login(TOKEN);
});
