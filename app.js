// ============================================
// 1. STATE & CONSTANTS
// ============================================
let currentTab = 'games';
let currentStatsView = 'team';
let playerSort = 'goals';
let pendingScorerId = null;
let editingGameId = null;
let editGoalEvents = [];
let editOpponentGoalCount = 0;
let guestPlayers = [];  // [{ id: -1, name: 'Guest Name' }, ...]
let nextGuestId = -1;

// ============================================
// 2. DATA LAYER (localStorage CRUD)
// ============================================
function getRoster() {
  return JSON.parse(localStorage.getItem('roster') || '[]');
}

function saveRoster(roster) {
  localStorage.setItem('roster', JSON.stringify(roster));
}

function getGames() {
  return JSON.parse(localStorage.getItem('games') || '[]');
}

function saveGames(games) {
  localStorage.setItem('games', JSON.stringify(games));
}

function getActiveGame() {
  const g = localStorage.getItem('activeGame');
  return g ? JSON.parse(g) : null;
}

function saveActiveGame(game) {
  localStorage.setItem('activeGame', JSON.stringify(game));
}

function clearActiveGame() {
  localStorage.removeItem('activeGame');
}

function getTeamName() {
  return localStorage.getItem('teamName') || 'My Team';
}

function getSeason() {
  return localStorage.getItem('season') || '';
}

function nextPlayerId() {
  const roster = getRoster();
  if (roster.length === 0) return 1;
  return Math.max(...roster.map(p => p.id)) + 1;
}

async function seedRosterFromFile() {
  if (localStorage.getItem('rosterSeeded')) return;
  try {
    const resp = await fetch('roster.json');
    const data = await resp.json();
    const roster = data.players.map((name, i) => ({ id: i + 1, name }));
    saveRoster(roster);
    localStorage.setItem('teamName', data.teamName || 'My Team');
    localStorage.setItem('season', data.season || '');
    localStorage.setItem('rosterSeeded', 'true');
  } catch (e) {
    // roster.json not available — start empty
  }
}

async function loadDataFile() {
  // Skip if localStorage already has data loaded
  if (localStorage.getItem('rosterSeeded') && getGames().length > 0) return;

  try {
    const resp = await fetch('dcsc-data.json');
    const data = await resp.json();

    if (data.roster) saveRoster(data.roster);
    if (data.games) saveGames(data.games);
    if (data.teamName) localStorage.setItem('teamName', data.teamName);
    if (data.season) localStorage.setItem('season', data.season);
    localStorage.setItem('rosterSeeded', 'true');
  } catch (e) {
    // dcsc-data.json not available — fall back to roster-only seed
    await seedRosterFromFile();
  }
}

// ============================================
// 3. COMPUTED STATS
// ============================================
function computeTeamRecord(games) {
  let w = 0, l = 0, d = 0, gf = 0, ga = 0;
  games.forEach(g => {
    gf += g.goalsFor;
    ga += g.goalsAgainst;
    if (g.result === 'W') w++;
    else if (g.result === 'L') l++;
    else d++;
  });
  return { w, l, d, gf, ga, gd: gf - ga, played: games.length };
}

function computeOpponentHistory(games) {
  const map = {};
  games.forEach(g => {
    if (!map[g.opponent]) map[g.opponent] = { opponent: g.opponent, w: 0, l: 0, d: 0, gf: 0, ga: 0, games: 0 };
    const o = map[g.opponent];
    o.games++;
    o.gf += g.goalsFor;
    o.ga += g.goalsAgainst;
    if (g.result === 'W') o.w++;
    else if (g.result === 'L') o.l++;
    else o.d++;
  });
  return Object.values(map).sort((a, b) => b.games - a.games);
}

function computePlayerStats(games, roster) {
  const stats = {};
  roster.forEach(p => {
    stats[p.id] = { playerId: p.id, name: p.name, goals: 0, assists: 0, gamesPlayed: 0 };
  });
  games.forEach(g => {
    // Add guest players to stats if not already there
    (g.guestPlayers || []).forEach(p => {
      if (!stats[p.id]) stats[p.id] = { playerId: p.id, name: p.name, goals: 0, assists: 0, gamesPlayed: 0 };
    });
    (g.playersPresent || []).forEach(pid => {
      if (stats[pid]) stats[pid].gamesPlayed++;
    });
    (g.events || []).forEach(ev => {
      if (ev.type === 'goal') {
        if (stats[ev.playerId]) stats[ev.playerId].goals++;
        if (ev.assistPlayerId && stats[ev.assistPlayerId]) stats[ev.assistPlayerId].assists++;
      }
    });
  });
  return Object.values(stats);
}

// ============================================
// 4. RENDERING
// ============================================
function renderHeader() {
  document.getElementById('team-name').textContent = getTeamName();
  document.getElementById('season-label').textContent = getSeason();
}

function renderEventLine(e, rosterMap, opponent) {
  if (e.type === 'goal') {
    const scorer = rosterMap[e.playerId] || '?';
    const assist = e.assistPlayerId ? ` (ast. ${rosterMap[e.assistPlayerId] || '?'})` : '';
    return `<div class="goal-event"><span class="event-icon">⚽</span> <span class="scorer">${scorer}</span><span class="assist">${assist}</span></div>`;
  } else if (e.type === 'opponent_goal') {
    return `<div class="goal-event opp-event"><span class="event-icon">⚽</span> ${opponent}</div>`;
  } else if (e.type === 'yellow_card') {
    const who = cardRecipientLabel(e, rosterMap, opponent);
    return `<div class="goal-event card-event yellow"><span class="event-icon">🟨</span> ${who}</div>`;
  } else if (e.type === 'red_card') {
    const who = cardRecipientLabel(e, rosterMap, opponent);
    const note = e.secondYellow ? ' (2nd yellow)' : '';
    return `<div class="goal-event card-event red"><span class="event-icon">🟥</span> ${who}${note}</div>`;
  }
  return '';
}

