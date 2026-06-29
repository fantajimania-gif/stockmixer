// Stock Mixer - Main Controller Logic (Refactored & Simplified)

// --- Global State ---
let selectedStock = null;
let currentGrowth = 0;
let currentOpm = 0;
let currentPer = 0;
let lastValuationState = null; // 'undervalued', 'fair', 'overvalued' for sound triggers

// Ranking Tab Global State & Cache
let originalStocksCache = [];
let rankingSearchQuery = "";
let rankingSectorFilter = "all";
let rankingMarketFilter = "all"; // 'all', 'KOSPI', 'KOSDAQ'
let simulationIntervalId = null;
let simulationSpeed = 1500; // ms
let isSimulationPaused = false;

// Web Audio API Context (lazy initialized)
let audioCtx = null;

// --- Kiwoom API State ---
const KiwoomState = {
  isConnected: false,
  mode: 'disconnected', // 'disconnected' | 'mock' | 'real'
  isLiveEnabled: false,
  liveIntervalId: null,
  PROXY_URL: 'http://localhost:3000'
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  // 1a. Cache original stock data for resets
  originalStocksCache = JSON.parse(JSON.stringify(STOCKS_DATA));

  // 1b. Initial stock selection
  const defaultStockId = STOCKS_DATA[0] ? STOCKS_DATA[0].id : "stock_005930";
  selectStock(defaultStockId);

  // 2. Setup Event Listeners
  setupEventListeners();

  // 3. Initialize Ranking Tab
  initRankingTab();

  // 4. Run Initial Calculations
  calculateAndRender();

  // 5. Render Saved Recipes
  renderSavedRecipes();

  // 6. Initialize Kiwoom API module
  initKiwoomAPI();
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

function formatKoreanShort(num) {
  if (num >= 1000000000000) return (num / 1000000000000).toFixed(0) + "조";
  if (num >= 100000000) return (num / 100000000).toFixed(0) + "억";
  return num.toLocaleString();
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
  
  const diffPct = parseFloat(roi);
  
  if (diffPct >= 15.0) {
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
    verdictBadge.textContent = "😐 적정";
    roiBadge.textContent = diffPct >= 0 ? `+${roi}%` : `${roi}%`;
    verdictMsg.innerHTML = `현재 주가 수준이 믹싱된 미래 가치를 적정하게 선반영하고 있습니다.`;
    
    valuationPanel.className = "valuation-panel val-fair";
    stockCard.className = "card active-stock-card";
    
    lastValuationState = 'fair';
  }

  // Update ranking table to show live price updates
  const rankingTab = document.getElementById("ranking-tab");
  if (rankingTab && rankingTab.classList.contains("active")) {
    renderRankingList();
  }
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
    
    // Filter stocks with Korean/English alias support (e.g. 네이버 -> NAVER)
    const aliases = {
      "네이버": "naver",
      "카카오": "kakao",
      "라인": "line",
      "에스케이": "sk",
      "삼성": "samsung",
      "현대": "hyundai",
      "엘지": "lg",
      "포스코": "posco",
      "에코프로": "ecopro",
      "셀트리온": "celltrion"
    };
    const query = val.toLowerCase().trim();
    const aliasQuery = aliases[query] || query;
    
    const filtered = STOCKS_DATA.filter(stock => {
      const nameLower = stock.name.toLowerCase();
      return nameLower.includes(query) || 
             nameLower.includes(aliasQuery) ||
             stock.ticker.includes(query);
    });
    
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
          
          // Switch to ranking tab and scroll to it if ranking is active
          const rankingTab = document.getElementById("ranking-tab");
          if (rankingTab && rankingTab.classList.contains("active")) {
            setTimeout(() => {
              scrollToSearchResult(stock.name);
            }, 100);
          }
          
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
  
  // Close modals clicking overlay
  [guideModal].forEach(modal => {
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
  
  // Save Recipe Button
  const btnSaveRecipe = document.getElementById("btn-save-recipe");
  if (btnSaveRecipe) {
    btnSaveRecipe.addEventListener("click", () => {
      initAudio();
      saveUserRecipe();
    });
  }
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
👉 index.html을 실행해 확인해 보세요.`;

  navigator.clipboard.writeText(shareText).then(() => {
    // Show toast message
    const toast = document.getElementById("toast");
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
  }).catch(err => {
    console.error("복사 실패:", err);
  });
}

// --- Saved Recipes Feature ---
function saveUserRecipe() {
  if (!selectedStock) return;
  const expRevenue = selectedStock.revenue * (1 + currentGrowth / 100);
  const expProfit = expRevenue * (currentOpm / 100);
  const expMarketCap = expProfit * currentPer;
  const expTargetPrice = Math.round(expMarketCap / selectedStock.shares);
  const roi = ((expTargetPrice - selectedStock.price) / selectedStock.price * 100).toFixed(1);
  
  let recipes = [];
  try {
    const saved = localStorage.getItem("stock_mixer_user_recipes");
    if (saved) recipes = JSON.parse(saved);
  } catch (e) {
    console.warn(e);
  }

  const newRecipe = {
    id: Date.now(),
    stockId: selectedStock.id,
    stockName: selectedStock.name,
    growth: currentGrowth,
    opm: currentOpm,
    per: currentPer,
    targetPrice: expTargetPrice,
    roi: roi,
    date: new Date().toLocaleDateString()
  };

  recipes.unshift(newRecipe);
  localStorage.setItem("stock_mixer_user_recipes", JSON.stringify(recipes));
  renderSavedRecipes();
  showToast(`💾 [${selectedStock.name}] 레시피가 저장되었습니다!`);
}

function renderSavedRecipes() {
  const listEl = document.getElementById("saved-recipes-list");
  if (!listEl) return;
  
  let recipes = [];
  try {
    const saved = localStorage.getItem("stock_mixer_user_recipes");
    if (saved) recipes = JSON.parse(saved);
  } catch (e) {
    console.warn(e);
  }

  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="empty-msg" style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 20px 0;">저장된 레시피가 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = "";
  recipes.forEach(recipe => {
    const item = document.createElement("div");
    item.className = "saved-recipe-item";
    const sign = recipe.roi >= 0 ? "+" : "";
    const roiClass = recipe.roi >= 15.0 ? "chg-up" : (recipe.roi <= -15.0 ? "chg-down" : "chg-flat");
    
    item.innerHTML = `
      <div class="recipe-info" style="cursor: pointer; flex-grow: 1;">
        <div class="recipe-title">${recipe.stockName} 레시피</div>
        <div class="recipe-meta">성장률:${recipe.growth}% | 마진:${recipe.opm}% | PER:${recipe.per}배</div>
        <div class="recipe-price-row">
          적정주가: <span class="highlight-neon">${recipe.targetPrice.toLocaleString()}원</span> 
          (<span class="${roiClass}">${sign}${recipe.roi}%</span>)
        </div>
      </div>
      <button class="btn-delete-recipe" data-id="${recipe.id}">×</button>
    `;

    item.querySelector(".recipe-info").addEventListener("click", () => {
      loadSavedRecipe(recipe);
    });

    item.querySelector(".btn-delete-recipe").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSavedRecipe(recipe.id);
    });

    listEl.appendChild(item);
  });
}

function loadSavedRecipe(recipe) {
  selectStock(recipe.stockId);
  currentGrowth = recipe.growth;
  currentOpm = recipe.opm;
  currentPer = recipe.per;
  syncSliders();
  calculateAndRender();
  showToast(`📂 [${recipe.stockName}] 레시피를 불러왔습니다!`);
}

function deleteSavedRecipe(id) {
  let recipes = [];
  try {
    const saved = localStorage.getItem("stock_mixer_user_recipes");
    if (saved) recipes = JSON.parse(saved);
  } catch (e) {
    console.warn(e);
  }
  recipes = recipes.filter(r => r.id !== id);
  localStorage.setItem("stock_mixer_user_recipes", JSON.stringify(recipes));
  renderSavedRecipes();
  showToast(`🗑️ 레시피가 삭제되었습니다.`);
}

// --- Ranking Tab Controller and Helpers ---
function initRankingTab() {
  // Tab Switching (Fixed: uses closest to safely capture dataset inside spans)
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", (e) => {
      initAudio();
      const currentBtn = e.target.closest('.tab-btn');
      if (!currentBtn) return;
      const targetTab = currentBtn.dataset.tab;
      if (!targetTab) return;
      
      const targetPanel = document.getElementById(targetTab);
      if (!targetPanel) return;
      
      tabButtons.forEach(b => b.classList.remove("active"));
      currentBtn.classList.add("active");
      
      document.querySelectorAll(".tab-content").forEach(content => {
        content.classList.remove("active");
      });
      targetPanel.classList.add("active");
      
      if (targetTab === "ranking-tab") {
        renderRankingList();
        startSimulation();
      }
    });
  });

  // 업종 필터
  const sectorFilter = document.getElementById("ranking-sector-filter");
  if (sectorFilter) {
    sectorFilter.addEventListener("change", (e) => {
      rankingSectorFilter = e.target.value;
      renderRankingList();
    });
  }

  // 시장 필터
  document.querySelectorAll(".market-pill").forEach(btn => {
    btn.addEventListener("click", (e) => {
      initAudio();
      document.querySelectorAll(".market-pill").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      rankingMarketFilter = e.target.dataset.market;
      renderRankingList();
    });
  });

  // 시뮬레이션 속도 슬라이더
  const simSpeedRange = document.getElementById("sim-speed-range");
  const simSpeedBadge = document.getElementById("sim-speed-badge");
  if (simSpeedRange) {
    simSpeedRange.addEventListener("input", (e) => {
      simulationSpeed = parseInt(e.target.value);
      if (simSpeedBadge) simSpeedBadge.textContent = `${(simulationSpeed / 1000).toFixed(1)}초`;
      if (!isSimulationPaused) {
        stopSimulation();
        startSimulation();
      }
    });
  }

  // 시뮬레이션 토글
  const btnToggleSim = document.getElementById("btn-toggle-sim");
  if (btnToggleSim) {
    btnToggleSim.addEventListener("click", () => {
      initAudio();
      isSimulationPaused = !isSimulationPaused;
      if (isSimulationPaused) {
        btnToggleSim.textContent = "▶️ 재생";
        btnToggleSim.classList.add("paused");
        stopSimulation();
      } else {
        btnToggleSim.textContent = "⏸️ 일시정지";
        btnToggleSim.classList.remove("paused");
        startSimulation();
      }
    });
  }

  // 시세 초기화
  const btnResetSim = document.getElementById("btn-reset-sim");
  if (btnResetSim) {
    btnResetSim.addEventListener("click", () => {
      initAudio();
      resetSimulationPrices();
    });
  }
}

// --- Custom Smooth Scroll Utility ---
function smoothScrollTo(container, targetY, duration) {
  const startY = container.scrollTop;
  const difference = targetY - startY;
  const startTime = performance.now();

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing: easeInOutCubic
    const ease = progress < 0.5 
      ? 4 * progress * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    
    container.scrollTop = startY + difference * ease;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

// 검색 결과로 부드러운 스크롤 (Fixed: correct scroll container & alias matching)
function scrollToSearchResult(stockName) {
  const aliases = {
    "네이버": "naver",
    "카카오": "kakao",
    "라인": "line",
    "에스케이": "sk",
    "삼성": "samsung",
    "현대": "hyundai",
    "엘지": "lg",
    "포스코": "posco",
    "에코프로": "ecopro",
    "셀트리온": "celltrion"
  };
  const query = (stockName || rankingSearchQuery || "").trim().toLowerCase();
  const aliasQuery = aliases[query] || query;
  if (!query) return;

  const rankingTab = document.getElementById("ranking-tab");
  if (!rankingTab) return;

  const scrollContainer = document.getElementById("rank-list-scroll");
  if (!scrollContainer) return;

  // Search through all elements
  const allRows = scrollContainer.querySelectorAll(".rank-row");
  let targetRow = null;

  for (const row of allRows) {
    const name = (row.dataset.name || "").toLowerCase();
    const ticker = (row.dataset.ticker || "").toLowerCase();
    if (name.includes(query) || name.includes(aliasQuery) || ticker.includes(query)) {
      targetRow = row;
      break;
    }
  }

  if (!targetRow) {
    showToast(`🔍 "${query}" 검색 결과가 없습니다.`);
    return;
  }

  // Remove existing highlights
  scrollContainer.querySelectorAll(".rank-row.search-highlight").forEach(r => {
    r.classList.remove("search-highlight");
  });

  const containerRect = rankingTab.getBoundingClientRect();
  const rowRect = targetRow.getBoundingClientRect();
  const relativeTop = rowRect.top - containerRect.top + rankingTab.scrollTop;
  const centerOffset = relativeTop - rankingTab.clientHeight / 2 + rowRect.height / 2;

  // Custom elastic/smooth scroll action targeting ranking tab scroll
  smoothScrollTo(rankingTab, Math.max(0, centerOffset), 900);

  // Bounce scale and glowing pulse highlight effect
  setTimeout(() => {
    targetRow.classList.add("search-highlight");
    setTimeout(() => targetRow.classList.remove("search-highlight"), 2500);
  }, 350);

  showToast(`✅ ${targetRow.dataset.name} 발견! 📍 ${allRows.length}개 중`);
}

function getFilteredStocks() {
  return STOCKS_DATA.filter(stock => {
    const matchesSector = rankingSectorFilter === "all" || stock.sector === rankingSectorFilter;
    const matchesMarket = rankingMarketFilter === "all" || stock.market === rankingMarketFilter;
    return matchesSector && matchesMarket;
  });
}

// 업종별 색상 매핑
const SECTOR_COLORS = {
  "반도체": "#6366f1",
  "IT/인터넷": "#3b82f6",
  "2차전지": "#10b981",
  "자동차": "#f59e0b",
  "제약/바이오": "#ec4899",
  "금융/은행": "#8b5cf6",
  "철강/소재": "#64748b",
  "화학/소재": "#06b6d4",
  "유통/상사/건설": "#f97316",
  "보험": "#84cc16",
  "엔터테인먼트": "#ef4444",
  "기타": "#94a3b8"
};

function getSectorColor(sector) {
  return SECTOR_COLORS[sector] || "#94a3b8";
}

let maxMarketCap = 0;

function renderRankingList() {
  const listBody = document.getElementById("rank-list-body");
  if (!listBody) return;

  const filtered = getFilteredStocks();
  maxMarketCap = filtered.length > 0 ? filtered[0].marketCap : 1;

  // 통계 업데이트
  updateRankingStats(filtered);

  // 필터 정보
  const filterInfo = document.getElementById("ranking-filter-info");
  if (filterInfo) {
    filterInfo.textContent = filtered.length < STOCKS_DATA.length
      ? `필터 결과: ${filtered.length}개 종목 표시 중 (전체 ${STOCKS_DATA.length}개)`
      : `전체 ${filtered.length}개 종목 표시 중`;
  }

  // 렌더링
  const fragment = document.createDocumentFragment();
  filtered.forEach((stock, idx) => {
    const row = createRankRow(stock, idx + 1);
    fragment.appendChild(row);
  });

  listBody.innerHTML = "";
  listBody.appendChild(fragment);

  // 스크롤 이벤트로 행 등장 애니메이션
  scheduleRowAnimations();
}

function updateRankingStats(filtered) {
  const totalMcap = filtered.reduce((sum, s) => sum + s.marketCap, 0);
  const upCount = filtered.filter(s => s.changeRate > 0).length;
  const downCount = filtered.filter(s => s.changeRate < 0).length;

  const statTotal = document.getElementById("stat-total-count");
  const statMcap = document.getElementById("stat-total-mcap");
  const statUp = document.getElementById("stat-up-count");
  const statDown = document.getElementById("stat-down-count");

  if (statTotal) statTotal.textContent = filtered.length;
  if (statMcap) statMcap.textContent = formatKoreanShort(totalMcap);
  if (statUp) statUp.textContent = upCount;
  if (statDown) statDown.textContent = downCount;
}

function createRankRow(stock, rankNum) {
  const row = document.createElement("div");
  row.className = "rank-row";
  row.dataset.id = stock.id;
  row.dataset.name = stock.name;
  row.dataset.ticker = stock.ticker;

  const sign = stock.changeRate > 0 ? "+" : "";
  const changeClass = stock.changeRate > 0 ? "chg-up" : (stock.changeRate < 0 ? "chg-down" : "chg-flat");

  let flashClass = "";
  if (stock.flashState === "up") flashClass = " flash-up";
  if (stock.flashState === "down") flashClass = " flash-down";

  // 시총 비중 바 (1위 대비 상대적 비율)
  const barPct = Math.min(100, (stock.marketCap / maxMarketCap) * 100);

  const sectorColor = getSectorColor(stock.sector);

  // 순위 뱃지 스타일
  let rankBadgeClass = "rank-num";
  if (rankNum === 1) rankBadgeClass += " rank-gold";
  else if (rankNum === 2) rankBadgeClass += " rank-silver";
  else if (rankNum === 3) rankBadgeClass += " rank-bronze";
  else if (rankNum <= 10) rankBadgeClass += " rank-top10";

  const marketTag = stock.market === "KOSDAQ" 
    ? `<span class="market-tag kosdaq">Q</span>` 
    : `<span class="market-tag kospi">K</span>`;

  row.innerHTML = `
    <div class="rl-col rl-rank"><span class="${rankBadgeClass}">${rankNum}</span></div>
    <div class="rl-col rl-name">
      <div class="stock-name-main">${stock.name}</div>
      <div class="stock-ticker-row">${marketTag} <span class="stock-ticker-txt">${stock.ticker}</span> <span class="sector-mini" style="color:${sectorColor}">${stock.sector}</span></div>
      <div class="price-inline${flashClass}" id="price-${stock.ticker}">${stock.price.toLocaleString()}<span class="price-won">원</span></div>
    </div>
    <div class="rl-col rl-change"><span class="${changeClass}">${sign}${stock.changeRate.toFixed(1)}%</span></div>
    <div class="rl-col rl-mcap">
      <div>${formatKoreanNumber(stock.marketCap)}</div>
      <div class="mcap-bar-mini"><div class="mcap-bar-fill" style="width:${barPct.toFixed(1)}%; background:${sectorColor}"></div></div>
    </div>
    <div class="rl-col rl-action"><button class="btn-pick" data-id="${stock.id}">🧪선택</button></div>
  `;

  // 클릭 이벤트
  row.addEventListener("click", (e) => {
    if (!e.target.classList.contains("btn-pick")) {
      // 행 전체 클릭시 선택
      selectStockForBattle(stock.id);
    }
  });

  const pickBtn = row.querySelector(".btn-pick");
  if (pickBtn) {
    pickBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectStockForBattle(stock.id);
    });
  }

  return row;
}

// 행 등장 애니메이션 스케줄러 (IntersectionObserver 방식)
let rowObserver = null;
function scheduleRowAnimations() {
  if (rowObserver) rowObserver.disconnect();

  const rows = document.querySelectorAll(".rank-row");

  rows.forEach((row) => {
    row.style.opacity = "0";
    row.style.transform = "translateX(-6px)";
  });

  rowObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const row = entry.target;
        row.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        row.style.opacity = "1";
        row.style.transform = "translateX(0)";
        rowObserver.unobserve(row);
      }
    });
  }, {
    root: null,  // 뷰포트 기준
    threshold: 0.01
  });

  rows.forEach(row => rowObserver.observe(row));
}

// 기존 renderRankingTable를 새 함수로 연결
function renderRankingTable() {
  renderRankingList();
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

// --- Simulation Controls ---
function startSimulation() {
  if (simulationIntervalId || isSimulationPaused) return;
  
  simulationIntervalId = setInterval(() => {
    tickSimulation();
  }, simulationSpeed);
}

// Stop simulation
function stopSimulation() {
  if (simulationIntervalId) {
    clearInterval(simulationIntervalId);
    simulationIntervalId = null;
  }
}

// Run one simulation tick
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

// Reset quotes to initial state
function resetSimulationPrices() {
  STOCKS_DATA.length = 0;
  originalStocksCache.forEach(item => STOCKS_DATA.push(JSON.parse(JSON.stringify(item))));
  STOCKS_DATA.sort((a, b) => b.marketCap - a.marketCap);
  renderRankingTable();
  showToast("📈 모든 주식 시세가 초기화되었습니다!");
}

// ============================================================
// KIWOOM API MODULE
// ============================================================

/**
 * Kiwoom API 모듈 초기화
 * - 모달, 상태 버튼, 연결 테스트 이벤트 등 설정
 */
function initKiwoomAPI() {
  const btnStatus   = document.getElementById('btn-kiwoom-status');
  const kiwoomModal = document.getElementById('kiwoom-modal');
  const btnClose    = document.getElementById('btn-close-kiwoom');
  const btnTest     = document.getElementById('btn-test-connect');
  const toggleLive  = document.getElementById('toggle-live-price');

  if (!btnStatus || !kiwoomModal) return;

  // 헤더 상태 버튼 → 모달 열기
  btnStatus.addEventListener('click', () => {
    kiwoomModal.classList.add('active');
  });

  // 모달 닫기
  btnClose.addEventListener('click', () => kiwoomModal.classList.remove('active'));
  kiwoomModal.addEventListener('click', (e) => {
    if (e.target === kiwoomModal) kiwoomModal.classList.remove('active');
  });

  // 연결 테스트 버튼
  btnTest.addEventListener('click', async () => {
    await testKiwoomConnection();
  });

  // 실시간 가격 토글
  if (toggleLive) {
    toggleLive.addEventListener('change', (e) => {
      if (e.target.checked) {
        startLivePriceFeed();
      } else {
        stopLivePriceFeed();
      }
    });
  }

  // 저장된 API 키가 있으면 자동 연결 시도
  try {
    const savedKey = localStorage.getItem('kiwoom_app_key');
    if (savedKey) {
      document.getElementById('input-app-key').value = savedKey;
    }
    const savedSecret = localStorage.getItem('kiwoom_secret_key');
    if (savedSecret) {
      document.getElementById('input-secret-key').value = savedSecret;
    }
  } catch(e) {}

  // 앱 시작 시 자동으로 프록시 서버 연결 확인 (조용히)
  silentConnectionCheck();
}

/**
 * 프록시 서버 조용히 연결 확인 (앱 시작 시)
 */
async function silentConnectionCheck() {
  try {
    const res = await fetch(`${KiwoomState.PROXY_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      KiwoomState.isConnected = true;
      KiwoomState.mode = data.has_credentials ? 'real' : 'mock';
      updateKiwoomStatusUI();
    }
  } catch (e) {
    // 서버 미실행 상태 - 조용히 무시
    KiwoomState.isConnected = false;
    KiwoomState.mode = 'disconnected';
  }
}

/**
 * 연결 테스트 (버튼 클릭 시)
 */
async function testKiwoomConnection() {
  const btnTest = document.getElementById('btn-test-connect');
  const pulseDot = document.getElementById('kiwoom-pulse-dot');
  const statusTitle = document.getElementById('kiwoom-status-title');
  const statusDesc = document.getElementById('kiwoom-status-desc');
  const modeBadge = document.getElementById('kiwoom-mode-badge');
  const toggleLive = document.getElementById('toggle-live-price');
  const liveToggleDesc = document.getElementById('live-toggle-desc');

  // UI: 연결 중 상태
  if (btnTest) {
    btnTest.disabled = true;
    btnTest.textContent = '🔄 확인 중...';
  }
  if (pulseDot) pulseDot.className = 'status-pulse-dot connecting';
  if (statusTitle) statusTitle.textContent = '서버에 연결 중...';

  // API 키 입력값 저장
  const inputAppKey = document.getElementById('input-app-key');
  const inputSecretKey = document.getElementById('input-secret-key');
  if (inputAppKey && inputAppKey.value.trim()) {
    try { localStorage.setItem('kiwoom_app_key', inputAppKey.value.trim()); } catch(e) {}
  }
  if (inputSecretKey && inputSecretKey.value.trim()) {
    try { localStorage.setItem('kiwoom_secret_key', inputSecretKey.value.trim()); } catch(e) {}
  }

  try {
    const res = await fetch(`${KiwoomState.PROXY_URL}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    KiwoomState.isConnected = true;
    KiwoomState.mode = data.has_credentials ? 'real' : 'mock';

    // 성공 UI 업데이트
    if (pulseDot) pulseDot.className = `status-pulse-dot ${KiwoomState.mode === 'real' ? 'connected-real' : 'connected-mock'}`;
    if (statusTitle) statusTitle.textContent = KiwoomState.mode === 'real' ? '🟢 실전 연동 준비 완료' : '🟡 Mock 모드로 연결됨';
    if (statusDesc) statusDesc.textContent = KiwoomState.mode === 'real'
      ? '키움 REST API 키 확인됨 - 실시간 가격 수신 가능'
      : '.env에서 KIWOOM_MODE=real 로 변경 시 실제 주가 수신';
    if (modeBadge) modeBadge.textContent = `서버 모드: ${data.mode} | ${data.server_time ? new Date(data.server_time).toLocaleTimeString('ko-KR') : ''}`;

    // 실시간 토글 활성화
    if (toggleLive) {
      toggleLive.disabled = false;
      if (liveToggleDesc) liveToggleDesc.textContent = '토글을 켜면 실시간 가격이 업데이트됩니다';
    }

    updateKiwoomStatusUI();
    showToast(`✅ 프록시 서버 연결 성공! (${KiwoomState.mode === 'real' ? '실전 모드' : 'Mock 모드'})`);

  } catch (err) {
    KiwoomState.isConnected = false;
    KiwoomState.mode = 'disconnected';

    if (pulseDot) pulseDot.className = 'status-pulse-dot error';
    if (statusTitle) statusTitle.textContent = '❌ 연결 실패';
    if (statusDesc) statusDesc.textContent = `서버를 시작해주세요: node server.js (${err.message})`;
    if (modeBadge) modeBadge.textContent = '서버가 실행 중이 아닙니다';
    if (toggleLive) toggleLive.disabled = true;
    if (liveToggleDesc) liveToggleDesc.textContent = '서버 연결 후 활성화됩니다';

    updateKiwoomStatusUI();
    showToast('⚠️ 프록시 서버에 연결할 수 없습니다. node server.js 를 먼저 실행하세요.');
  } finally {
    if (btnTest) {
      btnTest.disabled = false;
      btnTest.textContent = '🔄 연결 테스트';
    }
  }
}

/**
 * 헤더 상태 버튼 UI 업데이트
 */
function updateKiwoomStatusUI() {
  const btnStatus = document.getElementById('btn-kiwoom-status');
  const label = btnStatus ? btnStatus.querySelector('.kiwoom-status-label') : null;

  if (!btnStatus) return;

  btnStatus.className = 'btn-kiwoom-status';

  if (KiwoomState.mode === 'real') {
    btnStatus.classList.add('connected-real');
    if (label) label.textContent = KiwoomState.isLiveEnabled ? '🔴 LIVE' : '실전 연동';
  } else if (KiwoomState.mode === 'mock') {
    btnStatus.classList.add('connected-mock');
    if (label) label.textContent = KiwoomState.isLiveEnabled ? '🟡 LIVE' : 'Mock 연동';
  } else {
    btnStatus.classList.add('disconnected');
    if (label) label.textContent = '미연결';
  }
}

/**
 * 실시간 가격 피드 시작
 * 프록시 서버로부터 일정 간격으로 현재가를 받아 STOCKS_DATA 업데이트
 */
function startLivePriceFeed() {
  if (KiwoomState.liveIntervalId) return; // 이미 실행 중

  KiwoomState.isLiveEnabled = true;
  updateKiwoomStatusUI();

  // 랭킹 탭 헤더에 LIVE 뱃지 추가
  const rankingTitle = document.querySelector('.ranking-main-title');
  if (rankingTitle && !rankingTitle.querySelector('.live-badge')) {
    const badge = document.createElement('span');
    badge.className = 'live-badge';
    badge.textContent = 'LIVE';
    badge.style.marginLeft = '8px';
    badge.style.verticalAlign = 'middle';
    rankingTitle.appendChild(badge);
  }

  // 기존 시뮬레이션 일시정지
  stopSimulation();

  // 실시간 피드 시작 (3초 간격)
  fetchAndUpdatePrices(); // 즉시 1회 실행
  KiwoomState.liveIntervalId = setInterval(fetchAndUpdatePrices, 3000);

  showToast('🔴 실시간 가격 연동이 시작되었습니다!');
}

/**
 * 실시간 가격 피드 중지
 */
function stopLivePriceFeed() {
  if (KiwoomState.liveIntervalId) {
    clearInterval(KiwoomState.liveIntervalId);
    KiwoomState.liveIntervalId = null;
  }

  KiwoomState.isLiveEnabled = false;
  updateKiwoomStatusUI();

  // LIVE 뱃지 제거
  const badge = document.querySelector('.ranking-main-title .live-badge');
  if (badge) badge.remove();

  // 기존 시뮬레이션 재개
  if (!isSimulationPaused) startSimulation();

  showToast('⏹️ 실시간 연동이 중지되었습니다.');
}

/**
 * 프록시 서버에서 현재가 일괄 수신 후 STOCKS_DATA 업데이트
 */
async function fetchAndUpdatePrices() {
  // 현재 보이는 종목 코드 추출 (최대 30개 - 화면에 보이는 것 위주)
  const codes = STOCKS_DATA.slice(0, 30).map(s => s.ticker);

  try {
    const res = await fetch(`${KiwoomState.PROXY_URL}/api/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // STOCKS_DATA 업데이트
    STOCKS_DATA.forEach(stock => {
      const priceData = data.results[stock.ticker];
      if (priceData && priceData.price) {
        const oldPrice = stock.price;
        const newPrice = priceData.price;

        if (oldPrice !== newPrice) {
          const change = newPrice - oldPrice;
          stock.price = newPrice;
          // 시가총액도 업데이트 (shares * price)
          if (stock.shares) {
            stock.marketCap = Math.round(stock.shares * newPrice);
          }

          // DOM 업데이트 - 해당 행의 가격 셀 깜빡임
          flashPriceCell(stock.ticker, change > 0 ? 'up' : 'down');
        }
      }
    });

    // 랭킹 다시 정렬 및 렌더링
    STOCKS_DATA.sort((a, b) => b.marketCap - a.marketCap);
    const rankingTab = document.getElementById('ranking-tab');
    if (rankingTab && rankingTab.classList.contains('active')) {
      renderRankingList();
    }

    // 선택된 주식 가격도 업데이트
    if (selectedStock) {
      const priceData = data.results[selectedStock.ticker];
      if (priceData && priceData.price) {
        selectedStock.price = priceData.price;
        document.getElementById('display-price').textContent = priceData.price.toLocaleString();
        calculateAndRender();
      }
    }

  } catch (err) {
    console.warn('[Kiwoom Live] 가격 수신 실패:', err.message);
    // 연결 실패 시 자동으로 피드 중지
    if (err.name === 'TimeoutError' || err.message.includes('Failed to fetch')) {
      const toggleLive = document.getElementById('toggle-live-price');
      if (toggleLive) toggleLive.checked = false;
      stopLivePriceFeed();
      KiwoomState.isConnected = false;
      KiwoomState.mode = 'disconnected';
      updateKiwoomStatusUI();
      showToast('⚠️ 서버 연결이 끊어졌습니다. 시뮬레이션 모드로 전환합니다.');
    }
  }
}

/**
 * 가격 셀 깜빡임 효과 적용
 */
function flashPriceCell(ticker, direction) {
  // rank-list-body에서 해당 ticker 행 찾기
  const rows = document.querySelectorAll('[data-ticker]');
  rows.forEach(row => {
    if (row.dataset.ticker === ticker) {
      const priceEl = row.querySelector('.rl-change');
      if (priceEl) {
        const flashClass = direction === 'up' ? 'rank-price-flash-up' : 'rank-price-flash-down';
        priceEl.classList.remove('rank-price-flash-up', 'rank-price-flash-down');
        void priceEl.offsetWidth;
        priceEl.classList.add(flashClass);
        setTimeout(() => priceEl.classList.remove(flashClass), 600);
      }
    }
  });
}

/**
 * 클립보드 복사 헬퍼 (모달 버튼에서 onclick으로 사용)
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 명령어가 복사되었습니다!');
  }).catch(() => {
    // Fallback for older browsers
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('📋 명령어가 복사되었습니다!');
  });
}
