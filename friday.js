const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("node:fs");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const COLORS = {
  CYAN: 0x00ffff,
  ALERT: 0xff4500,
};

const CONFIG_FILE = path.join(__dirname, "friday-config.json");
const STATE_FILE = path.join(__dirname, "friday-state.json");

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[JSON] Falha ao ler ${filePath}:`, error);
    return fallback;
  }
}

function writeJson(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch (error) {
    console.error(`[JSON] Falha ao salvar ${filePath}:`, error);
  }
}

// Debounced async writer para o STATE_FILE — evita I/O síncrono massivo em guilds ativas
const _stateWriteTimers = new Map();
function writeStateDebounced(delayMs = 2000) {
  if (_stateWriteTimers.has(STATE_FILE)) clearTimeout(_stateWriteTimers.get(STATE_FILE));
  _stateWriteTimers.set(
    STATE_FILE,
    setTimeout(() => {
      _stateWriteTimers.delete(STATE_FILE);
      writeJson(STATE_FILE, state);
    }, delayMs).unref()
  );
}

const db = readJson(CONFIG_FILE, { guilds: {} });
const _rawState = readJson(STATE_FILE, {});
const state = {
  guilds: (_rawState.guilds && typeof _rawState.guilds === "object") ? _rawState.guilds : {},
  anonymousThreads: (_rawState.anonymousThreads && typeof _rawState.anonymousThreads === "object") ? _rawState.anonymousThreads : {},
  edithDelegations: Array.isArray(_rawState.edithDelegations) ? _rawState.edithDelegations : [],
};

function createGuildConfig() {
  return {
    welcome: {
      enabled: true,
      dmTemplate:
        "Bem-vindo(a), {user}, ao servidor **{server_name}**.\nLeia as regras em {rules_channel}.\nVoce e o membro #{member_count}.",
      rulesChannelId: null,
    },
    onboarding: {
      enabled: true,
      panelChannelId: null,
      questions: [
        {
          key: "idioma",
          label: "Idioma principal",
          type: "select",
          options: ["Portugues", "English", "Espanol"],
          roleMap: {},
        },
      ],
    },
    autoRoles: {
      panels: [],
    },
    voiceCreator: {
      enabled: false,
      categoryId: null,
      panelChannelId: null,
      masterChannelId: null,
      masterChannelName: "➕ criar-sala",
      adminPanelMessageId: null,
      allowedRoleIds: [],
      maxActiveRooms: 0,
    },
    tickets: {
      enabled: false,
      openCategoryId: null,
      logsChannelId: null,
      staffRoleId: null,
      panelChannelId: null,
      panelMessageId: null,
      counter: 0,
    },
    ouvidoria: {
      forumChannelId: null,
    },
    classes: {
      roleByClass: {
        tank: null,
        healer: null,
        dps_melee: null,
        dps_ranger: null,
        suporte: null,
      },
    },
    protocols: {
      quarantineRoleId: null,
      containmentCategoryId: null,
      containmentChannelId: null,
      meetingCategoryId: null,
      staffRoleIds: [],
      edithRoleId: null,
    },
    automation: {
      boosterRoleId: null,
    },
  };
}

function createGuildState() {
  return {
    memberLastActivity: {},
    antiSpam: {},
    tempVoiceOwners: {},
    tickets: {},
    onboardingAnswers: {},
    staffStats: {},
  };
}

function ensureGuildConfig(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = createGuildConfig();
  const cfg = db.guilds[guildId];
  cfg.voiceCreator = cfg.voiceCreator || {};
  cfg.voiceCreator.enabled = !!cfg.voiceCreator.enabled;
  cfg.voiceCreator.categoryId = cfg.voiceCreator.categoryId || null;
  cfg.voiceCreator.panelChannelId = cfg.voiceCreator.panelChannelId || null;
  cfg.voiceCreator.masterChannelId = cfg.voiceCreator.masterChannelId || null;
  cfg.voiceCreator.masterChannelName = cfg.voiceCreator.masterChannelName || "➕ criar-sala";
  cfg.voiceCreator.adminPanelMessageId = cfg.voiceCreator.adminPanelMessageId || null;
  cfg.voiceCreator.allowedRoleIds = Array.isArray(cfg.voiceCreator.allowedRoleIds)
    ? cfg.voiceCreator.allowedRoleIds
    : [];
  cfg.voiceCreator.maxActiveRooms = Number.isInteger(cfg.voiceCreator.maxActiveRooms)
    ? cfg.voiceCreator.maxActiveRooms
    : 0;

  cfg.tickets = cfg.tickets || {};
  cfg.tickets.enabled = !!cfg.tickets.enabled;
  cfg.tickets.openCategoryId = cfg.tickets.openCategoryId || null;
  cfg.tickets.logsChannelId = cfg.tickets.logsChannelId || null;
  cfg.tickets.staffRoleId = cfg.tickets.staffRoleId || null;
  cfg.tickets.panelChannelId = cfg.tickets.panelChannelId || null;
  cfg.tickets.panelMessageId = cfg.tickets.panelMessageId || null;
  cfg.tickets.counter = Number.isInteger(cfg.tickets.counter) ? cfg.tickets.counter : 0;

  cfg.autoRoles = cfg.autoRoles || {};
  cfg.autoRoles.panels = Array.isArray(cfg.autoRoles.panels) ? cfg.autoRoles.panels : [];

  cfg.protocols = cfg.protocols || {};
  cfg.protocols.staffRoleIds = Array.isArray(cfg.protocols.staffRoleIds) ? cfg.protocols.staffRoleIds : [];

  cfg.classes = cfg.classes || {};
  cfg.classes.roleByClass = cfg.classes.roleByClass || {};

  cfg.ouvidoria = cfg.ouvidoria || {};
  cfg.ouvidoria.forumChannelId = cfg.ouvidoria.forumChannelId || null;

  cfg.automation = cfg.automation || {};

  return db.guilds[guildId];
}

function ensureGuildState(guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = createGuildState();
  const s = state.guilds[guildId];
  if (!s.tickets || typeof s.tickets !== "object") s.tickets = {};
  if (!s.antiSpam || typeof s.antiSpam !== "object") s.antiSpam = {};
  if (!s.tempVoiceOwners || typeof s.tempVoiceOwners !== "object") s.tempVoiceOwners = {};
  if (!s.memberLastActivity || typeof s.memberLastActivity !== "object") s.memberLastActivity = {};
  if (!s.onboardingAnswers || typeof s.onboardingAnswers !== "object") s.onboardingAnswers = {};
  if (!s.staffStats || typeof s.staffStats !== "object") s.staffStats = {};
  return s;
}

function ensureStaffStats(guildState, userId) {
  if (!guildState.staffStats[userId]) {
    guildState.staffStats[userId] = {
      deletedMessages: 0,
      bans: 0,
      kicks: 0,
      timeouts: 0,
      voiceMs: 0,
      voiceJoinAt: null,
      auctionsClosed: 0,
    };
  }
  return guildState.staffStats[userId];
}

function nowIso() {
  return new Date().toISOString();
}

function parseRoleList(text) {
  return text
    .split(/[,\s]+/g)
    .map((v) => v.trim().replace(/[<@&>]/g, ""))
    .filter(Boolean);
}

function parseDurationToMs(raw) {
  const match = /^(\d+)\s*([smhd])$/i.exec(raw);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function formatWelcome(template, member, guildConfig) {
  const rules = guildConfig.welcome.rulesChannelId
    ? `<#${guildConfig.welcome.rulesChannelId}>`
    : "canal-nao-configurado";
  return template
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{server_name}", member.guild.name)
    .replaceAll("{member_count}", String(member.guild.memberCount))
    .replaceAll("{rules_channel}", rules);
}

function hasAnyRole(member, roleIds) {
  if (!member?.roles?.cache || !Array.isArray(roleIds) || !roleIds.length) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function canUseVoiceCreator(member, guildConfig) {
  const allowed = guildConfig.voiceCreator.allowedRoleIds || [];
  if (!allowed.length) return true;
  return hasAnyRole(member, allowed);
}

function countActiveVoiceRooms(guildState) {
  return Object.keys(guildState.tempVoiceOwners || {}).length;
}

function buildVoiceOwnerPanel(guildId, channelId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`voice:rename:${guildId}:${channelId}`)
      .setLabel("Renomear Sala")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`voice:limit:${guildId}:${channelId}`)
      .setLabel("Limite")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`voice:lock:${guildId}:${channelId}`)
      .setLabel("Trancar Sala")
      .setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`voice:hide:${guildId}:${channelId}`)
      .setLabel("Ocultar para Membro")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`voice:kick:${guildId}:${channelId}`)
      .setLabel("Expulsar Membro")
      .setStyle(ButtonStyle.Danger)
  );
  return [row1, row2];
}

function canManageTicket(member, guildConfig, ticketOwnerId) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (ticketOwnerId && member.id === ticketOwnerId) return true;
  return !!(guildConfig.tickets.staffRoleId && member.roles.cache.has(guildConfig.tickets.staffRoleId));
}

function buildTicketOpenPanel(guildId) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.CYAN)
    .setTitle("Central de Tickets")
    .setDescription("Clique no botao abaixo para abrir um ticket privado com a equipe.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:open:${guildId}`)
      .setLabel("Abrir Ticket")
      .setStyle(ButtonStyle.Primary)
  );
  return { embed, components: [row] };
}

function buildTicketControlPanel(guildId, channelId, isClosed) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${guildId}:${channelId}`)
      .setLabel("Fechar")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!!isClosed),
    new ButtonBuilder()
      .setCustomId(`ticket:save:${guildId}:${channelId}`)
      .setLabel("Guardar Registro")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket:reopen:${guildId}:${channelId}`)
      .setLabel("Reabertura")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!isClosed)
  );
  return [row];
}

async function publishOrRefreshTicketPanel(guild, guildConfig) {
  const panelChannel = guild.channels.cache.get(guildConfig.tickets.panelChannelId);
  if (!panelChannel || panelChannel.type !== ChannelType.GuildText) return;
  const payload = buildTicketOpenPanel(guild.id);
  let panelMessage = null;
  if (guildConfig.tickets.panelMessageId) {
    panelMessage = await panelChannel.messages.fetch(guildConfig.tickets.panelMessageId).catch(() => null);
  }
  if (panelMessage) {
    await panelMessage.edit({ embeds: [payload.embed], components: payload.components });
    return panelMessage;
  }
  const sent = await panelChannel.send({ embeds: [payload.embed], components: payload.components });
  guildConfig.tickets.panelMessageId = sent.id;
  writeJson(CONFIG_FILE, db);
  return sent;
}