function cardRecipientLabel(e, rosterMap, opponent) {
  if (e.team === 'dcsc') {
    if (e.isCoach) return 'DCSC Coach';
    return rosterMap[e.playerId] || '?';
  } else {
    if (e.isCoach) return `${opponent} Coach`;
    return e.jersey ? `${opponent} #${e.jersey}` : opponent;
  }
}

function renderGamesTab() {
  const games = getGames();
  const active = getActiveGame();
  const record = computeTeamRecord(games);

  // Season summary
  const summaryEl = document.getElementById('season-summary');
  if (games.length === 0 && !active) {
    summaryEl.innerHTML = '<div class="empty-state"><p>No games yet. Start your first game!</p></div>';
  } else {
    const gdSign = record.gd >= 0 ? '+' : '';
    summaryEl.innerHTML = `
      <div class="record-line">${record.w}W - ${record.l}L - ${record.d}D</div>
      <div class="record-detail">${record.gf} GF | ${record.ga} GA | ${gdSign}${record.gd} GD</div>
    `;
  }

  // Action button
  const actionEl = document.getElementById('game-action-btn');
  if (active) {
    actionEl.innerHTML = '<button class="btn btn-primary btn-large" onclick="resumeGame()">Resume Game</button>';
  } else {
    actionEl.innerHTML = '<button class="btn btn-primary btn-large" onclick="showPregame()">Start New Game</button>';
  }

  // Games list
  const listEl = document.getElementById('games-list');
  if (games.length === 0) {
    listEl.innerHTML = '';
    return;
  }
  const roster = getRoster();
  const baseRosterMap = {};
  roster.forEach(p => baseRosterMap[p.id] = p.name);

  listEl.innerHTML = [...games].reverse().map(g => {
    // Build per-game roster map including guests
    const rosterMap = { ...baseRosterMap };
    (g.guestPlayers || []).forEach(p => rosterMap[p.id] = p.name);

    const events = g.events || [];
    const detailLines = events.map(e => renderEventLine(e, rosterMap, g.opponent)).join('');
    const hasEvents = events.length > 0;

    return `
      <div class="game-card" onclick="toggleGameDetail(this)">
        <div class="game-header">
          <div>
            <div class="game-date">${formatDate(g.date)}</div>
            <div class="game-matchup">vs ${g.opponent}</div>
          </div>
          <div class="game-score result-${g.result}">${g.result} ${g.goalsFor}-${g.goalsAgainst}</div>
        </div>
        <div class="game-details">
          ${hasEvents ? detailLines : '<div style="color:#999">No events recorded</div>'}
          <div class="game-actions">
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); showEditGame('${g.id}')">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); showDeleteConfirm('${g.id}')">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleGameDetail(card) {
  const details = card.querySelector('.game-details');
  details.classList.toggle('expanded');
}

function renderStatsTab() {
  const games = getGames();
  const roster = getRoster();
  const record = computeTeamRecord(games);

  // Team record
  const teamEl = document.getElementById('team-record');
  if (games.length === 0) {
    teamEl.innerHTML = '<div class="empty-state"><p>Play some games to see stats!</p></div>';
    document.getElementById('opponent-history').innerHTML = '';
    document.getElementById('player-leaderboard').innerHTML = '<div class="empty-state"><p>Play some games to see stats!</p></div>';
    return;
  }

  const gdSign = record.gd >= 0 ? '+' : '';
  teamEl.innerHTML = `
    <div class="stat-box">
      <div class="stat-grid">
        <div class="stat-item"><div class="stat-value">${record.played}</div><div class="stat-label">Played</div></div>
        <div class="stat-item"><div class="stat-value">${record.w}-${record.l}-${record.d}</div><div class="stat-label">W-L-D</div></div>
        <div class="stat-item"><div class="stat-value">${record.gf}</div><div class="stat-label">Goals For</div></div>
        <div class="stat-item"><div class="stat-value">${record.ga}</div><div class="stat-label">Goals Against</div></div>
      </div>
      <div class="stat-item" style="margin-top:8px"><div class="stat-value">${gdSign}${record.gd}</div><div class="stat-label">Goal Difference</div></div>
    </div>
  `;

  // Opponent history
  const opponents = computeOpponentHistory(games);
  const oppEl = document.getElementById('opponent-history');
  oppEl.innerHTML = `
    <table class="stats-table">
      <thead><tr><th>Opponent</th><th>GP</th><th>W</th><th>L</th><th>D</th><th>GF</th><th>GA</th></tr></thead>
      <tbody>${opponents.map(o => `<tr><td>${o.opponent}</td><td>${o.games}</td><td>${o.w}</td><td>${o.l}</td><td>${o.d}</td><td>${o.gf}</td><td>${o.ga}</td></tr>`).join('')}</tbody>
    </table>
  `;

  // Player leaderboard
  renderPlayerLeaderboard();
}

function renderPlayerLeaderboard() {
  const games = getGames();
  const roster = getRoster();
  if (games.length === 0) return;

  let stats = computePlayerStats(games, roster);
  // Filter out players with no activity
  stats = stats.filter(s => s.goals > 0 || s.assists > 0 || s.gamesPlayed > 0);
  // Sort
  if (playerSort === 'goals') {
    stats.sort((a, b) => b.goals - a.goals || b.assists - a.assists);
  } else {
    stats.sort((a, b) => b.assists - a.assists || b.goals - a.goals);
  }

  const el = document.getElementById('player-leaderboard');
  el.innerHTML = `
    <table class="stats-table">
      <thead><tr>
        <th>Player</th>
        <th class="sortable ${playerSort === 'goals' ? 'sorted' : ''}" onclick="sortPlayers('goals')">G</th>
        <th class="sortable ${playerSort === 'assists' ? 'sorted' : ''}" onclick="sortPlayers('assists')">A</th>
        <th>GP</th>
      </tr></thead>
      <tbody>${stats.map(s => `<tr><td>${s.name}</td><td>${s.goals}</td><td>${s.assists}</td><td>${s.gamesPlayed}</td></tr>`).join('')}</tbody>
    </table>
  `;
}

function sortPlayers(by) {
  playerSort = by;
  renderPlayerLeaderboard();
}

function renderRosterTab() {
  const roster = getRoster();
  const listEl = document.getElementById('roster-list');

  if (roster.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>No players yet. Add your roster!</p></div>';
    return;
  }

  listEl.innerHTML = roster.map(p => `
    <div class="roster-item">
      <span class="roster-name">${p.name}</span>
      <div class="roster-actions">
        <button onclick="showEditPlayer(${p.id})">Edit</button>
        <button class="delete-btn" onclick="removePlayer(${p.id})">Remove</button>
      </div>
    </div>
  `).join('');
}

// ============================================
// 5. GAME FLOW
// ============================================
function showPregame() {
  const roster = getRoster();
  if (roster.length === 0) {
    alert('Add players to your roster first!');
    switchTab('roster');
    return;
  }

  document.getElementById('game-overlay').classList.remove('hidden');
  document.getElementById('pregame-setup').classList.remove('hidden');
  document.getElementById('ingame-view').classList.add('hidden');
  document.getElementById('opponent-input').value = '';

  const attEl = document.getElementById('attendance-list');
  attEl.innerHTML = roster.map(p => `
    <div class="attendance-item">
      <label><input type="checkbox" checked data-player-id="${p.id}"> ${p.name}</label>
    </div>
  `).join('');

  // Reset guest players
  guestPlayers = [];
  nextGuestId = -1;
  renderGuestList();

  document.getElementById('opponent-input').focus();
}

function cancelPregame() {
  document.getElementById('game-overlay').classList.add('hidden');
  document.getElementById('pregame-setup').classList.add('hidden');
}

function addGuestPlayer() {
  const guest = { id: nextGuestId--, name: '' };
  guestPlayers.push(guest);
  renderGuestList();
  // Focus the new input
  const inputs = document.querySelectorAll('#guest-list input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
}

function removeGuestPlayer(guestId) {
  guestPlayers = guestPlayers.filter(g => g.id !== guestId);
  renderGuestList();
}

function updateGuestName(guestId, name) {
  const guest = guestPlayers.find(g => g.id === guestId);
  if (guest) guest.name = name;
}

function renderGuestList() {
  const el = document.getElementById('guest-list');
  el.innerHTML = guestPlayers.map(g => `
    <div class="guest-item">
      <input type="text" value="${g.name}" placeholder="Guest name" autocomplete="off"
        onchange="updateGuestName(${g.id}, this.value)"
        oninput="updateGuestName(${g.id}, this.value)">
      <button class="btn-remove" onclick="removeGuestPlayer(${g.id})">✕</button>
    </div>
  `).join('');
}

function kickOff() {
  const opponent = document.getElementById('opponent-input').value.trim();
  if (!opponent) {
    alert('Enter an opponent name!');
    return;
  }

  const checkboxes = document.querySelectorAll('#attendance-list input[type="checkbox"]');
  const present = [];
  checkboxes.forEach(cb => {
    if (cb.checked) present.push(parseInt(cb.dataset.playerId));
  });

  if (present.length === 0) {
    alert('At least one player must be present!');
    return;
  }

  // Filter out guests with empty names
  const validGuests = guestPlayers.filter(g => g.name.trim());
  const guestIds = validGuests.map(g => g.id);
  const allPresent = present.concat(guestIds);

  const game = {
    id: 'game_' + Date.now(),
    date: new Date().toISOString().slice(0, 10),
    opponent,
    half: 1,
    events: [],
    playersPresent: allPresent,
    guestPlayers: validGuests.map(g => ({ id: g.id, name: g.name.trim() })),
    goalsAgainst: 0
  };

  saveActiveGame(game);
  showIngame();
}

function resumeGame() {
  document.getElementById('game-overlay').classList.remove('hidden');
  document.getElementById('pregame-setup').classList.add('hidden');
  showIngame();
}

function showIngame() {
  const game = getActiveGame();
  if (!game) return;

  document.getElementById('pregame-setup').classList.add('hidden');
  document.getElementById('ingame-view').classList.remove('hidden');
  document.getElementById('game-overlay').classList.remove('hidden');

  renderScoreboard();
  renderPlayerGrid();
}

function renderScoreboard() {
  const game = getActiveGame();
  if (!game) return;

  const goalsFor = game.events.filter(e => e.type === 'goal').length;
  document.getElementById('score-home').textContent = goalsFor;
  document.getElementById('score-away').textContent = game.goalsAgainst;
  document.getElementById('score-half').textContent = game.half === 1 ? '1st Half' : '2nd Half';
  document.getElementById('score-away-label').textContent = game.opponent;
  document.getElementById('score-home-label').textContent = 'DCSC';
  document.getElementById('half-toggle-btn').textContent = game.half === 1 ? 'Switch to 2nd Half' : 'Switch to 1st Half';
}

function getGameRoster(game) {
  // Combine regular roster with guest players from this game
  const roster = getRoster();
  const guests = game.guestPlayers || [];
  return roster.concat(guests);
}

function renderPlayerGrid() {
  const game = getActiveGame();
  if (!game) return;
  const roster = getGameRoster(game);
  const present = roster.filter(p => game.playersPresent.includes(p.id));

  const gridEl = document.getElementById('player-grid');
  gridEl.innerHTML = present.map(p => `
    <button class="player-btn" data-player-id="${p.id}" onclick="recordGoal(${p.id})">${p.name}</button>
  `).join('');
}

function recordGoal(playerId) {
  pendingScorerId = playerId;
  const game = getActiveGame();
  const roster = getGameRoster(game);
  const scorer = roster.find(p => p.id === playerId);
  const present = roster.filter(p => game.playersPresent.includes(p.id) && p.id !== playerId);

  document.getElementById('assist-title').textContent = `Goal by ${scorer ? scorer.name : '?'}! Who assisted?`;

  const gridEl = document.getElementById('assist-grid');
  gridEl.innerHTML = present.map(p => `
    <button class="assist-btn" onclick="confirmGoal(${playerId}, ${p.id})">${p.name}</button>
  `).join('');

  document.getElementById('assist-modal').classList.remove('hidden');
}

function confirmGoal(scorerId, assistId) {
  const game = getActiveGame();
  game.events.push({ type: 'goal', playerId: scorerId, assistPlayerId: assistId || null });
  saveActiveGame(game);
  document.getElementById('assist-modal').classList.add('hidden');
  pendingScorerId = null;
  renderScoreboard();
  showGoalFlash();
}

function noAssist() {
  confirmGoal(pendingScorerId, null);
}

function recordOpponentGoal() {
  const game = getActiveGame();
  game.goalsAgainst++;
  game.events.push({ type: 'opponent_goal' });
  saveActiveGame(game);
  renderScoreboard();
}

function undoLastEvent() {
  const game = getActiveGame();
  if (game.events.length === 0) {
    alert('Nothing to undo!');
    return;
  }
  const last = game.events[game.events.length - 1];
  const roster = getGameRoster(game);
  let desc = '';
  if (last.type === 'goal') {
    const p = roster.find(r => r.id === last.playerId);
    desc = `Goal by ${p ? p.name : '?'}`;
  } else if (last.type === 'opponent_goal') {
    desc = 'Opponent goal';
  } else if (last.type === 'yellow_card') {
    const who = last.isCoach ? 'Coach' : (last.team === 'dcsc' ? (roster.find(r => r.id === last.playerId)?.name || '?') : (last.jersey ? `#${last.jersey}` : 'Opponent'));
    desc = `Yellow card: ${who}`;
  } else if (last.type === 'red_card') {
    const who = last.isCoach ? 'Coach' : (last.team === 'dcsc' ? (roster.find(r => r.id === last.playerId)?.name || '?') : (last.jersey ? `#${last.jersey}` : 'Opponent'));
    desc = `Red card: ${who}`;
  }

  if (confirm(`Undo: ${desc}?`)) {
    game.events.pop();
    if (last.type === 'opponent_goal') {
      game.goalsAgainst = Math.max(0, game.goalsAgainst - 1);
    }
    saveActiveGame(game);
    renderScoreboard();
  }
}

function toggleHalf() {
  const game = getActiveGame();
  game.half = game.half === 1 ? 2 : 1;
  saveActiveGame(game);
  renderScoreboard();
}

function showEndGameConfirm() {
  const game = getActiveGame();
  const goalsFor = game.events.filter(e => e.type === 'goal').length;
  document.getElementById('endgame-score').textContent = `DCSC ${goalsFor} - ${game.goalsAgainst} ${game.opponent}`;
  document.getElementById('endgame-confirm').classList.remove('hidden');
}

function cancelEndGame() {
  document.getElementById('endgame-confirm').classList.add('hidden');
}

function finalizeGame() {
  const game = getActiveGame();
  const goalsFor = game.events.filter(e => e.type === 'goal').length;
  const goalsAgainst = game.goalsAgainst;

  let result = 'D';
  if (goalsFor > goalsAgainst) result = 'W';
  else if (goalsFor < goalsAgainst) result = 'L';

  const completed = {
    id: game.id,
    date: game.date,
    opponent: game.opponent,
    goalsFor,
    goalsAgainst,
    result,
    events: game.events,
    playersPresent: game.playersPresent,
    guestPlayers: game.guestPlayers || []
  };

  const games = getGames();
  games.push(completed);
  saveGames(games);
  clearActiveGame();

  document.getElementById('endgame-confirm').classList.add('hidden');
  document.getElementById('game-overlay').classList.add('hidden');
  document.getElementById('ingame-view').classList.add('hidden');

  exportData();
  switchTab('games');
}

function showGoalFlash() {
  const flash = document.getElementById('goal-flash');
  flash.classList.remove('hidden');
  // Reset animation
  flash.style.animation = 'none';
  flash.offsetHeight; // trigger reflow
  flash.style.animation = '';
  setTimeout(() => flash.classList.add('hidden'), 700);
}

// ============================================
// 6. ROSTER MANAGEMENT
// ============================================
function showEditPlayer(id) {
  const roster = getRoster();
  const player = roster.find(p => p.id === id);
  if (!player) return;

  document.getElementById('edit-player-title').textContent = 'Edit Player';
  document.getElementById('edit-player-name').value = player.name;
  document.getElementById('edit-player-modal').classList.remove('hidden');
  document.getElementById('edit-player-save').onclick = () => {
    const name = document.getElementById('edit-player-name').value.trim();
    if (!name) return;
    player.name = name;
    saveRoster(roster);
    document.getElementById('edit-player-modal').classList.add('hidden');
    renderRosterTab();
  };
}

function showAddPlayer() {
  document.getElementById('edit-player-title').textContent = 'Add Player';
  document.getElementById('edit-player-name').value = '';
  document.getElementById('edit-player-modal').classList.remove('hidden');
  document.getElementById('edit-player-name').focus();
  document.getElementById('edit-player-save').onclick = () => {
    const name = document.getElementById('edit-player-name').value.trim();
    if (!name) return;
    const roster = getRoster();
    roster.push({ id: nextPlayerId(), name });
    saveRoster(roster);
    document.getElementById('edit-player-modal').classList.add('hidden');
    renderRosterTab();
  };
}

function cancelEditPlayer() {
  document.getElementById('edit-player-modal').classList.add('hidden');
}

function removePlayer(id) {
  const roster = getRoster();
  const player = roster.find(p => p.id === id);
  if (!player) return;
  if (!confirm(`Remove ${player.name} from roster?`)) return;
  saveRoster(roster.filter(p => p.id !== id));
  renderRosterTab();
}

// ============================================
// 6b. EDIT / DELETE GAME
// ============================================
function showEditGame(gameId) {
  editingGameId = gameId;
  const games = getGames();
  const game = games.find(g => g.id === gameId);
  if (!game) return;

  document.getElementById('edit-game-opponent').value = game.opponent;
  document.getElementById('edit-game-date').value = game.date;

  // Clone goal events for editing
  editGoalEvents = (game.events || []).filter(e => e.type === 'goal').map(e => ({ ...e }));
  editOpponentGoalCount = (game.events || []).filter(e => e.type === 'opponent_goal').length;
  editCardEvents = (game.events || []).filter(e => e.type === 'yellow_card' || e.type === 'red_card').map(e => ({ ...e }));

  renderEditGoals();
  renderEditCards();
  document.getElementById('edit-opponent-goals').textContent = editOpponentGoalCount;
  document.getElementById('edit-game-modal').classList.remove('hidden');
}

function renderEditGoals() {
  const roster = getRoster().filter(p => p.name !== 'Own Goal');
  const container = document.getElementById('edit-game-goals');

  if (editGoalEvents.length === 0) {
    container.innerHTML = '';
    return;
  }

  const labelsHtml = `<div class="edit-goal-labels"><span>Scorer</span><span>Assist</span><span></span></div>`;

  container.innerHTML = labelsHtml + editGoalEvents.map((e, i) => {
    const scorerOptions = roster.map(p =>
      `<option value="${p.id}" ${p.id === e.playerId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    const assistOptions = `<option value="">None</option>` + roster.map(p =>
      `<option value="${p.id}" ${p.id === e.assistPlayerId ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    return `
      <div class="edit-goal-row">
        <select onchange="updateEditGoalScorer(${i}, this.value)">${scorerOptions}</select>
        <select onchange="updateEditGoalAssist(${i}, this.value)">${assistOptions}</select>
        <button class="btn-remove" onclick="removeEditGoal(${i})">✕</button>
      </div>
    `;
  }).join('');
}

function updateEditGoalScorer(index, value) {
  editGoalEvents[index].playerId = parseInt(value);
}

function updateEditGoalAssist(index, value) {
  editGoalEvents[index].assistPlayerId = value ? parseInt(value) : null;
}

function addEditGoal() {
  const roster = getRoster().filter(p => p.name !== 'Own Goal');
  if (roster.length === 0) return;
  editGoalEvents.push({ type: 'goal', playerId: roster[0].id, assistPlayerId: null });
  renderEditGoals();
}

function removeEditGoal(index) {
  editGoalEvents.splice(index, 1);
  renderEditGoals();
}

function changeEditOpponentGoals(delta) {
  editOpponentGoalCount = Math.max(0, editOpponentGoalCount + delta);
  document.getElementById('edit-opponent-goals').textContent = editOpponentGoalCount;
}

function saveEditGame() {
  const games = getGames();
  const idx = games.findIndex(g => g.id === editingGameId);
  if (idx === -1) return;

  const opponent = document.getElementById('edit-game-opponent').value.trim();
  const date = document.getElementById('edit-game-date').value;
  if (!opponent) { alert('Enter an opponent name!'); return; }
  if (!date) { alert('Enter a date!'); return; }

  // Rebuild events array: goals, then opponent goals, then cards
  const events = editGoalEvents.map(e => ({ type: 'goal', playerId: e.playerId, assistPlayerId: e.assistPlayerId }));
  for (let i = 0; i < editOpponentGoalCount; i++) {
    events.push({ type: 'opponent_goal' });
  }
  editCardEvents.forEach(e => {
    const card = { type: e.type, team: e.team };
    if (e.isCoach) card.isCoach = true;
    else if (e.team === 'dcsc' && e.playerId) card.playerId = e.playerId;
    else if (e.team === 'opponent' && e.jersey) card.jersey = e.jersey;
    if (e.secondYellow) card.secondYellow = true;
    events.push(card);
  });

  const goalsFor = editGoalEvents.length;
  const goalsAgainst = editOpponentGoalCount;
  let result = 'D';
  if (goalsFor > goalsAgainst) result = 'W';
  else if (goalsFor < goalsAgainst) result = 'L';

  games[idx] = {
    ...games[idx],
    opponent,
    date,
    goalsFor,
    goalsAgainst,
    result,
    events
  };

  saveGames(games);
  document.getElementById('edit-game-modal').classList.add('hidden');
  exportData();
  switchTab('games');
}

function cancelEditGame() {
  document.getElementById('edit-game-modal').classList.add('hidden');
  editingGameId = null;
}

function showDeleteConfirm(gameId) {
  editingGameId = gameId;
  const games = getGames();
  const game = games.find(g => g.id === gameId);
  if (!game) return;

  document.getElementById('delete-game-info').textContent =
    `${formatDate(game.date)} vs ${game.opponent} — ${game.result} ${game.goalsFor}-${game.goalsAgainst}`;
  document.getElementById('delete-game-confirm').classList.remove('hidden');
}

function cancelDeleteGame() {
  document.getElementById('delete-game-confirm').classList.add('hidden');
}

function deleteGame() {
  let games = getGames();
  games = games.filter(g => g.id !== editingGameId);
  saveGames(games);
  document.getElementById('delete-game-confirm').classList.add('hidden');
  document.getElementById('edit-game-modal').classList.add('hidden');
  editingGameId = null;
  exportData();
  switchTab('games');
}

// ============================================
// 6c. GITHUB SYNC
// ============================================
const GITHUB_REPO = 'shane818/soccer-tracker';
const GITHUB_FILE = 'dcsc-data.json';

function getGitHubToken() {
  return localStorage.getItem('ghToken') || null;
}

function setGitHubToken(token) {
  localStorage.setItem('ghToken', token);
}

function forgetGitHubToken() {
  localStorage.removeItem('ghToken');
  setSyncStatus('Token removed', '');
}

function setSyncStatus(msg, type) {
  const el = document.getElementById('sync-status');
  el.textContent = msg;
  el.className = type;
}

async function syncToGitHub() {
  let token = getGitHubToken();
  if (!token) {
    token = prompt('Enter your GitHub Personal Access Token.\n\nCreate one at:\ngithub.com/settings/personal-access-tokens/new\n\nScope: soccer-tracker repo → Contents: Read & Write');
    if (!token || !token.trim()) return;
    setGitHubToken(token.trim());
    token = token.trim();
  }

  setSyncStatus('Syncing...', 'syncing');

  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };

  try {
    // Step 1: Get current file and its SHA
    const getResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, { headers });
    if (getResp.status === 401) {
      forgetGitHubToken();
      setSyncStatus('Invalid token. Tap Sync to re-enter.', 'error');
      return;
    }
    if (!getResp.ok) {
      setSyncStatus('Error reading repo: ' + getResp.status, 'error');
      return;
    }
    const fileData = await getResp.json();

    // Step 2: Decode remote data and merge with local
    let remoteData = {};
    try {
      remoteData = JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, '')))));
    } catch (e) { /* empty or corrupt remote — local wins */ }

    const localGames = getGames();
    const remoteGames = remoteData.games || [];
    const mergedGames = mergeGames(localGames, remoteGames);

    // Use most complete roster (whichever has more players)
    const localRoster = getRoster();
    const remoteRoster = remoteData.roster || [];
    const mergedRoster = mergeRoster(localRoster, remoteRoster);

    const merged = {
      teamName: getTeamName(),
      season: getSeason(),
      roster: mergedRoster,
      games: mergedGames,
      exportedAt: new Date().toISOString()
    };

    // Step 3: Save merged data locally
    saveGames(mergedGames);
    saveRoster(mergedRoster);

    // Step 4: Push merged data to GitHub
    const json = JSON.stringify(merged, null, 2);
    const content = btoa(unescape(encodeURIComponent(json)));

    const putResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'Sync game data (' + mergedGames.length + ' games)',
        content,
        sha: fileData.sha
      })
    });

    if (putResp.ok) {
      const localCount = localGames.length;
      const remoteCount = remoteGames.length;
      const mergedCount = mergedGames.length;
      const newFromRemote = mergedCount - localCount;
      const msg = newFromRemote > 0
        ? `Synced! Pulled ${newFromRemote} new game${newFromRemote > 1 ? 's' : ''}. ${mergedCount} total.`
        : `Synced! ${mergedCount} games. Site updates in ~30s.`;
      setSyncStatus(msg, 'success');
      switchTab('games');
    } else {
      const err = await putResp.json();
      setSyncStatus('Sync failed: ' + (err.message || putResp.status), 'error');
    }
  } catch (e) {
    setSyncStatus('Network error. Check connection.', 'error');
  }
}

