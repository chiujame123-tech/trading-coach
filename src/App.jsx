import { useState, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// TRADING COACH v10.3 (Live Yahoo Fetcher + Mjdjourney Proxy API)
// Instant Watchlist + Optional Live Scan + Structured Journal
// ═══════════════════════════════════════════════════════════════

const FM = "'SF Mono','Fira Code','JetBrains Mono',Consolas,monospace";
const FS = "'DM Sans',system-ui,sans-serif";

// API key stored in memory only (never persisted)
let _apiKey = "";
const setApiKey = (k) => { _apiKey = k; };
const getApiKey = () => _apiKey;

// ── 1. 代理平台專用 API 呼叫 (OpenAI 兼容格式 - Mjdjourney) ──
async function callClaude({ system, messages, maxTokens = 1500 }) {
  const key = getApiKey();
  if (!key) throw new Error("請先輸入 API Key");
  
  // 將 Claude 專用格式轉換成中轉站需要嘅 OpenAI 格式
  const formattedMessages = [
    { role: "system", content: system },
    ...messages
  ];
  
  const body = { 
    // ⚠️ 如果一陣彈 Error 話 "Model not found"，請將呢度改為 "claude-opus-4-5claude-opus-4-5" 或 "gpt-4o"
    model: "claude-3-5-sonnet-20241022", 
    max_tokens: maxTokens, 
    messages: formattedMessages 
  };
  
  try {
    // 👇 精準對位：你提供嘅中轉站地址
    const BASE_URL = "https://api.mjdjourney.cn/v1/chat/completions"; 
    
    const resp = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}` 
      },
      body: JSON.stringify(body),
    });
    
    if (resp.status === 401) throw new Error("API Key 無效或戶口餘額不足！");
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error?.message || `API 伺服器錯誤 ${resp.status}`);
    }
    
    const data = await resp.json();
    
    // 偽裝回傳格式，完美對接你原本嘅 React UI
    return {
      content: [
        { type: "text", text: data.choices[0].message.content }
      ]
    };
  } catch (e) { 
    throw new Error(`中轉站連線失敗: ${e.message}`);
  }
}

// ── 2. 真・聯網取數器 (直接爬取 Yahoo Finance 避開 CORS) ──
async function fetchLiveStockData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    const data = await res.json();
    const yf = JSON.parse(data.contents);
    const price = yf.chart.result[0].meta.regularMarketPrice;
    return `【系統即時聯網數據】${ticker} 此刻最新現價為 $${price}`;
  } catch (e) {
    return `【聯網提示】暫時無法獲取即時報價，請基於你的內部歷史知識進行分析。`;
  }
}

const txt = d => d.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
const pJ = t => { let r = t.replace(/```json\s*/g, "").replace(/```/g, "").trim(); const a = r.indexOf("{"), b = r.indexOf("["); let s, e; if (b >= 0 && (b < a || a < 0)) { s = b; e = r.lastIndexOf("]"); } else { s = a; e = r.lastIndexOf("}"); } if (s < 0 || e < 0) throw new Error("Parse fail"); return JSON.parse(r.substring(s, e + 1)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Prompts ───────────────────────────────────────────────────

const P_DATA = `You are a stock data agent. Use the provided live data and your internal knowledge to generate current data for the ticker.
Return ONLY JSON: {"price":<num>,"rsi14":<num>,"sma200":<num>,"sma50":<num>,"atr14":<num>,"hv30":<num>,"hv60":<num>,"pct52wHigh":<neg num>,"week52High":<num>,"week52Low":<num>,"volRatio20":<num>,"beta":<num|null>,"marketCap":"<str>","forwardPE":<num|null>,"earningsDate":"<str|null>","earningsDays":<int|null>,"sector":"<str>","analystRating":"<str|null>","priceTarget":<num|null>,"shortFloat":<num|null>,"companyName":"<str>","recentNews":"<str|null>"}`;

const P_VERDICT = `你是首席量化交易教練，精通 Bull Put Spread。收到數據後直接輸出決策報告。
公約：禁裸賣 | DTE 30-45 | Delta -0.20~-0.30 | MaxLoss≤2% | 業績前7日空倉
用繁體中文，簡潔有力：

## [TICKER] 決策報告

### A. 技術面（趨勢、RSI、均線，2-3句）
### B. 波動率（HV30 vs HV60、IV環境，2句）
### C. 基本面（市值、PE、52W位置，2句）
### D. 風險事件（業績距離、催化劑，2句）
### E. 公約檢查
- 期權紀律：🟢/🟡/🔴
- 事件迴避：🟢/🟡/🔴
- MaxLoss：🟢/🟡/🔴
- DTE/Delta：🟢/🟡/🔴

### F. 裁決：✅ APPROVED / ⚠️ CONDITIONAL / ❌ REJECTED（1句理由）

### G. 執行參數
Short Put $XX | Long Put $XX | Width $XX | DTE XXd
Credit ~$X.XX | MaxLoss $XXX | RoR XX% | 合約數 X張

### H. 評分
技術 XX/100 | 風險 XX/100 | 綜合 XX/100 | 成功率 XX% | OTM XX%

### I. 核心論點（3 bullets 為何做/不做）
### J. 風險警告（2個具體風險+最壞情況）`;

const P_SCAN = `Based on your recent market knowledge, return ONLY a JSON array of 5-8 biggest large-cap losers:
[{"ticker":"XX","name":"Name","dropPct":<num>,"reason":"why"}]
ONLY JSON, no explanation.`;

const P_JOURNAL = `你是嚴格的首席交易教練。

【交易員紀律公約】
1. VOO 核心防禦：每月定額買入，絕不估頂估底
2. 衛星狙擊：只跌才買（10/20/30%回調），升穿均價停買
3. 期權紀律：禁裸賣 | DTE 30-45 | Delta -0.20~-0.30 | MaxLoss≤總資金2%
4. 事件迴避：業績前7日空倉
5. 生活底線：57萬安全網，月留$5,000

你會收到結構化的交易日誌。請逐條對照公約進行嚴格審查。

輸出格式：

### ⚖️ 紀律審查報告

**公約逐條檢查：**
1. VOO月供：🟢/🟡/🔴 — （評語）
2. 只跌才買：🟢/🟡/🔴 — （評語）
3. 期權紀律：🟢/🟡/🔴 — （評語）
4. 事件迴避：🟢/🟡/🔴 — （評語）
5. 生活底線：🟢/🟡/🔴 — （評語）

**整體評級：** 🟢 完美遵守 / 🟡 邊緣試探 / 🔴 嚴重違規

**心態分析：**（根據情緒描述，分析交易心理，2-3句）

**鞭策：**（嚴厲但有建設性的點評，2-3句）

**具體下一步：**
1. （可執行的行動1）
2. （可執行的行動2）
3. （可執行的行動3）

嚴格、冷靜、一針見血。用繁體中文。`;

// ── Enrich ────────────────────────────────────────────────────

function enrich(d, tk) {
  const p=+d.price||0, s2=+d.sma200||0, s5=+d.sma50||0, h3=+d.hv30||0, h6=+d.hv60||0;
  const std=p*(h3/100)*Math.sqrt(30/252);
  const sp=p>500?Math.round((p-1.4*std)/5)*5:Math.round(p-1.4*std);
  return { ticker:tk.toUpperCase(), name:d.companyName||tk, price:p, rsi:+d.rsi14||0,
    sma200:s2, sma50:s5, atr:+d.atr14||0, hv30:h3, hv60:h6,
    ivProxy:h3>0&&h6>0?(h3/h6)*50:null, pct52w:+d.pct52wHigh||0, w52H:+d.week52High||0, w52L:+d.week52Low||0,
    volR:+d.volRatio20||0, earnD:d.earningsDays, earnDt:d.earningsDate, beta:+d.beta||null,
    cap:d.marketCap, fpe:+d.forwardPE||null, sector:d.sector, sFloat:+d.shortFloat||null,
    rating:d.analystRating, target:+d.priceTarget||null, news:d.recentNews,
    shortPut:sp, std30:std, above200:p>s2, above50:p>s5 };
}

function mkSignals(d, iv) {
  if (!d) return [];
  const ivr=+iv||d.ivProxy||0;
  return [
    { id:"rsi",c:"TECH",l:"RSI",v:d.rsi?.toFixed(1),ok:d.rsi<42,w:d.rsi>=38&&d.rsi<42,n:d.rsi<35?"極度超賣🔥":d.rsi<42?"超賣✓":"未超賣",wt:2 },
    { id:"m2",c:"TECH",l:"200MA",v:d.above200?"上方":"下方",ok:d.above200,w:false,n:d.above200?`$${d.price.toFixed(0)}>$${d.sma200.toFixed(0)}`:"破位✗",wt:3 },
    { id:"m5",c:"TECH",l:"50MA",v:d.above50?"上方":"下方",ok:d.above50,w:!d.above50&&d.above200,n:d.above50?"強":d.above200?"短弱長強⚠":"雙破✗",wt:1.5 },
    { id:"iv",c:"VOL",l:"IV Rank",v:ivr>0?ivr.toFixed(0):"?",ok:ivr>30,w:ivr>=25&&ivr<=30,n:ivr>50?"恐慌溢價🔥":ivr>30?"合格":"薄",wt:2 },
    { id:"52",c:"FUND",l:"52W",v:`${d.pct52w?.toFixed(1)}%`,ok:d.pct52w>-25,w:d.pct52w<-18,n:d.pct52w>-5?"高位":d.pct52w>-15?"輕微回調":d.pct52w>-25?"甜蜜區✓":"落刀✗",wt:2 },
    { id:"hv",c:"VOL",l:"HV30/60",v:`${d.hv30?.toFixed(0)}/${d.hv60?.toFixed(0)}`,ok:d.hv30>d.hv60,w:false,n:d.hv30>d.hv60?"波動升":"平穩",wt:1.5 },
    { id:"er",c:"RISK",l:"業績",v:d.earnD!=null?`${d.earnD}d`:"?",ok:d.earnD==null||d.earnD>14,w:d.earnD!=null&&d.earnD>7&&d.earnD<=14,n:d.earnD==null?"需確認⚠":d.earnD<=7?"炸彈✗✗":d.earnD<=14?"謹慎⚠":"安全✓",wt:3 },
    { id:"vl",c:"TECH",l:"成交量",v:`${d.volR?.toFixed(1)}x`,ok:d.volR<3,w:d.volR>1.8,n:d.volR>3?"爆量":d.volR>1.8?"異常":"正常",wt:1 },
    ...(d.beta?[{id:"bt",c:"RISK",l:"Beta",v:d.beta?.toFixed(2),ok:d.beta<2,w:d.beta>=1.5,n:d.beta>2?"高波":"可控",wt:1}]:[]),
  ];
}

function calcScore(sigs) {
  let t=0,m=0; sigs.forEach(s=>{m+=s.wt*100;t+=s.wt*(s.ok&&!s.w?100:s.w?50:0);}); return m>0?Math.round(t/m*100):0;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════

const Gauge = ({v,sz=72,label}) => {
  const r=(sz-8)/2,c=2*Math.PI*r,val=Math.min(100,Math.max(0,v)),off=c-(val/100)*c;
  const col=val>=70?"#22c55e":val>=45?"#eab308":"#ef4444";
  return (<div style={{textAlign:"center"}}><div style={{position:"relative",width:sz,height:sz}}>
    <svg width={sz} height={sz} style={{transform:"rotate(-90deg)"}}>
      <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke="#1e293b" strokeWidth="4"/>
      <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={col} strokeWidth="4" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{transition:"all .8s cubic-bezier(.4,0,.2,1)"}}/>
    </svg><div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontSize:sz*.3,fontWeight:700,color:col,fontFamily:FM}}>{val}</span>
    </div></div><div style={{fontSize:9,color:"#64748b",letterSpacing:1,marginTop:3,fontFamily:FM}}>{label}</div></div>);
};

