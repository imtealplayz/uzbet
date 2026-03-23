const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Collection, MessageFlags } = require("discord.js");
const { connectDB, loadDB } = require("./db");
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
  handleWithdrawButton,
  cmdDeposit,
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
    .addUserOption(o => o.setName("user").setDescription("User to credit").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount they deposited").setRequired(true)),

  new SlashCommandBuilder().setName("give").setDescription("Admin: Give coins to a user")
    .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),

  new SlashCommandBuilder().setName("take").setDescription("Admin: Take coins from a user")
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

  new SlashCommandBuilder().setName("givespins").setDescription("Owner: Give wheel spins to a user")
    .addUserOption(o => o.setName("user").setDescription("User to give spins to").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Number of spins to give").setRequired(true)),

  new SlashCommandBuilder().setName("unfreeze").setDescription("Clear a frozen game — no refund will be given"),

  new SlashCommandBuilder().setName("withdraw").setDescription("Withdraw your Robux balance to your Roblox account")
    .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw (min 10)").setRequired(true))
    .addStringOption(o => o.setName("asset_id").setDescription("Your Roblox gamepass Asset ID").setRequired(true)),

  new SlashCommandBuilder().setName("withdrawpanel").setDescription("Send the withdrawal info panel in this channel"),

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
      .addIntegerOption(o => o.setName("amount").setDescription("Minimum Robux amount").setRequired(true))),

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
    case "help":        return cmdHelp(interaction);
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

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`ℹ️ [Games] activeGames map cleared on startup — any frozen games are now auto-released (users can start fresh)`);
  // Pre-cache all invites
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (invites) inviteCache.set(guild.id, invites);
    console.log(`📋 [InviteCache] Cached ${invites?.size ?? 0} invites for guild ${guild.id}`);
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
    const guildId = member.guild.id;
    const cachedBefore = inviteCache.get(guildId) || new Map();

    // Update cache for next time
    const invitesAfter = await member.guild.invites.fetch().catch(() => null);
    if (invitesAfter) inviteCache.set(guildId, invitesAfter);

    // Wheel spin invite tracking
    const data      = loadDB();
    const guildData = data[guildId] || {};

    console.log(`🔍 [WheelInvite] Member joined: ${member.user.username} (${member.user.id})`);
    console.log(`🔍 [WheelInvite] invitesAfter size: ${invitesAfter?.size ?? "null"}, cachedBefore size: ${cachedBefore?.size ?? 0}`);

    let wheelSpinGranted = false;
    for (const [uid, udata] of Object.entries(guildData)) {
      if (typeof udata !== "object") continue;
      // Use stored code directly if available, otherwise parse from URL
      const code = udata.wheelInviteCode || udata.wheelInviteUrl?.split("/").pop() || null;
      if (!code) continue;

      const after  = invitesAfter?.get(code);
      const before = cachedBefore?.get(code);

      console.log(`🔍 [WheelInvite] Checking user ${uid} code=${code} before.uses=${before?.uses ?? "missing"} after.uses=${after?.uses ?? "missing"}`);

      if (after && before && after.uses > before.uses) {
        console.log(`✅ [WheelInvite] Match! Granting spin to ${uid} — ${member.user.username} used their invite`);
        await grantWheelSpin(guildId, uid);
        wheelSpinGranted = true;
        const inviter = await member.client.users.fetch(uid).catch(() => null);
        if (inviter) inviter.send({ embeds: [new (require("discord.js").EmbedBuilder)()
          .setColor(0x2ECC71).setTitle("🎡 Bonus Spin!")
          .setDescription(`**${member.user.username}** joined using your invite!\n\nYou've been awarded **+1 wheel spin**. Use \`/wheel\` to spin!`)
          .setTimestamp().setFooter({ text: "🎰 Casino Bot" })]}).catch(() => {});
        break;
      }
    }
    if (!wheelSpinGranted) {
      console.log(`ℹ️ [WheelInvite] No wheel invite match found for ${member.user.username}`);
    }

    // Affiliate, prize pool, guess code join handlers
    await handleAffiliateMemberJoin(member, client, cachedBefore);
    await handlePrizepoolMemberJoin(member, client, cachedBefore);
    await handleCodeMemberJoin(member, client, cachedBefore);

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
