// ============================================
// DCSC Soccer Tracker — Read-Only Parent View
// ============================================

// ============================================
// 1. PURE COMPUTATION (from app.js)
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

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================
// 1b. EVENT RENDERING
// ============================================
function renderEventLine(e, rosterMap, opponent, score) {
  const min = e.minute ? `<span class="event-minute">${e.minute}</span> ` : '';
  if (e.type === 'goal') {
    const scorer = rosterMap[e.playerId] || '?';
    const assist = e.assistPlayerId ? ` (ast. ${rosterMap[e.assistPlayerId] || '?'})` : '';
    const scoreLine = score ? `<span class="event-score">${score}</span> ` : '';
    return `<div class="goal-event"><span class="event-icon">⚽</span> ${scoreLine}${min}<span class="scorer">${scorer}</span><span class="assist">${assist}</span></div>`;
  } else if (e.type === 'opponent_goal') {
    const scoreLine = score ? `<span class="event-score">${score}</span> ` : '';
    return `<div class="goal-event opp-event"><span class="event-icon">⚽</span> ${scoreLine}${min}${opponent}</div>`;
  } else if (e.type === 'yellow_card') {
    const who = cardRecipientLabel(e, rosterMap, opponent);
    return `<div class="goal-event card-event yellow"><span class="event-icon">🟨</span> ${min}${who}</div>`;
  } else if (e.type === 'red_card') {
    const who = cardRecipientLabel(e, rosterMap, opponent);
    const note = e.secondYellow ? ' (2nd yellow)' : '';
    return `<div class="goal-event card-event red"><span class="event-icon">🟥</span> ${min}${who}${note}</div>`;
  } else if (e.type === 'pk_goal') {
    const who = e.team === 'dcsc' ? (rosterMap[e.playerId] || 'DCSC') : opponent;
    return `<div class="goal-event pk-event"><span class="event-icon">⚽</span> PK ${who}</div>`;
  } else if (e.type === 'pk_miss') {
    const who = e.team === 'dcsc' ? (rosterMap[e.playerId] || 'DCSC') : opponent;
    return `<div class="goal-event pk-event pk-miss"><span class="event-icon">✕</span> PK ${who}</div>`;
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

// ============================================
// 2. STATE
// ============================================
let appData = null;
let playerSort = 'goals';

// ============================================
// 3. RENDERING
// ============================================
function renderHeader() {
  document.getElementById('team-name').textContent = appData.teamName || 'DCSC';
  document.getElementById('season-label').textContent = appData.season || '';
}

function renderGamesTab() {
  const games = appData.games || [];
  const roster = appData.roster || [];
  const record = computeTeamRecord(games);

  // Season summary
  const summaryEl = document.getElementById('season-summary');
  if (games.length === 0) {
    summaryEl.innerHTML = '<div class="empty-state"><p>No games recorded yet.</p></div>';
  } else {
    const gdSign = record.gd >= 0 ? '+' : '';
    summaryEl.innerHTML = `
      <div class="record-line">${record.w}W - ${record.l}L - ${record.d}D</div>
      <div class="record-detail">${record.gf} GF | ${record.ga} GA | ${gdSign}${record.gd} GD</div>
    `;
  }

  // Build roster lookup
  const baseRosterMap = {};
  roster.forEach(p => baseRosterMap[p.id] = p.name);

  // Games list
  const listEl = document.getElementById('games-list');
  if (games.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = [...games].reverse().map(g => {
    // Build per-game roster map including guests
    const rosterMap = { ...baseRosterMap };
    (g.guestPlayers || []).forEach(p => rosterMap[p.id] = p.name);

    const events = g.events || [];
    let runDCSC = 0, runOpp = 0;
    const detailLines = events.map(e => {
      let score = null;
      if (e.type === 'goal') { runDCSC++; score = `${runDCSC}-${runOpp}`; }
      else if (e.type === 'opponent_goal') { runOpp++; score = `${runDCSC}-${runOpp}`; }
      return renderEventLine(e, rosterMap, g.opponent, score);
    }).join('');
    const hasEvents = events.length > 0;

    return `
      <div class="game-card" onclick="toggleGameDetail(this)">
        <div class="game-header">
          <div>
            <div class="game-date">${formatDate(g.date)}</div>
            <div class="game-matchup">vs ${g.opponent}</div>
          </div>
          <div class="game-score result-${g.result}">${g.result} ${g.goalsFor}-${g.goalsAgainst}${g.pkScore ? ` (${g.pkScore.dcsc}-${g.pkScore.opponent})` : ''}</div>
        </div>
        <div class="game-details">
          ${hasEvents ? detailLines : '<div style="color:#999">No events recorded</div>'}
        </div>
      </div>
    `;
  }).join('');
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (appData.exportedAt) {
    const d = new Date(appData.exportedAt);
    el.textContent = 'Last updated: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}

function toggleGameDetail(card) {
  const details = card.querySelector('.game-details');
  details.classList.toggle('expanded');
}

function renderStatsTab() {
  const games = appData.games || [];
  const roster = appData.roster || [];
  const record = computeTeamRecord(games);

  const teamEl = document.getElementById('team-record');
  if (games.length === 0) {
    teamEl.innerHTML = '<div class="empty-state"><p>No games recorded yet.</p></div>';
    document.getElementById('opponent-history').innerHTML = '';
    document.getElementById('player-leaderboard').innerHTML = '<div class="empty-state"><p>No games recorded yet.</p></div>';
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
  document.getElementById('opponent-history').innerHTML = `
    <table class="stats-table">
      <thead><tr><th>Opponent</th><th>GP</th><th>W</th><th>L</th><th>D</th><th>GF</th><th>GA</th></tr></thead>
      <tbody>${opponents.map(o => `<tr><td>${o.opponent}</td><td>${o.games}</td><td>${o.w}</td><td>${o.l}</td><td>${o.d}</td><td>${o.gf}</td><td>${o.ga}</td></tr>`).join('')}</tbody>
    </table>
  `;

  renderPlayerLeaderboard();
}

function renderPlayerLeaderboard() {
  const games = appData.games || [];
  const roster = appData.roster || [];
  if (games.length === 0) return;

  let stats = computePlayerStats(games, roster);
  // Filter out "Own Goal" pseudo-player and inactive players
  stats = stats.filter(s => s.name !== 'Own Goal' && (s.goals > 0 || s.assists > 0 || s.gamesPlayed > 0));

  if (playerSort === 'goals') {
    stats.sort((a, b) => b.goals - a.goals || b.assists - a.assists);
  } else {
    stats.sort((a, b) => b.assists - a.assists || b.goals - a.goals);
  }

  document.getElementById('player-leaderboard').innerHTML = `
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

// ============================================
// 4. TAB SWITCHING
// ============================================
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'stats') renderStatsTab();
}

function switchStatsView(view) {
  document.querySelectorAll('.stats-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.stats-toggle-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('stats-' + view).classList.add('active');
  document.querySelector(`.stats-toggle-btn[data-view="${view}"]`).classList.add('active');
}

// ============================================
// 5. INIT
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('../dcsc-data.json');
    if (!resp.ok) throw new Error('Failed to load data');
    appData = await resp.json();
  } catch (err) {
    document.getElementById('season-summary').innerHTML =
      '<div class="empty-state"><p>Unable to load game data. Please try again later.</p></div>';
    return;
  }

  renderHeader();
  renderGamesTab();
  renderLastUpdated();

  // Tab bar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Stats toggle
  document.querySelectorAll('.stats-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => switchStatsView(btn.dataset.view));
  });
});
