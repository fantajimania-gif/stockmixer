// Stock Mixer - Main Controller Logic

// --- Global State ---
let selectedStock = null;
let currentGrowth = 0;
let currentOpm = 0;
let currentPer = 0;
let lastValuationState = null; // 'undervalued', 'fair', 'overvalued' for sound triggers

// Ranking Tab Global State & Cache
let originalStocksCache = [];
let rankingCurrentPage = 1;
const rankingItemsPerPage = 50;
let rankingSearchQuery = "";
let rankingSectorFilter = "all";
let rankingMarketFilter = "all"; // 'all', 'KOSPI', 'KOSDAQ'
let simulationIntervalId = null;
let simulationSpeed = 1500; // ms
let isSimulationPaused = false;
let kiwoomAccessToken = null;
let isKiwoomMode = false;
let kiwoomStatus = "sim"; // 'sim', 'connecting', 'active', 'error'

// Web Audio API Context (lazy initialized)
let audioCtx = null;

// Canvas Animation State
let canvas = null;
let ctx = null;
let bubbles = [];
let sparkles = [];
let wavePhase = 0;
let animationFrameId = null;

// Challenge Game State
let gameQuestions = [];
let gameCurrentIndex = 0;
let gameTotalScore = 0;
let gameUsedStockIds = [];

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  // 1a. Cache original stock data for resets
  originalStocksCache = JSON.parse(JSON.stringify(STOCKS_DATA));

  // 1b. Initial stock selection
  const defaultStockId = STOCKS_DATA[0] ? STOCKS_DATA[0].id : "stock_005930";
  selectStock(defaultStockId);

  // 2. Render Selection Chips
  renderChips();

  // 3. Initialize Canvas
  initBeakerCanvas();

  // 4. Setup Event Listeners
  setupEventListeners();

  // 4b. Initialize Ranking Tab and Table
  initRankingTab();

  // 5. Run Initial Calculations
  calculateAndRender();
});

// --- Sound Synthesizer (Web Audio API) ---
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Low click tick sound for sliders
function playTickSound() {
  if (!audioCtx) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.04);
  
  gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
  
  osc.start();
  osc.stop(audioCtx.currentTime + 0.04);
}

// Shiny golden success sound
function playGoldSound() {
  if (!audioCtx) return;
  
  const now = audioCtx.currentTime;
  // C major pentatonic sweep: C5, E5, G5, C6, E6
  const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
  
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const delay = i * 0.07;
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + delay);
    
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.06, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35);
    
    osc.start(now + delay);
    osc.stop(now + delay + 0.4);
  });
}

// Descending disappointed slide sound
function playOvervaluedSound() {
  if (!audioCtx) return;
  
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.linearRampToValueAtTime(85, now + 0.3);
  
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  
  osc.start(now);
  osc.stop(now + 0.35);
}

// --- Render Stock chips ---
function renderChips() {
  const chipsContainer = document.getElementById("chips-container");
  chipsContainer.innerHTML = "";
  
  // Render only the top 6 stocks as recommended chips to keep UI clean
  STOCKS_DATA.slice(0, 6).forEach(stock => {
    const chip = document.createElement("button");
    chip.className = "stock-chip";
    chip.textContent = stock.name;
    chip.dataset.id = stock.id;
    chip.style.setProperty("--chip-active-color", stock.color);
    
    chip.addEventListener("click", () => {
      initAudio();
      selectStock(stock.id);
    });
    
    chipsContainer.appendChild(chip);
  });
}

// Select Active Stock
function selectStock(stockId) {
  const stock = STOCKS_DATA.find(s => s.id === stockId);
  if (!stock) return;
  
  selectedStock = stock;
  
  // Set values to current stock defaults
  currentGrowth = 0;
  currentOpm = stock.opm;
  currentPer = stock.per;
  
  // Update inputs
  document.getElementById("slider-growth").value = currentGrowth;
  document.getElementById("slider-opm").value = currentOpm;
  document.getElementById("slider-per").value = currentPer;
  
  // Update slider badges
  document.getElementById("val-growth").textContent = `${currentGrowth}%`;
  document.getElementById("val-opm").textContent = `${currentOpm}%`;
  document.getElementById("val-per").textContent = `${currentPer}배`;
  
  // Update Info Card
  const card = document.getElementById("stock-display-card");
  card.style.setProperty("--accent-color", stock.color);
  // hex to rgba for card glow
  const hex = stock.color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  card.style.setProperty("--accent-gradient-start", `rgba(${r}, ${g}, ${b}, 0.12)`);
  
  document.getElementById("display-name").textContent = stock.name;
  document.getElementById("display-ticker").textContent = stock.ticker;
  document.getElementById("display-tagline").textContent = stock.tagline;
  document.getElementById("display-desc").textContent = stock.description;
  document.getElementById("display-price").textContent = stock.price.toLocaleString();
  document.getElementById("display-stat-opm").textContent = `${stock.opm}%`;
  document.getElementById("display-stat-per").textContent = `${stock.per}배`;
  
  // Highlight active chip
  document.querySelectorAll(".stock-chip").forEach(chip => {
    if (chip.dataset.id === stockId) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });

  // Reset preset button selections
  document.querySelectorAll(".btn-preset").forEach(btn => btn.classList.remove("active"));
  
  // Reset last valuation state to allow new sounds
  lastValuationState = null;
  
  calculateAndRender();
}

// --- Korean Number Formatter ---
function formatKoreanNumber(num) {
  if (num < 0) return "-" + formatKoreanNumber(-num);
  if (num === 0) return "0원";
  
  // Standard formatting limits
  if (num < 10000) return Math.round(num).toLocaleString() + " 원";
  
  const jo = Math.floor(num / 1000000000000);
  const remainderJo = num % 1000000000000;
  const eok = Math.floor(remainderJo / 100000000);
  const remainderEok = remainderJo % 100000000;
  const man = Math.floor(remainderEok / 10000);
  
  let result = "";
  if (jo > 0) result += jo.toLocaleString() + "조 ";
  if (eok > 0) result += eok.toLocaleString() + "억 ";
  if (jo === 0 && eok === 0 && man > 0) result += man.toLocaleString() + "만 ";
  
  return result.trim() + " 원";
}