async function collectTicketTranscript(channel) {
  const all = [];
  let before;
  for (let i = 0; i < 10; i += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [];
  lines.push(`Ticket transcript: #${channel.name}`);
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push("--------------------------------------------------");

  for (const msg of all) {
    const when = new Date(msg.createdTimestamp).toISOString();
    const author = `${msg.author?.tag || "desconhecido"} (${msg.author?.id || "?"})`;
    const content = (msg.content || "").replace(/\r?\n/g, " ").trim();
    const attachments = msg.attachments?.size
      ? ` [anexos: ${[...msg.attachments.values()].map((a) => a.url).join(", ")}]`
      : "";
    lines.push(`[${when}] ${author}: ${content || "(sem texto)"}${attachments}`);
  }

  return lines.join("\n");
}

function buildVoiceAdminPanel(guild, guildConfig, guildState) {
  const allowed = guildConfig.voiceCreator.allowedRoleIds || [];
  const allowedText = allowed.length ? allowed.map((id) => `<@&${id}>`).join(", ") : "Todos";
  const limit = guildConfig.voiceCreator.maxActiveRooms || 0;
  const active = countActiveVoiceRooms(guildState);
  const embed = new EmbedBuilder()
    .setColor(COLORS.CYAN)
    .setTitle("Creator Voice - Painel Admin")
    .setDescription(
      `Canal mestre: <#${guildConfig.voiceCreator.masterChannelId}>\nCategoria: <#${guildConfig.voiceCreator.categoryId}>`
    )
    .addFields(
      { name: "Cargos autorizados a criar sala", value: allowedText.slice(0, 1024) },
      { name: "Limite global de salas", value: limit === 0 ? "Ilimitado" : String(limit), inline: true },
      { name: "Salas ativas agora", value: String(active), inline: true }
    );

  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId(`voiceAdmin:roles:${guild.id}`)
    .setPlaceholder("Selecione os cargos autorizados")
    .setMinValues(1)
    .setMaxValues(25);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`voiceAdmin:set_limit:${guild.id}`)
      .setLabel("Definir Limite de Salas")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`voiceAdmin:clear_roles:${guild.id}`)
      .setLabel("Liberar para Todos")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`voiceAdmin:refresh:${guild.id}`)
      .setLabel("Atualizar Painel")
      .setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(roleMenu);
  return { embed, components: [row1, row2] };
}

async function applyVoiceCreatorAccess(guild, guildConfig) {
  const master = guild.channels.cache.get(guildConfig.voiceCreator.masterChannelId);
  if (!master || master.type !== ChannelType.GuildVoice) return;

  for (const [targetId] of master.permissionOverwrites.cache) {
    if (targetId === guild.roles.everyone.id) continue;
    if (!guild.roles.cache.has(targetId)) continue;
    await master.permissionOverwrites.delete(targetId).catch(() => null);
  }

  const allowed = guildConfig.voiceCreator.allowedRoleIds || [];
  if (!allowed.length) {
    await master.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: true,
      Connect: true,
    });
    return;
  }

  await master.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: true,
    Connect: false,
  });
  for (const roleId of allowed) {
    await master.permissionOverwrites.edit(roleId, {
      ViewChannel: true,
      Connect: true,
    });
  }
}

async function publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState) {
  const panelChannel = guild.channels.cache.get(guildConfig.voiceCreator.panelChannelId);
  if (!panelChannel || panelChannel.type !== ChannelType.GuildText) return;
  const payload = buildVoiceAdminPanel(guild, guildConfig, guildState);
  let panelMessage = null;
  if (guildConfig.voiceCreator.adminPanelMessageId) {
    panelMessage = await panelChannel.messages
      .fetch(guildConfig.voiceCreator.adminPanelMessageId)
      .catch(() => null);
  }
  if (panelMessage) {
    await panelMessage.edit({ embeds: [payload.embed], components: payload.components });
    return panelMessage;
  }
  const sent = await panelChannel.send({ embeds: [payload.embed], components: payload.components });
  guildConfig.voiceCreator.adminPanelMessageId = sent.id;
  writeJson(CONFIG_FILE, db);
  return sent;
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (e) {
    console.error("[safeReply] Falha ao responder interacao:", e?.message || e);
  }
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

const onboardingSessions = new Map();
const autoRoleBuildSessions = new Map();
const AUTO_ROLE_BUILD_TTL_MS = 15 * 60 * 1000;
// Lock por guild para evitar race condition na criação simultânea de salas de voz
const voiceCreationLocks = new Set();

function pruneAutoRoleBuildSessions() {
  const now = Date.now();
  for (const [buildId, session] of autoRoleBuildSessions.entries()) {
    if (!session?.createdAt || now - session.createdAt > AUTO_ROLE_BUILD_TTL_MS) {
      autoRoleBuildSessions.delete(buildId);
    }
  }
}

// Limpeza periódica do state: remove dados de anti-spam e atividade muito antiga
function pruneState() {
  const now = Date.now();
  const cutoff = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 dias
  for (const guildId of Object.keys(state.guilds)) {
    const s = state.guilds[guildId];
    // Remover registros de atividade com mais de 90 dias
    for (const [userId, iso] of Object.entries(s.memberLastActivity || {})) {
      if (iso < cutoff) delete s.memberLastActivity[userId];
    }
    // Buckets de anti-spam são temporários — limpar completamente no boot/diariamente
    s.antiSpam = {};
  }
  writeJson(STATE_FILE, state);
  console.log("[PRUNE] State limpo.");
}

async function sendNextOnboardingStep(interactionOrMessage, guild, userId) {
  const guildConfig = ensureGuildConfig(guild.id);
  const sessionKey = `${guild.id}:${userId}`;
  const session = onboardingSessions.get(sessionKey);
  if (!session) return;

  const question = guildConfig.onboarding.questions[session.index];
  if (!question) {
    onboardingSessions.delete(sessionKey);
    const payload = {
      content: "Onboarding finalizado com sucesso.",
      components: [],
      flags: MessageFlags.Ephemeral,
    };
    if (interactionOrMessage.editReply) return interactionOrMessage.editReply(payload);
    if (interactionOrMessage.reply) return interactionOrMessage.reply(payload);
    return;
  }

  if (question.type === "select") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`onboard:select:${guild.id}:${question.key}`)
      .setPlaceholder(question.label)
      .addOptions(
        question.options.slice(0, 25).map((opt) => ({
          label: opt.slice(0, 100),
          value: opt.slice(0, 100),
        }))
      );
    const row = new ActionRowBuilder().addComponents(menu);
    const payload = {
      content: `**${question.label}**\nSelecione uma opcao:`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    };
    if (interactionOrMessage.editReply) return interactionOrMessage.editReply(payload);
    if (interactionOrMessage.reply) return interactionOrMessage.reply(payload);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`onboard:modal:${guild.id}:${question.key}`)
    .setTitle("Onboarding");
  const input = new TextInputBuilder()
    .setCustomId("answer")
    .setLabel(question.label.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(800);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  if (interactionOrMessage.showModal) return interactionOrMessage.showModal(modal);
}

async function ensureEdithRole(guild, guildConfig) {
  if (guildConfig.protocols.edithRoleId) {
    const found = guild.roles.cache.get(guildConfig.protocols.edithRoleId);
    if (found) return found;
  }
  const role = await guild.roles.create({
    name: "EDITH-Temp-Admin",
    permissions: [PermissionFlagsBits.Administrator],
    color: COLORS.ALERT,
    reason: "Criacao automatica Protocolo EDITH",
  });
  guildConfig.protocols.edithRoleId = role.id;
  writeJson(CONFIG_FILE, db);
  return role;
}

