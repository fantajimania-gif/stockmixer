/**
 * Stock Mixer - Kiwoom REST API 프록시 서버
 * 
 * 역할: 브라우저의 CORS 제한을 우회하여 키움증권 REST API를 호출합니다.
 * 실행: node server.js
 * 접속: http://localhost:3000
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const MODE = process.env.KIWOOM_MODE || 'mock';
const KIWOOM_BASE_URL = process.env.KIWOOM_BASE_URL || 'https://api.kiwoom.com';
const APP_KEY = process.env.KIWOOM_APP_KEY || '';
const SECRET_KEY = process.env.KIWOOM_SECRET_KEY || '';

// -------------------------------------------------------
// 미들웨어 설정
// -------------------------------------------------------
app.use(cors({ origin: '*' })); // 브라우저에서의 요청 허용
app.use(express.json());

// -------------------------------------------------------
// 토큰 캐시 (메모리)
// -------------------------------------------------------
let cachedToken = null;
let tokenExpiresAt = 0;

// -------------------------------------------------------
// Mock 데이터 (실제 API 없이 동작하는 모드)
// -------------------------------------------------------

// 시가총액 Top 150 종목 기준가 (data.js와 동기화된 종목코드 → 기준 현재가)
const MOCK_BASE_PRICES = {
  '000660': 184000,  // SK하이닉스
  '005930': 65000,   // 삼성전자
  '402340': 247000,  // SK스퀘어
  '000270': 47000,   // 기아
  '051910': 235000,  // LG화학
  '005935': 49000,   // 삼성전자우
  '035420': 195000,  // NAVER
  '005380': 205000,  // 현대차
  '207940': 720000,  // 삼성바이오로직스
  '006400': 185000,  // 삼성SDI
  '028260': 150000,  // 삼성물산
  '012330': 235000,  // 현대모비스
  '003670': 42000,   // 포스코퓨처엠
  '105560': 48000,   // KB금융
  '055550': 46000,   // 신한지주
  '373220': 95000,   // LG에너지솔루션
  '009150': 34000,   // 삼성전기
  '003550': 68000,   // LG
  '032830': 89000,   // 삼성생명
  '000810': 225000,  // 삼성화재
  '011200': 95000,   // HMM
  '066570': 75000,   // LG전자
  '017670': 42000,   // SK텔레콤
  '030200': 35000,   // KT
  '316140': 18500,   // 우리금융지주
  '086790': 78000,   // 하나금융지주
  '010130': 85000,   // 고려아연
  '096770': 178000,  // SK이노베이션
  '000100': 15000,   // 유한양행
  '003490': 23000,   // 대한항공
  '034020': 17000,   // 두산에너빌리티
  '033780': 157000,  // KT&G
  '035720': 40000,   // 카카오
  '015760': 17000,   // 한국전력
  '047050': 53000,   // 포스코인터내셔널
  '006360': 175000,  // GS건설
  '009830': 34000,   // 한화솔루션
  '090430': 75000,   // 아모레퍼시픽
  '034730': 185000,  // SK
  '000720': 195000,  // 현대건설
};

// Mock 가격 변동 상태 (서버 메모리에 유지)
const mockPriceState = {};

function getMockPrice(code) {
  const base = MOCK_BASE_PRICES[code] || 50000;
  if (!mockPriceState[code]) {
    mockPriceState[code] = { price: base, trend: 0 };
  }
  const state = mockPriceState[code];
  
  // 트렌드 기반 랜덤 워크
  const trendChange = (Math.random() - 0.5) * 0.1;
  state.trend = Math.max(-2, Math.min(2, state.trend + trendChange));
  const changePct = (Math.random() - 0.48) * 0.8 + state.trend * 0.1;
  const tick = Math.ceil(base * 0.001); // 호가단위
  const rawChange = Math.round((base * changePct) / 100 / tick) * tick;
  
  state.price = Math.max(Math.round(base * 0.3), state.price + rawChange);
  const changeFromBase = ((state.price - base) / base * 100).toFixed(2);
  
  return {
    code,
    price: state.price,
    change: rawChange,
    change_pct: parseFloat(changeFromBase),
    volume: Math.floor(Math.random() * 1000000) + 100000,
    is_mock: true
  };
}

// -------------------------------------------------------
// 키움 REST API 헬퍼 함수
// -------------------------------------------------------

async function getAccessToken() {
  // 캐시된 토큰 유효성 체크 (만료 5분 전에 갱신)
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const response = await axios.post(`${KIWOOM_BASE_URL}/oauth2/token`, {
    grant_type: 'client_credentials',
    appkey: APP_KEY,
    secretkey: SECRET_KEY
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });

  const data = response.data;
  if (!data.token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));

  cachedToken = data.token;
  // 키움 토큰 유효기간: 24시간
  tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  console.log('[Kiwoom] 토큰 발급 성공');
  return cachedToken;
}

async function fetchKiwoomPrice(code) {
  const token = await getAccessToken();

  // 주식 현재가 조회 (TR: ka10001)
  const response = await axios.post(`${KIWOOM_BASE_URL}/api/dostk/stkinfo`, {
    stk_cd: code
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'api-id': 'ka10001'
    },
    timeout: 10000
  });

  const d = response.data;
  const price = parseInt((d.cur_prc || '0').replace(/[^0-9-]/g, ''), 10);
  const change = parseInt((d.prdy_vrss || '0').replace(/[^0-9-]/g, ''), 10);
  const changePct = parseFloat((d.prdy_ctrt || '0').replace(/[^0-9.-]/g, ''));

  return {
    code,
    name: d.hts_kor_isnm || '',
    price: Math.abs(price),
    change,
    change_pct: changePct,
    volume: parseInt((d.acml_vol || '0').replace(/[^0-9]/g, ''), 10),
    market_cap: parseInt((d.hts_avls || '0').replace(/[^0-9]/g, ''), 10),
    is_mock: false
  };
}

// -------------------------------------------------------
// API 라우트
// -------------------------------------------------------

/**
 * GET /api/health
 * 서버 및 연동 상태 확인
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: MODE,
    has_credentials: !!(APP_KEY && SECRET_KEY && APP_KEY !== '여기에_앱키_입력'),
    server_time: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * POST /api/auth
 * 키움 API 토큰 발급 테스트
 */