// --- Main Calculation and Rendering Engine ---
function calculateAndRender() {
  if (!selectedStock) return;
  
  // 1. Calculate metrics
  // Expected Revenue = current * (1 + growth/100)
  const expRevenue = selectedStock.revenue * (1 + currentGrowth / 100);
  // Expected Profit = expected revenue * (opm/100)
  const expProfit = expRevenue * (currentOpm / 100);
  // Expected Market Cap = expected profit * per
  const expMarketCap = expProfit * currentPer;
  // Expected Target Price = expected market cap / outstanding shares
  const expTargetPrice = Math.round(expMarketCap / selectedStock.shares);
  
  // Percentage diffs
  const revDiff = currentGrowth;
  const profitDiff = ((expProfit - (selectedStock.revenue * (selectedStock.opm / 100))) / (selectedStock.revenue * (selectedStock.opm / 100)) * 100).toFixed(1);
  const roi = ((expTargetPrice - selectedStock.price) / selectedStock.price * 100).toFixed(1);
  
  // 2. Render Text Results
  document.getElementById("out-revenue").textContent = formatKoreanNumber(expRevenue);
  const revBadge = document.getElementById("out-revenue-pct");
  revBadge.textContent = revDiff >= 0 ? `+${revDiff}%` : `${revDiff}%`;
  revBadge.className = `output-change-badge ${revDiff > 0 ? 'change-up' : revDiff < 0 ? 'change-down' : 'change-flat'}`;

  document.getElementById("out-profit").textContent = formatKoreanNumber(expProfit);
  const profitBadge = document.getElementById("out-profit-pct");
  profitBadge.textContent = profitDiff >= 0 ? `+${profitDiff}%` : `${profitDiff}%`;
  profitBadge.className = `output-change-badge ${profitDiff > 0 ? 'change-up' : profitDiff < 0 ? 'change-down' : 'change-flat'}`;

  document.getElementById("out-marketcap").textContent = formatKoreanNumber(expMarketCap);
  
  const targetPriceEl = document.getElementById("out-target-price");
  // Animate target price counter if updated
  const prevVal = targetPriceEl.textContent;
  const newValStr = expTargetPrice.toLocaleString();
  if (prevVal !== newValStr) {
    targetPriceEl.textContent = newValStr;
    targetPriceEl.classList.remove("price-pop");
    void targetPriceEl.offsetWidth; // Trigger reflow
    targetPriceEl.classList.add("price-pop");
  }
  
  // 3. Valuation Verdict Engine
  const valuationPanel = document.getElementById("valuation-panel");
  const verdictBadge = document.getElementById("val-result-badge");
  const roiBadge = document.getElementById("val-roi-badge");
  const verdictMsg = document.getElementById("val-msg");
  const stockCard = document.getElementById("stock-display-card");
  
  let currentValuation = 'fair';
  
  // Valuation levels: Under-valued (+15% higher target), Over-valued (-15% lower target)
  const diffPct = parseFloat(roi);
  
  if (diffPct >= 15.0) {
    currentValuation = 'undervalued';
    verdictBadge.textContent = "🔥 싸다";
    roiBadge.textContent = `+${roi}%`;
    verdictMsg.innerHTML = `현재 주가보다 <strong>${roi}%</strong> 저렴합니다! 지금 믹싱된 가치에 도달한다면 매력적인 매수 시점입니다.`;
    
    valuationPanel.className = "valuation-panel val-undervalued";
    stockCard.className = "card active-stock-card undervalued";
    
    if (lastValuationState !== 'undervalued') {
      playGoldSound();
      lastValuationState = 'undervalued';
    }
  } else if (diffPct <= -15.0) {
    currentValuation = 'overvalued';
    verdictBadge.textContent = "💀 비싸다";
    roiBadge.textContent = `${roi}%`;
    verdictMsg.innerHTML = `현재 주가보다 <strong>${Math.abs(roi)}%</strong> 고평가되어 있습니다! 보수적인 관점이 요구되는 레시피입니다.`;
    
    valuationPanel.className = "valuation-panel val-overvalued";
    stockCard.className = "card active-stock-card overvalued";
    
    if (lastValuationState !== 'overvalued') {
      playOvervaluedSound();
      lastValuationState = 'overvalued';
    }
  } else {
    currentValuation = 'fair';
    verdictBadge.textContent = "😐 적정";
    roiBadge.textContent = diffPct >= 0 ? `+${roi}%` : `${roi}%`;
    verdictMsg.innerHTML = `현재 주가 수준이 믹싱된 미래 가치를 적정하게 선반영하고 있습니다.`;
    
    valuationPanel.className = "valuation-panel val-fair";
    stockCard.className = "card active-stock-card";
    
    lastValuationState = 'fair';
  }

  // Update ranking table to show new virtual rank if active
  if (typeof renderRankingTable === "function" && document.getElementById("ranking-tab")) {
    renderRankingTable();
  }
}

// --- Canvas Chemistry Liquid Simulation ---
function initBeakerCanvas() {
  canvas = document.getElementById("beaker-canvas");
  ctx = canvas.getContext("2d");
  
  // Handle high-DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  // Generate random bubbles
  bubbles = [];
  for (let i = 0; i < 20; i++) {
    bubbles.push({
      x: 50 + Math.random() * 100,
      y: 100 + Math.random() * 100,
      r: 2 + Math.random() * 5,
      speed: 0.5 + Math.random() * 1.5,
      wobble: Math.random() * 100
    });
  }
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  animateBeaker();
}