function parseAutoRoleDetails(rawText, selectedRoles) {
  const fallback = "Clique para adicionar/remover este cargo.";
  const result = {};
  if (!rawText?.trim()) {
    for (const role of selectedRoles) result[role.id] = fallback;
    return result;
  }

  const byId = {};
  const byName = {};
  const lines = rawText
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  for (const line of lines) {
    let match = line.match(/^<@&(\d+)>\s*[:|\-]\s*(.+)$/);
    if (match) {
      byId[match[1]] = match[2].trim();
      continue;
    }
    match = line.match(/^(\d{10,20})\s*[:|\-]\s*(.+)$/);
    if (match) {
      byId[match[1]] = match[2].trim();
      continue;
    }
    match = line.match(/^(.+?)\s*[:|\-]\s*(.+)$/);
    if (match) {
      byName[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }

  for (const role of selectedRoles) {
    const byRoleId = byId[role.id];
    const byRoleName = byName[role.name.toLowerCase()];
    result[role.id] = (byRoleId || byRoleName || fallback).slice(0, 100);
  }
  return result;
}

function buildCommands() {
  const setup = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configuracao centralizada do Friday")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName("boas_vindas")
        .setDescription("Configura mensagem DM de boas-vindas")
        .addStringOption((o) => o.setName("mensagem").setDescription("Template").setRequired(true))
        .addChannelOption((o) =>
          o
            .setName("canal_regras")
            .setDescription("Canal de regras")
            .addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((o) => o.setName("ativar").setDescription("Ativar/desativar"))
    )
    .addSubcommand((s) =>
      s
        .setName("onboarding_canal")
        .setDescription("Canal do painel onboarding")
        .addChannelOption((o) =>
          o
            .setName("canal")
            .setDescription("Canal de texto")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("onboarding_pergunta")
        .setDescription("Adiciona/atualiza pergunta do onboarding")
        .addStringOption((o) => o.setName("chave").setDescription("Ex: idioma").setRequired(true))
        .addStringOption((o) => o.setName("titulo").setDescription("Pergunta").setRequired(true))
        .addStringOption((o) =>
          o
            .setName("tipo")
            .setDescription("Tipo")
            .setRequired(true)
            .addChoices(
              { name: "select", value: "select" },
              { name: "texto", value: "text" }
            )
        )
        .addStringOption((o) =>
          o.setName("opcoes").setDescription("Somente select; separar por virgula")
        )
    )
    .addSubcommand((s) =>
      s
        .setName("onboarding_mapeamento")
        .setDescription("Mapeia resposta para cargo")
        .addStringOption((o) => o.setName("chave").setDescription("Chave").setRequired(true))
        .addStringOption((o) => o.setName("resposta").setDescription("Opcao").setRequired(true))
        .addRoleOption((o) => o.setName("cargo").setDescription("Cargo").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("ouvidoria_forum")
        .setDescription("Define forum da ouvidoria")
        .addChannelOption((o) =>
          o
            .setName("canal")
            .setDescription("Canal forum")
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("class_role")
        .setDescription("Mapeia classe para cargo")
        .addStringOption((o) =>
          o
            .setName("classe")
            .setDescription("Classe")
            .setRequired(true)
            .addChoices(
              { name: "tank", value: "tank" },
              { name: "healer", value: "healer" },
              { name: "dps_melee", value: "dps_melee" },
              { name: "dps_ranger", value: "dps_ranger" },
              { name: "suporte", value: "suporte" }
            )
        )
        .addRoleOption((o) => o.setName("cargo").setDescription("Cargo").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("protocolos")
        .setDescription("Configura protocolos Stark")
        .addRoleOption((o) =>
          o
            .setName("cargo_quarentena")
            .setDescription("Cargo quarentena")
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName("categoria_contencao")
            .setDescription("Categoria contencao")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o
            .setName("categoria_reuniao")
            .setDescription("Categoria reuniao")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("cargos_staff")
            .setDescription("IDs/menções separados por virgula")
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("booster_role")
        .setDescription("Cargo auto para server booster")
        .addRoleOption((o) => o.setName("cargo").setDescription("Cargo").setRequired(true))
    )
    .addSubcommand((s) => s.setName("ver").setDescription("Resumo da configuracao"));

  const list = [
    setup,
    new SlashCommandBuilder()
      .setName("novos_membros")
      .setDescription("Publica painel de onboarding")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("dm_boas_vindas")
      .setDescription("Define a mensagem automatica de boas-vindas por DM")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o.setName("mensagem").setDescription("Template personalizado").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("auto_cargos")
      .setDescription("Cria painel de auto-cargos")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName("canal")
          .setDescription("Canal para publicar")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption((o) => o.setName("titulo").setDescription("Titulo").setRequired(true))
      .addStringOption((o) => o.setName("descricao").setDescription("Descricao").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("detalhes")
          .setDescription("Uma linha por cargo: @Cargo | Descricao")
      ),
    new SlashCommandBuilder()
      .setName("creator_voice")
      .setDescription("Configura criacao automatica de salas de voz")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName("categoria")
          .setDescription("Categoria")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("ticket_setup")
      .setDescription("Configura o sistema de tickets")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName("categoria_tickets")
          .setDescription("Categoria onde os tickets serao criados")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("canal_registros")
          .setDescription("Canal para guardar os registros")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addRoleOption((o) =>
        o
          .setName("cargo_staff")
          .setDescription("Cargo que pode visualizar/responder tickets")
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("canal_painel")
          .setDescription("Canal do botao Abrir Ticket")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("ticket_painel")
      .setDescription("Republica o painel de abrir ticket")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o
          .setName("canal")
          .setDescription("Canal de texto para publicar")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("puxar_all")
      .setDescription("Move todos de uma sala de voz para outra")
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
      .addChannelOption((o) =>
        o
          .setName("origem")
          .setDescription("Sala origem")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      )
      .addChannelOption((o) =>
        o
          .setName("destino")
          .setDescription("Sala destino")
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      ),
    new SlashCommandBuilder().setName("ouvidoria").setDescription("Formulario privado de feedback"),
    new SlashCommandBuilder()
      .setName("perfil_class")
      .setDescription("Define sua classe")
      .addStringOption((o) =>
        o
          .setName("classe")
          .setDescription("Classe")
          .setRequired(true)
          .addChoices(
            { name: "tank", value: "tank" },
            { name: "healer", value: "healer" },
            { name: "dps_melee", value: "dps_melee" },
            { name: "dps_ranger", value: "dps_ranger" },
            { name: "suporte", value: "suporte" }
          )
      ),
    new SlashCommandBuilder()
      .setName("buscar_class")
      .setDescription("Convoca uma classe especifica")
      .addStringOption((o) =>
        o
          .setName("classe")
          .setDescription("Classe")
          .setRequired(true)
          .addChoices(
            { name: "tank", value: "tank" },
            { name: "healer", value: "healer" },
            { name: "dps_melee", value: "dps_melee" },
            { name: "dps_ranger", value: "dps_ranger" },
            { name: "suporte", value: "suporte" }
          )
      )
      .addStringOption((o) => o.setName("motivo").setDescription("Motivo")),
    new SlashCommandBuilder()
      .setName("inativos")
      .setDescription("Relatorio de inatividade")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addBooleanOption((o) => o.setName("reengajar").setDescription("Enviar DM para 30+ dias")),
    new SlashCommandBuilder()
      .setName("staff_report")
      .setDescription("Relatorio da equipe")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("protocolo_veronica")
      .setDescription("Isola membro em quarentena")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((o) => o.setName("usuario").setDescription("Alvo").setRequired(true)),
    new SlashCommandBuilder()
      .setName("protocolo_festa_de_arromba")
      .setDescription("Convoca staff em emergencia")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((o) => o.setName("motivo").setDescription("Motivo").setRequired(true)),
    new SlashCommandBuilder()
      .setName("protocolo_tabua_rasa")
      .setDescription("Limpeza estrutural de canal/categoria")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName("protocolo_edith")
      .setDescription("Delega admin temporario")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName("usuario").setDescription("Membro").setRequired(true))
      .addStringOption((o) => o.setName("tempo").setDescription("30m, 4h, 2d").setRequired(true)),
    new SlashCommandBuilder()
      .setName("limpar")
      .setDescription("Limpeza com filtros")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((o) =>
        o
          .setName("quantidade")
          .setDescription("1..100")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      )
      .addUserOption((o) => o.setName("usuario").setDescription("Filtrar usuario"))
      .addStringOption((o) => o.setName("data").setDescription("AAAA-MM-DD")),
    new SlashCommandBuilder()
      .setName("remove_roles")
      .setDescription("Remove todos os cargos do usuario")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption((o) => o.setName("usuario").setDescription("Alvo").setRequired(true)),
    new SlashCommandBuilder()
      .setName("voice_painel")
      .setDescription("Abre painel privado da sala temporaria"),
  ];

  return list.map((cmd) => cmd.toJSON());
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

async function registerCommands() {
  const commands = buildCommands();
  if (process.env.GUILD_ID) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.commands.set(commands);
    console.log(`[READY] Commands registrados na guild ${process.env.GUILD_ID}`);
  } else {
    await client.application.commands.set(commands);
    console.log("[READY] Commands globais registrados");
  }
}

async function reconcileVoiceCreatorState() {
  for (const [guildId] of Object.entries(state.guilds || {})) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    const guildState = ensureGuildState(guildId);
    const roomIds = Object.keys(guildState.tempVoiceOwners || {});
    let changed = false;

    for (const roomId of roomIds) {
      const channel =
        guild.channels.cache.get(roomId) || (await guild.channels.fetch(roomId).catch(() => null));
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        delete guildState.tempVoiceOwners[roomId];
        changed = true;
        continue;
      }
      if (channel.members.size === 0) {
        await channel.delete("Reconsolidacao apos reinicio do bot").catch(() => null);
        delete guildState.tempVoiceOwners[roomId];
        changed = true;
      }
    }

    if (changed) {
      const guildConfig = ensureGuildConfig(guildId);
      await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
    }
  }
  writeJson(STATE_FILE, state);
}

async function reconcileTicketPanels() {
  for (const [guildId] of Object.entries(db.guilds || {})) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;
    const guildConfig = ensureGuildConfig(guildId);
    if (!guildConfig.tickets.enabled || !guildConfig.tickets.panelChannelId) continue;
    await publishOrRefreshTicketPanel(guild, guildConfig).catch(() => null);
  }
}

function scheduleEdithRemoval(entry) {
  const ms = entry.expiresAt - Date.now();
  if (ms <= 0) {
    // Expirou enquanto o bot estava offline — remover imediatamente
    (async () => {
      try {
        const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
        if (guild) {
          const member = await guild.members.fetch(entry.userId).catch(() => null);
          if (member?.roles.cache.has(entry.roleId)) {
            await member.roles.remove(entry.roleId, "Protocolo EDITH expirado (reconciliacao offline)");
          }
          const owner = await client.users.fetch(entry.ownerId).catch(() => null);
          if (owner) {
            await owner
              .send(`Protocolo EDITH encerrado (expirou offline) para <@${entry.userId}> em **${guild.name}**.`)
              .catch(() => null);
          }
        }
      } catch (e) {
        console.error("[EDITH] reconcile offline:", e);
      } finally {
        state.edithDelegations = state.edithDelegations.filter(
          (d) => !(d.guildId === entry.guildId && d.userId === entry.userId && d.expiresAt === entry.expiresAt)
        );
        writeJson(STATE_FILE, state);
      }
    })();
    return;
  }
  setTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(entry.guildId);
      const member = await guild.members.fetch(entry.userId).catch(() => null);
      if (member && member.roles.cache.has(entry.roleId)) {
        await member.roles.remove(entry.roleId, "Protocolo EDITH expirado");
      }
      const owner = await client.users.fetch(entry.ownerId).catch(() => null);
      if (owner) {
        await owner.send(
          `Protocolo EDITH encerrado para <@${entry.userId}> no servidor **${guild.name}**.`
        );
      }
      state.edithDelegations = state.edithDelegations.filter(
        (d) =>
          !(
            d.guildId === entry.guildId &&
            d.userId === entry.userId &&
            d.expiresAt === entry.expiresAt
          )
      );
      writeJson(STATE_FILE, state);
    } catch (error) {
      console.error("[EDITH] Falha na expiracao:", error);
    }
  }, ms);
}

client.once("clientReady", async () => {
  console.log(`[READY] ${client.user.tag} online`);
  try { await registerCommands(); } catch (e) { console.error("[READY] Falha ao registrar commands:", e); }
  try { await reconcileVoiceCreatorState(); } catch (e) { console.error("[READY] Falha ao reconciliar voice:", e); }
  try { await reconcileTicketPanels(); } catch (e) { console.error("[READY] Falha ao reconciliar tickets:", e); }
  pruneAutoRoleBuildSessions();
  setInterval(pruneAutoRoleBuildSessions, 5 * 60 * 1000).unref();
  pruneState();
  setInterval(pruneState, 24 * 60 * 60 * 1000).unref();
  for (const d of state.edithDelegations) {
    try { scheduleEdithRemoval(d); } catch (e) { console.error("[READY] Falha ao agendar EDITH:", e); }
  }
});

client.on("guildMemberAdd", async (member) => {
  const guildConfig = ensureGuildConfig(member.guild.id);
  const guildState = ensureGuildState(member.guild.id);
  guildState.memberLastActivity[member.id] = nowIso();
  writeJson(STATE_FILE, state);

  if (guildConfig.automation.boosterRoleId && member.premiumSince) {
    await member.roles.add(guildConfig.automation.boosterRoleId).catch(() => null);
  }

  if (guildConfig.welcome.enabled) {
    try {
      console.log(
        `[WELCOME] Novo membro detectado em ${member.guild.name}: ${member.user.tag} (${member.id})`
      );
      const text = formatWelcome(guildConfig.welcome.dmTemplate, member, guildConfig);
      await member.send({ content: text });
    } catch (error) {
      console.warn(
        `[WELCOME] Nao foi possivel enviar DM para ${member.user.tag} (${member.id}): ${error?.message || error}`
      );
    }
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const guildConfig = ensureGuildConfig(newMember.guild.id);
  if (!guildConfig.automation.boosterRoleId) return;
  if (!oldMember.premiumSince && newMember.premiumSince) {
    await newMember.roles.add(guildConfig.automation.boosterRoleId).catch(() => null);
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  const guildState = ensureGuildState(message.guild.id);
  guildState.memberLastActivity[message.author.id] = nowIso();

  const bucketKey = `${message.guild.id}:${message.author.id}`;
  const bucket = guildState.antiSpam[bucketKey] || {};
  if (!Array.isArray(bucket.hits)) bucket.hits = [];
  if (!Array.isArray(bucket.links)) bucket.links = [];
  const now = Date.now();
  bucket.hits = bucket.hits.filter((t) => now - t < 7000);
  bucket.hits.push(now);
  if (message.content && /https?:\/\/|discord\.gg\//i.test(message.content)) {
    bucket.links = bucket.links.filter((t) => now - t < 12000);
    bucket.links.push(now);
  }
  guildState.antiSpam[bucketKey] = bucket;
  writeStateDebounced(); // anti-spam: debounced para evitar I/O síncrono por mensagem

  const flood = bucket.hits.length >= 7;
  const links = bucket.links.length >= 4;
  if (flood || links) {
    if (!message.member) return;
    if (message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    await message.member.timeout(10 * 60 * 1000, "Sistema Flares").catch(() => null);
    await message.channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ALERT)
            .setTitle("Sistema Flares")
            .setDescription(`<@${message.author.id}> recebeu timeout automatico por spam/flood.`),
        ],
      })
      .catch(() => null);
  }
});

