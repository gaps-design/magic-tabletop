const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "hall-of-fame.json");

function now() {
  return Date.now();
}

function createEmptyState() {
  return {
    version: 1,
    players: {},
    events: {},
    matches: {},
    processedMatches: {},
    suspiciousEvents: []
  };
}

let state = loadState();

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return createEmptyState();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      ...createEmptyState(),
      ...parsed,
      players: parsed.players || {},
      events: parsed.events || {},
      matches: parsed.matches || {},
      processedMatches: parsed.processedMatches || {},
      suspiciousEvents: parsed.suspiciousEvents || []
    };
  } catch (error) {
    console.error("Falha ao carregar Hall da Fama:", error.message);
    return createEmptyState();
  }
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isTestName(name = "") {
  const normalized = normalizeText(name);
  if (!normalized) return true;
  const testWords = new Set(["teste", "test", "aaa", "asd", "demo", "local"]);
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some(word => testWords.has(word)) || (words.length > 0 && words.every(word => testWords.has(word)));
}

function playerId(player = {}) {
  return player.userId || player.id || player.email || "";
}

function isLoggedPlayer(player = {}) {
  return !!playerId(player);
}

function validMatches(tournament = {}) {
  return (tournament.matches || []).filter(match => {
    if (!match.result || match.result === "drop" || match.result === "bye" || match.isBye) return false;
    const p1 = (tournament.players || []).find(player => player.id === match.player1Id || player.userId === match.player1Id);
    const p2 = (tournament.players || []).find(player => player.id === match.player2Id || player.userId === match.player2Id);
    return isLoggedPlayer(p1) && isLoggedPlayer(p2);
  });
}

function validateEventForRanking(tournament = {}) {
  if (!tournament) return { isRanked: false, reason: "Evento nao encontrado." };
  if (tournament.isRankedRequested === false) return { isRanked: false, reason: "Evento criado como casual." };
  if (isTestName(tournament.name)) return { isRanked: false, reason: "Nome de teste nao conta para o Hall da Fama." };
  if (tournament.status !== "finished") return { isRanked: false, reason: "Evento precisa estar finalizado." };

  const players = tournament.players || [];
  const loggedPlayers = players.filter(isLoggedPlayer);
  const uniqueLoggedIds = new Set(loggedPlayers.map(playerId));
  const matches = validMatches(tournament);
  const matchedPlayers = new Set(matches.flatMap(match => [match.player1Id, match.player2Id]).filter(Boolean));
  const uniquePairs = new Set(matches.map(match => [match.player1Id, match.player2Id].sort().join("::")));

  if (tournament.type === "round_table") {
    if (uniqueLoggedIds.size < 3) return { isRanked: false, reason: "Mesa Redonda precisa de pelo menos 3 jogadores logados." };
    if (matches.length < 2) return { isRanked: false, reason: "Mesa Redonda precisa de pelo menos 2 partidas validas." };
    if (uniquePairs.size < 2) return { isRanked: false, reason: "Partidas repetidas entre apenas o mesmo par nao ranqueiam." };
    return { isRanked: true, reason: "" };
  }

  if (uniqueLoggedIds.size < 3) return { isRanked: false, reason: "Torneio precisa de pelo menos 3 jogadores logados." };
  if (matchedPlayers.size < 2) return { isRanked: false, reason: "Torneio precisa de partidas entre pelo menos 2 jogadores." };
  return { isRanked: true, reason: "" };
}