function animateBeaker() {
  // Beaker dimensions
  const width = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1);
  
  ctx.clearRect(0, 0, width, height);
  
  // Determine beaker physics properties based on state
  // OPM controls liquid height (ranges 1% to 50%) -> maps to liquid heights
  const minLiquidHeight = 40;
  const maxLiquidHeight = 130;
  const targetLiquidHeight = minLiquidHeight + (currentOpm / 50) * (maxLiquidHeight - minLiquidHeight);
  
  // Growth controls bubble quantity & speed (ranges -50% to 100%)
  const bubbleSpeedMultiplier = Math.max(0.1, (currentGrowth + 60) / 60);
  const bubbleCount = Math.floor(10 + ((currentGrowth + 50) / 150) * 30);
  
  // Bubble generation/destruction
  while (bubbles.length < bubbleCount) {
    bubbles.push({
      x: width/2 - 50 + Math.random() * 100,
      y: height - 50 + Math.random() * 20,
      r: 1.5 + Math.random() * 4.5,
      speed: 0.3 + Math.random() * 1.2,
      wobble: Math.random() * 100
    });
  }
  if (bubbles.length > bubbleCount) {
    bubbles.splice(bubbleCount);
  }
  
  // Liquid Color styling based on valuation
  let liquidColorStart = "rgba(16, 185, 129, 0.6)"; // Fair: mint
  let liquidColorEnd = "rgba(6, 182, 212, 0.75)";
  let glowColor = "rgba(16, 185, 129, 0.4)";
  
  if (lastValuationState === 'undervalued') {
    liquidColorStart = "rgba(251, 191, 36, 0.7)"; // Gold
    liquidColorEnd = "rgba(217, 119, 6, 0.85)";
    glowColor = "rgba(251, 191, 36, 0.5)";
    
    // Spawn sparkles randomly inside the liquid to bubble up
    if (Math.random() < 0.12 && sparkles.length < 15) {
      sparkles.push({
        x: width/2 - 45 + Math.random() * 90,
        y: height - 50 - Math.random() * targetLiquidHeight,
        size: 3 + Math.random() * 6,
        alpha: 1,
        angle: Math.random() * Math.PI * 2,
        rotSpeed: -0.05 + Math.random() * 0.1
      });
    }
  } else if (lastValuationState === 'overvalued') {
    liquidColorStart = "rgba(244, 63, 94, 0.65)"; // Hot Pink/Purple
    liquidColorEnd = "rgba(139, 92, 246, 0.8)";
    glowColor = "rgba(244, 63, 94, 0.45)";
  }
  
  // Beaker glass shape parameters
  const beakerX = width / 2 - 60;
  const beakerY = height - 170;
  const beakerW = 120;
  const beakerH = 140;
  const beakerRadius = 16;
  
  // 1. Draw Liquid inside the beaker
  ctx.save();
  // Create clipping mask for the beaker interior
  ctx.beginPath();
  ctx.moveTo(beakerX, beakerY);
  ctx.arcTo(beakerX, beakerY + beakerH, beakerX + beakerW, beakerY + beakerH, beakerRadius);
  ctx.arcTo(beakerX + beakerW, beakerY + beakerH, beakerX + beakerW, beakerY, beakerRadius);
  ctx.lineTo(beakerX + beakerW, beakerY);
  ctx.closePath();
  ctx.clip();
  
  // Animate wave on top of liquid
  wavePhase += 0.05 * bubbleSpeedMultiplier;
  const waveAmp = currentGrowth > 50 ? 5 : 2.5;
  const waveFreq = 0.04;
  const liquidY = beakerY + beakerH - targetLiquidHeight;
  
  // Draw gradient liquid
  const gradient = ctx.createLinearGradient(beakerX, liquidY, beakerX, beakerY + beakerH);
  gradient.addColorStop(0, liquidColorStart);
  gradient.addColorStop(1, liquidColorEnd);
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(beakerX - 10, beakerY + beakerH + 10);
  ctx.lineTo(beakerX - 10, liquidY);
  
  for (let x = beakerX - 10; x <= beakerX + beakerW + 10; x += 5) {
    const y = liquidY + Math.sin(x * waveFreq + wavePhase) * waveAmp;
    ctx.lineTo(x, y);
  }
  
  ctx.lineTo(beakerX + beakerW + 10, beakerY + beakerH + 10);
  ctx.closePath();
  ctx.fill();
  
  // 2. Animate and Draw Bubbles
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  bubbles.forEach(bubble => {
    bubble.y -= bubble.speed * bubbleSpeedMultiplier;
    bubble.wobble += 0.05;
    
    // Add sinusoidal wobble movement
    const wobbleX = Math.sin(bubble.wobble) * 1.5;
    
    // Reset bubble if it pops above liquid surface
    const bubbleMaxY = liquidY + Math.sin((bubble.x + wobbleX) * waveFreq + wavePhase) * waveAmp;
    if (bubble.y < bubbleMaxY) {
      bubble.y = beakerY + beakerH - 5;
      bubble.x = beakerX + 15 + Math.random() * (beakerW - 30);
    }
    
    ctx.beginPath();
    ctx.arc(bubble.x + wobbleX, bubble.y, bubble.r, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // 3. Draw Gold Sparkles (only in Undervalued mode)
  if (lastValuationState === 'undervalued') {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    
    sparkles.forEach((spark, index) => {
      spark.y -= 0.8;
      spark.alpha -= 0.007;
      spark.angle += spark.rotSpeed;
      
      if (spark.alpha <= 0) {
        sparkles.splice(index, 1);
        return;
      }
      
      ctx.save();
      ctx.globalAlpha = spark.alpha;
      ctx.translate(spark.x, spark.y);
      ctx.rotate(spark.angle);
      
      // Draw 4-point star sparkle
      ctx.beginPath();
      ctx.moveTo(0, -spark.size);
      ctx.lineTo(spark.size * 0.25, -spark.size * 0.25);
      ctx.lineTo(spark.size, 0);
      ctx.lineTo(spark.size * 0.25, spark.size * 0.25);
      ctx.lineTo(0, spark.size);
      ctx.lineTo(-spark.size * 0.25, spark.size * 0.25);
      ctx.lineTo(-spark.size, 0);
      ctx.lineTo(-spark.size * 0.25, -spark.size * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }
  
  ctx.restore(); // Restore clip mask
  
  // 4. Draw Beaker Glass Structure
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  
  ctx.beginPath();
  // Left neck and spout profile
  ctx.moveTo(beakerX + 10, beakerY - 10);
  ctx.lineTo(beakerX, beakerY - 10);
  ctx.lineTo(beakerX + 10, beakerY);
  ctx.lineTo(beakerX + 10, beakerY + 15);
  // Main wall arc down
  ctx.lineTo(beakerX, beakerY + 25);
  ctx.arcTo(beakerX, beakerY + beakerH, beakerX + beakerW, beakerY + beakerH, beakerRadius);
  // Main wall arc up
  ctx.arcTo(beakerX + beakerW, beakerY + beakerH, beakerX + beakerW, beakerY + 25, beakerRadius);
  ctx.lineTo(beakerX + beakerW - 10, beakerY + 15);
  ctx.lineTo(beakerX + beakerW - 10, beakerY);
  ctx.lineTo(beakerX + beakerW, beakerY - 10);
  ctx.lineTo(beakerX + beakerW - 10, beakerY - 10);
  ctx.stroke();
  
  // Beaker Measurement Ticks
  ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
  ctx.lineWidth = 2;
  ctx.font = "bold 8px Outfit, sans-serif";
  ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
  
  const tickMarks = [
    { name: "PER", height: 0.75 },
    { name: "OPM", height: 0.5 },
    { name: "REV", height: 0.25 }
  ];
  
  tickMarks.forEach(tick => {
    const tickY = beakerY + beakerH - (beakerH * tick.height);
    // tick mark lines
    ctx.beginPath();
    ctx.moveTo(beakerX + 15, tickY);
    ctx.lineTo(beakerX + 28, tickY);
    ctx.stroke();
    
    ctx.fillText(tick.name, beakerX + 32, tickY + 3);
  });
  
  // Display current beaker mix status label
  const statusLabel = document.getElementById("beaker-status-label");
  if (lastValuationState === 'undervalued') {
    statusLabel.innerHTML = "✨ 골드 레시피 달성! 💥 보글보글";
    statusLabel.style.color = "#d97706";
  } else if (lastValuationState === 'overvalued') {
    statusLabel.innerHTML = "⚠️ 과열 레시피 경보! 🧪 끓어오름";
    statusLabel.style.color = "#e11d48";
  } else {
    statusLabel.innerHTML = "🧪 믹싱 성분 배합 완료! 안정한 형태";
    statusLabel.style.color = "#475569";
  }
  
  animationFrameId = requestAnimationFrame(animateBeaker);
}

// --- Setup Event Listeners ---
function setupEventListeners() {
  // Sliders Inputs
  const sliderGrowth = document.getElementById("slider-growth");
  const sliderOpm = document.getElementById("slider-opm");
  const sliderPer = document.getElementById("slider-per");
  
  sliderGrowth.addEventListener("input", (e) => {
    initAudio();
    currentGrowth = parseInt(e.target.value);
    document.getElementById("val-growth").textContent = `${currentGrowth}%`;
    playTickSound();
    calculateAndRender();
  });
  
  sliderOpm.addEventListener("input", (e) => {
    initAudio();
    currentOpm = parseFloat(e.target.value);
    document.getElementById("val-opm").textContent = `${currentOpm}%`;
    playTickSound();
    calculateAndRender();
  });
  
  sliderPer.addEventListener("input", (e) => {
    initAudio();
    currentPer = parseFloat(e.target.value);
    document.getElementById("val-per").textContent = `${currentPer}배`;
    playTickSound();
    calculateAndRender();
  });
  
  // Sliders Reset
  document.getElementById("btn-reset-sliders").addEventListener("click", () => {
    initAudio();
    if (selectedStock) {
      selectStock(selectedStock.id);
    }
  });
  
  // Search Autocomplete
  const searchInput = document.getElementById("stock-search");
  const suggestionsBox = document.getElementById("search-suggestions");
  
  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.toLowerCase().trim();
    if (!val) {
      suggestionsBox.classList.remove("active");
      return;
    }
    
    // Filter stocks
    const filtered = STOCKS_DATA.filter(stock => 
      stock.name.toLowerCase().includes(val) || 
      stock.ticker.includes(val)
    );
    
    if (filtered.length > 0) {
      suggestionsBox.innerHTML = "";
      filtered.forEach(stock => {
        const item = document.createElement("div");
        item.className = "suggestion-item";
        item.innerHTML = `
          <span class="suggestion-name">${stock.name}</span>
          <span class="suggestion-ticker">${stock.ticker}</span>
        `;
        item.addEventListener("click", () => {
          selectStock(stock.id);
          searchInput.value = "";
          suggestionsBox.classList.remove("active");
        });
        suggestionsBox.appendChild(item);
      });
      suggestionsBox.classList.add("active");
    } else {
      suggestionsBox.classList.remove("active");
    }
  });
  
  // Close suggestions if clicked outside
  document.addEventListener("click", (e) => {
    if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.remove("active");
    }
  });
  
  // Modals Open/Close
  const guideModal = document.getElementById("guide-modal");
  const btnOpenGuide = document.getElementById("btn-open-guide");
  const btnCloseGuide = document.getElementById("btn-close-guide");
  
  btnOpenGuide.addEventListener("click", () => {
    initAudio();
    guideModal.classList.add("active");
  });
  btnCloseGuide.addEventListener("click", () => guideModal.classList.remove("active"));
  
  const rankingsModal = document.getElementById("rankings-modal");
  const btnOpenRankings = document.getElementById("btn-open-rankings");
  const btnCloseRankings = document.getElementById("btn-close-rankings");
  
  btnOpenRankings.addEventListener("click", () => {
    initAudio();
    rankingsModal.classList.add("active");
    initGameLobby();
  });
  btnCloseRankings.addEventListener("click", () => rankingsModal.classList.remove("active"));
  
  // Close modals clicking overlay
  [guideModal, rankingsModal].forEach(modal => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.remove("active");
      }
    });
  });
  
  // Presets: DCF Mode
  document.querySelectorAll(".btn-preset-dcf").forEach(btn => {
    btn.addEventListener("click", (e) => {
      initAudio();
      document.querySelectorAll(".btn-preset").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      
      const presetType = e.target.dataset.preset;
      applyDCFPreset(presetType);
    });
  });
  
  // Presets: Scenarios Mode
  document.querySelectorAll(".btn-preset-scenario").forEach(btn => {
    btn.addEventListener("click", (e) => {
      initAudio();
      document.querySelectorAll(".btn-preset").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      
      const scenarioType = e.target.dataset.scenario;
      applyScenarioPreset(scenarioType);
    });
  });
  
  // Copy Recipe Button
  document.getElementById("btn-share-recipe").addEventListener("click", () => {
    initAudio();
    copyRecipeText();
  });
  
  // Challenge Game triggers
  document.getElementById("btn-try-game").addEventListener("click", () => {
    initAudio();
    rankingsModal.classList.add("active");
    initGameLobby();
  });
  
  // Handle canvas window resizing
  window.addEventListener("resize", () => {
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = rect.height * (window.devicePixelRatio || 1);
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
  });
}

