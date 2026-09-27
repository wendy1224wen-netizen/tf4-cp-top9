"use strict";

const APP_VERSION = 3;
const STORAGE_KEY = "tf4-cp-top9-v3";
const TOTAL_QUESTIONS = 84;

const CP_NAMES = [
  "奇文", "杨桂", "博瑞", "恒文", "文铭", "罕文", "杰文", "桂奇", "复函", "恒奇",
  "奇铭", "奇罕", "橹奇", "桂瑞", "桂恒", "桂铭", "桂罕", "桂橹", "恒瑞", "铭瑞",
  "罕瑞", "橹瑞", "恒铭", "恒罕", "橹恒", "铭罕", "橹铭", "橹罕", "文奕", "聂文",
  "文煜", "文宸", "烁文", "涵文", "文臣", "奇奕", "聂奇", "奇煜", "奇瓜", "奇然",
  "奇堡", "官左", "桂奕", "桂辰", "桂煜", "龙瓜", "桂然", "龙堡", "桂官", "奕瑞",
  "聂瑞", "东瑞", "宸瑞", "烁瑞", "堡瑞", "官瑞", "打啵奕", "聂恒", "恒东", "恒宸",
  "恒然", "恒堡", "官恒", "铭奕", "聂铭", "铭东", "宸铭", "铭烁", "梦堡", "官铭",
  "然罕", "聂罕", "东罕", "宸罕", "烁罕", "罕堡", "官罕", "橹奕", "聂橹", "橹东",
  "橹瓜", "橹烁", "橹堡", "官橹", "聂然", "然东", "然瓜", "然烁", "然堡", "官然",
  "聂东", "聂瓜", "聂烁", "聂堡", "官聂", "瓜东", "东烁", "东堡", "官东", "宸烁",
  "博宸", "官宸", "烁堡", "官烁", "官堡"
];

const CANDIDATES = CP_NAMES.map((name, index) => ({
  id: index,
  name,
  sheet: Math.floor(index / 25) + 1,
  cell: index % 25
}));

const STAGES = [
  { id: "qualifier", label: "全员海选", english: "ROUND 01", repetitions: 2, advance: 36, k: 12 },
  { id: "review", label: "高位复核", english: "ROUND 02", repetitions: 2, advance: 16, k: 15 },
  { id: "final", label: "TOP 9 冲刺", english: "FINAL ROUND", repetitions: 3, advance: 9, k: 18 }
];

const screens = {
  intro: document.querySelector("#intro"),
  game: document.querySelector("#game"),
  transition: document.querySelector("#transition"),
  result: document.querySelector("#result")
};

const ui = {
  startButton: document.querySelector("#start-button"),
  startLabel: document.querySelector("#start-button .button-label"),
  resetIntroButton: document.querySelector("#reset-intro-button"),
  stageLabel: document.querySelector("#stage-label"),
  progressBar: document.querySelector("#progress-bar"),
  progressText: document.querySelector("#progress-text"),
  choiceGrid: document.querySelector("#choice-grid"),
  undoButton: document.querySelector("#undo-button"),
  transitionTitle: document.querySelector("#transition-title"),
  transitionCopy: document.querySelector("#transition-copy"),
  continueButton: document.querySelector("#continue-button"),
  resultGrid: document.querySelector("#result-grid"),
  fullRankingList: document.querySelector("#full-ranking-list"),
  posterButton: document.querySelector("#poster-button"),
  restartButton: document.querySelector("#restart-button"),
  posterModal: document.querySelector("#poster-modal"),
  posterPreview: document.querySelector("#poster-preview"),
  posterDownload: document.querySelector("#poster-download"),
  posterCanvas: document.querySelector("#poster-canvas")
};

let state = loadState();
let interactionLocked = false;
let posterObjectUrl = null;
const spriteImages = new Map();
const assetsReady = preloadSprites();

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const result = [...values];
  const random = mulberry32(seed >>> 0);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function createSchedule(ids, repetitions, seed) {
  const rounds = [];
  const bonusCount = new Map(ids.map(id => [id, 0]));

  for (let pass = 0; pass < repetitions; pass += 1) {
    const passIds = shuffled(ids, seed + (pass + 1) * 7919);
    for (let start = 0; start < passIds.length; start += 4) {
      const group = passIds.slice(start, start + 4);
      if (group.length < 4) {
        const fillers = shuffled(ids, seed + pass * 101 + start)
          .filter(id => !group.includes(id))
          .sort((a, b) => bonusCount.get(a) - bonusCount.get(b));
        while (group.length < 4) {
          const next = fillers.shift();
          group.push(next);
          bonusCount.set(next, bonusCount.get(next) + 1);
        }
      }
      rounds.push(shuffled(group, seed + pass * 1009 + start * 37));
    }
  }
  return rounds;
}

