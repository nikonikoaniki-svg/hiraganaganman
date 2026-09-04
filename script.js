const $ = (id) => document.getElementById(id);

const screens = ["titleScreen", "setupScreen", "gameScreen", "stageScreen"];
const levels = [
  { chars: [..."あいうえお"], delay: 7000 },
  { chars: [..."かきくけこ"], delay: 6200 },
  { chars: [..."さしすせそ"], delay: 5500 },
  { chars: [..."たちつてと"], delay: 4900 },
  { chars: [..."なにぬねの"], delay: 4400 },
  { chars: [..."はひふへほ"], delay: 4000 },
  { chars: [..."まみむめも"], delay: 3600 },
  { chars: [..."やゆよらりるれろわをん"], delay: 3200 },
  { chars: [..."がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"], delay: 2900 },
  { chars: [..."ぁぃぅぇぉっゃゅょ"], delay: 2600 }
];

let level = 1;
let round = 0;
let wins = 0;
let active = false;
let targetChar = "";
let enemyTimer = null;
let nextTimer = null;
let countdownTimer = null;
let composing = false;
let audioCtx = null;

function showScreen(id) {
  screens.forEach(s => $(s).classList.toggle("active", s === id));
}

function ensureAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function clearTimers() {
  clearTimeout(enemyTimer);
  clearTimeout(nextTimer);
  clearTimeout(countdownTimer);
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
}

function speak(text, rate = 1.0, pitch = 1.0) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

function playGunshotSound() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.9, now + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
  oscGain.gain.setValueAtTime(0.55, now);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  osc.connect(oscGain);
  oscGain.connect(master);
  osc.start(now);
  osc.stop(now + 0.13);

  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.16));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(1000, now);
  bandpass.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.85, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(master);
  noise.start(now);
  noise.stop(now + 0.17);
}

function playWinJingle() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime + 0.03;
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    const start = now + i * 0.12;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.18);
  });
}

function normalizeKana(text) {
  return text.normalize("NFKC").trim().slice(-1);
}

function resetBattleEffects() {
  $("enemyCowboy").classList.remove("shoot", "hit", "down");
  $("arena").classList.remove("player-shot", "enemy-shot");
}

function triggerPlayerShot() {
  resetBattleEffects();
  void $("arena").offsetWidth;
  $("enemyCowboy").classList.add("hit");
  $("arena").classList.add("player-shot");
  setTimeout(() => $("enemyCowboy").classList.add("down"), 120);
}

function triggerEnemyShot() {
  resetBattleEffects();
  void $("arena").offsetWidth;
  $("enemyCowboy").classList.add("shoot");
  $("arena").classList.add("enemy-shot");
}

function runReadyCountdown() {
  $("countdown").textContent = 'READY!';
  speak('レディ', 1.05, 1.0);
  countdownTimer = setTimeout(() => {
    $("countdown").textContent = 'GO!';
    speak('ゴー', 1.1, 1.05);
    countdownTimer = setTimeout(beginDuel, 450);
  }, 1800);
}

$("startBtn").addEventListener("click", () => {
  ensureAudio();
  showScreen("setupScreen");
  setTimeout(() => $("kanaCheck").focus(), 80);
});

$("kanaCheck").addEventListener("input", (e) => {
  const v = normalizeKana(e.target.value);
  if (v === "あ") {
    $("checkMessage").textContent = "できた！ かな入力OK！";
    $("readyBtn").disabled = false;
  } else if (v) {
    $("checkMessage").textContent = `「${v}」になっているよ。「あ」になるようにしてみよう。`;
    $("readyBtn").disabled = true;
  }
});

$("readyBtn").addEventListener("click", startGame);
$("skipBtn").addEventListener("click", startGame);
$("focusBtn").addEventListener("click", () => $("gameInput").focus());

function startGame() {
  ensureAudio();
  clearTimers();
  round = 0;
  wins = 0;
  updateHud();
  showScreen("gameScreen");
  setTimeout(nextRound, 250);
}

