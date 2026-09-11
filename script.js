const $ = (id) => document.getElementById(id);

const screens = ["titleScreen", "setupScreen", "gameScreen", "stageScreen"];
const levels = [
  { chars: [..."あいうえお"] },
  { chars: [..."かきくけこ"] },
  { chars: [..."さしすせそ"] },
  { chars: [..."たちつてと"] },
  { chars: [..."なにぬねの"] },
  { chars: [..."はひふへほ"] },
  { chars: [..."まみむめも"] },
  { chars: [..."やゆよらりるれろわをん"] },
  { chars: [..."がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ"] },
  { chars: [..."ぁぃぅぇぉっゃゅょ"] }
];

// 相手が撃つまでの時間。レベルとは切り離して固定する。
const speedDelays = {
  1: 8000,
  2: 6000,
  3: 4500,
  4: 3000,
  5: 2000,
  unlimited: null
};

let speedSetting = "3";
let typedKana = "";

// JISかな配列を、IMEの確定待ちなしで直接読むための物理キー対応表。
const kanaKeyMap = {
  Digit1:"ぬ", Digit2:"ふ", Digit3:"あ", Digit4:"う", Digit5:"え", Digit6:"お", Digit7:"や", Digit8:"ゆ", Digit9:"よ", Digit0:"わ",
  Minus:"ほ", Equal:"へ", IntlYen:"ー",
  KeyQ:"た", KeyW:"て", KeyE:"い", KeyR:"す", KeyT:"か", KeyY:"ん", KeyU:"な", KeyI:"に", KeyO:"ら", KeyP:"せ",
  KeyA:"ち", KeyS:"と", KeyD:"し", KeyF:"は", KeyG:"き", KeyH:"く", KeyJ:"ま", KeyK:"の", KeyL:"り", Semicolon:"れ", Quote:"け",
  KeyZ:"つ", KeyX:"さ", KeyC:"そ", KeyV:"ひ", KeyB:"こ", KeyN:"み", KeyM:"も", Comma:"ね", Period:"る", Slash:"め", IntlRo:"ろ"
};

const shiftedKanaKeyMap = {
  Digit3:"ぁ", Digit4:"ぅ", Digit5:"ぇ", Digit6:"ぉ", Digit7:"ゃ", Digit8:"ゅ", Digit9:"ょ", Digit0:"を", KeyZ:"っ"
};

const dakutenMap = {
  "か":"が","き":"ぎ","く":"ぐ","け":"げ","こ":"ご",
  "さ":"ざ","し":"じ","す":"ず","せ":"ぜ","そ":"ぞ",
  "た":"だ","ち":"ぢ","つ":"づ","て":"で","と":"ど",
  "は":"ば","ひ":"び","ふ":"ぶ","へ":"べ","ほ":"ぼ"
};

const handakutenMap = {"は":"ぱ","ひ":"ぴ","ふ":"ぷ","へ":"ぺ","ほ":"ぽ"};

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
let speechHold = [];
let readySpeechTimer = null;
let speechVoices = [];

function refreshSpeechVoices() {
  if (!("speechSynthesis" in window)) return;
  try { speechVoices = window.speechSynthesis.getVoices() || []; } catch (_) { speechVoices = []; }
}

if ("speechSynthesis" in window) {
  refreshSpeechVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshSpeechVoices);
}

function showScreen(id) {
  screens.forEach(s => $(s).classList.toggle("active", s === id));
}

function focusGameSurface() {
  const activeEl = document.activeElement;
  if (activeEl && typeof activeEl.blur === 'function' && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    activeEl.blur();
  }
  setTimeout(() => {
    $("gameScreen")?.focus?.({ preventScroll: true });
  }, 0);
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
  clearTimeout(readySpeechTimer);
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  speechHold = [];
}

// Chrome / Chromebook では cancel() の直後に speak() すると、
// ときどき音声が飲み込まれることがあるため、発話ごとの cancel はしない。
// また SpeechSynthesisUtterance を発話終了まで保持して、途中で消えないようにする。
function speak(text, rate = 1.0, pitch = 1.0) {
  if (!('speechSynthesis' in window)) return false;
  try {
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    refreshSpeechVoices();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;

    const jaVoice = speechVoices.find(v => /^ja(-|_)/i.test(v.lang)) ||
                    speechVoices.find(v => /Japanese|日本語/i.test(v.name));
    if (jaVoice) u.voice = jaVoice;

    speechHold.push(u);
    const release = () => {
      const i = speechHold.indexOf(u);
      if (i >= 0) speechHold.splice(i, 1);
    };
    u.onend = release;
    u.onerror = release;

    synth.speak(u);
    return true;
  } catch (_) {
    return false;
  }
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

// ChromeOS の日本語IMEでは、Enterで確定する前でも compositionupdate に
// 変換中のかなが届く。1文字問題なので、その時点で正解なら即発砲する。
function checkCompositionKana(text) {
  if (!active) return;
  const char = normalizeKana(text || "");
  if (!char) return;

  if (char === targetChar) {
    playerShoots();
    return;
  }

  // 濁音・半濁音は、途中の清音（か→が、は→ぱ等）では誤答扱いにしない。
  const pairs = {...dakutenMap, ...handakutenMap};
  const expectedBase = Object.entries(pairs).find(([, value]) => value === targetChar)?.[0];
  if (expectedBase && char === expectedBase) return;
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

  // 1回だけキューを整理し、少し待ってから READY を発話する。
  // cancel → speak を同じ瞬間に行わないことで Chromebook での欠けを防ぐ。
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); window.speechSynthesis.resume(); } catch (_) {}
  }
  speechHold = [];
  readySpeechTimer = setTimeout(() => speak('レディ', 1.05, 1.0), 100);

  countdownTimer = setTimeout(() => {
    $("countdown").textContent = 'GO!';
    speak('ゴー', 1.1, 1.05);
    countdownTimer = setTimeout(beginDuel, 500);
  }, 1800);
}