function mergeGames(localGames, remoteGames) {
  const gameMap = {};
  // Add all local games first
  localGames.forEach(g => { gameMap[g.id] = g; });
  // Add remote games — remote wins for conflicts (has newer data from other parent)
  remoteGames.forEach(g => {
    if (!gameMap[g.id]) {
      // New game from remote — add it
      gameMap[g.id] = g;
    } else {
      // Game exists in both — keep whichever has more events (more complete record)
      const local = gameMap[g.id];
      if ((g.events || []).length > (local.events || []).length) {
        gameMap[g.id] = g;
      }
    }
  });
  // Sort by date
  return Object.values(gameMap).sort((a, b) => a.date.localeCompare(b.date));
}

function mergeRoster(localRoster, remoteRoster) {
  const rosterMap = {};
  localRoster.forEach(p => { rosterMap[p.id] = p; });
  remoteRoster.forEach(p => {
    if (!rosterMap[p.id]) rosterMap[p.id] = p;
  });
  return Object.values(rosterMap).sort((a, b) => a.id - b.id);
}

// ============================================
// 6d. CARD SYSTEM
// ============================================
let cardTeam = null;  // 'dcsc' or 'opponent'
let cardType = null;  // 'yellow' or 'red'

function showCardModal() {
  const game = getActiveGame();
  if (!game) return;
  cardTeam = null;
  cardType = null;
  document.getElementById('card-opp-btn').textContent = game.opponent;
  showCardStep('card-step-team');
  document.getElementById('card-modal').classList.remove('hidden');
}