function blankStats() {
  return Object.fromEntries(CANDIDATES.map(candidate => [candidate.id, {
    qualifier: { rating: 1500, wins: 0, seen: 0 },
    review: { rating: 1500, wins: 0, seen: 0 },
    final: { rating: 1500, wins: 0, seen: 0 }
  }]));
}

function freshState() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const ids = CANDIDATES.map(candidate => candidate.id);
  return {
    version: APP_VERSION,
    seed,
    stageIndex: 0,
    roundIndex: 0,
    completed: 0,
    pool: ids,
    schedule: createSchedule(ids, STAGES[0].repetitions, seed),
    stats: blankStats(),
    pendingPool: null,
    awaitingContinue: false,
    finished: false,
    result: null,
    lastSnapshot: null
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.version === APP_VERSION && saved?.stats && saved?.schedule) return saved;
  } catch (error) {
    console.warn("Saved progress could not be loaded", error);
  }
  return null;
}

function persistState() {
  if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, screen]) => {
    screen.classList.toggle("is-active", key === name);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function spritePosition(candidate) {
  const col = candidate.cell % 5;
  const row = Math.floor(candidate.cell / 5);
  return `${col * 25}% ${row * 25}%`;
}

function applySprite(element, candidateId) {
  const candidate = CANDIDATES[candidateId];
  element.classList.add("sprite");
  element.style.backgroundImage = `url("cp-sheet-${candidate.sheet}.webp")`;
  element.style.backgroundPosition = spritePosition(candidate);
}

async function preloadSprites() {
  const promises = [];
  for (let sheet = 1; sheet <= 5; sheet += 1) {
    const image = new Image();
    image.decoding = "async";
    image.src = `cp-sheet-${sheet}.webp`;
    spriteImages.set(sheet, image);
    promises.push(image.decode().catch(() => new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    })));
  }
  return Promise.all(promises);
}

function hydrateIntroSprites() {
  document.querySelectorAll("[data-candidate]").forEach(element => {
    applySprite(element, Number(element.dataset.candidate));
  });
}

function configureIntro() {
  hydrateIntroSprites();
  if (!state) {
    ui.startLabel.textContent = "开始总选";
    ui.resetIntroButton.classList.add("is-hidden");
    return;
  }
  ui.resetIntroButton.classList.remove("is-hidden");
  if (state.finished) {
    ui.startLabel.textContent = "查看我的 TOP 9";
  } else if (state.awaitingContinue) {
    ui.startLabel.textContent = "继续下一轮";
  } else {
    ui.startLabel.textContent = `继续总选 · ${state.completed}/${TOTAL_QUESTIONS}`;
  }
}

function stageMetric(id, stageIndex) {
  const weights = stageIndex === 0 ? [1, 0, 0]
    : stageIndex === 1 ? [.32, .68, 0]
      : [.15, .3, .55];
  const ids = STAGES.map(stage => stage.id);
  const rating = ids.reduce((total, stageId, index) => {
    return total + (state.stats[id][stageId].rating - 1500) * weights[index];
  }, 0);
  const current = state.stats[id][ids[stageIndex]];
  const winRate = current.seen ? current.wins / current.seen : 0;
  return rating + winRate * 1.5;
}

function rankPool(ids, stageIndex = state.stageIndex) {
  const stageId = STAGES[stageIndex].id;
  return [...ids].sort((a, b) => {
    const metricDifference = stageMetric(b, stageIndex) - stageMetric(a, stageIndex);
    if (Math.abs(metricDifference) > .0001) return metricDifference;
    const statsA = state.stats[a][stageId];
    const statsB = state.stats[b][stageId];
    if (statsB.wins !== statsA.wins) return statsB.wins - statsA.wins;
    return CANDIDATES[a].name.localeCompare(CANDIDATES[b].name, "zh-CN");
  });
}

function renderGame() {
  const stage = STAGES[state.stageIndex];
  const group = state.schedule[state.roundIndex];
  if (!group) {
    finishStage();
    return;
  }

  showScreen("game");
  ui.stageLabel.textContent = `${stage.english} · ${stage.label}`;
  ui.progressText.textContent = `${state.completed + 1} / ${TOTAL_QUESTIONS}`;
  ui.progressBar.style.width = `${(state.completed / TOTAL_QUESTIONS) * 100}%`;
  ui.undoButton.disabled = !state.lastSnapshot;
  ui.choiceGrid.replaceChildren();

  group.forEach((candidateId, index) => {
    const candidate = CANDIDATES[candidateId];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-card";
    button.setAttribute("aria-label", `选择${candidate.name}`);
    button.dataset.candidateId = String(candidateId);

    const image = document.createElement("div");
    image.className = "choice-image";
    image.setAttribute("aria-hidden", "true");
    applySprite(image, candidateId);

    const meta = document.createElement("div");
    meta.className = "choice-meta";
    const name = document.createElement("span");
    name.className = "choice-name";
    name.textContent = candidate.name;
    const number = document.createElement("span");
    number.className = "choice-number";
    number.textContent = String(index + 1).padStart(2, "0");
    meta.append(name, number);
    button.append(image, meta);
    button.addEventListener("click", () => choose(candidateId, button));
    ui.choiceGrid.append(button);
  });
}