function createProfile(player = {}) {
  const id = playerId(player);
  const timestamp = now();
  return {
    id,
    userId: player.userId || player.id || id,
    googleId: player.userId || player.id || id,
    name: player.name || "Jogador",
    email: player.email || "",
    avatar: player.avatar || player.photo || "/assets/default-avatar.png",
    createdAt: timestamp,
    updatedAt: timestamp,
    totalPoints: 0,
    totalMatches: 0,
    totalWins: 0,
    totalDraws: 0,
    totalLosses: 0,
    winRate: 0,
    titles: 0,
    runnerUps: 0,
    tournamentsPlayed: 0,
    roundTablesPlayed: 0,
    lastPlayedAt: null,
    roundTablePoints: 0,
    roundTableMatches: 0,
    roundTableWins: 0,
    roundTableDraws: 0,
    roundTableLosses: 0,
    currentStreak: 0,
    bestStreak: 0,
    timesKingOfTable: 0,
    roundTableTitles: 0,
    tournamentPoints: 0,
    tournamentMatches: 0,
    tournamentWins: 0,
    tournamentDraws: 0,
    tournamentLosses: 0,
    tournamentTitles: 0,
    tournamentTop3: 0,
    swissTournamentsPlayed: 0,
    trustedScore: 100,
    suspiciousEvents: [],
    lastValidEventAt: null
  };
}

function getProfile(player = {}) {
  const id = playerId(player);
  if (!id) return null;
  if (!state.players[id]) {
    state.players[id] = createProfile(player);
  }
  const profile = state.players[id];
  profile.name = player.name || profile.name;
  profile.email = player.email || profile.email;
  profile.avatar = player.avatar || player.photo || profile.avatar;
  profile.updatedAt = now();
  return profile;
}

function addSuspiciousEvent(eventId, userId, reason, severity = "medium") {
  const duplicate = state.suspiciousEvents.some(item => item.eventId === eventId && item.userId === userId && item.reason === reason);
  if (duplicate) return;
  state.suspiciousEvents.push({
    id: `suspicious-${eventId}-${state.suspiciousEvents.length + 1}`,
    eventId,
    userId,
    reason,
    severity,
    createdAt: now()
  });
}

function flagSuspiciousPatterns(tournament = {}) {
  if (isTestName(tournament.name)) addSuspiciousEvent(tournament.id, tournament.ownerId, "Nome de teste.", "low");
  const matches = validMatches(tournament);
  const pairCounts = new Map();
  matches.forEach(match => {
    const key = [match.player1Id, match.player2Id].sort().join("::");
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  });
  pairCounts.forEach((count, key) => {
    if (count >= 4) addSuspiciousEvent(tournament.id, key, "Mesmo par repetido muitas vezes no evento.", "medium");
  });
  if (tournament.type === "round_table") {
    const uniquePlayers = new Set((tournament.players || []).filter(isLoggedPlayer).map(playerId));
    if (uniquePlayers.size < 3) addSuspiciousEvent(tournament.id, tournament.ownerId, "Mesa Redonda com apenas 2 jogadores.", "high");
  }
}

function matchPoints(result, playerSlot) {
  if (result === "draw") return 1;
  if (result === "player1_win" && playerSlot === 1) return 3;
  if (result === "player2_win" && playerSlot === 2) return 3;
  return 0;
}

function applyMatchToProfile(profile, match, type, slot) {
  const won = (match.result === "player1_win" && slot === 1) || (match.result === "player2_win" && slot === 2);
  const draw = match.result === "draw";
  const points = matchPoints(match.result, slot);

  profile.totalPoints += points;
  profile.totalMatches += 1;
  profile.totalWins += won ? 1 : 0;
  profile.totalDraws += draw ? 1 : 0;
  profile.totalLosses += !won && !draw ? 1 : 0;
  profile.lastPlayedAt = match.reportedAt || match.updatedAt || now();
  profile.lastValidEventAt = profile.lastPlayedAt;

  if (type === "round_table") {
    profile.roundTablePoints += points;
    profile.roundTableMatches += 1;
    profile.roundTableWins += won ? 1 : 0;
    profile.roundTableDraws += draw ? 1 : 0;
    profile.roundTableLosses += !won && !draw ? 1 : 0;
    profile.currentStreak = won ? profile.currentStreak + 1 : 0;
    profile.bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
    if (won) profile.timesKingOfTable += 1;
  } else {
    profile.tournamentPoints += points;
    profile.tournamentMatches += 1;
    profile.tournamentWins += won ? 1 : 0;
    profile.tournamentDraws += draw ? 1 : 0;
    profile.tournamentLosses += !won && !draw ? 1 : 0;
  }

  profile.winRate = profile.totalMatches ? profile.totalWins / profile.totalMatches : 0;
  profile.updatedAt = now();
}