function cancelCard() {
  document.getElementById('card-modal').classList.add('hidden');
}

function showCardStep(stepId) {
  document.querySelectorAll('.card-step').forEach(el => el.classList.add('hidden'));
  document.getElementById(stepId).classList.remove('hidden');
}

function cardSelectTeam(team) {
  cardTeam = team;
  showCardStep('card-step-type');
}

function cardBackToTeam() {
  showCardStep('card-step-team');
}

function cardSelectType(type) {
  cardType = type;
  if (cardTeam === 'dcsc') {
    const game = getActiveGame();
    const roster = getGameRoster(game);
    const present = roster.filter(p => game.playersPresent.includes(p.id) && p.name !== 'Own Goal');
    const title = type === 'yellow' ? 'Yellow card — who?' : 'Red card — who?';
    document.getElementById('card-dcsc-title').textContent = title;
    document.getElementById('card-player-grid').innerHTML = present.map(p =>
      `<button class="player-btn" onclick="cardSelectDcscPlayer(${p.id})">${p.name}</button>`
    ).join('');
    showCardStep('card-step-dcsc-player');
  } else {
    const title = type === 'yellow' ? 'Yellow card — opponent' : 'Red card — opponent';
    document.getElementById('card-opp-title').textContent = title;
    document.getElementById('card-jersey-input').value = '';
    showCardStep('card-step-opp-player');
  }
}

