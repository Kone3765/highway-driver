// 하이웨이 드라이버 난이도 측정용 봇. 로컬 미리보기 페이지에 주입해서만 쓴다 (게시본에는 없음).
// 게임의 setTimeout 대기를 지연 없는 큐로 바꿔서 한 판을 순식간에 돌리고, 화면(DOM)만 읽어 선택한다.
(() => {
  if (window.__sim) return;
  const realTimeout = window.setTimeout.bind(window);
  const mc = new MessageChannel(), queue = [];
  mc.port1.onmessage = () => { const f = queue.shift(); if (f) f(); };
  window.setTimeout = (fn, ms, ...a) => { queue.push(() => fn(...a)); mc.port2.postMessage(0); return 0; };
  const tick = () => new Promise(r => window.setTimeout(r));
  // 비상등 5초 판정은 performance.now()로 반응 시간을 재므로, 봇이 누를 때 사람 반응 시간만큼 시계를 밀어 준다
  const realNow = performance.now.bind(performance);
  let clockSkew = 0;
  performance.now = () => realNow() + clockSkew;

  const $ = id => document.getElementById(id);
  const P = () => $("panel");
  const num = id => parseFloat(($(id)?.textContent || "0").replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
  const pctOf = b => { const m = b.querySelector(".risk")?.textContent.match(/(\d+)%/); return m ? +m[1] : null; };
  const txt = b => b.querySelector(".t")?.textContent || b.textContent;
  const errors = [];
  addEventListener("error", e => errors.push(String(e.message)));
  addEventListener("unhandledrejection", e => errors.push(String(e.reason && e.reason.stack || e.reason)));

  // 스탯 슬라이더에 값을 넣는다 (총점 상한에 걸리면 갈 수 있는 끝에서 멈춘다)
  function setStat(k, v) {
    const s = $("s" + k);
    s.value = v; s.dispatchEvent(new Event("input"));
  }
  function dash() {
    return { fuel: num("gFuel"), hp: num("gCar"), fat: parseFloat($("gFat").textContent) || 0, money: num("cMoney"),
      km: num("km"), goal: num("goalKm"), limit: num("cLimit"), ins: num("cIns"), fuelTag: $("fuelRange")?.querySelector(".tag")?.textContent || "" };
  }

  // 시간만 버리는 안전한 선택지 (FAST는 성공률이 충분하면 이걸 피한다)
  const WASTE = /기다린다|뒤에서 기다린다|감속해서|멀찍이|천천히|참고 따라간다|비를 보낸다|10분만|미리 감속|미리 부드럽게|끼워 준다|뒤로 들어간다|화물차 뒤에 남는다|돌아서|빠질 때까지/;

  function bestOf(btns) {
    return btns.reduce((a, b) => ((pctOf(b) ?? 100) > (pctOf(a) ?? 100) ? b : a));
  }

  function decide(cfg, ctx) {
    const { h2, kicker, d } = ctx;
    let { choices } = ctx;
    const s = cfg.strat;
    // 속도
    if (choices[0].closest(".modes")) {
      const modes = choices;   // 100,110,120,130 순서
      if (s === "SAFE") return modes[0];
      if (s === "FAST") return d.fat >= 80 ? modes[2] : modes[3];
      if (s === "QUICK" || s === "AQUICK") return modes[2];   // 120km/h 고정
      const lim = d.limit;      // LIMIT·ARANK: 제한 속도 이하에서 가장 빠른 것
      return lim >= 120 ? modes[2] : lim >= 110 ? modes[1] : modes[0];
    }
    // 휴게소 진입 (ARANK·AQUICK = A랭크를 노리고 꼭 필요할 때만 들른다)
    if (/진입로/.test(h2)) {
      const need = d.fuelTag !== "충분";
      const aim = s === "ARANK" || s === "AQUICK";
      const enter = s === "SAFE" ? true : s === "LIMIT" ? (d.fat >= 45 || d.fuel < 30 || need || d.hp < 50)
        : aim ? (d.fat >= 60 || need || d.hp < 40) : (d.fat >= 65 || d.fuel < 22 || need);
      return choices.find(b => /들른다/.test(txt(b)) === enter) || choices[0];
    }
    // 휴게소 메뉴
    if (/무엇을 할까/.test(h2)) {
      const by = re => choices.find(b => re.test(txt(b)));
      const fuelTarget = s === "FAST" ? 60 : 75;
      if (d.fuel < fuelTarget && d.money > 20000 + 2000 && by(/주유/)) return by(/주유/);
      if (d.hp < 60 && d.money > 30000 + 50000 && by(/경정비/)) return by(/경정비/);
      const napAt = s === "SAFE" ? 30 : s === "LIMIT" ? 45 : s === "ARANK" || s === "AQUICK" ? 50 : 70;
      if (d.fat >= napAt && by(/쪽잠/)) return by(/쪽잠/);
      if (d.fat >= 35 && d.money > 40000 && by(/커피/)) return by(/커피/);
      if (s !== "FAST" && s !== "ARANK" && s !== "AQUICK" && by(/폰 충전/)) return by(/폰 충전/);
      return by(/출발/) || choices[choices.length - 1];
    }
    // 사고 수습 / 고장 / 연료 바닥
    if (/사고 수습|고장|연료 바닥/.test(kicker)) {
      const ins = choices.find(b => /보험/.test(txt(b)));
      if (ins) return ins;
      const cash = choices.find(b => /돈으로|급유|수리/.test(txt(b)));
      const self = choices.find(b => /혼자/.test(txt(b)));
      const quit = choices.find(b => /포기/.test(txt(b)));
      if (!self) return cash || quit || choices[0];          // 폐차 직전이면 돈으로라도 살린다
      if (cash && s === "FAST" && d.money > 150000) return cash;
      if (cash && (s === "ARANK" || s === "AQUICK") && d.money > 200000) return cash;   // 시간이 돈보다 귀하다
      return self;
    }
    // 단속 카메라
    if (/^단속 카메라/.test(kicker)) {
      const early = choices.find(b => /미리 부드럽게/.test(txt(b)));
      const late = choices.find(b => /직전에/.test(txt(b)));
      const slam = choices.find(b => /급브레이크/.test(txt(b)));
      const none = choices.find(b => /안 밟는다/.test(txt(b)));
      if (s !== "FAST") return early || (slam && pctOf(slam) >= 80 ? slam : (d.money > 120000 ? none : slam));
      if (late && pctOf(late) >= 85) return late;
      if (early) return early;
      if (slam && pctOf(slam) >= 75) return slam;
      return d.money > 120000 ? none : slam;
    }
    // 「제작자 실화」 재현용: 친구 전화를 받는다
    if (cfg.acceptCall && /친구의 전화/.test(h2)) { const a = choices.find(b => /받는다/.test(txt(b))); if (a) return a; }
    // 심리 읽기는 먼저 해 본다
    const read = choices.find(b => /상대 심리를 읽는다/.test(txt(b)));
    if (read) return read;
    // 일반 이벤트. 사람처럼 「→ 파산」이 붙은 선택지는 피한다
    const solvent = choices.filter(b => !/→ 파산/.test(b.textContent));
    if (solvent.length && solvent.length < choices.length) choices = solvent;
    const safeLike = choices.filter(b => !/안 밟는다|대충|IC 밖/.test(txt(b)) || choices.length === 1);
    const pool = safeLike.length ? safeLike : choices;
    if (s === "FAST") {
      const quick = pool.filter(b => !WASTE.test(txt(b)) && (pctOf(b) ?? 100) >= 80);
      if (quick.length) return bestOf(quick);
    }
    return bestOf(pool);
  }

  function parseMinutes(t) {
    const h = t.match(/(\d+)시간/), m = t.match(/(\d+)분/);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
  }

  async function oneRun(cfg) {
    const p0 = P();
    if (p0.querySelector("#again")) p0.querySelector("#again").click();
    if (!P().querySelector(".car[data-i]") || !/코스/.test(P().querySelector("h2")?.textContent || "")) throw new Error("코스 화면이 아님");
    P().querySelector(`.car[data-i='${cfg.course}']`).click();
    for (const k of ["W", "L", "D"]) setStat(k, 1);
    setStat("W", cfg.stats[0]); setStat("L", cfg.stats[1]); setStat("D", cfg.stats[2]);
    $("toCar").click();
    if (cfg.car != null) { const b = P().querySelector(`.car[data-i='${cfg.car}']`); if (b && !b.disabled) b.click(); }
    if (cfg.nav) { const o = $("optNav"); if (o && !o.disabled && !o.classList.contains("picked")) o.click(); }
    $("go").click();
    let steps = 0, idle = 0, lastSig = "";
    for (;;) {
      await tick();
      const p = P();
      if (p.querySelector("#again")) break;
      if (++steps > 6000) return { stuck: true, screen: p.innerText.slice(0, 200) };
      if (p.querySelector(".qbtn:not(:disabled)")) {
        const ms = cfg.qteMiss && Math.random() < cfg.qteMiss ? null : true;
        if (ms) { clockSkew += cfg.qteMs ?? 1800; $("qB")?.click(); $("qH")?.click(); }   // 기본 1.8초 반응(목표 4+)
        else { $("qB")?.click(); await new Promise(r => realTimeout(r, 5200)); }
        continue;
      }
      const rr = $("reroll"); if (rr) { rr.click(); continue; }
      const choices = [...p.querySelectorAll(".choice:not(:disabled)")];
      if (choices.length) {
        const ctx = { h2: p.querySelector("h2")?.textContent || "", kicker: p.querySelector(".kicker")?.textContent || "", choices, d: dash() };
        decide(cfg, ctx).click();
        continue;
      }
      const prim = [...p.querySelectorAll("button.primary:not(:disabled)")].pop();
      if (prim) { prim.click(); continue; }
      const sig = p.innerText.slice(0, 80);
      if (sig === lastSig) { if (++idle > 3000) return { stuck: true, screen: p.innerText.slice(0, 200) }; } else { idle = 0; lastSig = sig; }
    }
    const p = P(), res = {};
    p.querySelectorAll(".result div").forEach(x => res[x.querySelector("small").textContent] = x.querySelector("b").textContent);
    const rank = p.querySelector(".rank")?.textContent || null;
    return {
      clear: !!rank, rank, title: rank ? p.querySelector("h2")?.textContent : null,
      fail: rank ? null : p.querySelector("h2")?.textContent, where: rank ? null : p.querySelector(".kicker")?.textContent,
      km: num("km"), min: parseMinutes(res["걸린 시간"] || ""), acc: parseInt(res["사고"]) || 0, fines: parseInt(res["고지서"]) || 0,
      money: parseInt((res["남은 여비"] || "0").replace(/[^\d-]/g, "")) || 0,
    };
  }

  function summarize(cfg, runs) {
    const n = runs.length, cl = runs.filter(r => r.clear);
    const ranks = {}; cl.forEach(r => ranks[r.rank] = (ranks[r.rank] || 0) + 1);
    const fails = {}; runs.filter(r => !r.clear && !r.stuck).forEach(r => fails[r.fail] = (fails[r.fail] || 0) + 1);
    const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    return {
      key: cfg.key, n, clear: Math.round(cl.length / n * 100), ranks, fails, stuck: runs.filter(r => r.stuck).length,
      avgMin: avg(cl.map(r => r.min)), avgAcc: +(runs.reduce((x, r) => x + (r.acc || 0), 0) / n).toFixed(2),
      avgFines: +(runs.reduce((x, r) => x + (r.fines || 0), 0) / n).toFixed(2),
      failKm: avg(runs.filter(r => !r.clear && !r.stuck).map(r => r.km)),
      stuckScreens: runs.filter(r => r.stuck).map(r => r.screen).slice(0, 2),
    };
  }

  window.__sim = {
    errors, results: [], raw: [], done: true, progress: "",
    async run(configs, n) {
      this.done = false; this.results = []; this.raw = [];
      for (const cfg of configs) {
        const runs = [];
        for (let i = 0; i < n; i++) {
          this.progress = `${cfg.key} ${i + 1}/${n}`;
          try { runs.push(await oneRun(cfg)); } catch (e) { errors.push(cfg.key + ": " + e.message); runs.push({ stuck: true, screen: String(e.message) }); break; }
          if (runs[runs.length - 1].stuck) break;
        }
        this.raw.push({ key: cfg.key, runs });
        this.results.push(summarize(cfg, runs));
      }
      this.done = true;
    },
    wait: ms => new Promise(r => realTimeout(r, ms)),
  };
})();