// Helper: busca audit log com delay para aguardar propagação da API do Discord
async function safeAuditLookup(guild, type, targetId = null, delayMs = 800, maxAgeMs = 5000) {
  await new Promise((r) => setTimeout(r, delayMs));
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(
      (e) =>
        (!targetId || e.target?.id === targetId) &&
        Date.now() - e.createdTimestamp < maxAgeMs
    );
    return entry?.executorId || null;
  } catch {
    return null;
  }
}

client.on("messageDelete", async (message) => {
  if (!message.guild) return;
  try {
    const executorId = await safeAuditLookup(message.guild, 72);
    if (!executorId) return;
    const guildState = ensureGuildState(message.guild.id);
    const stats = ensureStaffStats(guildState, executorId);
    stats.deletedMessages += 1;
    writeJson(STATE_FILE, state);
  } catch (_) {}
});

client.on("guildBanAdd", async (ban) => {
  try {
    const executorId = await safeAuditLookup(ban.guild, 22, ban.user?.id);
    if (!executorId) return;
    const guildState = ensureGuildState(ban.guild.id);
    const stats = ensureStaffStats(guildState, executorId);
    stats.bans += 1;
    writeJson(STATE_FILE, state);
  } catch (_) {}
});

client.on("guildMemberRemove", async (member) => {
  if (!member.guild) return;
  try {
    // Busca com target para garantir que é este membro — se não houver entry recente, foi saída voluntária
    const executorId = await safeAuditLookup(member.guild, 20, member.id);
    if (!executorId) return; // saída voluntária: sem entrada de kick → ignorar
    const guildState = ensureGuildState(member.guild.id);
    const stats = ensureStaffStats(guildState, executorId);
    stats.kicks += 1;
    writeJson(STATE_FILE, state);
  } catch (_) {}
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const guildConfig = ensureGuildConfig(guild.id);
  const guildState = ensureGuildState(guild.id);

  const member = newState.member || oldState.member;
  if (member && !member.user.bot) {
    guildState.memberLastActivity[member.id] = nowIso();
  }

  if (member && !member.user.bot) {
    const stats = ensureStaffStats(guildState, member.id);
    if (!oldState.channelId && newState.channelId) {
      stats.voiceJoinAt = Date.now();
    } else if (oldState.channelId && !newState.channelId && stats.voiceJoinAt) {
      stats.voiceMs += Date.now() - stats.voiceJoinAt;
      stats.voiceJoinAt = null;
    } else if (
      oldState.channelId &&
      newState.channelId &&
      oldState.channelId !== newState.channelId &&
      stats.voiceJoinAt
    ) {
      stats.voiceMs += Date.now() - stats.voiceJoinAt;
      stats.voiceJoinAt = Date.now();
    }
  }

  if (guildConfig.voiceCreator.enabled && guildConfig.voiceCreator.masterChannelId) {
    if (
      newState.channelId === guildConfig.voiceCreator.masterChannelId &&
      member &&
      !member.user.bot
    ) {
      if (!canUseVoiceCreator(member, guildConfig)) {
        await member.voice.disconnect("Sem permissao para usar o criador de salas").catch(() => null);
        await member
          .send("Voce nao tem permissao para criar salas temporarias neste servidor.")
          .catch(() => null);
        return;
      }

      // Lock por guild: previne race condition com entradas simultâneas
      if (voiceCreationLocks.has(guild.id)) {
        await member.voice.disconnect("Aguarde, processando criacao de sala.").catch(() => null);
        return;
      }
      voiceCreationLocks.add(guild.id);
      try {
      const maxRooms = guildConfig.voiceCreator.maxActiveRooms || 0;
      const activeRooms = countActiveVoiceRooms(guildState);
      if (maxRooms > 0 && activeRooms >= maxRooms) {
        await member.voice.disconnect("Limite de salas temporarias atingido").catch(() => null);
        await member
          .send(`O limite global de salas temporarias foi atingido (${maxRooms}).`)
          .catch(() => null);
        return;
      }

      const temp = await guild.channels.create({
        name: `🔊 ${member.displayName}`,
        type: ChannelType.GuildVoice,
        parent: guildConfig.voiceCreator.categoryId || null,
      });
      guildState.tempVoiceOwners[temp.id] = member.id;
      writeJson(STATE_FILE, state);
      await member.voice.setChannel(temp).catch(() => null);
      await temp
        .send({
          content: `Painel da sala de <@${member.id}>. Somente o criador consegue executar os controles.`,
          components: buildVoiceOwnerPanel(guild.id, temp.id),
        })
        .catch(() => null);
      try {
        await member.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.CYAN)
              .setTitle("Painel do Criador")
              .setDescription(
                `Sua sala foi criada: **${temp.name}**\nUse \`/voice_painel\` enquanto estiver nela para personalizar.`
              ),
          ],
          components: buildVoiceOwnerPanel(guild.id, temp.id),
        });
      } catch (_) {}
      await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
      } finally {
        voiceCreationLocks.delete(guild.id);
      }
    }

    if (oldState.channelId && guildState.tempVoiceOwners[oldState.channelId]) {
      const oldChannel = guild.channels.cache.get(oldState.channelId);
      if (oldChannel && oldChannel.members.size === 0) {
        delete guildState.tempVoiceOwners[oldChannel.id];
        writeJson(STATE_FILE, state);
        await oldChannel.delete("Sala temporaria vazia").catch(() => null);
        await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
      }
    }
  }

  writeJson(STATE_FILE, state);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      const [kind, action, guildId, channelId] = interaction.customId.split(":");

      if (kind === "onboard" && action === "start") {
        const guild = interaction.guild || (guildId ? await client.guilds.fetch(guildId) : null);
        if (!guild) return safeReply(interaction, { content: "Guild invalida.", flags: MessageFlags.Ephemeral });
        const guildConfig = ensureGuildConfig(guild.id);
        if (!guildConfig.onboarding.enabled) {
          return safeReply(interaction, {
            content: "Onboarding desativado.",
            flags: MessageFlags.Ephemeral,
          });
        }
        onboardingSessions.set(`${guild.id}:${interaction.user.id}`, { index: 0, answers: {} });
        await safeReply(interaction, { content: "Iniciando onboarding...", flags: MessageFlags.Ephemeral });
        return sendNextOnboardingStep(interaction, guild, interaction.user.id);
      }

      if (kind === "voiceAdmin") {
        const guild = interaction.guild || (guildId ? await client.guilds.fetch(guildId) : null);
        if (!guild) return;
        if (!isAdmin(interaction)) {
          return safeReply(interaction, {
            content: "Somente administradores podem usar esse painel.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const guildConfig = ensureGuildConfig(guild.id);
        const guildState = ensureGuildState(guild.id);

        if (action === "set_limit") {
          const modal = new ModalBuilder()
            .setCustomId(`voiceAdmin:set_limit_modal:${guild.id}`)
            .setTitle("Limite Global de Salas");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("maxRooms")
                .setLabel("Quantidade (0 = ilimitado)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2)
            )
          );
          return interaction.showModal(modal);
        }

        if (action === "clear_roles") {
          guildConfig.voiceCreator.allowedRoleIds = [];
          writeJson(CONFIG_FILE, db);
          await applyVoiceCreatorAccess(guild, guildConfig).catch(() => null);
          await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
          return safeReply(interaction, {
            content: "Criacao de salas liberada para todos os membros.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (action === "refresh") {
          await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
          return safeReply(interaction, {
            content: "Painel atualizado.",
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (kind === "ticket") {
        const guild = interaction.guild || (guildId ? await client.guilds.fetch(guildId) : null);
        if (!guild) return;
        const guildConfig = ensureGuildConfig(guild.id);
        const guildState = ensureGuildState(guild.id);
        guildState.tickets = guildState.tickets || {};

        if (action === "open") {
          if (!guildConfig.tickets.enabled) {
            return safeReply(interaction, {
              content: "Sistema de tickets nao esta configurado.",
              flags: MessageFlags.Ephemeral,
            });
          }
          const existing = Object.entries(guildState.tickets).find(
            ([, t]) => t.ownerId === interaction.user.id && t.status === "open"
          );
          if (existing) {
            return safeReply(interaction, {
              content: `Voce ja possui ticket aberto: <#${existing[0]}>`,
              flags: MessageFlags.Ephemeral,
            });
          }

          const openCategory = guild.channels.cache.get(guildConfig.tickets.openCategoryId);
          const logsChannel = guild.channels.cache.get(guildConfig.tickets.logsChannelId);
          const staffRole = guild.roles.cache.get(guildConfig.tickets.staffRoleId);
          if (
            !openCategory ||
            openCategory.type !== ChannelType.GuildCategory ||
            !logsChannel ||
            logsChannel.type !== ChannelType.GuildText ||
            !staffRole
          ) {
            return safeReply(interaction, {
              content: "Configuracao de tickets invalida. Rode /ticket_setup novamente.",
              flags: MessageFlags.Ephemeral,
            });
          }

          guildConfig.tickets.counter = (guildConfig.tickets.counter || 0) + 1;
          const ticketNumber = String(guildConfig.tickets.counter).padStart(4, "0");
          const baseName = interaction.user.username
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, "")
            .slice(0, 12);
          const channelName = `ticket-${baseName || "user"}-${ticketNumber}`;

          const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: openCategory.id,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel],
              },
              {
                id: interaction.user.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.AttachFiles,
                ],
              },
              {
                id: staffRole.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.AttachFiles,
                  PermissionFlagsBits.ManageMessages,
                ],
              },
              {
                id: guild.members.me?.id || client.user.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.ManageChannels,
                ],
              },
            ],
          });

          guildState.tickets[ticketChannel.id] = {
            ownerId: interaction.user.id,
            status: "open",
            createdAt: nowIso(),
            closedAt: null,
            reopenedAt: null,
            lastSavedAt: null,
          };
          writeJson(CONFIG_FILE, db);
          writeJson(STATE_FILE, state);

          await ticketChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.CYAN)
                .setTitle("Ticket Aberto")
                .setDescription(
                  `Solicitante: <@${interaction.user.id}>\nEquipe: <@&${staffRole.id}>\nUse os botoes para fechar, guardar registro e reabrir.`
                ),
            ],
            components: buildTicketControlPanel(guild.id, ticketChannel.id, false),
          });

          return safeReply(interaction, {
            content: `Ticket criado: ${ticketChannel}`,
            flags: MessageFlags.Ephemeral,
          });
        }

        const ticket = channelId ? guildState.tickets[channelId] : null;
        if (!ticket) {
          return safeReply(interaction, {
            content: "Ticket nao encontrado no sistema.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!canManageTicket(member, guildConfig, ticket.ownerId)) {
          return safeReply(interaction, {
            content: "Voce nao tem permissao para essa acao no ticket.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const ticketChannel = guild.channels.cache.get(channelId);
        if (!ticketChannel || ticketChannel.type !== ChannelType.GuildText) {
          return safeReply(interaction, {
            content: "Canal do ticket nao encontrado.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (action === "close") {
          if (ticket.status === "closed") {
            return safeReply(interaction, { content: "Ticket ja esta fechado.", flags: MessageFlags.Ephemeral });
          }
          await ticketChannel.permissionOverwrites.edit(ticket.ownerId, {
            SendMessages: false,
            AttachFiles: false,
          });
          ticket.status = "closed";
          ticket.closedAt = nowIso();
          writeJson(STATE_FILE, state);
          await ticketChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.ALERT)
                .setTitle("Ticket Fechado")
                .setDescription(`Fechado por <@${interaction.user.id}>.`),
            ],
            components: buildTicketControlPanel(guild.id, ticketChannel.id, true),
          });
          return safeReply(interaction, { content: "Ticket fechado com sucesso.", flags: MessageFlags.Ephemeral });
        }

        if (action === "reopen") {
          if (ticket.status === "open") {
            return safeReply(interaction, { content: "Ticket ja esta aberto.", flags: MessageFlags.Ephemeral });
          }
          await ticketChannel.permissionOverwrites.edit(ticket.ownerId, {
            ViewChannel: true,
            SendMessages: true,
            AttachFiles: true,
          });
          ticket.status = "open";
          ticket.reopenedAt = nowIso();
          writeJson(STATE_FILE, state);
          await ticketChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.CYAN)
                .setTitle("Ticket Reaberto")
                .setDescription(`Reaberto por <@${interaction.user.id}>.`),
            ],
            components: buildTicketControlPanel(guild.id, ticketChannel.id, false),
          });
          return safeReply(interaction, { content: "Ticket reaberto com sucesso.", flags: MessageFlags.Ephemeral });
        }

        if (action === "save") {
          const logsChannel = guild.channels.cache.get(guildConfig.tickets.logsChannelId);
          if (!logsChannel || logsChannel.type !== ChannelType.GuildText) {
            return safeReply(interaction, {
              content: "Canal de registros nao configurado/invalido.",
              flags: MessageFlags.Ephemeral,
            });
          }
          const transcript = await collectTicketTranscript(ticketChannel);
          const file = new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
            name: `${ticketChannel.name}.txt`,
          });
          await logsChannel.send({
            content: `Registro do ticket ${ticketChannel} | Solicitante: <@${ticket.ownerId}> | Salvo por <@${interaction.user.id}>`,
            files: [file],
          });
          ticket.lastSavedAt = nowIso();
          writeJson(STATE_FILE, state);
          return safeReply(interaction, {
            content: `Registro enviado para ${logsChannel}.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (kind === "voice") {
        const guild = interaction.guild;
        if (!guild) return;
        const guildState = ensureGuildState(guild.id);
        const ownerId = guildState.tempVoiceOwners[channelId];
        if (!ownerId || ownerId !== interaction.user.id) {
          return safeReply(interaction, {
            content: "Somente o dono da sala pode usar.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
          return safeReply(interaction, { content: "Sala nao encontrada.", flags: MessageFlags.Ephemeral });
        }

        if (action === "lock") {
          await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
          return safeReply(interaction, { content: "Sala trancada.", flags: MessageFlags.Ephemeral });
        }

        if (action === "rename") {
          const modal = new ModalBuilder()
            .setCustomId(`voice:rename_modal:${guild.id}:${channel.id}`)
            .setTitle("Renomear Sala");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("name")
                .setLabel("Novo nome da sala")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(40)
            )
          );
          return interaction.showModal(modal);
        }

        if (action === "limit") {
          const modal = new ModalBuilder()
            .setCustomId(`voice:limit_modal:${guild.id}:${channel.id}`)
            .setTitle("Limite de Vagas");
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("limit")
                .setLabel("Novo limite (0-99)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(2)
            )
          );
          return interaction.showModal(modal);
        }

        if (action === "hide") {
          const candidates = channel.members.filter((m) => m.id !== interaction.user.id);
          if (!candidates.size) {
            return safeReply(interaction, {
              content: "Nao ha membros para ocultar.",
              flags: MessageFlags.Ephemeral,
            });
          }
          const menu = new StringSelectMenuBuilder()
            .setCustomId(`voice:hide_select:${guild.id}:${channel.id}`)
            .setPlaceholder("Selecione o membro")
            .addOptions(
              candidates.first(25).map((m) => ({
                label: m.displayName.slice(0, 100),
                value: m.id,
              }))
            );
          return safeReply(interaction, {
            content: "Escolha para quem a sala ficara invisivel:",
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: MessageFlags.Ephemeral,
          });
        }

        if (action === "kick") {
          const candidates = channel.members.filter((m) => m.id !== interaction.user.id);
          if (!candidates.size) {
            return safeReply(interaction, {
              content: "Nao ha membros para expulsar.",
              flags: MessageFlags.Ephemeral,
            });
          }
          const menu = new StringSelectMenuBuilder()
            .setCustomId(`voice:kick_select:${guild.id}:${channel.id}`)
            .setPlaceholder("Selecione o membro")
            .addOptions(
              candidates.first(25).map((m) => ({
                label: m.displayName.slice(0, 100),
                value: m.id,
              }))
            );
          return safeReply(interaction, {
            content: "Escolha quem remover:",
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    }

    if (interaction.isRoleSelectMenu()) {
      const parts = interaction.customId.split(":");
      const kind = parts[0];

      if (kind === "voiceAdmin") {
        const guildIdFromCustom = parts[2];
        if (!isAdmin(interaction)) {
          return safeReply(interaction, {
            content: "Somente administradores podem configurar o creator voice.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const guild =
          interaction.guild ||
          (guildIdFromCustom ? await client.guilds.fetch(guildIdFromCustom) : null);
        if (!guild) return;
        const guildConfig = ensureGuildConfig(guild.id);
        const guildState = ensureGuildState(guild.id);
        guildConfig.voiceCreator.allowedRoleIds = interaction.values.slice(0, 25);
        writeJson(CONFIG_FILE, db);
        await applyVoiceCreatorAccess(guild, guildConfig).catch(() => null);
        await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
        return safeReply(interaction, {
          content: "Cargos autorizados atualizados.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (kind !== "auto_role_builder") return;
      const buildId = parts[1];
      pruneAutoRoleBuildSessions();
      const session = autoRoleBuildSessions.get(buildId);
      if (!session) {
        return safeReply(interaction, {
          content: "Sessao expirada. Rode /auto_cargos novamente.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (interaction.user.id !== session.userId) {
        return safeReply(interaction, { content: "Esse menu nao e seu.", flags: MessageFlags.Ephemeral });
      }
      const guild = interaction.guild || (session.guildId ? await client.guilds.fetch(session.guildId) : null);
      if (!guild || guild.id !== session.guildId) {
        return safeReply(interaction, { content: "Guild invalida para essa sessao.", flags: MessageFlags.Ephemeral });
      }
      const guildConfig = ensureGuildConfig(guild.id);

      const selectedRoles = interaction.values
        .slice(0, 25)
        .map((id) => guild.roles.cache.get(id))
        .filter(Boolean);
      if (!selectedRoles.length) {
        return safeReply(interaction, { content: "Nenhum cargo valido selecionado.", flags: MessageFlags.Ephemeral });
      }

      const targetChannel = guild.channels.cache.get(session.channelId);
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        return safeReply(interaction, {
          content: "Canal escolhido nao encontrado. Rode /auto_cargos novamente.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const roleDescriptions = parseAutoRoleDetails(session.details, selectedRoles);
      const panelId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const options = selectedRoles.map((role) => ({
        label: role.name.slice(0, 100),
        value: role.id,
        description: (roleDescriptions[role.id] || "Clique para adicionar/remover este cargo.").slice(0, 100),
      }));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`autoRolePanel:${panelId}`)
        .setPlaceholder("Selecione um ou mais cargos")
        .setMinValues(1)
        .setMaxValues(options.length)
        .addOptions(options);
      const roleLines = selectedRoles.map((role) => `• ${role}: ${roleDescriptions[role.id] || ""}`);
      const descriptionText = `${session.description}\n\n${roleLines.join("\n")}`.slice(0, 4096);
      const sent = await targetChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.CYAN)
            .setTitle(session.title.slice(0, 256))
            .setDescription(descriptionText),
        ],
        components: [new ActionRowBuilder().addComponents(menu)],
      });

      guildConfig.autoRoles.panels.push({
        panelId,
        messageId: sent.id,
        channelId: sent.channel.id,
        title: session.title,
        description: session.description,
        roleDescriptions,
        roles: selectedRoles.map((r) => r.id),
      });
      writeJson(CONFIG_FILE, db);
      autoRoleBuildSessions.delete(buildId);
      return interaction.update({ content: "Painel de auto-cargos publicado.", components: [] });
    }

    if (interaction.isStringSelectMenu()) {
      const parts = interaction.customId.split(":");
      const kind = parts[0];

      if (kind === "onboard" && parts[1] === "select") {
        const guildId = parts[2];
        const key = parts[3];
        const guild = interaction.guild || (guildId ? await client.guilds.fetch(guildId) : null);
        if (!guild) return;
        const guildConfig = ensureGuildConfig(guild.id);
        const sessionKey = `${guild.id}:${interaction.user.id}`;
        const session = onboardingSessions.get(sessionKey);
        if (!session) {
          return safeReply(interaction, {
            content: "Sessao expirada. Clique para iniciar novamente.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const selected = interaction.values[0];
        session.answers[key] = selected;
        session.index += 1;
        onboardingSessions.set(sessionKey, session);
        const question = guildConfig.onboarding.questions.find((q) => q.key === key);
        const roleId = question?.roleMap?.[selected];
        if (roleId && interaction.member?.roles) {
          await interaction.member.roles.add(roleId).catch(() => null);
        }
        const guildState = ensureGuildState(guild.id);
        guildState.onboardingAnswers[interaction.user.id] = session.answers;
        writeJson(STATE_FILE, state);
        await interaction.update({ content: `Resposta salva: **${selected}**`, components: [] });
        return sendNextOnboardingStep(interaction, guild, interaction.user.id);
      }

      if (kind === "autoRolePanel") {
        const panelId = parts[1];
        const guild = interaction.guild;
        if (!guild) return;
        const guildConfig = ensureGuildConfig(guild.id);
        const panel = guildConfig.autoRoles.panels.find((p) => p.panelId === panelId);
        if (!panel) {
          return safeReply(interaction, { content: "Painel nao encontrado.", flags: MessageFlags.Ephemeral });
        }
        const member = interaction.member;
        if (!member?.roles) return;

        const added = [];
        const removed = [];
        for (const roleId of interaction.values) {
          const role = guild.roles.cache.get(roleId);
          if (!role) continue;
          if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role.id).catch(() => null);
            removed.push(`${role}`);
          } else {
            await member.roles.add(role.id).catch(() => null);
            added.push(`${role}`);
          }
        }

        const lines = [];
        if (added.length) lines.push(`✅ Adicionados: ${added.join(", ")}`);
        if (removed.length) lines.push(`❌ Removidos: ${removed.join(", ")}`);
        return safeReply(interaction, {
          content: lines.join("\n") || "Nenhuma alteracao.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (kind === "voice" && parts[1] === "kick_select") {
        const channelId = parts[3];
        const guild = interaction.guild;
        if (!guild) return;
        const guildState = ensureGuildState(guild.id);
        if (guildState.tempVoiceOwners[channelId] !== interaction.user.id) {
          return safeReply(interaction, {
            content: "Somente o dono da sala pode usar esse painel.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = guild.channels.cache.get(channelId);
        const targetId = interaction.values[0];
        const target = await guild.members.fetch(targetId).catch(() => null);
        if (target?.voice?.channelId === channel?.id) {
          await target.voice.disconnect("Removido pelo dono da sala").catch(() => null);
        }
        return safeReply(interaction, {
          content: `Membro removido: <@${targetId}>`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (kind === "voice" && parts[1] === "hide_select") {
        const channelId = parts[3];
        const guild = interaction.guild;
        if (!guild) return;
        const guildState = ensureGuildState(guild.id);
        if (guildState.tempVoiceOwners[channelId] !== interaction.user.id) {
          return safeReply(interaction, {
            content: "Somente o dono da sala pode usar esse painel.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
          return safeReply(interaction, { content: "Sala nao encontrada.", flags: MessageFlags.Ephemeral });
        }
        const targetId = interaction.values[0];
        await channel.permissionOverwrites.edit(targetId, {
          ViewChannel: false,
          Connect: false,
        });
        const target = await guild.members.fetch(targetId).catch(() => null);
        if (target?.voice?.channelId === channel.id) {
          await target.voice.disconnect("Sala ocultada pelo dono").catch(() => null);
        }
        return safeReply(interaction, {
          content: `A sala agora esta invisivel para <@${targetId}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (interaction.isModalSubmit()) {
      const [kind, action, guildId, key] = interaction.customId.split(":");

      if (kind === "onboard" && action === "modal") {
        const guild = interaction.guild || (guildId ? await client.guilds.fetch(guildId) : null);
        if (!guild) return;
        const sessionKey = `${guild.id}:${interaction.user.id}`;
        const session = onboardingSessions.get(sessionKey);
        if (!session) return;
        const answer = interaction.fields.getTextInputValue("answer");
        session.answers[key] = answer;
        session.index += 1;
        onboardingSessions.set(sessionKey, session);
        const guildState = ensureGuildState(guild.id);
        guildState.onboardingAnswers[interaction.user.id] = session.answers;
        writeJson(STATE_FILE, state);
        await safeReply(interaction, { content: "Resposta registrada.", flags: MessageFlags.Ephemeral });
        return sendNextOnboardingStep(interaction, guild, interaction.user.id);
      }

      if (kind === "voice" && action === "limit_modal") {
        const guild = interaction.guild;
        if (!guild) return;
        const guildState = ensureGuildState(guild.id);
        if (guildState.tempVoiceOwners[key] !== interaction.user.id) {
          return safeReply(interaction, {
            content: "Somente o dono da sala pode alterar limite.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = guild.channels.cache.get(key);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
          return safeReply(interaction, { content: "Sala invalida.", flags: MessageFlags.Ephemeral });
        }
        const n = Number(interaction.fields.getTextInputValue("limit"));
        if (!Number.isInteger(n) || n < 0 || n > 99) {
          return safeReply(interaction, { content: "Limite invalido.", flags: MessageFlags.Ephemeral });
        }
        await channel.setUserLimit(n, "Ajuste via painel");
        return safeReply(interaction, { content: `Limite atualizado para ${n}.`, flags: MessageFlags.Ephemeral });
      }

      if (kind === "voice" && action === "rename_modal") {
        const guild = interaction.guild;
        if (!guild) return;
        const guildState = ensureGuildState(guild.id);
        if (guildState.tempVoiceOwners[key] !== interaction.user.id) {
          return safeReply(interaction, {
            content: "Somente o dono da sala pode renomear.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const channel = guild.channels.cache.get(key);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
          return safeReply(interaction, { content: "Sala invalida.", flags: MessageFlags.Ephemeral });
        }
        const newName = interaction.fields.getTextInputValue("name").trim();
        if (!newName) {
          return safeReply(interaction, { content: "Nome invalido.", flags: MessageFlags.Ephemeral });
        }
        await channel.setName(newName.slice(0, 100), "Renomeada pelo dono da sala");
        return safeReply(interaction, {
          content: `Sala renomeada para **${newName.slice(0, 100)}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (kind === "voiceAdmin" && action === "set_limit_modal") {
        const guild = interaction.guild || (guildId ? await client.guilds.fetch(guildId) : null);
        if (!guild) return;
        if (!isAdmin(interaction)) {
          return safeReply(interaction, {
            content: "Somente administradores podem alterar esse limite.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const guildConfig = ensureGuildConfig(guild.id);
        const guildState = ensureGuildState(guild.id);
        const raw = interaction.fields.getTextInputValue("maxRooms");
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 99) {
          return safeReply(interaction, {
            content: "Valor invalido. Use um numero entre 0 e 99.",
            flags: MessageFlags.Ephemeral,
          });
        }
        guildConfig.voiceCreator.maxActiveRooms = n;
        writeJson(CONFIG_FILE, db);
        await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);
        return safeReply(interaction, {
          content: `Limite global atualizado para ${n === 0 ? "Ilimitado" : n}.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (kind === "ouvidoria" && action === "modal") {
        const guild = interaction.guild;
        if (!guild) return;
        const guildConfig = ensureGuildConfig(guild.id);
        const forumId = guildConfig.ouvidoria.forumChannelId;
        if (!forumId) {
          return safeReply(interaction, {
            content: "Forum nao configurado. Use /setup ouvidoria_forum.",
            flags: MessageFlags.Ephemeral,
          });
        }
        const forum = guild.channels.cache.get(forumId);
        if (!forum || forum.type !== ChannelType.GuildForum) {
          return safeReply(interaction, { content: "Forum invalido.", flags: MessageFlags.Ephemeral });
        }
        const subject = interaction.fields.getTextInputValue("subject");
        const body = interaction.fields.getTextInputValue("body");
        const thread = await forum.threads.create({
          name: `Relato-${Date.now()}`,
          message: {
            embeds: [
              new EmbedBuilder()
                .setColor(COLORS.ALERT)
                .setTitle("Ouvidoria Anonima")
                .setDescription(body)
                .addFields({ name: "Assunto", value: subject }),
            ],
          },
          reason: "Novo relato anonimo",
        });
        state.anonymousThreads[thread.id] = {
          guildId: guild.id,
          userId: interaction.user.id,
          createdAt: nowIso(),
        };
        writeJson(STATE_FILE, state);
        return safeReply(interaction, {
          content: "Relato enviado com sucesso. Se houver resposta, ela chega por DM.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (!interaction.isChatInputCommand()) return;
    const guild = interaction.guild;
    if (!guild) return safeReply(interaction, { content: "Use no servidor.", flags: MessageFlags.Ephemeral });
    const guildConfig = ensureGuildConfig(guild.id);
    const guildState = ensureGuildState(guild.id);
    const { commandName } = interaction;

    if (commandName === "setup") {
      if (!isAdmin(interaction)) {
        return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      }
      const sub = interaction.options.getSubcommand();

      if (sub === "boas_vindas") {
        guildConfig.welcome.dmTemplate = interaction.options.getString("mensagem", true);
        const rulesChannel = interaction.options.getChannel("canal_regras");
        const enabled = interaction.options.getBoolean("ativar");
        if (rulesChannel) guildConfig.welcome.rulesChannelId = rulesChannel.id;
        if (typeof enabled === "boolean") guildConfig.welcome.enabled = enabled;
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: "Boas-vindas atualizadas.", flags: MessageFlags.Ephemeral });
      }

      if (sub === "onboarding_canal") {
        const channel = interaction.options.getChannel("canal", true);
        guildConfig.onboarding.panelChannelId = channel.id;
        guildConfig.onboarding.enabled = true;
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: `Canal definido: ${channel}`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "onboarding_pergunta") {
        const key = interaction.options.getString("chave", true).toLowerCase();
        const title = interaction.options.getString("titulo", true);
        const type = interaction.options.getString("tipo", true);
        const optionsRaw = interaction.options.getString("opcoes");
        const options = optionsRaw
          ? optionsRaw.split(",").map((v) => v.trim()).filter(Boolean)
          : [];
        let q = guildConfig.onboarding.questions.find((x) => x.key === key);
        if (!q) {
          q = { key, label: title, type, options: [], roleMap: {} };
          guildConfig.onboarding.questions.push(q);
        }
        q.label = title;
        q.type = type;
        if (type === "select" && options.length) q.options = options.slice(0, 25);
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: `Pergunta ${key} salva.`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "onboarding_mapeamento") {
        const key = interaction.options.getString("chave", true).toLowerCase();
        const answer = interaction.options.getString("resposta", true);
        const role = interaction.options.getRole("cargo", true);
        const q = guildConfig.onboarding.questions.find((x) => x.key === key);
        if (!q) return safeReply(interaction, { content: "Pergunta nao encontrada.", flags: MessageFlags.Ephemeral });
        q.roleMap = q.roleMap || {};
        q.roleMap[answer] = role.id;
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: `Mapeado: ${answer} -> ${role}`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "ouvidoria_forum") {
        const channel = interaction.options.getChannel("canal", true);
        guildConfig.ouvidoria.forumChannelId = channel.id;
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: `Forum definido: ${channel}`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "class_role") {
        const className = interaction.options.getString("classe", true);
        const role = interaction.options.getRole("cargo", true);
        guildConfig.classes.roleByClass[className] = role.id;
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: `Classe ${className} -> ${role}`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "protocolos") {
        const quarantineRole = interaction.options.getRole("cargo_quarentena", true);
        const containmentCategory = interaction.options.getChannel("categoria_contencao", true);
        const meetingCategory = interaction.options.getChannel("categoria_reuniao", true);
        const staffRaw = interaction.options.getString("cargos_staff", true);
        guildConfig.protocols.quarantineRoleId = quarantineRole.id;
        guildConfig.protocols.containmentCategoryId = containmentCategory.id;
        guildConfig.protocols.meetingCategoryId = meetingCategory.id;
        guildConfig.protocols.staffRoleIds = parseRoleList(staffRaw);
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: "Protocolos salvos.", flags: MessageFlags.Ephemeral });
      }

      if (sub === "booster_role") {
        const role = interaction.options.getRole("cargo", true);
        guildConfig.automation.boosterRoleId = role.id;
        writeJson(CONFIG_FILE, db);
        return safeReply(interaction, { content: `Booster role: ${role}`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "ver") {
        const lines = [
          `DM boas-vindas: ${guildConfig.welcome.enabled ? "ativa" : "desativada"}`,
          `Canal regras: ${guildConfig.welcome.rulesChannelId ? `<#${guildConfig.welcome.rulesChannelId}>` : "nao definido"}`,
          `Onboarding canal: ${guildConfig.onboarding.panelChannelId ? `<#${guildConfig.onboarding.panelChannelId}>` : "nao definido"}`,
          `Forum ouvidoria: ${guildConfig.ouvidoria.forumChannelId ? `<#${guildConfig.ouvidoria.forumChannelId}>` : "nao definido"}`,
          `Voice master: ${guildConfig.voiceCreator.masterChannelId ? `<#${guildConfig.voiceCreator.masterChannelId}>` : "nao definido"}`,
          `Voice painel admin: ${guildConfig.voiceCreator.panelChannelId ? `<#${guildConfig.voiceCreator.panelChannelId}>` : "nao definido"}`,
          `Voice limite global: ${guildConfig.voiceCreator.maxActiveRooms || 0}`,
          `Tickets ativo: ${guildConfig.tickets.enabled ? "sim" : "nao"}`,
          `Tickets categoria: ${guildConfig.tickets.openCategoryId ? `<#${guildConfig.tickets.openCategoryId}>` : "nao definido"}`,
          `Tickets registros: ${guildConfig.tickets.logsChannelId ? `<#${guildConfig.tickets.logsChannelId}>` : "nao definido"}`,
          `Tickets staff: ${guildConfig.tickets.staffRoleId ? `<@&${guildConfig.tickets.staffRoleId}>` : "nao definido"}`,
          `Quarentena: ${guildConfig.protocols.quarantineRoleId ? `<@&${guildConfig.protocols.quarantineRoleId}>` : "nao definido"}`,
        ];
        return safeReply(interaction, {
          embeds: [new EmbedBuilder().setColor(COLORS.CYAN).setTitle("Setup").setDescription(lines.join("\n"))],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (commandName === "novos_membros") {
      if (!isAdmin(interaction)) return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      const channelId = guildConfig.onboarding.panelChannelId;
      const channel = channelId ? guild.channels.cache.get(channelId) : interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        return safeReply(interaction, {
          content: "Canal invalido. Configure com /setup onboarding_canal.",
          flags: MessageFlags.Ephemeral,
        });
      }
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.CYAN)
            .setTitle("Novos Membros")
            .setDescription("Clique no botao para iniciar o onboarding."),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`onboard:start:${guild.id}`)
              .setLabel("Iniciar Onboarding")
              .setStyle(ButtonStyle.Primary)
          ),
        ],
      });
      return safeReply(interaction, { content: `Painel enviado em ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === "dm_boas_vindas") {
      if (!isAdmin(interaction)) return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      const custom = interaction.options.getString("mensagem", true);
      guildConfig.welcome.dmTemplate = custom;
      guildConfig.welcome.enabled = true;
      writeJson(CONFIG_FILE, db);
      return safeReply(interaction, {
        content:
          "Mensagem automatica salva. A partir de agora, todo novo membro recebera essa DM de boas-vindas.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "auto_cargos") {
      if (!isAdmin(interaction)) return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      pruneAutoRoleBuildSessions();
      const channel = interaction.options.getChannel("canal", true);
      const title = interaction.options.getString("titulo", true);
      const description = interaction.options.getString("descricao", true);
      const details = interaction.options.getString("detalhes") || "";
      const buildId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
      autoRoleBuildSessions.set(buildId, {
        guildId: guild.id,
        userId: interaction.user.id,
        channelId: channel.id,
        title,
        description,
        details,
        createdAt: Date.now(),
      });
      const menu = new RoleSelectMenuBuilder()
        .setCustomId(`auto_role_builder:${buildId}`)
        .setPlaceholder("Selecione os cargos para o painel")
        .setMinValues(1)
        .setMaxValues(25);
      return safeReply(interaction, {
        content:
          "Selecione agora os cargos no menu abaixo. Vou publicar o painel com titulo, descricao e detalhes por cargo no canal escolhido.",
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "ticket_setup") {
      if (!isAdmin(interaction)) return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      const ticketsCategory = interaction.options.getChannel("categoria_tickets", true);
      const logsChannel = interaction.options.getChannel("canal_registros", true);
      const staffRole = interaction.options.getRole("cargo_staff", true);
      const panelChannel = interaction.options.getChannel("canal_painel", true);

      guildConfig.tickets.enabled = true;
      guildConfig.tickets.openCategoryId = ticketsCategory.id;
      guildConfig.tickets.logsChannelId = logsChannel.id;
      guildConfig.tickets.staffRoleId = staffRole.id;
      guildConfig.tickets.panelChannelId = panelChannel.id;
      writeJson(CONFIG_FILE, db);

      await publishOrRefreshTicketPanel(guild, guildConfig).catch(() => null);
      return safeReply(interaction, {
        content:
          `Sistema de tickets configurado.\nCategoria: ${ticketsCategory}\nRegistros: ${logsChannel}\nStaff: ${staffRole}\nPainel: ${panelChannel}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "ticket_painel") {
      if (!isAdmin(interaction)) return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      const channel = interaction.options.getChannel("canal", true);
      guildConfig.tickets.enabled = true;
      guildConfig.tickets.panelChannelId = channel.id;
      writeJson(CONFIG_FILE, db);
      await publishOrRefreshTicketPanel(guild, guildConfig).catch(() => null);
      return safeReply(interaction, {
        content: `Painel de tickets publicado/atualizado em ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "creator_voice") {
      if (!isAdmin(interaction)) return safeReply(interaction, { content: "Apenas administradores.", flags: MessageFlags.Ephemeral });
      const category = interaction.options.getChannel("categoria", true);
      const masterName = guildConfig.voiceCreator.masterChannelName || "➕ criar-sala";
      let master = guild.channels.cache.get(guildConfig.voiceCreator.masterChannelId);
      let adminText = guild.channels.cache.get(guildConfig.voiceCreator.panelChannelId);

      if (!master) {
        master = await guild.channels.create({
          name: masterName,
          type: ChannelType.GuildVoice,
          parent: category.id,
        });
      } else {
        await master.setName(masterName).catch(() => null);
        await master.setParent(category.id).catch(() => null);
      }

      if (!adminText) {
        adminText = await guild.channels.create({
          name: "creator-voice-admin",
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: guild.members.me?.id || client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
              ],
            },
          ],
        });
      } else {
        await adminText.setParent(category.id).catch(() => null);
      }

      guildConfig.voiceCreator.enabled = true;
      guildConfig.voiceCreator.categoryId = category.id;
      guildConfig.voiceCreator.panelChannelId = adminText.id;
      guildConfig.voiceCreator.masterChannelId = master.id;
      guildConfig.voiceCreator.masterChannelName = masterName;
      writeJson(CONFIG_FILE, db);
      await applyVoiceCreatorAccess(guild, guildConfig).catch(() => null);
      await publishOrRefreshVoiceAdminPanel(guild, guildConfig, guildState).catch(() => null);

      return safeReply(interaction, {
        content:
          `Creator Voice configurado.\nCanal de criacao: ${master}\nPainel admin: ${adminText}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "voice_painel") {
      const requester = await guild.members.fetch(interaction.user.id).catch(() => null);
      const requesterVoiceId = requester?.voice?.channelId || null;
      const ownerEntry = Object.entries(guildState.tempVoiceOwners).find(
        ([cid, ownerId]) => ownerId === interaction.user.id && requesterVoiceId === cid
      );
      if (!ownerEntry) {
        return safeReply(interaction, {
          content: "Voce nao e dono de sala temporaria ativa.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const channelId = ownerEntry[0];
      return safeReply(interaction, {
        content: "Painel privado:",
        components: buildVoiceOwnerPanel(guild.id, channelId),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "puxar_all") {
      const origin = interaction.options.getChannel("origem", true);
      const dest = interaction.options.getChannel("destino", true);
      let moved = 0;
      for (const [, m] of origin.members) {
        await m.voice.setChannel(dest).catch(() => null);
        moved += 1;
      }
      return safeReply(interaction, { content: `${moved} membro(s) movidos.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === "ouvidoria") {
      const modal = new ModalBuilder().setCustomId(`ouvidoria:modal:${guild.id}`).setTitle("Ouvidoria");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("subject")
            .setLabel("Assunto")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("body")
            .setLabel("Relato")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000)
        )
      );
      return interaction.showModal(modal);
    }

    if (commandName === "perfil_class") {
      const className = interaction.options.getString("classe", true);
      const roleId = guildConfig.classes.roleByClass[className];
      if (!roleId) {
        return safeReply(interaction, {
          content: "Classe sem mapeamento. Use /setup class_role.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const role = guild.roles.cache.get(roleId);
      if (!role) return safeReply(interaction, { content: "Cargo invalido.", flags: MessageFlags.Ephemeral });
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return safeReply(interaction, { content: "Membro nao encontrado.", flags: MessageFlags.Ephemeral });
      const allClassRoles = Object.values(guildConfig.classes.roleByClass).filter(Boolean);
      for (const id of allClassRoles) {
        if (id !== role.id && member.roles.cache.has(id)) {
          await member.roles.remove(id).catch(() => null);
        }
      }
      await member.roles.add(role.id).catch(() => null);
      return safeReply(interaction, { content: `Classe definida: ${role}`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === "buscar_class") {
      const className = interaction.options.getString("classe", true);
      const reason = interaction.options.getString("motivo") || "Convocacao de evento";
      const roleId = guildConfig.classes.roleByClass[className];
      if (!roleId) return safeReply(interaction, { content: "Classe nao mapeada.", flags: MessageFlags.Ephemeral });
      await interaction.channel.send(`Convocacao: <@&${roleId}>\nMotivo: ${reason}`);
      return safeReply(interaction, { content: "Convocacao enviada.", flags: MessageFlags.Ephemeral });
    }

    if (commandName === "inativos") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reengajar = interaction.options.getBoolean("reengajar") || false;
      const members = await guild.members.fetch();
      const now = Date.now();
      const data = [];
      for (const [, member] of members) {
        if (member.user.bot) continue;
        const last = guildState.memberLastActivity[member.id];
        // Se joinedTimestamp for null (partial), usa now → dias = 0 → não entra no relatório corretamente.
        // Preferir last activity; se ausente e joinedTimestamp disponível, usar joinedTimestamp; caso contrário ignorar.
        let lastMs;
        if (last) {
          lastMs = new Date(last).getTime();
        } else if (member.joinedTimestamp) {
          lastMs = member.joinedTimestamp;
        } else {
          continue; // sem dados confiáveis — ignorar
        }
        const days = Math.floor((now - lastMs) / (1000 * 60 * 60 * 24));
        if (days >= 7) data.push({ member, days });
      }
      data.sort((a, b) => b.days - a.days);
      const lines = data.slice(0, 20).map((x) => `${x.member} - ${x.days} dias`);
      if (!lines.length) lines.push("Nenhum inativo relevante.");

      if (reengajar) {
        const reengageTargets = data.filter((x) => x.days >= 30).slice(0, 20);
        await Promise.allSettled(
          reengageTargets.map((item) =>
            item.member
              .send(`Sentimos sua falta em **${guild.name}**. Quando quiser, estamos aqui.`)
              .catch(() => null)
          )
        );
      }
      return interaction.editReply({
        embeds: [
          new EmbedBuilder().setColor(COLORS.CYAN).setTitle("Inativos").setDescription(lines.join("\n")),
        ],
      });
    }

    if (commandName === "staff_report") {
      const lines = [];
      for (const [id, stats] of Object.entries(guildState.staffStats)) {
        const hours = (stats.voiceMs / (1000 * 60 * 60)).toFixed(2);
        lines.push(
          `<@${id}> | Del: ${stats.deletedMessages} | Bans: ${stats.bans} | Kicks: ${stats.kicks} | Timeouts: ${stats.timeouts} | Voz(h): ${hours} | Leiloes: ${stats.auctionsClosed}`
        );
      }
      if (!lines.length) lines.push("Sem dados ainda.");
      return safeReply(interaction, {
        embeds: [new EmbedBuilder().setColor(COLORS.CYAN).setTitle("Staff Report").setDescription(lines.slice(0, 20).join("\n"))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "protocolo_veronica") {
      const targetUser = interaction.options.getUser("usuario", true);
      const target = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!target) return safeReply(interaction, { content: "Membro nao encontrado.", flags: MessageFlags.Ephemeral });
      if (!guildConfig.protocols.quarantineRoleId || !guildConfig.protocols.containmentCategoryId) {
        return safeReply(interaction, {
          content: "Configure protocolos via /setup protocolos.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const quarantineRole = guild.roles.cache.get(guildConfig.protocols.quarantineRoleId);
      if (!quarantineRole) return safeReply(interaction, { content: "Cargo quarentena invalido.", flags: MessageFlags.Ephemeral });
      const remove = target.roles.cache.filter(
        (r) => r.id !== guild.roles.everyone.id && r.id !== quarantineRole.id
      );
      if (remove.size) await target.roles.remove(remove, "Protocolo Veronica").catch(() => null);
      await target.roles.add(quarantineRole.id, "Protocolo Veronica").catch(() => null);
      if (target?.voice?.channelId) await target.voice.disconnect().catch(() => null);

      let containment = guildConfig.protocols.containmentChannelId
        ? guild.channels.cache.get(guildConfig.protocols.containmentChannelId)
        : null;
      if (!containment) {
        containment = await guild.channels.create({
          name: "Sala de Contencao",
          type: ChannelType.GuildVoice,
          parent: guildConfig.protocols.containmentCategoryId,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
            { id: quarantineRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
            ...guildConfig.protocols.staffRoleIds.map((roleId) => ({
              id: roleId,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers],
            })),
          ],
        });
        guildConfig.protocols.containmentChannelId = containment.id;
        writeJson(CONFIG_FILE, db);
      }
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ALERT)
            .setTitle("Protocolo Veronica Ativado")
            .setDescription(`${target} isolado. Sala: ${containment}`),
        ],
      });
      return safeReply(interaction, { content: "Concluido.", flags: MessageFlags.Ephemeral });
    }

    if (commandName === "protocolo_festa_de_arromba") {
      const reason = interaction.options.getString("motivo", true);
      if (!guildConfig.protocols.meetingCategoryId || !guildConfig.protocols.staffRoleIds.length) {
        return safeReply(interaction, { content: "Configure protocolos via /setup protocolos.", flags: MessageFlags.Ephemeral });
      }
      const category = guild.channels.cache.get(guildConfig.protocols.meetingCategoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        return safeReply(interaction, { content: "Categoria de reuniao invalida.", flags: MessageFlags.Ephemeral });
      }
      const room = await guild.channels.create({
        name: `Reuniao-${Date.now()}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
          ...guildConfig.protocols.staffRoleIds.map((roleId) => ({
            id: roleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
          })),
        ],
      });
      const mentions = guildConfig.protocols.staffRoleIds.map((id) => `<@&${id}>`).join(" ");
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ALERT)
            .setTitle("Protocolo Festa de Arromba")
            .setDescription(`${mentions}\nMotivo: ${reason}\nSala: ${room}`),
        ],
      });
      const dmTasks = [];
      for (const roleId of guildConfig.protocols.staffRoleIds) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        for (const [, m] of role.members) {
          dmTasks.push(
            m
              .send(`Convocacao emergencial em **${guild.name}**.\nMotivo: ${reason}\nSala: ${room.name}`)
              .catch(() => null)
          );
        }
      }
      await Promise.allSettled(dmTasks);
      return safeReply(interaction, { content: "Convocacao enviada.", flags: MessageFlags.Ephemeral });
    }

    if (commandName === "protocolo_tabua_rasa") {
      const current = interaction.channel;
      if (!current) return;
      if (current.type === ChannelType.GuildCategory) {
        const originalName = current.name;
        await current.setName(`${originalName}-backup-${Date.now()}`).catch(() => null);
        const newCategory = await guild.channels.create({
          name: originalName,
          type: ChannelType.GuildCategory,
          permissionOverwrites: current.permissionOverwrites.cache.map((ow) => ({
            id: ow.id,
            allow: ow.allow.bitfield,
            deny: ow.deny.bitfield,
          })),
        });
        const children = guild.channels.cache.filter((c) => c.parentId === current.id);
        for (const [, child] of children) {
          await child.clone({ name: child.name, parent: newCategory.id, reason: "Protocolo Tabua Rasa" });
        }
        return safeReply(interaction, {
          content: "Categoria duplicada limpa; backup mantido.",
          flags: MessageFlags.Ephemeral,
        });
      }
      const originalName = current.name;
      await current.setName(`${originalName}-backup-${Date.now()}`).catch(() => null);
      await current.clone({ name: originalName, reason: "Protocolo Tabua Rasa" });
      return safeReply(interaction, { content: "Canal limpo clonado; backup mantido.", flags: MessageFlags.Ephemeral });
    }

    if (commandName === "protocolo_edith") {
      const targetUser = interaction.options.getUser("usuario", true);
      const raw = interaction.options.getString("tempo", true);
      const ms = parseDurationToMs(raw);
      if (!ms || ms < 60_000) {
        return safeReply(interaction, { content: "Tempo invalido. Ex: 30m, 4h, 2d", flags: MessageFlags.Ephemeral });
      }
      const target = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!target) return safeReply(interaction, { content: "Membro nao encontrado.", flags: MessageFlags.Ephemeral });
      const role = await ensureEdithRole(guild, guildConfig);
      await target.roles.add(role.id, "Protocolo EDITH").catch(() => null);
      const entry = {
        guildId: guild.id,
        userId: target.id,
        ownerId: guild.ownerId,
        roleId: role.id,
        grantedAt: Date.now(),
        expiresAt: Date.now() + ms,
      };
      state.edithDelegations.push(entry);
      writeJson(STATE_FILE, state);
      scheduleEdithRemoval(entry);
      return safeReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ALERT)
            .setTitle("Protocolo EDITH")
            .setDescription(`${target} recebeu admin temporario por ${raw}.`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "limpar") {
      const quantity = interaction.options.getInteger("quantidade", true);
      const user = interaction.options.getUser("usuario");
      const dateRaw = interaction.options.getString("data");

      let minDate = null;
      if (dateRaw) {
        const ts = new Date(dateRaw).getTime();
        if (Number.isNaN(ts)) {
          return safeReply(interaction, {
            content: "Data invalida. Use AAAA-MM-DD.",
            flags: MessageFlags.Ephemeral,
          });
        }
        minDate = ts;
      }

      const fetched = await interaction.channel.messages.fetch({ limit: 100 });
      let filtered = [...fetched.values()];
      if (user) filtered = filtered.filter((m) => m.author.id === user.id);
      if (minDate) filtered = filtered.filter((m) => m.createdTimestamp >= minDate);
      filtered = filtered.slice(0, quantity);

      const under14days = filtered.filter(
        (m) => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000
      );
      await interaction.channel.bulkDelete(under14days, true);
      return safeReply(interaction, {
        content: `Limpeza concluida: ${under14days.length} mensagens removidas.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (commandName === "remove_roles") {
      const user = interaction.options.getUser("usuario", true);
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return safeReply(interaction, { content: "Membro nao encontrado.", flags: MessageFlags.Ephemeral });
      }
      const rolesToRemove = member.roles.cache.filter((r) => r.id !== guild.roles.everyone.id);
      await member.roles.remove(rolesToRemove, "Reestruturacao");
      return safeReply(interaction, { content: `Todos os cargos removidos de ${member}.`, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error("[INTERACTION] Erro:", error);
    if (interaction.isRepliable()) {
      await safeReply(interaction, {
        content: "Ocorreu um erro ao processar a interacao.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.channel.isThread()) return;
  const map = state.anonymousThreads[message.channel.id];
  if (!map) return;
  if (message.author.id === client.user.id) return;
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  const isStaff = member.permissions.has(PermissionFlagsBits.ManageMessages);
  if (!isStaff) return;
  const user = await client.users.fetch(map.userId).catch(() => null);
  if (!user) return;
  const text = message.content?.trim();
  if (!text) return;
  await user
    .send(`Resposta da diretoria (${message.guild.name}) sobre seu relato anonimo:\n${text}`)
    .catch(() => null);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("Defina DISCORD_TOKEN no .env. Opcional: GUILD_ID para registro rapido.");
  process.exit(1);
}

process.on("uncaughtException", (error) => {
  console.error("[FATAL] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandledRejection:", reason);
});

client.on("error", (error) => {
  console.error("[CLIENT] Erro no websocket:", error);
});

client.login(process.env.DISCORD_TOKEN);