function cardBackToType() {
  showCardStep('card-step-type');
}

function cardSelectDcscPlayer(playerId) {
  const game = getActiveGame();
  // Check for 2nd yellow → auto-red
  if (cardType === 'yellow') {
    const hasYellow = game.events.some(e => e.type === 'yellow_card' && e.team === 'dcsc' && e.playerId === playerId);
    if (hasYellow) {
      game.events.push({ type: 'red_card', team: 'dcsc', playerId, secondYellow: true });
      saveActiveGame(game);
      document.getElementById('card-modal').classList.add('hidden');
      showCardFlash('red');
      return;
    }
  }
  game.events.push({ type: cardType + '_card', team: 'dcsc', playerId });
  saveActiveGame(game);
  document.getElementById('card-modal').classList.add('hidden');
  showCardFlash(cardType);
}

function cardSelectDcscCoach() {
  const game = getActiveGame();
  if (cardType === 'yellow') {
    const hasYellow = game.events.some(e => e.type === 'yellow_card' && e.team === 'dcsc' && e.isCoach);
    if (hasYellow) {
      game.events.push({ type: 'red_card', team: 'dcsc', isCoach: true, secondYellow: true });
      saveActiveGame(game);
      document.getElementById('card-modal').classList.add('hidden');
      showCardFlash('red');
      return;
    }
  }
  game.events.push({ type: cardType + '_card', team: 'dcsc', isCoach: true });
  saveActiveGame(game);
  document.getElementById('card-modal').classList.add('hidden');
  showCardFlash(cardType);
}