// --- Preset Applicator Engines ---
function applyDCFPreset(type) {
  if (!selectedStock) return;
  
  if (type === 'conservative') {
    currentGrowth = -10;
    currentOpm = Math.max(1, parseFloat((selectedStock.opm * 0.8).toFixed(1)));
    currentPer = Math.max(1, parseFloat((selectedStock.per * 0.8).toFixed(1)));
  } else if (type === 'normal') {
    currentGrowth = 0;
    currentOpm = selectedStock.opm;
    currentPer = selectedStock.per;
  } else if (type === 'optimistic') {
    currentGrowth = 15;
    currentOpm = Math.min(50, parseFloat((selectedStock.opm * 1.2).toFixed(1)));
    currentPer = Math.min(100, parseFloat((selectedStock.per * 1.25).toFixed(1)));
  }
  
  syncSliders();
  calculateAndRender();
}

function applyScenarioPreset(type) {
  if (!selectedStock) return;
  
  if (type === 'boom') {
    currentGrowth = 30;
    currentOpm = Math.min(50, parseFloat((selectedStock.opm * 1.15).toFixed(1)));
    currentPer = Math.min(100, parseFloat((selectedStock.per * 1.3).toFixed(1)));
  } else if (type === 'ai') {
    currentGrowth = 50;
    currentOpm = Math.min(50, parseFloat((selectedStock.opm * 1.35).toFixed(1)));
    currentPer = Math.min(100, parseFloat((selectedStock.per * 1.6).toFixed(1)));
  } else if (type === 'recession') {
    currentGrowth = -35;
    currentOpm = Math.max(1, parseFloat((selectedStock.opm * 0.6).toFixed(1)));
    currentPer = Math.max(1, parseFloat((selectedStock.per * 0.55).toFixed(1)));
  }
  
  syncSliders();
  calculateAndRender();
}

// Sync variables with slider controls
function syncSliders() {
  document.getElementById("slider-growth").value = currentGrowth;
  document.getElementById("slider-opm").value = currentOpm;
  document.getElementById("slider-per").value = currentPer;
  
  document.getElementById("val-growth").textContent = `${currentGrowth}%`;
  document.getElementById("val-opm").textContent = `${currentOpm}%`;
  document.getElementById("val-per").textContent = `${currentPer}배`;
}