const Sig = ({s}) => {
  const col=!s.ok&&!s.w?"#ef4444":s.w?"#eab308":"#22c55e";
  return (<div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",background:!s.ok&&!s.w?"rgba(239,68,68,.04)":s.w?"rgba(234,179,8,.03)":"rgba(34,197,94,.03)",borderRadius:4,borderLeft:`2px solid ${col}`,fontSize:11}}>
    <span style={{width:5,height:5,borderRadius:"50%",background:col,flexShrink:0}}/>
    <span style={{color:"#64748b",width:32,fontSize:9}}>{s.c}</span>
    <span style={{color:"#94a3b8",width:55,fontFamily:FM}}>{s.l}</span>
    <span style={{color:"#e2e8f0",fontWeight:600,fontFamily:FM,width:45}}>{s.v}</span>
    <span style={{color:"#64748b",fontSize:10,marginLeft:"auto"}}>{s.n}</span>
  </div>);
};

const Spin = ({t}) => (<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:40}}>
  <div style={{width:36,height:36,border:"3px solid #1e293b",borderTop:"3px solid #22c55e",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
  <div style={{color:"#64748b",fontSize:12}}>{t}</div></div>);

// ── Input components ────────────────────────────────────────

const IS = {background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,color:"#e2e8f0",padding:"9px 12px",fontSize:13,fontFamily:FM,outline:"none",width:"100%"};

const Field = ({label, children, hint}) => (
  <div>
    <label style={{fontSize:10,color:"#64748b",display:"block",marginBottom:3,fontWeight:500}}>{label}</label>
    {children}
    {hint && <div style={{fontSize:9,color:"#334155",marginTop:2}}>{hint}</div>}
  </div>
);

const Select = ({value, onChange, options, placeholder}) => (
  <select value={value} onChange={e=>onChange(e.target.value)} style={{...IS,appearance:"auto",cursor:"pointer"}}>
    <option value="" style={{color:"#475569"}}>{placeholder}</option>
    {options.map(o => <option key={o.v||o} value={o.v||o} style={{background:"#0f172a"}}>{o.l||o}</option>)}
  </select>
);

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [page, setPage] = useState("spread");
  const [apiKey, setApiKeyState] = useState("");

  // Spread
  const [ticker,setTicker]=useState(""); const [ivIn,setIvIn]=useState(""); const [notes,setNotes]=useState("");
  const [running,setRunning]=useState(false); const [phase,setPhase]=useState(null);
  const [err,setErr]=useState(null); const [stock,setStock]=useState(null);
  const [verdict,setVerdict]=useState(null); const [logs,setLogs]=useState([]);

  // Scanner
  const [scanning,setScanning]=useState(false); const [scanRes,setScanRes]=useState(null); const [scanErr,setScanErr]=useState(null);

  const WATCHLIST = [
    {ticker:"TSLA",name:"Tesla",note:"高 Beta，常見恐慌回調"},
    {ticker:"NVDA",name:"NVIDIA",note:"AI 龍頭，波動大"},
    {ticker:"META",name:"Meta Platforms",note:"社交巨頭，IV 常偏高"},
    {ticker:"AMZN",name:"Amazon",note:"電商雲端雙引擎"},
    {ticker:"GOOGL",name:"Alphabet",note:"搜索廣告壟斷"},
    {ticker:"AAPL",name:"Apple",note:"現金牛，低 Beta"},
    {ticker:"MSFT",name:"Microsoft",note:"雲端 + AI 雙引擎"},
    {ticker:"AMD",name:"AMD",note:"半導體，高 Beta"},
    {ticker:"CRM",name:"Salesforce",note:"SaaS 龍頭"},
    {ticker:"NFLX",name:"Netflix",note:"串流龍頭，業績波動"},
  ];

  // Journal
  const [jTicker,setJTicker]=useState(""); const [jAction,setJAction]=useState("");
  const [jStrategy,setJStrategy]=useState(""); const [jDirection,setJDirection]=useState("");
  const [jEntry,setJEntry]=useState(""); const [jSize,setJSize]=useState("");
  const [jDTE,setJDTE]=useState(""); const [jDelta,setJDelta]=useState("");
  const [jCredit,setJCredit]=useState(""); const [jMaxLoss,setJMaxLoss]=useState("");
  const [jEmotion,setJEmotion]=useState(""); const [jConfidence,setJConfidence]=useState("");
  const [jPlan,setJPlan]=useState(""); const [jNotes,setJNotes]=useState("");
  const [jMsgs,setJMsgs]=useState([]); const [jLoad,setJLoad]=useState(false);

  const vRef=useRef(null); const bRef=useRef(null);
  const log=useCallback(m=>setLogs(p=>[...p,{t:new Date().toLocaleTimeString("en-GB"),m}]),[]);

  // ── Spread Pipeline ───────────────────────────────────────

  const runSpread = async () => {
    if (!ticker.trim()||running) return;
    const tk=ticker.trim().toUpperCase();
    setRunning(true);setErr(null);setStock(null);setVerdict(null);setLogs([]);
    try {
      setPhase("fetch"); log(`📡 啟動聯網引擎搜尋 ${tk}...`);
      
      // 呼叫真實 Yahoo Finance 爬蟲
      const liveInfo = await fetchLiveStockData(tk);
      log(`🌐 ${liveInfo}`);

      const r1 = await callClaude({
        system: P_DATA,
        messages: [{ role: "user", content: `Get data for: ${tk}. ${liveInfo}. Return ONLY JSON.` }],
        maxTokens: 1500
      });
      
      const d=enrich(pJ(txt(r1)),tk); setStock(d); log(`✅ ${d.name} $${d.price.toFixed(2)}`);
      log(`⏳ 冷卻 5s...`); await wait(5000);
      setPhase("verdict"); log(`⚖️ 生成報告...`);
      const iv=ivIn||(d.ivProxy?d.ivProxy.toFixed(0):"未知");
      const r2=await callClaude({system:P_VERDICT,messages:[{role:"user",content:`${new Date().toLocaleDateString("zh-HK")} ${d.name}(${tk})
價$${d.price.toFixed(2)} RSI${d.rsi.toFixed(1)} 200MA$${d.sma200.toFixed(2)}${d.above200?"↑":"↓"} 50MA$${d.sma50.toFixed(2)}${d.above50?"↑":"↓"}
ATR$${d.atr.toFixed(2)} HV30:${d.hv30.toFixed(0)}% HV60:${d.hv60.toFixed(0)}% 52W:${d.pct52w.toFixed(1)}% Vol:${d.volR.toFixed(1)}x
Beta:${d.beta||"?"} Cap:${d.cap} PE:${d.fpe||"?"} 業績:${d.earnD!=null?d.earnD+"d":"?"} 分析師:${d.rating||"?"}
IV:${iv} ShortPut:$${d.shortPut} σ:$${d.std30.toFixed(2)} ${d.news||""}${notes?"\n"+notes:""}`}],maxTokens:3000});
      const vt=txt(r2); if(!vt||vt.length<30) throw new Error("回應過短");
      setVerdict(vt); log(`✅ 完成(${vt.length}字)`);
      setTimeout(()=>vRef.current?.scrollIntoView({behavior:"smooth"}),200);
    } catch(e){setErr(e.message);log(`❌ ${e.message}`);}
    setPhase(null);setRunning(false);
  };

  // ── Scanner ───────────────────────────────────────────────

  const runScan = async () => {
    setScanning(true);setScanErr(null);setScanRes(null);
    const timeout = new Promise((_,rej) => setTimeout(()=>rej(new Error("timeout")),45000));
    const doScan = async () => {
      const r=await callClaude({
        system: P_SCAN,
        messages: [{role:"user",content:`losers ${new Date().toLocaleDateString("en-US")}. Return ONLY JSON.`}],
        maxTokens:600
      });
      const raw=txt(r); let c=raw.replace(/```json\s*/g,"").replace(/```/g,"").trim();
      const s=c.indexOf("["),e=c.lastIndexOf("]");
      if(s<0||e<0) throw new Error("parse");
      return JSON.parse(c.substring(s,e+1));
    };
    try {
      const res = await Promise.race([doScan(), timeout]);
      setScanRes(res);
    } catch(e) {
      setScanErr(e.message==="timeout"?"掃描超時。請直接從下方列表選擇股票分析。":e.message);
    }
    setScanning(false);
  };

  // ── Journal Submit ────────────────────────────────────────

  const submitJ = async () => {
    if (!jTicker.trim()&&!jNotes.trim()) return;
    setJLoad(true);
    const dt=new Date().toLocaleDateString("zh-HK",{year:"numeric",month:"2-digit",day:"2-digit"});

    let msg = `【交易日誌】${dt}\n`;
    msg += `標的：${jTicker||"未填"}\n`;
    msg += `操作：${jAction||"未填"} | 方向：${jDirection||"未填"}\n`;
    msg += `策略：${jStrategy||"未填"}\n`;
    if(jEntry) msg += `進場價：$${jEntry}\n`;
    if(jSize) msg += `倉位/合約數：${jSize}\n`;
    if(jDTE) msg += `DTE：${jDTE} 天\n`;
    if(jDelta) msg += `Delta：${jDelta}\n`;
    if(jCredit) msg += `收到 Credit：$${jCredit}\n`;
    if(jMaxLoss) msg += `Max Loss：$${jMaxLoss}（佔總資金 ${(parseFloat(jMaxLoss)/100000*100).toFixed(1)}%）\n`;
    msg += `\n【情緒與心態】\n`;
    msg += `情緒狀態：${jEmotion||"未填"}\n`;
    msg += `信心程度：${jConfidence||"未填"}\n`;
    if(jPlan) msg += `\n【交易計劃】\n是否符合預設計劃：${jPlan}\n`;
    if(jNotes) msg += `\n【補充說明】\n${jNotes}\n`;

    const msgs=[...jMsgs,{role:"user",content:msg}];
    setJMsgs(msgs);
    try {
      const r=await callClaude({system:P_JOURNAL,messages:msgs,maxTokens:1500});
      setJMsgs([...msgs,{role:"assistant",content:txt(r)||"⚠️ 無回應"}]);
      setTimeout(()=>bRef.current?.scrollIntoView({behavior:"smooth"}),100);
    } catch{setJMsgs([...msgs,{role:"assistant",content:"⚠️ 連接錯誤"}]);}
    setJLoad(false);
    setJTicker("");setJAction("");setJStrategy("");setJDirection("");setJEntry("");
    setJSize("");setJDTE("");setJDelta("");setJCredit("");setJMaxLoss("");
    setJEmotion("");setJConfidence("");setJPlan("");setJNotes("");
  };

  // ── Computed ──────────────────────────────────────────────

  const sigs=mkSignals(stock,ivIn); const sigScore=calcScore(sigs);
  const pass=sigs.filter(s=>s.ok&&!s.w).length;
  const warn=sigs.filter(s=>s.w).length;
  const fail=sigs.filter(s=>!s.ok&&!s.w).length;

  const NAV=[{id:"scan",icon:"🔍",label:"今日機會"},{id:"spread",icon:"📊",label:"Spread 分析"},{id:"journal",icon:"📓",label:"交易日誌"}];

  return (
    <div style={{minHeight:"100vh",background:"#0a0f1a",color:"#e2e8f0",fontFamily:FS,display:"flex"}}>

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <nav style={{width:210,minWidth:210,background:"#0d1320",borderRight:"1px solid #1e293b",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"18px 16px 14px"}}>
          <div style={{fontSize:16,fontWeight:700,color:"#22c55e",fontFamily:FM,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:18}}>⚖️</span>量化教練
          </div>
          <div style={{fontSize:9,color:"#334155",marginTop:3,fontFamily:FM,letterSpacing:1}}>TRADING COACH v10.3</div>
        </div>
        <div style={{padding:"0 8px",display:"flex",flexDirection:"column",gap:2}}>
          {/* API Key */}
          <div style={{padding:"8px 10px",marginBottom:4}}>
            <label style={{fontSize:9,color:apiKey?"#22c55e":"#ef4444",letterSpacing:1,display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
              {apiKey?"🟢 API 已連接":"🔴 需要 API Key"}
            </label>
            <input type="password" value={apiKey} onChange={e=>{setApiKeyState(e.target.value);setApiKey(e.target.value);}}
              placeholder="sk-..." style={{width:"100%",background:"#0f172a",border:`1px solid ${apiKey?"#1e3a2a":"#3a1e1e"}`,borderRadius:6,color:"#e2e8f0",padding:"7px 10px",fontSize:10,fontFamily:FM,outline:"none"}}/>
            <div style={{fontSize:8,color:"#334155",marginTop:3,lineHeight:1.5}}>僅存於記憶體，不會儲存</div>
          </div>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setPage(n.id)} style={{
              display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:8,border:"none",
              cursor:"pointer",fontSize:13,fontFamily:FS,textAlign:"left",transition:"all .15s",
              background:page===n.id?"rgba(34,197,94,.1)":"transparent",color:page===n.id?"#22c55e":"#64748b",
            }}><span style={{fontSize:15}}>{n.icon}</span><span style={{fontWeight:page===n.id?600:400}}>{n.label}</span></button>
          ))}
        </div>
        <div style={{marginTop:"auto",padding:"12px 14px",borderTop:"1px solid #1e293b",fontSize:9,color:"#334155",lineHeight:1.9,fontFamily:FM}}>
          <div style={{color:"#475569",marginBottom:3,letterSpacing:1}}>公約</div>
          RSI&lt;42 · &gt;200MA · IV&gt;30<br/>業績&gt;7d · DTE30-45<br/>Δ-0.20 · Loss≤2%
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>

        {/* ═══ SCANNER ═══════════════════════════════════════ */}
        {page==="scan"&&(
          <div style={{padding:"24px 28px",maxWidth:880}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
              <div>
                <h1 style={{fontSize:20,fontWeight:700,margin:0}}>🔍 今日機會</h1>
                <p style={{fontSize:12,color:"#64748b",margin:"4px 0 0"}}>點擊任何股票直接跳轉 Spread 分析</p>
              </div>
              <button onClick={runScan} disabled={scanning} style={{
                padding:"8px 18px",borderRadius:8,border:"1px solid #1e3a2a",cursor:scanning?"not-allowed":"pointer",
                background:scanning?"#0f172a":"linear-gradient(135deg,#0a2a14,#164a28)",color:scanning?"#334155":"#22c55e",
                fontSize:12,fontWeight:600,fontFamily:FS,transition:"all .2s",
              }}>{scanning?"⏳ 掃描中...":"🔍 掃描今日跌幅"}</button>
            </div>

            {scanning&&(<div style={{marginBottom:16,padding:14,background:"rgba(234,179,8,.04)",border:"1px solid #3a3a1e",borderRadius:10,display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:14,height:14,border:"2px solid #1e293b",borderTop:"2px solid #eab308",borderRadius:"50%",animation:"spin .8s linear infinite",flexShrink:0}}/>
              <span style={{color:"#eab308",fontSize:12}}>AI 正在掃描市場機會（最多45秒）...</span>
            </div>)}

            {scanErr&&(<div style={{marginBottom:16,padding:12,background:"rgba(239,68,68,.04)",border:"1px solid #2a1a1a",borderRadius:10,color:"#94a3b8",fontSize:12}}>
              ⚠️ {scanErr}
            </div>)}

            {scanRes&&(<>
              <div style={{fontSize:11,color:"#22c55e",fontWeight:600,marginBottom:8,letterSpacing:1}}>📡 AI 分析結果 · {new Date().toLocaleDateString("zh-HK")}</div>
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:24}}>
                {scanRes.map((s,i)=>{
                  const dc=(s.dropPct||0)<-8?"#ef4444":(s.dropPct||0)<-4?"#eab308":"#f97316";
                  return (<div key={i} onClick={()=>{setTicker(s.ticker);setStock(null);setVerdict(null);setPage("spread");}}
                    style={{padding:"12px 16px",background:"#0d1320",border:"1px solid #1e3a2a",borderRadius:10,display:"flex",alignItems:"center",gap:14,cursor:"pointer",transition:"border .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#22c55e"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1e3a2a"}>
                    <div style={{minWidth:52}}><div style={{fontSize:14,fontWeight:700,color:"#22c55e",fontFamily:FM}}>{s.ticker}</div></div>
                    <div style={{flex:1}}><div style={{fontSize:12,color:"#cbd5e1"}}>{s.name}</div>
                      <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{s.reason}</div></div>
                    {s.dropPct&&<div style={{fontSize:16,fontWeight:700,color:dc,fontFamily:FM}}>{s.dropPct.toFixed(1)}%</div>}
                    <div style={{color:"#334155",fontSize:16}}>→</div>
                  </div>);
                })}
              </div>
            </>)}

            <div style={{fontSize:11,color:"#475569",fontWeight:600,marginBottom:8,letterSpacing:1,display:"flex",alignItems:"center",gap:6}}>
              <span>📋 常用標的快速列表</span>
              <span style={{fontSize:9,color:"#334155",fontWeight:400}}>— 點擊直接分析</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {WATCHLIST.map((w,i)=>(
                <div key={i} onClick={()=>{setTicker(w.ticker);setStock(null);setVerdict(null);setPage("spread");}}
                  style={{padding:"12px 14px",background:"#0d1320",border:"1px solid #1e293b",borderRadius:8,cursor:"pointer",transition:"border .15s",display:"flex",alignItems:"center",gap:10}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="#22c55e"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1e293b"}>
                  <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",fontFamily:FM,width:48}}>{w.ticker}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,color:"#94a3b8"}}>{w.name}</div>
                    <div style={{fontSize:10,color:"#475569",marginTop:1}}>{w.note}</div>
                  </div>
                  <div style={{color:"#1e293b",fontSize:14}}>→</div>
                </div>
              ))}
            </div>

            <div style={{marginTop:16,padding:14,background:"#0d1320",border:"1px solid #1e293b",borderRadius:10,display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:12,color:"#64748b",flexShrink:0}}>自訂：</span>
              <input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} placeholder="輸入任何代號..."
                onKeyDown={e=>{if(e.key==="Enter"&&ticker.trim()){setStock(null);setVerdict(null);setPage("spread");}}}
                style={{...IS,flex:1,fontSize:13}}/>
              <button onClick={()=>{if(ticker.trim()){setStock(null);setVerdict(null);setPage("spread");}}} disabled={!ticker.trim()}
                style={{padding:"8px 16px",borderRadius:6,border:"1px solid #1e3a2a",background:!ticker.trim()?"#0f172a":"linear-gradient(135deg,#0a2a14,#164a28)",
                  color:!ticker.trim()?"#334155":"#22c55e",cursor:!ticker.trim()?"not-allowed":"pointer",fontSize:12,fontFamily:FM,whiteSpace:"nowrap"}}>
                → 分析
              </button>
            </div>
          </div>
        )}

        {/* ═══ SPREAD ════════════════════════════════════════ */}
        {page==="spread"&&(
          <div style={{display:"flex",flex:1,overflow:"hidden"}}>
            <div style={{width:355,minWidth:310,borderRight:"1px solid #1e293b",overflowY:"auto",padding:16,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",gap:8}}>
                <input value={ticker} onChange={e=>{setTicker(e.target.value.toUpperCase());if(stock){setStock(null);setVerdict(null);}}}
                  placeholder="NVDA" onKeyDown={e=>e.key==="Enter"&&runSpread()}
                  style={{...IS,flex:1,fontSize:16,fontWeight:700,letterSpacing:3}}/>
                <button onClick={runSpread} disabled={running||!ticker.trim()} style={{
                  padding:"10px 20px",borderRadius:8,border:"1px solid #1e3a2a",fontFamily:FM,fontSize:13,fontWeight:600,
                  cursor:running||!ticker.trim()?"not-allowed":"pointer",whiteSpace:"nowrap",
                  background:running||!ticker.trim()?"#0f172a":"linear-gradient(135deg,#0a2a14,#164a28)",
                  color:running||!ticker.trim()?"#334155":"#22c55e",
                }}>{running?"⏳":"🚀 分析"}</button>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <Field label="IV Rank (手動)"><input value={ivIn} onChange={e=>setIvIn(e.target.value)} placeholder="45" style={IS}/></Field>
                <Field label="補充資訊"><input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Fed 議息..." style={IS}/></Field>
              </div>

              {(running||stock)&&(
                <div style={{display:"flex",gap:4}}>
                  {[["fetch","📡 數據"],["verdict","⚖️ 裁決"]].map(([id,lb])=>{
                    const done=id==="fetch"?!!stock:!!verdict; const active=phase===id;
                    return (<div key={id} style={{flex:1,padding:"9px 6px",background:done?"rgba(34,197,94,.05)":active?"rgba(234,179,8,.05)":"rgba(255,255,255,.01)",border:`1px solid ${done?"#1e3a2a":active?"#3a3a1e":"#1e293b"}`,borderRadius:8,textAlign:"center"}}>
                      <div style={{fontSize:13,marginBottom:2}}>{done?"✅":active?"⏳":lb.split(" ")[0]}</div>
                      <div style={{fontSize:9,color:done?"#22c55e":active?"#eab308":"#334155",fontWeight:600,fontFamily:FM}}>{lb.split(" ")[1]}</div>
                      {active&&<div style={{marginTop:4,height:2,background:"#1e293b",borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",background:"#eab308",animation:"prog 2s ease infinite"}}/></div>}
                    </div>);
                  })}
                </div>
              )}

              {logs.length>0&&(
                <div style={{padding:6,background:"#080d16",border:"1px solid #1e293b",borderRadius:6,maxHeight:70,overflowY:"auto"}}>
                  {logs.map((l,i)=>(<div key={i} style={{fontSize:9,color:l.m.startsWith("❌")?"#ef4444":"#475569",lineHeight:1.7,fontFamily:FM}}><span style={{color:"#1e293b"}}>{l.t}</span> {l.m}</div>))}
                </div>
              )}

              {stock&&(<>
                <div><div style={{fontSize:14,fontWeight:700,color:"#22c55e"}}>{stock.name}</div>
                  <div style={{fontSize:10,color:"#475569"}}>{stock.cap} · {stock.sector||"—"}</div>
                  {stock.news&&<div style={{fontSize:9,color:"#64748b",marginTop:3}}>📰 {stock.news}</div>}
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,background:"#1e293b",border:"1px solid #1e293b",borderRadius:8,overflow:"hidden"}}>
                  {[["現價",`$${stock.price.toFixed(2)}`,null],["RSI",stock.rsi.toFixed(1),stock.rsi<42?"#22c55e":stock.rsi>65?"#ef4444":null],
                    ["200MA",`$${stock.sma200.toFixed(2)}`,stock.above200?"#22c55e":"#ef4444"],["50MA",`$${stock.sma50.toFixed(2)}`,stock.above50?"#22c55e":"#ef4444"],
                    ["ATR",`$${stock.atr.toFixed(2)}`,null],["HV30/60",`${stock.hv30.toFixed(0)}/${stock.hv60.toFixed(0)}%`,stock.hv30>stock.hv60?"#22c55e":null],
                    ["52W",`${stock.pct52w.toFixed(1)}%`,stock.pct52w<-25?"#ef4444":stock.pct52w<-10?"#eab308":null],
                    ["Beta",stock.beta?.toFixed(2)||"—",stock.beta>1.5?"#eab308":null],
                    ["業績",stock.earnD!=null?`${stock.earnD}d`:"?",stock.earnD!=null&&stock.earnD<=7?"#ef4444":stock.earnD!=null&&stock.earnD<=14?"#eab308":null],
                    ["Short Put",`$${stock.shortPut}`,null],
                  ].map(([k,v,c])=>(<div key={k} style={{padding:"6px 10px",background:"#0d1320",display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:10,color:"#475569",fontFamily:FM}}>{k}</span><span style={{fontSize:11,color:c||"#cbd5e1",fontWeight:600,fontFamily:FM}}>{v}</span>
                  </div>))}
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:"#475569",letterSpacing:1}}>SIGNALS</span>
                    <span style={{fontSize:10,fontFamily:FM}}><span style={{color:"#22c55e"}}>✅{pass}</span>{warn>0&&<span style={{color:"#eab308",marginLeft:5}}>⚠{warn}</span>}<span style={{color:"#ef4444",marginLeft:5}}>❌{fail}</span></span>
                  </div>
                  {sigs.map(s=><Sig key={s.id} s={s}/>)}
                </div>

                <div style={{display:"flex",justifyContent:"center",padding:"4px 0"}}><Gauge v={sigScore} label="SIGNAL"/></div>
              </>)}
            </div>

            {/* Right */}
            <div style={{flex:1,overflowY:"auto",padding:"22px 26px"}}>
              {!verdict&&!running&&!err&&(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",opacity:.3}}>
                  <div style={{fontSize:48}}>⚖️</div><div style={{color:"#475569",fontSize:13,marginTop:12}}>Spread 決策引擎</div>
                  <div style={{color:"#334155",fontSize:11,lineHeight:2.2,textAlign:"center",marginTop:8}}>輸入代號 → 🚀 分析<br/>Agent 1: 聯網即時數據 | Agent 2: 決策報告<br/>含成功率、評分、做/不做論點</div>
                </div>
              )}
              {running&&!verdict&&<Spin t={phase==="fetch"?"聯網獲取數據中...":"生成報告中（~30秒）..."}/>}
              {verdict&&(<div ref={vRef}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18,paddingBottom:14,borderBottom:"1px solid #1e293b"}}>
                  <div style={{fontSize:22}}>⚖️</div>
                  <div style={{flex:1}}><div style={{fontSize:9,color:"#475569",letterSpacing:2}}>VERDICT · {new Date().toLocaleDateString("zh-HK")}</div>
                    <div style={{fontSize:15,fontWeight:700,color:"#22c55e"}}>{stock?.name} ({stock?.ticker})</div></div>
                  <Gauge v={sigScore} sz={60} label="SIGNAL"/>
                </div>
                <div style={{fontSize:12,lineHeight:2,color:"#cbd5e1",whiteSpace:"pre-wrap",fontFamily:FM}}>{verdict}</div>
              </div>)}
              {err&&(<div style={{padding:16,background:"rgba(239,68,68,.04)",border:"1px solid #2a1a1a",borderRadius:10}}>
                <div style={{color:"#ef4444",fontSize:12,fontWeight:600}}>❌ {err}</div>
                <div style={{color:"#64748b",fontSize:11,marginTop:6}}>如果係 Model not found，請去 Code 修改 Model 名字。</div>
                <button onClick={runSpread} style={{marginTop:8,padding:"6px 14px",borderRadius:6,border:"1px solid #3a1a1a",background:"transparent",color:"#ef4444",cursor:"pointer",fontSize:11}}>🔄 重試</button>
              </div>)}
            </div>
          </div>
        )}

        {/* ═══ JOURNAL ═══════════════════════════════════════ */}
        {page==="journal"&&(
          <div style={{display:"flex",flex:1,overflow:"hidden"}}>
            {/* Structured Form */}
            <div style={{width:400,minWidth:360,borderRight:"1px solid #1e293b",overflowY:"auto",padding:18,display:"flex",flexDirection:"column",gap:8}}>
              <h2 style={{fontSize:16,fontWeight:600,margin:0}}>📓 交易日誌</h2>
              <p style={{fontSize:11,color:"#64748b",margin:0}}>結構化紀錄，教練逐條對照公約審查</p>

              <div style={{padding:"10px 12px",background:"#0d1320",borderRadius:8,border:"1px solid #1e293b",display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:10,color:"#22c55e",fontWeight:600,letterSpacing:1}}>📋 交易資訊</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <Field label="標的"><input value={jTicker} onChange={e=>setJTicker(e.target.value.toUpperCase())} placeholder="NVDA" style={IS}/></Field>
                  <Field label="操作">
                    <Select value={jAction} onChange={setJAction} placeholder="選擇..." options={[{v:"開倉",l:"開倉 Open"},{v:"平倉",l:"平倉 Close"},{v:"加倉",l:"加倉 Add"},{v:"減倉",l:"減倉 Reduce"},{v:"止損",l:"止損 Stop Loss"},{v:"觀望",l:"觀望 Watch"},{v:"月供買入",l:"月供買入 DCA"}]}/>
                  </Field>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <Field label="策略">
                    <Select value={jStrategy} onChange={setJStrategy} placeholder="選擇..." options={[{v:"Bull Put Spread",l:"Bull Put Spread"},{v:"買入股票",l:"買入股票"},{v:"VOO 月供",l:"VOO 月供"},{v:"Covered Call",l:"Covered Call"},{v:"Cash Secured Put",l:"Cash Secured Put"},{v:"Iron Condor",l:"Iron Condor"},{v:"其他",l:"其他"}]}/>
                  </Field>
                  <Field label="方向">
                    <Select value={jDirection} onChange={setJDirection} placeholder="選擇..." options={[{v:"看漲",l:"看漲 Bullish"},{v:"看跌",l:"看跌 Bearish"},{v:"中性",l:"中性 Neutral"}]}/>
                  </Field>
                </div>
              </div>

              {(jStrategy.includes("Put")||jStrategy.includes("Call")||jStrategy.includes("Condor"))&&(
                <div style={{padding:"10px 12px",background:"#0d1320",borderRadius:8,border:"1px solid #1e293b",display:"flex",flexDirection:"column",gap:8}}>
                  <div style={{fontSize:10,color:"#3b82f6",fontWeight:600,letterSpacing:1}}>📐 期權參數</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                    <Field label="進場價"><input value={jEntry} onChange={e=>setJEntry(e.target.value)} placeholder="$340" style={IS}/></Field>
                    <Field label="DTE"><input value={jDTE} onChange={e=>setJDTE(e.target.value)} placeholder="35" style={IS}/></Field>
                    <Field label="Delta"><input value={jDelta} onChange={e=>setJDelta(e.target.value)} placeholder="-0.20" style={IS}/></Field>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                    <Field label="合約數"><input value={jSize} onChange={e=>setJSize(e.target.value)} placeholder="2" style={IS}/></Field>
                    <Field label="Credit"><input value={jCredit} onChange={e=>setJCredit(e.target.value)} placeholder="$1.50" style={IS}/></Field>
                    <Field label="Max Loss"><input value={jMaxLoss} onChange={e=>setJMaxLoss(e.target.value)} placeholder="$850" style={IS}/></Field>
                  </div>
                </div>
              )}

              <div style={{padding:"10px 12px",background:"#0d1320",borderRadius:8,border:"1px solid #1e293b",display:"flex",flexDirection:"column",gap:8}}>
                <div style={{fontSize:10,color:"#eab308",fontWeight:600,letterSpacing:1}}>🧠 心態紀錄</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <Field label="情緒狀態">
                    <Select value={jEmotion} onChange={setJEmotion} placeholder="選擇..." options={[{v:"冷靜理性",l:"😐 冷靜理性"},{v:"略為興奮",l:"😃 略為興奮"},{v:"焦慮不安",l:"😰 焦慮不安"},{v:"FOMO 恐懼錯過",l:"😱 FOMO"},{v:"恐慌想逃",l:"🏃 恐慌想逃"},{v:"貪婪想加碼",l:"🤑 貪婪想加碼"},{v:"報復性交易",l:"😤 報復性交易"},{v:"麻木無感",l:"😶 麻木無感"}]}/>
                  </Field>
                  <Field label="信心程度">
                    <Select value={jConfidence} onChange={setJConfidence} placeholder="選擇..." options={[{v:"非常有信心(90%+)",l:"💪 90%+"},{v:"有信心(70-90%)",l:"👍 70-90%"},{v:"一般(50-70%)",l:"🤔 50-70%"},{v:"缺乏信心(<50%)",l:"😟 <50%"},{v:"純粹賭博",l:"🎰 純粹賭博"}]}/>
                  </Field>
                </div>
                <Field label="是否符合預設計劃？">
                  <Select value={jPlan} onChange={setJPlan} placeholder="選擇..." options={[{v:"完全符合計劃",l:"✅ 完全符合"},{v:"大致符合但有偏差",l:"⚠️ 大致符合"},{v:"臨時起意",l:"❌ 臨時起意"},{v:"沒有計劃",l:"❌ 沒有計劃"}]}/>
                </Field>
              </div>

              <Field label="補充說明（自由記錄）">
                <textarea value={jNotes} onChange={e=>setJNotes(e.target.value)} placeholder="例：今天看到跌了 8%，很想追但忍住了..." onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey)submitJ();}} style={{...IS,minHeight:80,resize:"vertical",lineHeight:1.8}}/>
              </Field>

              <button onClick={submitJ} disabled={jLoad||(!jTicker.trim()&&!jNotes.trim())} style={{
                padding:"11px 16px",borderRadius:8,border:"1px solid #1e3a2a",fontFamily:FS,fontSize:13,fontWeight:600,
                cursor:jLoad||(!jTicker.trim()&&!jNotes.trim())?"not-allowed":"pointer",
                background:jLoad||(!jTicker.trim()&&!jNotes.trim())?"#0f172a":"linear-gradient(135deg,#0a2a14,#164a28)",
                color:jLoad||(!jTicker.trim()&&!jNotes.trim())?"#334155":"#22c55e",
              }}>{jLoad?"⏳ 審查中...":"⚖️ 提交紀律審查"}</button>

              {jMsgs.length>0&&(<button onClick={()=>setJMsgs([])} style={{padding:"5px 10px",borderRadius:6,border:"1px solid #1e293b",background:"transparent",color:"#475569",cursor:"pointer",fontSize:10}}>清除歷史</button>)}
            </div>

            {/* Chat */}
            <div style={{flex:1,overflowY:"auto",padding:"22px 26px"}}>
              {jMsgs.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",opacity:.3}}>
                  <div style={{fontSize:44}}>📓</div>
                  <div style={{color:"#475569",fontSize:13,marginTop:10}}>交易紀律審查</div>
                  <div style={{color:"#334155",fontSize:11,lineHeight:2,textAlign:"center",marginTop:8}}>
                    填寫左側表格<br/>教練逐條對照五大公約<br/>分析心態 + 給出行動建議
                  </div>
                </div>
              ):(<>
                {jMsgs.map((m,i)=>(
                  <div key={i} style={{marginBottom:16,display:"flex",flexDirection:"column",alignItems:m.role==="user"?"flex-end":"flex-start"}}>
                    <div style={{fontSize:8,color:m.role==="user"?"#3b82f6":"#eab308",marginBottom:3,letterSpacing:2,fontFamily:FM}}>{m.role==="user"?"▸ YOU":"◂ COACH"}</div>
                    <div style={{
                      maxWidth:"90%",padding:"14px 18px",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",
                      background:m.role==="user"?"rgba(59,130,246,.05)":"rgba(234,179,8,.04)",border:m.role==="user"?"1px solid #1e3050":"1px solid #30301e",
                      color:m.role==="user"?"#93c5fd":"#d4d0a0",fontSize:12,lineHeight:2,fontFamily:FM,whiteSpace:"pre-wrap"
                    }}>{m.content}</div>
                  </div>
                ))}
                {jLoad&&(<div style={{display:"flex",alignItems:"center",gap:8,padding:12}}><div style={{width:6,height:6,borderRadius:"50%",background:"#eab308",animation:"pulse 1s infinite"}}/><span style={{color:"#64748b",fontSize:11}}>教練正在審查...</span></div>)}
                <div ref={bRef}/>
              </>)}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{padding:"5px 16px",borderTop:"1px solid #1e293b",background:"#0d1320",display:"flex",justifyContent:"space-between",fontSize:9,color:"#334155",fontFamily:FM,flexShrink:0}}>
          <span>⚡ v10.3 · Mjdjourney API · Yahoo Fetch</span>
          <span>{new Date().toLocaleDateString("zh-HK")}</span>
        </div>
      </main>

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.8)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes prog{0%{width:15%}50%{width:85%}100%{width:15%}}
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:#0a0f1a}
        ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}
        input:focus,textarea:focus,select:focus{border-color:#22c55e!important;box-shadow:0 0 0 2px rgba(34,197,94,.08)!important}
        button:hover:not(:disabled){filter:brightness(1.15)}
        select{cursor:pointer}
        select option{background:#0f172a;color:#e2e8f0}
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
      `}</style>
    </div>
  );
}