function applyChoice(group, winnerId) {
  const stage = STAGES[state.stageIndex];
  const stageId = stage.id;
  const before = Object.fromEntries(group.map(id => [id, state.stats[id][stageId].rating]));
  const deltas = Object.fromEntries(group.map(id => [id, 0]));

  group.forEach(id => { state.stats[id][stageId].seen += 1; });
  state.stats[winnerId][stageId].wins += 1;

  group.filter(id => id !== winnerId).forEach(loserId => {
    const expected = 1 / (1 + 10 ** ((before[loserId] - before[winnerId]) / 400));
    const change = stage.k * (1 - expected);
    deltas[winnerId] += change;
    deltas[loserId] -= change;
  });

  group.forEach(id => {
    state.stats[id][stageId].rating = before[id] + deltas[id];
  });
}

function choose(candidateId, button) {
  if (interactionLocked) return;
  interactionLocked = true;
  const snapshot = { ...state, lastSnapshot: null };
  state.lastSnapshot = JSON.stringify(snapshot);

  const group = state.schedule[state.roundIndex];
  applyChoice(group, candidateId);
  state.roundIndex += 1;
  state.completed += 1;
  persistState();

  ui.choiceGrid.querySelectorAll(".choice-card").forEach(card => {
    card.classList.toggle("is-picked", card === button);
    card.classList.toggle("is-muted", card !== button);
    card.disabled = true;
  });

  window.setTimeout(() => {
    interactionLocked = false;
    if (state.roundIndex >= state.schedule.length) finishStage();
    else renderGame();
  }, 260);
}

function finishStage() {
  const stage = STAGES[state.stageIndex];
  const ranked = rankPool(state.pool);

  if (state.stageIndex === STAGES.length - 1) {
    state.result = ranked.slice(0, 9);
    state.finalRanking = ranked;
    state.finished = true;
    state.awaitingContinue = false;
    state.lastSnapshot = null;
    persistState();
    renderResults();
    return;
  }

  state.pendingPool = ranked.slice(0, stage.advance);
  state.awaitingContinue = true;
  state.lastSnapshot = null;
  persistState();

  if (state.stageIndex === 0) {
    ui.transitionTitle.textContent = "36强确认";
    ui.transitionCopy.textContent = "105组CP已完成两次亮相，高位36组进入复核。";
  } else {
    ui.transitionTitle.textContent = "16强出炉";
    ui.transitionCopy.textContent = "复核完成，最后16组进入TOP 9冲刺轮。";
  }
  showScreen("transition");
}

function continueStage() {
  if (!state?.awaitingContinue || !state.pendingPool) return;
  state.stageIndex += 1;
  state.pool = state.pendingPool;
  state.pendingPool = null;
  state.roundIndex = 0;
  state.schedule = createSchedule(
    state.pool,
    STAGES[state.stageIndex].repetitions,
    state.seed + state.stageIndex * 100003
  );
  state.awaitingContinue = false;
  state.lastSnapshot = null;
  persistState();
  renderGame();
}

function undoChoice() {
  if (!state?.lastSnapshot || interactionLocked) return;
  try {
    state = JSON.parse(state.lastSnapshot);
    state.lastSnapshot = null;
    persistState();
    renderGame();
  } catch (error) {
    console.warn("Undo failed", error);
  }
}

function resultCard(candidateId, rank) {
  const candidate = CANDIDATES[candidateId];
  const card = document.createElement("article");
  card.className = "result-card";
  const photo = document.createElement("div");
  photo.className = "result-photo";
  applySprite(photo, candidateId);
  const badge = document.createElement("span");
  badge.className = "result-rank";
  badge.textContent = rank <= 3 ? ["Ⅰ", "Ⅱ", "Ⅲ"][rank - 1] : String(rank);
  const name = document.createElement("div");
  name.className = "result-name";
  name.textContent = candidate.name;
  card.append(photo, badge, name);
  return card;
}