function updateHud() {
  $("levelLabel").textContent = level;
  $("roundLabel").textContent = Math.min(round + 1, 5);
  $("winLabel").textContent = wins;
}

function nextRound() {
  clearTimers();
  if (round >= 5) return finishStage();
  active = false;
  resetBattleEffects();
  $("target").classList.remove("show");
  $("resultText").textContent = "";
  $("playerBubble").textContent = "もじを うて！";
  $("enemyBubble").textContent = "……";
  $("gameInput").value = "";
  updateHud();
  runReadyCountdown();
}

function beginDuel() {
  const config = levels[Math.min(level - 1, levels.length - 1)];
  targetChar = config.chars[Math.floor(Math.random() * config.chars.length)];
  $("target").textContent = targetChar;
  $("target").classList.add("show");
  $("playerBubble").textContent = `「${targetChar}」を うて！`;
  $("enemyBubble").textContent = "こい！";
  $("gameInput").value = "";
  active = true;
  $("gameInput").focus();

  const jitter = Math.floor(Math.random() * 900) - 350;
  enemyTimer = setTimeout(enemyShoots, Math.max(1500, config.delay + jitter));
}

function acceptInput(raw) {
  if (!active) return;
  const char = normalizeKana(raw);
  if (!char) return;
  $("gameInput").value = "";

  if (char === targetChar) {
    playerShoots();
  } else {
    $("playerBubble").textContent = `「${char}」じゃないよ`;
    $("resultText").textContent = "もういちど！";
    setTimeout(() => {
      if (active) $("resultText").textContent = "";
    }, 550);
  }
}

$("gameInput").addEventListener("compositionstart", () => composing = true);
$("gameInput").addEventListener("compositionend", (e) => {
  composing = false;
  acceptInput(e.data || e.target.value);
});
$("gameInput").addEventListener("input", (e) => {
  if (!composing) acceptInput(e.target.value);
});

$("gameScreen").addEventListener("pointerdown", (e) => {
  if (e.target.tagName !== "BUTTON") setTimeout(() => $("gameInput").focus(), 0);
});

function playerShoots() {
  if (!active) return;
  active = false;
  clearTimeout(enemyTimer);
  wins++;
  triggerPlayerShot();
  playGunshotSound();
  setTimeout(playWinJingle, 120);
  $("playerBubble").textContent = "バン！";
  $("enemyBubble").textContent = "うわー！";
  $("resultText").textContent = "あなたの かち！";
  finishRound();
}

function enemyShoots() {
  if (!active) return;
  active = false;
  triggerEnemyShot();
  playGunshotSound();
  $("enemyBubble").textContent = "バン！";
  $("playerBubble").textContent = "やられた！";
  $("resultText").textContent = "つぎは もっとはやく！";
  finishRound();
}

function finishRound() {
  round++;
  updateHud();
  nextTimer = setTimeout(nextRound, 1600);
}

function finishStage() {
  clearTimers();
  const cleared = wins >= 3;
  $("stageBadge").textContent = cleared ? "⭐" : "🤠";
  $("stageTitle").textContent = cleared ? "ステージクリア！" : "おしかった！";
  $("stageSummary").textContent = `5かいのうち ${wins}かい かったよ！`;
  $("nextBtn").style.display = cleared ? "inline-block" : "none";
  $("retryBtn").style.display = cleared ? "none" : "inline-block";
  showScreen("stageScreen");
}

$("nextBtn").addEventListener("click", () => {
  level = Math.min(level + 1, levels.length);
  startGame();
});
$("retryBtn").addEventListener("click", startGame);
$("homeBtn").addEventListener("click", () => {
  clearTimers();
  level = 1;
  $("kanaCheck").value = "";
  $("readyBtn").disabled = true;
  $("checkMessage").textContent = "ここをクリックして、かな入力で「あ」とうってね";
  showScreen("titleScreen");
});