function cardSubmitOpponent() {
  const jersey = document.getElementById('card-jersey-input').value.trim();
  const game = getActiveGame();

  // Check for 2nd yellow on same jersey
  if (cardType === 'yellow' && jersey) {
    const hasYellow = game.events.some(e => e.type === 'yellow_card' && e.team === 'opponent' && e.jersey === jersey);
    if (hasYellow) {
      document.getElementById('card-2nd-title').textContent = '2nd yellow = Red Card?';
      document.getElementById('card-2nd-info').textContent = `Opponent #${jersey} already has a yellow card.`;
      showCardStep('card-step-second-yellow');
      return;
    }
  }

  const event = { type: cardType + '_card', team: 'opponent' };
  if (jersey) event.jersey = jersey;
  game.events.push(event);
  saveActiveGame(game);
  document.getElementById('card-modal').classList.add('hidden');
  showCardFlash(cardType);
}

function cardSelectOppCoach() {
  const game = getActiveGame();
  if (cardType === 'yellow') {
    const hasYellow = game.events.some(e => e.type === 'yellow_card' && e.team === 'opponent' && e.isCoach);
    if (hasYellow) {
      document.getElementById('card-2nd-title').textContent = '2nd yellow = Red Card?';
      document.getElementById('card-2nd-info').textContent = 'Opponent coach already has a yellow card.';
      showCardStep('card-step-second-yellow');
      return;
    }
  }
  game.events.push({ type: cardType + '_card', team: 'opponent', isCoach: true });
  saveActiveGame(game);
  document.getElementById('card-modal').classList.add('hidden');
  showCardFlash(cardType);
}