app.post('/api/auth', async (req, res) => {
  if (MODE === 'mock') {
    return res.json({ success: true, mode: 'mock', message: 'Mock 모드: 인증 생략' });
  }
  try {
    const token = await getAccessToken();
    res.json({ success: true, mode: 'real', token_preview: token.slice(0, 20) + '...' });
  } catch (err) {
    console.error('[Auth Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/price/:code
 * 단일 종목 현재가 조회
 * ?code=005930
 */
app.get('/api/price/:code', async (req, res) => {
  const code = req.params.code;
  
  if (MODE === 'mock' || !APP_KEY || APP_KEY === '여기에_앱키_입력') {
    return res.json(getMockPrice(code));
  }
  
  try {
    const data = await fetchKiwoomPrice(code);
    res.json(data);
  } catch (err) {
    console.error(`[Price Error] ${code}:`, err.message);
    // 실패 시 Mock 데이터로 폴백
    res.json({ ...getMockPrice(code), is_mock: true, error: err.message });
  }
});

/**
 * POST /api/prices
 * 복수 종목 현재가 일괄 조회
 * body: { codes: ["005930", "000660", ...] }
 */
app.post('/api/prices', async (req, res) => {
  const codes = req.body.codes || [];
  if (!Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: 'codes 배열이 필요합니다.' });
  }

  // Mock 모드 또는 키 미설정
  if (MODE === 'mock' || !APP_KEY || APP_KEY === '여기에_앱키_입력') {
    const results = {};
    codes.forEach(code => { results[code] = getMockPrice(code); });
    return res.json({ results, mode: 'mock' });
  }

  // 실전 모드: 순차적으로 조회 (키움 API 초당 요청 제한 고려)
  const results = {};
  const delay = ms => new Promise(r => setTimeout(r, ms));
  
  for (const code of codes) {
    try {
      results[code] = await fetchKiwoomPrice(code);
      await delay(100); // 100ms 간격 (초당 최대 10건)
    } catch (err) {
      results[code] = { ...getMockPrice(code), is_mock: true, error: err.message };
    }
  }
  
  res.json({ results, mode: 'real' });
});

// -------------------------------------------------------
// 서버 시작
// -------------------------------------------------------
app.listen(PORT, () => {
  console.log('');
  console.log('🧪 ==========================================');
  console.log('   Stock Mixer - Kiwoom 프록시 서버 시작!');
  console.log('==========================================');
  console.log(`📡 주소: http://localhost:${PORT}`);
  console.log(`🔧 모드: ${MODE === 'mock' ? '🎭 Mock 모드 (시뮬레이션)' : '🟢 실전 모드 (키움 실시간)'}`);
  if (MODE !== 'mock' && APP_KEY && APP_KEY !== '여기에_앱키_입력') {
    console.log(`🔑 앱키: ${APP_KEY.slice(0, 8)}...`);
  } else if (MODE !== 'mock') {
    console.log('⚠️  경고: .env 파일에 KIWOOM_APP_KEY/KIWOOM_SECRET_KEY를 설정해주세요');
    console.log('   설정 전까지는 Mock 모드로 동작합니다.');
  }
  console.log('==========================================');
  console.log('');
  console.log('📌 사용 가능한 엔드포인트:');
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   POST http://localhost:${PORT}/api/auth`);
  console.log(`   GET  http://localhost:${PORT}/api/price/:종목코드`);
  console.log(`   POST http://localhost:${PORT}/api/prices`);
  console.log('');
  console.log('💡 Stock Mixer 앱을 열어 우측 상단 연동 버튼을 클릭하세요!');
  console.log('==========================================');
  console.log('');
});