function determineChampion(tournament = {}) {
  const players = [...(tournament.players || [])].sort((a, b) => {
    const pointsDiff = (b.matchPoints || b.points || 0) - (a.matchPoints || a.points || 0);
    if (pointsDiff) return pointsDiff;
    const winsDiff = (b.matchWins || b.wins || 0) - (a.matchWins || a.wins || 0);
    if (winsDiff) return winsDiff;
    const streakDiff = (b.bestStreak || 0) - (a.bestStreak || 0);
    if (streakDiff) return streakDiff;
    const lossDiff = (a.matchLosses || a.losses || 0) - (b.matchLosses || b.losses || 0);
    if (lossDiff) return lossDiff;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return players[0] || null;
}

function upsertEvent(tournament, validation) {
  const existing = state.events[tournament.id] || {};
  const champion = validation.isRanked ? determineChampion(tournament) : null;
  state.events[tournament.id] = {
    ...existing,
    id: tournament.id,
    type: tournament.type === "round_table" ? "round_table" : "swiss_tournament",
    name: tournament.name,
    createdBy: tournament.ownerId,
    status: validation.isRanked ? "finished" : "unranked",
    isRanked: validation.isRanked,
    reasonUnranked: validation.reason || "",
    playerCount: (tournament.players || []).length,
    validPlayerCount: new Set((tournament.players || []).filter(isLoggedPlayer).map(playerId)).size,
    championId: playerId(champion),
    championName: champion?.name || "",
    startedAt: tournament.createdAt,
    finishedAt: tournament.updatedAt || now(),
    createdAt: existing.createdAt || now(),
    updatedAt: now()
  };
}

function updateHallOfFameFromEvent(tournament = {}) {
  flagSuspiciousPatterns(tournament);
  const validation = validateEventForRanking(tournament);
  upsertEvent(tournament, validation);

  if (!validation.isRanked) {
    saveState();
    return { isRanked: false, reason: validation.reason };
  }

  const eventProcessed = state.processedMatches[tournament.id] || {};
  const matches = validMatches(tournament);
  matches.forEach(match => {
    if (eventProcessed[match.id]) return;
    const p1 = (tournament.players || []).find(player => player.id === match.player1Id || player.userId === match.player1Id);
    const p2 = (tournament.players || []).find(player => player.id === match.player2Id || player.userId === match.player2Id);
    const profile1 = getProfile(p1);
    const profile2 = getProfile(p2);
    if (!profile1 || !profile2) return;

    applyMatchToProfile(profile1, match, tournament.type, 1);
    applyMatchToProfile(profile2, match, tournament.type, 2);
    state.matches[`${tournament.id}:${match.id}`] = {
      id: `${tournament.id}:${match.id}`,
      eventId: tournament.id,
      eventType: tournament.type === "round_table" ? "round_table" : "swiss_tournament",
      matchId: match.id,
      roundNumber: match.roundNumber || null,
      tableNumber: match.tableNumber || null,
      player1Id: playerId(p1),
      player2Id: playerId(p2),
      winnerId: match.winnerId || null,
      loserId: match.winnerId ? (match.winnerId === match.player1Id ? playerId(p2) : playerId(p1)) : null,
      isDraw: match.result === "draw",
      player1Score: match.player1GameWins,
      player2Score: match.player2GameWins,
      resultLabel: match.resultLabel || "",
      reportedBy: match.reportedBy || "",
      confirmedBy: "",
      createdAt: match.reportedAt || match.updatedAt || now(),
      isRanked: true,
      reasonUnranked: ""
    };
    eventProcessed[match.id] = true;
  });
  state.processedMatches[tournament.id] = eventProcessed;

  if (!state.events[tournament.id]?.participationApplied) {
    (tournament.players || []).filter(isLoggedPlayer).forEach(player => {
      const profile = getProfile(player);
      if (!profile) return;
      if (tournament.type === "round_table") {
        profile.roundTablesPlayed += 1;
      } else {
        profile.tournamentsPlayed += 1;
        profile.swissTournamentsPlayed += 1;
      }
      profile.updatedAt = now();
    });
    state.events[tournament.id].participationApplied = true;
  }

  const champion = determineChampion(tournament);
  const championProfile = getProfile(champion);
  if (championProfile && !state.events[tournament.id]?.titleApplied) {
    championProfile.titles += 1;
    if (tournament.type === "round_table") {
      championProfile.roundTableTitles += 1;
    } else {
      championProfile.tournamentTitles += 1;
      getTopPlayers(tournament, 3).forEach(player => {
        const profile = getProfile(player);
        if (profile) profile.tournamentTop3 += 1;
      });
    }
    state.events[tournament.id].titleApplied = true;
  }

  saveState();
  return { isRanked: true, reason: "" };
}

function getTopPlayers(tournament, count) {
  return [...(tournament.players || [])].sort((a, b) =>
    (b.matchPoints || b.points || 0) - (a.matchPoints || a.points || 0) ||
    (b.matchWins || b.wins || 0) - (a.matchWins || a.wins || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  ).slice(0, count);
}

function sortGeneral(a, b) {
  return b.titles - a.titles || b.totalPoints - a.totalPoints || b.winRate - a.winRate || b.totalWins - a.totalWins || b.totalMatches - a.totalMatches || a.name.localeCompare(b.name);
}

function sortRoundTable(a, b) {
  return b.roundTableTitles - a.roundTableTitles || b.bestStreak - a.bestStreak || b.roundTablePoints - a.roundTablePoints || b.roundTableWins - a.roundTableWins || a.name.localeCompare(b.name);
}

function sortTournaments(a, b) {
  return b.tournamentTitles - a.tournamentTitles || b.tournamentTop3 - a.tournamentTop3 || b.tournamentPoints - a.tournamentPoints || b.tournamentWins - a.tournamentWins || a.name.localeCompare(b.name);
}

function getHallOfFame() {
  const players = Object.values(state.players);
  const events = Object.values(state.events).sort((a, b) => (b.finishedAt || b.updatedAt || 0) - (a.finishedAt || a.updatedAt || 0));
  const rankedRoundTableEvents = events.filter(event => event.type === "round_table" && event.isRanked);
  const roundTableLeader = [...players].sort(sortRoundTable)[0] || null;
  const bestStreak = [...players].sort((a, b) => b.bestStreak - a.bestStreak || a.name.localeCompare(b.name))[0] || null;
  const mostMatches = [...players].sort((a, b) => b.totalMatches - a.totalMatches || a.name.localeCompare(b.name))[0] || null;
  return {
    general: [...players].sort(sortGeneral),
    roundTable: [...players].sort(sortRoundTable),
    tournaments: [...players].sort(sortTournaments),
    players: [...players].sort((a, b) => a.name.localeCompare(b.name)),
    events,
    matches: Object.values(state.matches).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    suspiciousEvents: state.suspiciousEvents,
    summary: {
      currentRoundTableChampion: rankedRoundTableEvents[0]?.championName || roundTableLeader?.name || "",
      bestStreakPlayer: bestStreak?.bestStreak ? bestStreak : null,
      biggestChampion: [...players].sort(sortGeneral)[0] || null,
      mostMatchesPlayer: mostMatches?.totalMatches ? mostMatches : null
    }
  };
}

module.exports = {
  getHallOfFame,
  updateHallOfFameFromEvent,
  validateEventForRanking
};