function cardConfirmSecondYellow(isRed) {
  const game = getActiveGame();
  const jersey = document.getElementById('card-jersey-input').value.trim();
  const isCoach = !jersey && game.events.some(e => e.type === 'yellow_card' && e.team === 'opponent' && e.isCoach);

  if (isRed) {
    const event = { type: 'red_card', team: 'opponent', secondYellow: true };
    if (isCoach) event.isCoach = true;
    else if (jersey) event.jersey = jersey;
    game.events.push(event);
  } else {
    const event = { type: 'yellow_card', team: 'opponent' };
    if (isCoach) event.isCoach = true;
    else if (jersey) event.jersey = jersey;
    game.events.push(event);
  }
  saveActiveGame(game);
  document.getElementById('card-modal').classList.add('hidden');
  showCardFlash(isRed ? 'red' : 'yellow');
}

function showCardFlash(type) {
  const flash = document.getElementById('goal-flash');
  if (type === 'red') {
    flash.textContent = '🟥 RED CARD!';
    flash.style.background = '#C41E3A';
  } else {
    flash.textContent = '🟨 YELLOW CARD';
    flash.style.background = '#D4A017';
  }
  flash.classList.remove('hidden');
  flash.style.animation = 'none';
  flash.offsetHeight;
  flash.style.animation = '';
  setTimeout(() => {
    flash.classList.add('hidden');
    flash.textContent = 'GOAL!';
    flash.style.background = '#C41E3A';
  }, 700);
}

// ============================================
// 6e. EDIT GAME — CARD EDITING
// ============================================
let editCardEvents = [];