$("startBtn").addEventListener("click", () => {
  ensureAudio();
  showScreen("setupScreen");
  setTimeout(() => $("kanaCheck").focus(), 80);
});

function updateKanaCheck(raw) {
  const v = normalizeKana(raw || "");
  if (v === "あ") {
    $("checkMessage").textContent = "できた！ かな入力OK！";
    $("readyBtn").disabled = false;
  } else if (v) {
    $("checkMessage").textContent = `「${v}」になっているよ。「あ」になるようにしてみよう。`;
    $("readyBtn").disabled = true;
  }
}

$("kanaCheck").addEventListener("compositionupdate", (e) => updateKanaCheck(e.data || e.target.value));
$("kanaCheck").addEventListener("input", (e) => updateKanaCheck(e.target.value));

document.querySelectorAll("[data-speed]").forEach((button) => {
  button.addEventListener("click", () => {
    speedSetting = button.dataset.speed;
    document.querySelectorAll("[data-speed]").forEach((b) => {
      b.classList.toggle("selected", b === button);
      b.setAttribute("aria-pressed", b === button ? "true" : "false");
    });
  });
});

$("readyBtn").addEventListener("click", startGame);
$("skipBtn").addEventListener("click", startGame);
$("focusBtn").addEventListener("click", focusGameSurface);

function startGame() {
  ensureAudio();
  clearTimers();
  round = 0;
  wins = 0;
  updateHud();
  showScreen("gameScreen");
  focusGameSurface();
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
  focusGameSurface();
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
  focusGameSurface();

  typedKana = "";
  const delay = speedDelays[speedSetting];
  // 「じっくり練習」は相手が撃ってこない。
  if (delay !== null) {
    enemyTimer = setTimeout(enemyShoots, delay);
  } else {
    $("enemyBubble").textContent = "まってるよ！";
  }
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

function acceptDirectKana(char) {
  if (!active || !char) return;

  // 濁点・半濁点は直前のかなと合成する。
  if (char === "゛" || char === "゜") {
    if (!typedKana) return;
    const map = char === "゛" ? dakutenMap : handakutenMap;
    const combined = map[typedKana];
    if (combined) {
      typedKana = combined;
      if (typedKana === targetChar) playerShoots();
    }
    return;
  }

  typedKana = char;

  if (typedKana === targetChar) {
    playerShoots();
    return;
  }

  // 濁音・半濁音の問題では、清音1キー目を「まちがい」にしない。
  if (Object.values(dakutenMap).includes(targetChar) || Object.values(handakutenMap).includes(targetChar)) {
    const expectedBase = Object.entries({...dakutenMap, ...handakutenMap}).find(([, v]) => v === targetChar)?.[0];
    if (typedKana === expectedBase) return;
  }

  $("playerBubble").textContent = `「${typedKana}」じゃないよ`;
  $("resultText").textContent = "もういちど！";
  typedKana = "";
  setTimeout(() => {
    if (active) {
      $("resultText").textContent = "";
      $("playerBubble").textContent = `「${targetChar}」を うて！`;
    }
  }, 550);
}

// Chromebook等で、日本語IMEの「Enterで確定」を待たずに物理かなキーを直接判定する。
document.addEventListener("keydown", (e) => {
  if (!active) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  let char = e.shiftKey ? shiftedKanaKeyMap[e.code] : kanaKeyMap[e.code];
  if (e.code === "BracketLeft") char = "゛";
  if (e.code === "BracketRight") char = "゜";

  if (char) {
    e.preventDefault();
    e.stopPropagation();
    $("gameInput").value = "";
    acceptDirectKana(char);
  }
}, true);

$("gameInput").addEventListener("focus", () => {
  if (active) focusGameSurface();
});

// ChromeOS / 日本語IME対応。
// Enterで確定する前の「変換中のかな」を compositionupdate で直接判定する。
$("gameInput").addEventListener("compositionstart", () => {
  composing = true;
});
$("gameInput").addEventListener("compositionupdate", (e) => {
  checkCompositionKana(e.data || e.target.value);
});
$("gameInput").addEventListener("compositionend", (e) => {
  composing = false;
  // compositionupdate が来ない環境のための最終フォールバック。
  if (active) acceptInput(e.data || e.target.value);
});
$("gameInput").addEventListener("beforeinput", (e) => {
  // 一部のChromeOSでは変換中テキストが beforeinput に先に届く。
  if (e.isComposing && e.data) checkCompositionKana(e.data);
});
$("gameInput").addEventListener("input", (e) => {
  if (e.isComposing) {
    checkCompositionKana(e.target.value);
  } else if (!composing) {
    acceptInput(e.target.value);
  }
});

$("gameScreen").addEventListener("pointerdown", (e) => {
  if (e.target.tagName !== "BUTTON") focusGameSurface();
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