function renderResults() {
  if (!state?.result) return;
  showScreen("result");
  ui.resultGrid.replaceChildren(...state.result.map((id, index) => resultCard(id, index + 1)));
  ui.fullRankingList.replaceChildren(...state.finalRanking.map(id => {
    const item = document.createElement("li");
    item.textContent = CANDIDATES[id].name;
    return item;
  }));
  ui.progressBar.style.width = "100%";
}

function resumeFromIntro() {
  if (!state) {
    state = freshState();
    persistState();
    renderGame();
  } else if (state.finished) {
    renderResults();
  } else if (state.awaitingContinue) {
    continueStage();
  } else {
    renderGame();
  }
}

async function startOrResume() {
  const original = ui.startLabel.textContent;
  ui.startButton.disabled = true;
  ui.startLabel.textContent = "图片准备中…";
  try {
    await assetsReady;
    resumeFromIntro();
  } catch (error) {
    console.error(error);
    ui.startLabel.textContent = "图片加载失败，请重试";
    window.setTimeout(() => { ui.startLabel.textContent = original; }, 1800);
  } finally {
    ui.startButton.disabled = false;
  }
}

function restart() {
  const confirmed = window.confirm("确定清空本次进度，重新开始吗？");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  state = freshState();
  persistState();
  closePosterModal();
  renderGame();
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawPosterCard(context, candidateId, rank, x, y, width, height) {
  const candidate = CANDIDATES[candidateId];
  const image = spriteImages.get(candidate.sheet);
  const sourceX = (candidate.cell % 5) * 600;
  const sourceY = Math.floor(candidate.cell / 5) * 600;

  context.save();
  context.fillStyle = rank === 1 ? "#d5ff42" : "#ffffff";
  context.strokeStyle = "#171717";
  context.lineWidth = 3;
  drawRoundedRect(context, x, y, width, height, 2);
  context.fill();
  context.stroke();
  context.drawImage(image, sourceX, sourceY, 600, 600, x + 8, y + 8, width - 16, width - 16);

  context.fillStyle = "#f4efe7";
  context.beginPath();
  context.arc(x + 35, y + 35, 25, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#171717";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "900 24px Georgia, serif";
  context.fillText(String(rank), x + 35, y + 36);
  context.font = '900 29px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText(candidate.name, x + width / 2, y + height - 31);
  context.restore();
}

async function generatePoster() {
  if (!state?.result) return;
  ui.posterButton.disabled = true;
  ui.posterButton.firstChild.textContent = "生成中… ";
  await assetsReady;

  const canvas = ui.posterCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f4efe7";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(23,23,23,.12)";
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 54) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
  }

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#2f62ff";
  context.font = "900 30px Arial, sans-serif";
  context.fillText("TF 4TH GEN CP AWARDS", 70, 74);
  context.fillStyle = "#171717";
  context.font = '900 92px "Songti SC", "STSong", serif';
  context.fillText("我的心动 TOP 9", 68, 178);
  context.fillStyle = "#ff5f45";
  context.fillRect(70, 206, 940, 8);

  const cardWidth = 288;
  const cardHeight = 330;
  const gapX = 36;
  const gapY = 34;
  const startX = 72;
  const startY = 252;
  state.result.forEach((candidateId, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    drawPosterCard(
      context,
      candidateId,
      index + 1,
      startX + col * (cardWidth + gapX),
      startY + row * (cardHeight + gapY),
      cardWidth,
      cardHeight
    );
  });

  context.fillStyle = "#6e6a65";
  context.textAlign = "center";
  context.font = '500 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText("105组CP · 84次四选一 · 饭制娱乐向", canvas.width / 2, 1382);

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png", 1));
  if (posterObjectUrl) URL.revokeObjectURL(posterObjectUrl);
  posterObjectUrl = URL.createObjectURL(blob);
  ui.posterPreview.src = posterObjectUrl;
  ui.posterDownload.href = posterObjectUrl;
  ui.posterModal.hidden = false;
  document.body.style.overflow = "hidden";
  ui.posterButton.disabled = false;
  ui.posterButton.firstChild.textContent = "生成榜单图 ";
}

function closePosterModal() {
  ui.posterModal.hidden = true;
  document.body.style.overflow = "";
}

ui.startButton.addEventListener("click", startOrResume);
ui.resetIntroButton.addEventListener("click", restart);
ui.undoButton.addEventListener("click", undoChoice);
ui.continueButton.addEventListener("click", continueStage);
ui.restartButton.addEventListener("click", restart);
ui.posterButton.addEventListener("click", generatePoster);
document.querySelectorAll("[data-close-modal]").forEach(element => element.addEventListener("click", closePosterModal));

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !ui.posterModal.hidden) closePosterModal();
  if (!screens.game.classList.contains("is-active") || interactionLocked) return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < 4) ui.choiceGrid.children[index]?.click();
});

configureIntro();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