function renderEditCards() {
  const roster = getRoster().filter(p => p.name !== 'Own Goal');
  const container = document.getElementById('edit-game-cards');

  if (editCardEvents.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = editCardEvents.map((e, i) => {
    const typeOptions = ['yellow_card', 'red_card'].map(t =>
      `<option value="${t}" ${e.type === t ? 'selected' : ''}>${t === 'yellow_card' ? 'Yellow' : 'Red'}</option>`
    ).join('');

    const teamOptions = ['dcsc', 'opponent'].map(t =>
      `<option value="${t}" ${e.team === t ? 'selected' : ''}>${t === 'dcsc' ? 'DCSC' : 'Opp'}</option>`
    ).join('');

    let recipientHtml = '';
    if (e.team === 'dcsc' && !e.isCoach) {
      const playerOpts = roster.map(p =>
        `<option value="p_${p.id}" ${e.playerId === p.id ? 'selected' : ''}>${p.name}</option>`
      ).join('');
      recipientHtml = `<select onchange="updateEditCardRecipient(${i}, this.value)"><option value="coach" ${e.isCoach ? 'selected' : ''}>Coach</option>${playerOpts}</select>`;
    } else if (e.team === 'dcsc' && e.isCoach) {
      const playerOpts = roster.map(p =>
        `<option value="p_${p.id}">${p.name}</option>`
      ).join('');
      recipientHtml = `<select onchange="updateEditCardRecipient(${i}, this.value)"><option value="coach" selected>Coach</option>${playerOpts}</select>`;
    } else {
      recipientHtml = `<input type="text" value="${e.isCoach ? 'Coach' : (e.jersey || '')}" placeholder="${e.isCoach ? '' : '#'}" onchange="updateEditCardOppRecipient(${i}, this.value)" style="width:60px;padding:8px;border:2px solid #ddd;border-radius:8px;font-size:0.9rem;">`;
    }

    return `
      <div class="edit-goal-row">
        <select onchange="updateEditCardType(${i}, this.value)" style="width:70px">${typeOptions}</select>
        <select onchange="updateEditCardTeam(${i}, this.value)" style="width:60px">${teamOptions}</select>
        ${recipientHtml}
        <button class="btn-remove" onclick="removeEditCard(${i})">✕</button>
      </div>
    `;
  }).join('');
}

function updateEditCardType(index, value) {
  editCardEvents[index].type = value;
}

function updateEditCardTeam(index, value) {
  editCardEvents[index].team = value;
  if (value === 'dcsc') {
    delete editCardEvents[index].jersey;
    editCardEvents[index].isCoach = false;
    const roster = getRoster().filter(p => p.name !== 'Own Goal');
    if (roster.length > 0) editCardEvents[index].playerId = roster[0].id;
  } else {
    delete editCardEvents[index].playerId;
    editCardEvents[index].isCoach = false;
    editCardEvents[index].jersey = '';
  }
  renderEditCards();
}

function updateEditCardRecipient(index, value) {
  if (value === 'coach') {
    editCardEvents[index].isCoach = true;
    delete editCardEvents[index].playerId;
  } else {
    editCardEvents[index].isCoach = false;
    editCardEvents[index].playerId = parseInt(value.replace('p_', ''));
  }
}

function updateEditCardOppRecipient(index, value) {
  if (value.toLowerCase() === 'coach') {
    editCardEvents[index].isCoach = true;
    delete editCardEvents[index].jersey;
  } else {
    editCardEvents[index].isCoach = false;
    editCardEvents[index].jersey = value;
  }
}

function addEditCard() {
  editCardEvents.push({ type: 'yellow_card', team: 'dcsc', playerId: getRoster().filter(p => p.name !== 'Own Goal')[0]?.id || 1 });
  renderEditCards();
}

function removeEditCard(index) {
  editCardEvents.splice(index, 1);
  renderEditCards();
}

// ============================================
// 7. DATA EXPORT / IMPORT
// ============================================
function exportData() {
  const data = {
    teamName: getTeamName(),
    season: getSeason(),
    roster: getRoster(),
    games: getGames(),
    exportedAt: new Date().toISOString()
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dcsc-data.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.roster || !data.games) {
        alert('Invalid data file. Must contain roster and games.');
        return;
      }
      if (!confirm(`Import ${data.games.length} games and ${data.roster.length} players? This will replace all current data.`)) return;
      saveRoster(data.roster);
      saveGames(data.games);
      if (data.teamName) localStorage.setItem('teamName', data.teamName);
      if (data.season) localStorage.setItem('season', data.season);
      localStorage.setItem('rosterSeeded', 'true');
      renderHeader();
      switchTab('games');
      alert('Data imported successfully!');
    } catch (err) {
      alert('Error reading file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ============================================
// 8. TAB SWITCHING & NAVIGATION
// ============================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'games') renderGamesTab();
  else if (tab === 'stats') renderStatsTab();
  else if (tab === 'roster') renderRosterTab();
}

function switchStatsView(view) {
  currentStatsView = view;
  document.querySelectorAll('.stats-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.stats-toggle-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('stats-' + view).classList.add('active');
  document.querySelector(`.stats-toggle-btn[data-view="${view}"]`).classList.add('active');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================
// 9. EVENT LISTENERS & INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadDataFile();
  renderHeader();
  renderGamesTab();

  // Tab bar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Stats toggle
  document.querySelectorAll('.stats-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchStatsView(btn.dataset.view));
  });

  // Pregame buttons
  document.getElementById('cancel-game-btn').addEventListener('click', cancelPregame);
  document.getElementById('kickoff-btn').addEventListener('click', kickOff);
  document.getElementById('add-guest-btn').addEventListener('click', addGuestPlayer);

  // In-game buttons
  document.getElementById('opponent-goal-btn').addEventListener('click', recordOpponentGoal);
  document.getElementById('undo-btn').addEventListener('click', undoLastEvent);
  document.getElementById('half-toggle-btn').addEventListener('click', toggleHalf);
  document.getElementById('end-game-btn').addEventListener('click', showEndGameConfirm);

  // Card button
  document.getElementById('card-btn').addEventListener('click', showCardModal);

  // Assist modal
  document.getElementById('no-assist-btn').addEventListener('click', noAssist);

  // End game modal
  document.getElementById('endgame-cancel').addEventListener('click', cancelEndGame);
  document.getElementById('endgame-ok').addEventListener('click', finalizeGame);

  // Roster
  document.getElementById('add-player-btn').addEventListener('click', showAddPlayer);
  document.getElementById('edit-player-cancel').addEventListener('click', cancelEditPlayer);

  // Edit game modal
  document.getElementById('edit-game-cancel').addEventListener('click', cancelEditGame);
  document.getElementById('edit-game-save').addEventListener('click', saveEditGame);
  document.getElementById('edit-game-delete').addEventListener('click', () => showDeleteConfirm(editingGameId));
  document.getElementById('edit-add-goal-btn').addEventListener('click', addEditGoal);
  document.getElementById('opp-goal-minus').addEventListener('click', () => changeEditOpponentGoals(-1));
  document.getElementById('opp-goal-plus').addEventListener('click', () => changeEditOpponentGoals(1));
  document.getElementById('edit-add-card-btn').addEventListener('click', addEditCard);

  // Delete game confirmation
  document.getElementById('delete-game-cancel').addEventListener('click', cancelDeleteGame);
  document.getElementById('delete-game-ok').addEventListener('click', deleteGame);

  // GitHub sync
  document.getElementById('sync-github-btn').addEventListener('click', syncToGitHub);
  document.getElementById('forget-token-btn').addEventListener('click', () => {
    if (confirm('Remove saved GitHub token?')) forgetGitHubToken();
  });

  // Data export/import
  document.getElementById('export-data-btn').addEventListener('click', exportData);
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Check for active game on load
  if (getActiveGame()) {
    renderGamesTab();
  }
});