// --- Clipboard Copy Feature ---
function copyRecipeText() {
  if (!selectedStock) return;
  
  const expRevenue = selectedStock.revenue * (1 + currentGrowth / 100);
  const expProfit = expRevenue * (currentOpm / 100);
  const expMarketCap = expProfit * currentPer;
  const expTargetPrice = Math.round(expMarketCap / selectedStock.shares);
  const roi = ((expTargetPrice - selectedStock.price) / selectedStock.price * 100).toFixed(1);
  
  let sign = roi >= 0 ? "+" : "";
  let tag = "😐 적정";
  if (parseFloat(roi) >= 15.0) tag = "🔥 싸다";
  if (parseFloat(roi) <= -15.0) tag = "💀 비싸다";
  
  const shareText = `🧪 [Stock Mixer 주식 레시피 보고서]
----------------------------------
🏢 기업명: ${selectedStock.name} (${selectedStock.ticker})

[조합 성분 리스트]
📈 매출 성장률: ${currentGrowth >= 0 ? "+" : ""}${currentGrowth}%
💵 예상 영업이익률: ${currentOpm}%
🔮 부여 PER 배수: ${currentPer}배

[실험실 합성 결과]
💰 적정 주가: ${expTargetPrice.toLocaleString()}원
📊 현재 주가 대비: ${sign}${roi}% (${tag})

지금 나만의 주식 장난감에서 가치평가 레시피를 믹싱해보세요!
👉 index.html을 더블클릭해 실행하세요.`;

  navigator.clipboard.writeText(shareText).then(() => {
    // Show toast message
    const toast = document.getElementById("toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }).catch(err => {
    console.error("복사 실패:", err);
  });
}

// --- Challenge Game Logic ---
function initGameLobby() {
  document.getElementById("game-start-view").classList.add("active");
  document.getElementById("game-play-view").classList.remove("active");
  document.getElementById("game-result-view").classList.remove("active");
  
  // Hook start button
  const startBtn = document.getElementById("btn-start-game");
  // Remove existing listener to avoid stack duplicate
  const clone = startBtn.cloneNode(true);
  startBtn.parentNode.replaceChild(clone, startBtn);
  
  clone.addEventListener("click", () => {
    initAudio();
    startGame();
  });
  
  renderLeaderboard();
}

function startGame() {
  gameQuestions = [];
  gameCurrentIndex = 0;
  gameTotalScore = 0;
  gameUsedStockIds = [];
  
  // Pick 3 random stocks from STOCKS_DATA
  const available = [...STOCKS_DATA];
  // Shuffle array
  available.sort(() => Math.random() - 0.5);
  gameQuestions = available.slice(0, 3);
  
  loadQuestion();
  
  document.getElementById("game-start-view").classList.remove("active");
  document.getElementById("game-play-view").classList.add("active");
  document.getElementById("game-result-view").classList.remove("active");
}

function loadQuestion() {
  const currentQ = gameQuestions[gameCurrentIndex];
  
  document.getElementById("game-step").textContent = `문제 ${gameCurrentIndex + 1} / 3`;
  document.getElementById("game-score").textContent = `현재 점수: ${gameTotalScore}점`;
  
  document.getElementById("q-stock-name").textContent = currentQ.name;
  document.getElementById("q-stock-desc").textContent = currentQ.description;
  document.getElementById("q-stock-price").textContent = `${currentQ.price.toLocaleString()} 원`;
  document.getElementById("q-stock-revenue").textContent = formatKoreanNumber(currentQ.revenue);
  document.getElementById("q-stock-opm").textContent = `${currentQ.opm}%`;
  
  // Set default slider value
  const gameSlider = document.getElementById("game-slider-per");
  gameSlider.value = 20;
  const gameVal = document.getElementById("game-per-val");
  gameVal.textContent = "20배";
  
  // Setup game slider input event
  gameSlider.oninput = (e) => {
    initAudio();
    gameVal.textContent = `${e.target.value}배`;
    playTickSound();
  };
  
  // Bind answer submission
  const submitBtn = document.getElementById("btn-submit-answer");
  const newSubmit = submitBtn.cloneNode(true);
  submitBtn.parentNode.replaceChild(newSubmit, submitBtn);
  
  newSubmit.addEventListener("click", () => {
    initAudio();
    evaluateAnswer(parseInt(gameSlider.value));
  });
}

function evaluateAnswer(userGuess) {
  const currentQ = gameQuestions[gameCurrentIndex];
  const actualPer = currentQ.per;
  
  // Score calculation: diff = abs(guess - actual), score = max(0, 100 - diff * 5)
  const diff = Math.abs(userGuess - actualPer);
  const score = Math.max(0, Math.round(100 - diff * 5.5));
  gameTotalScore += score;
  
  // Show intermediate results modal or alert (for premium visual, let's inject feedback nicely)
  alert(`🎯 정답 확인!\n\n${currentQ.name}의 실제 PER 배수: ${actualPer}배\n당신의 입력: ${userGuess}배 (오차: ${diff.toFixed(1)}배)\n\n이번 라운드 획득 점수: ${score}점!`);
  
  gameCurrentIndex++;
  if (gameCurrentIndex < 3) {
    loadQuestion();
  } else {
    showFinalResults();
  }
}

function showFinalResults() {
  document.getElementById("game-play-view").classList.remove("active");
  const resultView = document.getElementById("game-result-view");
  resultView.classList.add("active");
  
  document.getElementById("final-score-text").textContent = `최종 점수: ${gameTotalScore}점 (만점: 300점)`;
  
  const evalEl = document.getElementById("score-evaluation");
  if (gameTotalScore >= 270) {
    evalEl.innerHTML = "🥇 <strong>여의도의 절대 고수!</strong> 가치 평가를 완벽히 직관적으로 이해하고 계시네요. 신의 손끝입니다!";
    evalEl.style.color = "#b45309";
  } else if (gameTotalScore >= 200) {
    evalEl.innerHTML = "🥈 <strong>상위 10% 애널리스트!</strong> 기업 평가의 기준을 아주 잘 잡고 계십니다. 훌륭한 실력가입니다.";
    evalEl.style.color = "#047857";
  } else {
    evalEl.innerHTML = "🥉 <strong>새내기 믹서 연구원!</strong> PER과 마진의 관계를 믹서기로 조금 더 섞어보며 감을 다져보세요!";
    evalEl.style.color = "#1e293b";
  }
  
  // Save score to local rankings
  saveRanking(gameTotalScore);
  renderLeaderboard();
  
  // Action buttons
  const replayBtn = document.getElementById("btn-replay-game");
  const newReplay = replayBtn.cloneNode(true);
  replayBtn.parentNode.replaceChild(newReplay, replayBtn);
  newReplay.addEventListener("click", () => {
    initAudio();
    startGame();
  });
  
  const exitBtn = document.getElementById("btn-exit-game");
  const newExit = exitBtn.cloneNode(true);
  exitBtn.parentNode.replaceChild(newExit, exitBtn);
  newExit.addEventListener("click", () => {
    initAudio();
    initGameLobby();
  });
}

function saveRanking(score) {
  let rankings = [];
  try {
    const saved = localStorage.getItem("stock_mixer_rankings");
    if (saved) rankings = JSON.parse(saved);
  } catch (e) {
    console.warn("로컬 스토리지를 이용할 수 없습니다 (In-memory 랭킹 대체).");
  }
  
  // Add new ranking
  const nickname = prompt("축하합니다! 랭킹에 이름을 등록해보세요:", "주린이레시피") || "익명";
  rankings.push({ name: nickname, score: score, date: new Date().toLocaleDateString() });
  
  // Sort and limit
  rankings.sort((a, b) => b.score - a.score);
  rankings = rankings.slice(0, 5);
  
  try {
    localStorage.setItem("stock_mixer_rankings", JSON.stringify(rankings));
  } catch (e) {
    // In memory fallback
    window.memRankings = rankings;
  }
}

function renderLeaderboard() {
  let rankings = [
    { name: "가치투자달인", score: 290 },
    { name: "여의도워렌버핏", score: 275 },
    { name: "삼전주주", score: 240 }
  ];
  
  try {
    const saved = localStorage.getItem("stock_mixer_rankings");
    if (saved) {
      rankings = JSON.parse(saved);
    } else if (window.memRankings) {
      rankings = window.memRankings;
    }
  } catch (e) {
    if (window.memRankings) rankings = window.memRankings;
  }
  
  const listEl = document.getElementById("local-rankings-list");
  listEl.innerHTML = "";
  
  rankings.forEach((rank, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i + 1}. ${rank.name}</span> <strong>${rank.score}점</strong>`;
    listEl.appendChild(li);
  });
}

// --- Ranking Tab Controller and Helpers ---

function initRankingTab() {
  // Tab Switching
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      initAudio();
      const targetTab = e.target.dataset.tab;
      
      // Toggle button active state
      tabButtons.forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      
      // Toggle content active state
      document.querySelectorAll(".tab-content").forEach(content => {
        content.classList.remove("active");
      });
      document.getElementById(targetTab).classList.add("active");
      
      // Special action on tab show
      if (targetTab === "ranking-tab") {
        renderRankingTable();
        startSimulation();
      } else {
        // Keep simulation running in the background so prices fluctuate live
      }
    });
  });

  // Table Filters & Search
  document.getElementById("ranking-search").addEventListener("input", (e) => {
    rankingSearchQuery = e.target.value.toLowerCase().trim();
    rankingCurrentPage = 1;
    renderRankingTable();
  });

  document.getElementById("ranking-sector-filter").addEventListener("change", (e) => {
    rankingSectorFilter = e.target.value;
    rankingCurrentPage = 1;
    renderRankingTable();
  });

  document.querySelectorAll(".market-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      initAudio();
      document.querySelectorAll(".market-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      rankingMarketFilter = e.target.dataset.market;
      rankingCurrentPage = 1;
      renderRankingTable();
    });
  });

  // Pagination Buttons
  document.getElementById("btn-prev-page").addEventListener("click", () => {
    initAudio();
    if (rankingCurrentPage > 1) {
      rankingCurrentPage--;
      renderRankingTable();
    }
  });

  document.getElementById("btn-next-page").addEventListener("click", () => {
    initAudio();
    const filtered = getFilteredStocks();
    const maxPage = Math.ceil(filtered.length / rankingItemsPerPage);
    if (rankingCurrentPage < maxPage) {
      rankingCurrentPage++;
      renderRankingTable();
    }
  });

  // Kiwoom UI Toggle Mode
  const apiModeInputs = document.querySelectorAll("input[name='api-mode']");
  apiModeInputs.forEach(input => {
    input.addEventListener("change", (e) => {
      initAudio();
      const mode = e.target.value;
      const kiwoomInputs = document.getElementById("kiwoom-inputs-section");
      const simControls = document.getElementById("sim-controls-section");
      
      if (mode === "kiwoom") {
        isKiwoomMode = true;
        kiwoomInputs.style.display = "flex";
        simControls.style.display = "none";
        updateConnectionStatus("sim" === kiwoomStatus ? "error" : kiwoomStatus, "sim" === kiwoomStatus ? "연동 대기 중 (연결 버튼 클릭)" : "");
      } else {
        isKiwoomMode = false;
        kiwoomInputs.style.display = "none";
        simControls.style.display = "block";
        updateConnectionStatus("sim", "시뮬레이션 모드 활성화 중 (Live 가격 변동)");
      }
    });
  });

  // Kiwoom Connect Button
  document.getElementById("btn-connect-kiwoom").addEventListener("click", () => {
    initAudio();
    connectKiwoom();
  });

  // Simulation Controls
  const simSpeedRange = document.getElementById("sim-speed-range");
  const simSpeedBadge = document.getElementById("sim-speed-badge");
  simSpeedRange.addEventListener("input", (e) => {
    simulationSpeed = parseInt(e.target.value);
    simSpeedBadge.textContent = `${(simulationSpeed / 1000).toFixed(1)}초`;
    if (!isSimulationPaused && !isKiwoomMode) {
      stopSimulation();
      startSimulation();
    }
  });

  const btnToggleSim = document.getElementById("btn-toggle-sim");
  btnToggleSim.addEventListener("click", () => {
    initAudio();
    isSimulationPaused = !isSimulationPaused;
    if (isSimulationPaused) {
      btnToggleSim.textContent = "▶️ 재생";
      btnToggleSim.classList.add("btn-accent");
      btnToggleSim.classList.remove("btn-secondary");
      stopSimulation();
    } else {
      btnToggleSim.textContent = "⏸️ 일시 정지";
      btnToggleSim.classList.remove("btn-accent");
      btnToggleSim.classList.add("btn-secondary");
      startSimulation();
    }
  });

  document.getElementById("btn-reset-sim").addEventListener("click", () => {
    initAudio();
    resetSimulationPrices();
  });
}

function getFilteredStocks() {
  return STOCKS_DATA.filter(stock => {
    const matchesSearch = stock.name.toLowerCase().includes(rankingSearchQuery) || 
                          stock.ticker.includes(rankingSearchQuery);
    const matchesSector = rankingSectorFilter === "all" || stock.sector === rankingSectorFilter;
    const matchesMarket = rankingMarketFilter === "all" || stock.market === rankingMarketFilter;
    return matchesSearch && matchesSector && matchesMarket;
  });
}

function renderRankingTable() {
  const tbody = document.getElementById("ranking-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filtered = getFilteredStocks();
  const totalItems = filtered.length;
  const maxPage = Math.max(1, Math.ceil(totalItems / rankingItemsPerPage));
  if (rankingCurrentPage > maxPage) rankingCurrentPage = maxPage;
  
  const pageIndicator = document.getElementById("page-indicator");
  if (pageIndicator) {
    pageIndicator.textContent = `페이지 ${rankingCurrentPage} / ${maxPage}`;
  }
  
  const btnPrev = document.getElementById("btn-prev-page");
  const btnNext = document.getElementById("btn-next-page");
  if (btnPrev) btnPrev.disabled = rankingCurrentPage === 1;
  if (btnNext) btnNext.disabled = rankingCurrentPage === maxPage;

  const startIdx = (rankingCurrentPage - 1) * rankingItemsPerPage;
  const endIdx = startIdx + rankingItemsPerPage;
  let pageStocks = filtered.slice(startIdx, endIdx);

  let virtualStockRowInserted = false;
  let virtualStock = null;
  
  if (selectedStock) {
    const expRevenue = selectedStock.revenue * (1 + currentGrowth / 100);
    const expProfit = expRevenue * (currentOpm / 100);
    const expMarketCap = expProfit * currentPer;
    const expPrice = Math.round(expMarketCap / selectedStock.shares);
    const roi = ((expPrice - selectedStock.price) / selectedStock.price * 100).toFixed(1);

    virtualStock = {
      ...selectedStock,
      id: "virtual_" + selectedStock.ticker,
      name: "🧪 " + selectedStock.name + " (레시피)",
      price: expPrice,
      marketCap: expMarketCap,
      changeRate: parseFloat(roi),
      isVirtual: true
    };
    
    const rankingCopy = [...filtered];
    rankingCopy.push(virtualStock);
    rankingCopy.sort((a, b) => b.marketCap - a.marketCap);
    
    const globalRank = rankingCopy.findIndex(s => s.id === virtualStock.id) + 1;
    virtualStock.rank = globalRank;
    
    updateBattleReport(globalRank, virtualStock, rankingCopy);

    const pageStartRank = startIdx + 1;
    const pageEndRank = startIdx + rankingItemsPerPage;
    
    if (globalRank >= pageStartRank && globalRank <= pageEndRank + 1) {
      const insertIdx = globalRank - pageStartRank;
      pageStocks.splice(insertIdx, 0, virtualStock);
      virtualStockRowInserted = true;
    }
  }

  pageStocks.forEach((stock, idx) => {
    const tr = document.createElement("tr");
    if (stock.isVirtual) {
      tr.className = "virtual-rank-row";
    }
    
    let rankNum = stock.isVirtual ? stock.rank : (startIdx + idx + 1);
    if (!stock.isVirtual && virtualStockRowInserted) {
      const currentElementRankInCopy = startIdx + idx + 1;
      if (currentElementRankInCopy > virtualStock.rank) {
        rankNum = currentElementRankInCopy - 1;
      }
    }
    
    const sign = stock.changeRate > 0 ? "+" : "";
    const changeClass = stock.changeRate > 0 ? "change-up" : (stock.changeRate < 0 ? "change-down" : "change-flat");
    
    let flashClass = "";
    if (stock.flashState === "up") flashClass = "flash-price-up";
    if (stock.flashState === "down") flashClass = "flash-price-down";
    
    tr.innerHTML = `
      <td class="text-center"><span class="rank-badge">${rankNum}</span></td>
      <td>
        <div style="font-weight: 800;">${stock.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${stock.ticker}</div>
      </td>
      <td><span class="sector-badge" style="background-color: ${stock.color || '#64748b'};">${stock.sector}</span></td>
      <td class="text-right ${flashClass}" id="price-${stock.ticker}">${stock.price.toLocaleString()} 원</td>
      <td class="text-right change-text ${changeClass}">${sign}${stock.changeRate.toFixed(2)}%</td>
      <td class="text-right">${formatKoreanNumber(stock.marketCap)}</td>
      <td class="text-center">
        ${stock.isVirtual ? 
          `<span style="font-size: 0.8rem; font-weight: 800; color: #d97706;">🔥 활성화됨</span>` : 
          `<button class="btn-mix-battle" data-id="${stock.id}">믹스 & 배틀 🧪</button>`
        }
      </td>
    `;
    
    if (!stock.isVirtual) {
      tr.querySelector(".btn-mix-battle").addEventListener("click", () => {
        selectStockForBattle(stock.id);
      });
    }
    
    tbody.appendChild(tr);
  });
}

function selectStockForBattle(stockId) {
  const cleanId = stockId.replace("stock_", "");
  const stock = STOCKS_DATA.find(s => s.id === stockId || s.ticker === cleanId);
  if (!stock) return;
  
  selectStock(stock.id);
  
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(btn => {
    if (btn.dataset.tab === "mixer-tab") {
      btn.click();
    }
  });

  showToast(`🧪 ${stock.name}이 믹서에 투입되었습니다!`);
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }
}

function updateBattleReport(globalRank, virtualStock, rankingCopy) {
  const rankEl = document.getElementById("battle-rank");
  const mcapEl = document.getElementById("battle-mcap");
  const compEl = document.getElementById("battle-comparison-text");
  
  if (!rankEl || !mcapEl || !compEl) return;
  
  rankEl.textContent = `#${globalRank} 위`;
  mcapEl.textContent = formatKoreanNumber(virtualStock.marketCap);
  
  const virtualIdx = rankingCopy.findIndex(s => s.id === virtualStock.id);
  let comparisonText = "";
  
  if (virtualIdx === 0) {
    const nextStock = rankingCopy[1];
    comparisonText = `🏆 **대단합니다! 랭킹 1위를 차지했습니다!** <br>실제 시총 1위인 **${nextStock.name}**(${formatKoreanNumber(nextStock.marketCap)})를 제치고 왕좌에 올랐습니다. 당신의 시나리오가 현실화된다면 대한민국 시총 1위는 바뀝니다!`;
  } else {
    const aboveStock = rankingCopy[virtualIdx - 1];
    const belowStock = virtualIdx < rankingCopy.length - 1 ? rankingCopy[virtualIdx + 1] : null;
    
    comparisonText = `현재 랭킹 **#${globalRank}**위에 위치해 있습니다.<br>`;
    
    if (aboveStock) {
      const diffAbove = aboveStock.marketCap - virtualStock.marketCap;
      comparisonText += `⚔️ 바로 위 **${aboveStock.name}**(#${globalRank-1}위, ${formatKoreanNumber(aboveStock.marketCap)})를 넘어서기 위해선 시가총액이 약 **${formatKoreanNumber(diffAbove)}** 더 필요합니다. PER 또는 매출액을 조금만 더 올려보세요!<br>`;
    }
    
    if (belowStock) {
      comparisonText += `🛡️ 바로 아래 **${belowStock.name.replace("🧪 ", "")}**(#${globalRank+1}위, ${formatKoreanNumber(belowStock.marketCap)})보다 우위에 있으며, 현재 시장 가치를 리드하고 있습니다.`;
    }
  }
  
  compEl.innerHTML = comparisonText;
}

function startSimulation() {
  if (simulationIntervalId || isSimulationPaused || isKiwoomMode) return;
  
  simulationIntervalId = setInterval(() => {
    tickSimulation();
  }, simulationSpeed);
}

function stopSimulation() {
  if (simulationIntervalId) {
    clearInterval(simulationIntervalId);
    simulationIntervalId = null;
  }
}

function tickSimulation() {
  const count = 5 + Math.floor(Math.random() * 4);
  const indices = [];
  
  for (let i = 0; i < count; i++) {
    const randIdx = Math.floor(Math.random() * STOCKS_DATA.length);
    if (!indices.includes(randIdx)) {
      indices.push(randIdx);
    }
  }
  
  indices.forEach(idx => {
    const stock = STOCKS_DATA[idx];
    const pct = -0.8 + (Math.random() * 1.6);
    const priceChange = Math.round(stock.price * (pct / 100));
    const newPrice = Math.max(100, stock.price + priceChange);
    const oldPrice = stock.price;
    
    stock.price = newPrice;
    stock.marketCap = stock.price * stock.shares;
    stock.changeRate = stock.changeRate + pct;
    stock.flashState = newPrice > oldPrice ? "up" : (newPrice < oldPrice ? "down" : "");
    
    setTimeout(() => {
      stock.flashState = "";
      const rankingTab = document.getElementById("ranking-tab");
      if (rankingTab && rankingTab.classList.contains("active")) {
        const priceEl = document.getElementById(`price-${stock.ticker}`);
        if (priceEl) {
          priceEl.classList.remove("flash-price-up", "flash-price-down");
        }
      }
    }, 850);
  });
  
  STOCKS_DATA.sort((a, b) => b.marketCap - a.marketCap);
  
  const rankingTab = document.getElementById("ranking-tab");
  if (rankingTab && rankingTab.classList.contains("active")) {
    renderRankingTable();
  }
}

function resetSimulationPrices() {
  STOCKS_DATA.length = 0;
  originalStocksCache.forEach(item => STOCKS_DATA.push(JSON.parse(JSON.stringify(item))));
  STOCKS_DATA.sort((a, b) => b.marketCap - a.marketCap);
  renderRankingTable();
  showToast("📈 모든 주식 시세가 초기화되었습니다!");
}

function updateConnectionStatus(status, text) {
  kiwoomStatus = status;
  const dot = document.getElementById("conn-status-dot");
  const txt = document.getElementById("conn-status-text");
  if (!dot || !txt) return;

  dot.className = "status-dot";
  
  if (status === "sim") {
    dot.classList.add("status-sim");
    txt.textContent = text || "시뮬레이션 모드 활성화 중 (Live 가격 변동)";
  } else if (status === "connecting") {
    dot.classList.add("status-connecting");
    txt.textContent = text || "키움 API 토큰 요청 중...";
  } else if (status === "active") {
    dot.classList.add("status-active");
    txt.textContent = text || "연결 성공: 실시간 시세 수신 중";
  } else {
    dot.classList.add("status-error");
    dot.style.backgroundColor = "var(--neon-pink)";
    dot.style.boxShadow = "var(--shadow-pink-glow)";
    txt.textContent = text || "오류: 연결 실패 (인증키를 확인하세요)";
  }
}

async function connectKiwoom() {
  const appKey = document.getElementById("kiwoom-app-key").value.trim();
  const secretKey = document.getElementById("kiwoom-secret-key").value.trim();
  const proxyUrl = document.getElementById("kiwoom-proxy").value.trim();
  
  if (!appKey || !secretKey) {
    updateConnectionStatus("error", "오류: App Key와 Secret Key를 모두 입력해주세요.");
    return;
  }
  
  updateConnectionStatus("connecting", "키움 API 인증 서버에 접근 중...");
  
  const tokenUrl = "https://api.kiwoom.com/v1/auth/token";
  const requestUrl = proxyUrl ? (proxyUrl + tokenUrl) : tokenUrl;
  
  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: appKey,
        appsecret: secretKey
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP 에러 상태 코드: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.access_token) {
      kiwoomAccessToken = data.access_token;
      updateConnectionStatus("active", "키움 API 연결 성공! 실시간 데이터를 연동합니다.");
      showToast("🔌 키움 Open API 연결에 성공했습니다!");
      
      startKiwoomFeed();
    } else {
      throw new Error("Access Token이 응답에 포함되지 않았습니다.");
    }
  } catch (error) {
    console.error("Kiwoom Connection Error:", error);
    let errMsg = "연결 실패: ";
    if (error.message.includes("Failed to fetch") || error.message.includes("CORS")) {
      errMsg += "CORS 차단 또는 네트워크 에러. 프록시 설정을 확인하세요.";
    } else {
      errMsg += error.message;
    }
    
    updateConnectionStatus("error", errMsg);
    alert(`❌ 키움 API 연결에 실패했습니다.\n\n사유: ${error.message}\n\n[개발자 팁] 로컬 브라우저 CORS 정책으로 인해 서버 응답이 차단되었습니다. 'CORS Proxy URL'에 올바른 프록시 서버를 기입하시거나 Chrome CORS 해제 옵션으로 실행해 주세요. 연결에 성공할 때까지 로컬 시뮬레이션 데이터가 계속 작동합니다!`);
  }
}

let kiwoomFeedIntervalId = null;

function startKiwoomFeed() {
  stopSimulation();
  if (kiwoomFeedIntervalId) clearInterval(kiwoomFeedIntervalId);
  
  fetchKiwoomQuotes();
  
  kiwoomFeedIntervalId = setInterval(() => {
    fetchKiwoomQuotes();
  }, 5000);
}

function stopKiwoomFeed() {
  if (kiwoomFeedIntervalId) {
    clearInterval(kiwoomFeedIntervalId);
    kiwoomFeedIntervalId = null;
  }
}

async function fetchKiwoomQuotes() {
  if (!kiwoomAccessToken || !isKiwoomMode) return;
  
  const filtered = getFilteredStocks();
  const startIdx = (rankingCurrentPage - 1) * rankingItemsPerPage;
  const pageStocks = filtered.slice(startIdx, startIdx + rankingItemsPerPage);
  
  const proxyUrl = document.getElementById("kiwoom-proxy").value.trim();
  const queryList = pageStocks.slice(0, 8);
  
  queryList.forEach(async (stock) => {
    const url = "https://api.kiwoom.com/v1/dostk/stkinfo";
    const requestUrl = proxyUrl ? (proxyUrl + url) : url;
    
    try {
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "authorization": `Bearer ${kiwoomAccessToken}`,
          "api-id": "ka10001"
        },
        body: JSON.stringify({
          stk_cd: stock.ticker
        })
      });
      
      if (!response.ok) return;
      const data = await response.json();
      
      if (data && data.output) {
        const out = data.output;
        const newPrice = Math.abs(parseInt(out.cur_prc));
        const newChange = parseFloat(out.prc_chg_rt);
        
        if (newPrice > 0) {
          const oldPrice = stock.price;
          stock.price = newPrice;
          stock.marketCap = newPrice * stock.shares;
          stock.changeRate = newChange;
          stock.flashState = newPrice > oldPrice ? "up" : (newPrice < oldPrice ? "down" : "");
          
          setTimeout(() => {
            stock.flashState = "";
          }, 800);
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch quote for ${stock.ticker}:`, e);
    }
  });
  
  STOCKS_DATA.sort((a, b) => b.marketCap - a.marketCap);
  renderRankingTable();
}
