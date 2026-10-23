(() => {
  'use strict';

  const KINDS = {
    formula: { label: '配方奶', emoji: '🍼', usesMl: true },
    bottle_breast: { label: '瓶餵母乳', emoji: '🥛', usesMl: true },
    breast: { label: '親餵', emoji: '🤱', usesMl: false },
  };
  const QUICK_ML = [30, 60, 90, 120, 150, 180, 210, 240];
  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  const $app = document.getElementById('app');
  const $sheet = document.getElementById('sheet');
  const $backdrop = document.getElementById('sheet-backdrop');
  const $toast = document.getElementById('toast');

  const state = {
    session: null,
    member: null,
    family: null,
    members: [],
    day: startOfDay(new Date()),
    rows: [],
    last: null,
    channel: null,
    live: false,
    tab: lsGetEarly('tab', 'milk'),
    growth: [],
    diapers: [],
    lastDiaper: null,
  };

  function lsGetEarly(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } }

  let sb = null;

  // ---------- 小工具 ----------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function hhmm(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function toLocalInput(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm(d)}`;
  }
  function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function duration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(m / 60);
    return h ? `${h} 小時 ${m % 60} 分` : `${m} 分鐘`;
  }
  function shortDuration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(m / 60);
    return h ? `${h}h${pad(m % 60)}m` : `${m}m`;
  }
  function babyAge(birthday) {
    if (!birthday) return '';
    const b = new Date(birthday + 'T00:00:00');
    const today = startOfDay(new Date());
    const days = Math.round((today - b) / 86400000);
    if (days < 0) return '';
    let months = (today.getFullYear() - b.getFullYear()) * 12 + (today.getMonth() - b.getMonth());
    if (today.getDate() < b.getDate()) months -= 1;
    const anchor = new Date(b); anchor.setMonth(b.getMonth() + months);
    const rest = Math.round((today - anchor) / 86400000);
    return months > 0 ? `${months} 個月 ${rest} 天（第 ${days + 1} 天）` : `出生第 ${days + 1} 天`;
  }
  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, 2200);
  }
  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(m)) return '帳號名稱或密碼不正確';
    if (/Email not confirmed/i.test(m)) return '帳號還沒啟用，請確認 Supabase 已關閉 Confirm email';
    if (/User already registered/i.test(m)) return '這個帳號名稱已經有人用了，請直接登入或換一個';
    if (/Password should be at least/i.test(m)) return '密碼至少要 6 個字';
    if (/invalid invite code/i.test(m)) return '找不到這個邀請碼，請再確認一次';
    if (/already in a family/i.test(m)) return '你已經在一個家庭裡了';
    if (/Failed to fetch|NetworkError/i.test(m)) return '網路連線有問題，請稍後再試';
    return m;
  }
  // 不用信箱登入：把帳號名稱轉成內部用的假 Email（英數字不分大小寫，其他文字轉成 16 進位）
  function usernameToEmail(name) {
    const n = name.trim().normalize('NFC');
    if (!n) return null;
    const local = /^[a-z0-9._-]+$/i.test(n) && !/^[.]|[.]$|[.]{2}/.test(n)
      ? n.toLowerCase()
      : 'u' + Array.from(new TextEncoder().encode(n), (b) => b.toString(16).padStart(2, '0')).join('');
    return local.length <= 64 ? `${local}@users.babymilk.app` : null;
  }
  function lsGet(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式等 */ } }

  // ---------- 底部表單 ----------

  const SHEET_TOP = '<div class="sheet-head"><div class="grip"></div><button type="button" class="sheet-close" aria-label="關閉">✕</button></div>';

  function setSheetHtml(html) {
    $sheet.innerHTML = SHEET_TOP + html;
    $sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);
  }
  function openSheet(html, onMount) {
    setSheetHtml(html);
    $sheet.hidden = false;
    $backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    // 讓手機的「返回」也能關閉表單，而不是離開網站
    if (!(history.state && history.state.sheet)) history.pushState({ sheet: true }, '');
    if (onMount) onMount($sheet);
  }
  function hideSheet() {
    $sheet.hidden = true;
    $backdrop.hidden = true;
    $sheet.innerHTML = '';
    document.body.style.overflow = '';
  }
  function closeSheet() {
    if (history.state && history.state.sheet) history.back();
    else hideSheet();
  }
  window.addEventListener('popstate', () => { if (!$sheet.hidden) hideSheet(); });
  $backdrop.addEventListener('click', closeSheet);

  // ---------- 啟動 ----------

  async function boot() {
    const cfg = window.APP_CONFIG || {};
    if (!window.supabase) return renderOffline('程式沒有載入完整，可能是網路不穩或被擋住了。');
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      $app.innerHTML = `
        <div class="hero"><div class="logo">🛠️</div><h1>還差一步</h1>
        <p>請在 config.js 填入 Supabase 的網址與 anon key</p></div>`;
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    const { data } = await sb.auth.getSession();
    state.session = data.session;
    sb.auth.onAuthStateChange((event, session) => {
      const had = !!state.session;
      state.session = session;
      if (event === 'SIGNED_OUT' || (!had && session)) route();
    });
    route();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.family) {
        if (!sameDay(state.day, new Date()) && sameDay(state.day, addDays(new Date(), -1))) {
          state.day = startOfDay(new Date());
        }
        loadData();
      }
    });
    setInterval(() => { if (state.family && !document.hidden) renderMain(); }, 60000);
  }

  function isNetworkError(e) {
    return /Failed to fetch|NetworkError|Load failed|network/i.test((e && (e.message || e.details)) || String(e));
  }

  function renderOffline(reason) {
    $app.innerHTML = `
      <div class="hero"><div class="logo">📡</div><h1>連不上資料庫</h1>
        <p>${esc(reason || '這支手機現在連不到紀錄存放的伺服器。')}</p></div>
      <div class="card" style="font-size:14px">
        <div class="card-title">可以試試看</div>
        <ol style="margin:0;padding-left:20px;line-height:1.8">
          <li>關掉 Wi-Fi 改用行動網路，再重新整理</li>
          <li>如果行動網路可以、Wi-Fi 不行，通常是家裡路由器或網路業者的「防護／家長控制」擋住了 <b>supabase.co</b>，請把它加入允許清單</li>
          <li>手機有開 VPN、廣告阻擋或「私密 DNS」的話，先暫時關掉試試</li>
        </ol>
      </div>
      <button class="btn" id="retry">重新連線</button>`;
    $app.querySelector('#retry').addEventListener('click', () => location.reload());
  }

  async function route() {
    if (!state.session) { teardownRealtime(); state.member = state.family = null; return renderAuth(); }
    const { data: member, error } = await sb.from('family_members')
      .select('family_id, display_name').eq('user_id', state.session.user.id).maybeSingle();
    if (error) return isNetworkError(error) ? renderOffline() : ($app.innerHTML = `<p class="err">${esc(errText(error))}</p>`);
    if (!member) return renderOnboarding();
    state.member = member;
    await loadFamily();
    setupRealtime();
    await loadData();
  }

  // ---------- 登入 / 註冊 ----------

  function renderAuth(mode = 'login', msg = '') {
    $app.innerHTML = `
      <div class="hero">
        <div class="logo">👶</div>
        <h1>寶寶喝奶日記</h1>
        <p>全家一起記錄寶寶每一口奶</p>
      </div>
      <div class="card">
        <div class="tabs">
          <button data-mode="login" class="${mode === 'login' ? 'on' : ''}">登入</button>
          <button data-mode="signup" class="${mode === 'signup' ? 'on' : ''}">註冊</button>
        </div>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
        <form id="auth-form">
          <div class="field"><label>帳號名稱</label>
            <input class="input" name="username" autocomplete="username" autocapitalize="none" autocorrect="off"
              maxlength="20" placeholder="例如：mama 或 小湯圓媽媽" required></div>
          <div class="field"><label>密碼</label>
            <input class="input" type="password" name="password" minlength="6"
              autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></div>
          <button class="btn" type="submit">${mode === 'login' ? '登入' : '建立帳號'}</button>
        </form>
        ${mode === 'signup' ? '<p class="hint">不需要信箱。請記好帳號名稱和密碼，換手機時用同一組登入</p>' : ''}
      </div>`;
    $app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => renderAuth(b.dataset.mode)));
    $app.querySelector('#auth-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const username = f.get('username').trim();
      const email = usernameToEmail(username);
      if (!email) { renderAuth(mode, '帳號名稱太長了，請短一點'); return; }
      const password = f.get('password');
      const btn = ev.target.querySelector('button');
      btn.disabled = true;
      try {
        if (mode === 'login') {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
          if (error) throw error;
          if (!data.session) renderAuth('login', '帳號建立了，但還不能登入：請確認 Supabase 已關閉 Confirm email');
        }
      } catch (e) {
        renderAuth(mode, errText(e));
      }
    });
  }

  // ---------- 建立 / 加入家庭 ----------

  function renderOnboarding(msg = '') {
    $app.innerHTML = `
      <div class="hero"><div class="logo">🏡</div><h1>建立寶寶的家</h1>
        <p>第一位家人建立家庭，其他人用邀請碼加入</p></div>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <div class="card">
        <div class="card-title">🐣 建立新家庭</div>
        <form id="create-form">
          <div class="field"><label>寶寶的名字</label><input class="input" name="baby" placeholder="例如：小湯圓" required></div>
          <div class="field"><label>你的稱呼</label><input class="input" name="me" placeholder="例如：媽媽" required></div>
          <button class="btn" type="submit">建立</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title">💌 我有邀請碼</div>
        <form id="join-form">
          <div class="field"><label>邀請碼</label><input class="input" name="code" placeholder="6 碼英數字" autocapitalize="characters" required></div>
          <div class="field"><label>你的稱呼</label><input class="input" name="me" placeholder="例如：爸爸" required></div>
          <button class="btn" type="submit">加入</button>
        </form>
      </div>
      <button class="btn danger" id="logout">登出</button>`;
    $app.querySelector('#create-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const { error } = await sb.rpc('create_family', { p_baby_name: f.get('baby'), p_display_name: f.get('me') });
      if (error) return renderOnboarding(errText(error));
      route();
    });
    $app.querySelector('#join-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const { error } = await sb.rpc('join_family', { p_code: f.get('code'), p_display_name: f.get('me') });
      if (error) return renderOnboarding(errText(error));
      toast('加入成功 🎉');
      route();
    });
    $app.querySelector('#logout').addEventListener('click', () => sb.auth.signOut());
  }

  // ---------- 資料 ----------

  async function loadFamily() {
    const [{ data: fam }, { data: members }] = await Promise.all([
      sb.from('families').select('*').eq('id', state.member.family_id).single(),
      sb.from('family_members').select('user_id, display_name').eq('family_id', state.member.family_id).order('joined_at'),
    ]);
    state.family = fam;
    state.members = members || [];
    await refreshAvatarUrl();
  }

  // ---------- 寶寶頭像 ----------

  const BABY_SVG = {
    boy: `<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="56" r="34" fill="#FFE0C7"/>
      <path d="M30 34c6-14 34-16 42-2-8-4-14-3-18 2-4-6-14-6-24 0z" fill="#8A5A3C"/>
      <path d="M52 22c6-6 14-4 12 3-3-3-7-3-12-3z" fill="#8A5A3C"/>
      <circle cx="38" cy="56" r="4" fill="#5B3F30"/><circle cx="62" cy="56" r="4" fill="#5B3F30"/>
      <circle cx="31" cy="66" r="6" fill="#FFB59E" opacity=".7"/><circle cx="69" cy="66" r="6" fill="#FFB59E" opacity=".7"/>
      <path d="M43 70q7 6 14 0" stroke="#5B3F30" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
    girl: `<svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="56" r="34" fill="#FFE0C7"/>
      <path d="M22 54c-2-22 14-34 28-34s30 12 28 34c-4-12-12-18-28-18S26 42 22 54z" fill="#8A5A3C"/>
      <path d="M62 20l14-8v20zM62 20l-2 10 16 2" fill="#F58DA5"/><path d="M76 12l12 2-12 18z" fill="#F58DA5"/>
      <circle cx="74" cy="22" r="5" fill="#E9819A"/>
      <circle cx="38" cy="58" r="4" fill="#5B3F30"/><circle cx="62" cy="58" r="4" fill="#5B3F30"/>
      <circle cx="31" cy="68" r="6" fill="#FFB59E" opacity=".75"/><circle cx="69" cy="68" r="6" fill="#FFB59E" opacity=".75"/>
      <path d="M43 72q7 6 14 0" stroke="#5B3F30" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
  };

  function avatarHtml(cls = 'avatar') {
    const fam = state.family || {};
    const g = fam.baby_gender === 'girl' ? 'girl' : 'boy';
    if (state.avatarUrl) return `<div class="${cls} ${g}"><img src="${esc(state.avatarUrl)}" alt=""></div>`;
    return `<div class="${cls} ${g}">${BABY_SVG[g]}</div>`;
  }

  async function refreshAvatarUrl() {
    const path = state.family && state.family.avatar_path;
    if (!path) { state.avatarUrl = null; state.avatarFor = null; return; }
    if (state.avatarFor === path && state.avatarUrl) return;
    const { data, error } = await sb.storage.from('avatars').createSignedUrl(path, 60 * 60 * 24 * 7);
    state.avatarUrl = error ? null : data.signedUrl;
    state.avatarFor = error ? null : path;
  }

  // 裁成正方形並縮小，避免手機照片太大
  async function squareJpeg(file, size = 480) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, fail) => {
        const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('讀不到這張照片，請換一張試試')); i.src = url;
      });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    } finally { URL.revokeObjectURL(url); }
  }

  async function loadData() {
    const from = addDays(state.day, -6);
    const to = addDays(state.day, 1);
    const [rowsRes, lastRes, growthRes, diaperRes, lastDiaperRes] = await Promise.all([
      sb.from('feedings').select('*').eq('family_id', state.family.id)
        .gte('fed_at', from.toISOString()).lt('fed_at', to.toISOString()).order('fed_at'),
      sb.from('feedings').select('fed_at, kind, amount_ml').eq('family_id', state.family.id)
        .order('fed_at', { ascending: false }).limit(1),
      sb.from('growth').select('*').eq('family_id', state.family.id).order('measured_on'),
      sb.from('diapers').select('*').eq('family_id', state.family.id)
        .gte('changed_at', from.toISOString()).lt('changed_at', to.toISOString()).order('changed_at'),
      sb.from('diapers').select('changed_at, kind').eq('family_id', state.family.id)
        .order('changed_at', { ascending: false }).limit(1),
    ]);
    if (rowsRes.error) {
      if (isNetworkError(rowsRes.error) && !state.rows.length) return renderOffline();
      toast(errText(rowsRes.error)); return;
    }
    state.rows = rowsRes.data || [];
    state.last = (lastRes.data || [])[0] || null;
    state.growth = growthRes.data || [];
    state.diapers = diaperRes.data || [];
    state.lastDiaper = (lastDiaperRes.data || [])[0] || null;
    renderMain();
  }

  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadData, 250);
  }

  function setupRealtime() {
    teardownRealtime();
    state.channel = sb.channel(`feedings-${state.family.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedings', filter: `family_id=eq.${state.family.id}` }, scheduleReload)
      // 刪除事件不帶 family_id，無法套用 filter，另外監聽
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'feedings' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'growth', filter: `family_id=eq.${state.family.id}` }, scheduleReload)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'growth' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diapers', filter: `family_id=eq.${state.family.id}` }, scheduleReload)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'diapers' }, scheduleReload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'families', filter: `id=eq.${state.family.id}` }, async () => { await loadFamily(); renderMain(); })
      .subscribe((status) => {
        state.live = status === 'SUBSCRIBED';
        const el = document.querySelector('.live');
        if (el) el.classList.toggle('off', !state.live);
        if (status === 'SUBSCRIBED') scheduleReload();
      });
  }
  function teardownRealtime() {
    if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
  }

  // ---------- 主畫面 ----------

  function dayRows(d) {
    const k = dayKey(d);
    return state.rows.filter((r) => dayKey(new Date(r.fed_at)) === k);
  }
  function totals(rows) {
    const t = { ml: 0, formula: 0, bottle_breast: 0, breastCount: 0, breastMin: 0, count: rows.length };
    for (const r of rows) {
      if (r.kind === 'breast') { t.breastCount += 1; t.breastMin += (r.left_min || 0) + (r.right_min || 0); }
      else { t.ml += r.amount_ml || 0; t[r.kind] += r.amount_ml || 0; }
    }
    return t;
  }

  function headerHtml() {
    const fam = state.family;
    return `
      <header class="topbar">
        ${avatarHtml()}
        <div>
          <h1>${esc(fam.baby_name)}</h1>
          <div class="age">${esc(babyAge(fam.baby_birthday) || '點右上角設定生日')}</div>
        </div>
        <button class="icon-btn" id="settings" aria-label="設定">⚙️</button>
      </header>`;
  }

  function tabbarHtml() {
    return `<nav class="tabbar">
      <button data-tab="milk" class="${state.tab === 'milk' ? 'on' : ''}"><span class="e">🍼</span>喝奶</button>
      <button data-tab="diaper" class="${state.tab === 'diaper' ? 'on' : ''}"><span class="e">🧷</span>尿布</button>
      <button data-tab="growth" class="${state.tab === 'growth' ? 'on' : ''}"><span class="e">📈</span>成長曲線</button>
    </nav>`;
  }

  function bindChrome() {
    $app.querySelector('#settings').addEventListener('click', openSettings);
    $app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      if (state.tab === b.dataset.tab) return;
      state.tab = b.dataset.tab; lsSet('tab', state.tab);
      window.scrollTo(0, 0);
      renderMain();
    }));
  }

  function daynavHtml() {
    const d = state.day;
    const isToday = sameDay(d, new Date());
    return `
      <nav class="daynav">
        <button id="prev" aria-label="前一天">‹</button>
        <label class="label pick">${isToday ? '今天' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`} <span class="cal">📅</span>
          <small>${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}（${WEEKDAYS[d.getDay()]}）・點我選日期</small>
          <input type="date" id="pick-day" value="${dayKey(d)}" max="${dayKey(new Date())}" aria-label="選擇日期"></label>
        <button id="next" aria-label="後一天" ${isToday ? 'disabled' : ''}>›</button>
      </nav>`;
  }

  function bindDaynav() {
    const isToday = sameDay(state.day, new Date());
    $app.querySelector('#prev').addEventListener('click', () => { state.day = addDays(state.day, -1); loadData(); });
    $app.querySelector('#next').addEventListener('click', () => { if (!isToday) { state.day = addDays(state.day, 1); loadData(); } });
    const pick = $app.querySelector('#pick-day');
    pick.addEventListener('click', (ev) => { try { pick.showPicker(); ev.preventDefault(); } catch { /* 舊瀏覽器用原生行為 */ } });
    pick.addEventListener('change', () => {
      if (!pick.value) return;
      const nd = new Date(pick.value + 'T00:00:00');
      state.day = nd > new Date() ? startOfDay(new Date()) : nd;
      loadData();
    });
  }

  function renderMain() {
    if (!state.family) return;
    if (state.tab === 'growth') return renderGrowth();
    if (state.tab === 'diaper') return renderDiapers();
    const fam = state.family;
    const rows = dayRows(state.day);
    const t = totals(rows);
    const isToday = sameDay(state.day, new Date());
    const goal = fam.daily_goal_ml || 600;
    const pct = Math.min(1, t.ml / goal);
    const C = 2 * Math.PI * 50;
    const d = state.day;

    const sinceLast = state.last ? duration(Date.now() - new Date(state.last.fed_at)) : null;

    const week = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dd = addDays(state.day, -i);
      week.push({ d: dd, ml: totals(dayRows(dd)).ml });
    }
    const maxMl = Math.max(goal, ...week.map((w) => w.ml)) * 1.1;
    const weekAvg = Math.round(week.reduce((s, w) => s + w.ml, 0) / 7);

    $app.innerHTML = `${headerHtml()}

      ${sinceLast ? `<div class="card" style="display:flex;align-items:center;gap:10px;padding:12px 16px">
        <span style="font-size:22px">⏰</span>
        <span>距離上次喝奶 <b>${sinceLast}</b></span>
        <span class="live ${state.live ? '' : 'off'}" style="margin-left:auto">同步</span>
      </div>` : ''}

      ${daynavHtml()}

      <section class="card">
        <div class="summary">
          <div class="ring">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#FFF0E6" stroke-width="14"/>
              <circle cx="60" cy="60" r="50" fill="none" stroke="#F58D72" stroke-width="14" stroke-linecap="round"
                stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" style="transition:stroke-dashoffset .5s"/>
            </svg>
            <div class="center"><div><div class="big">${t.ml}</div><div class="unit">/ ${goal} ml</div></div></div>
          </div>
          <div class="stats">
            <div class="stat"><span class="dot k-formula">🍼</span>配方奶<b>${t.formula} ml</b></div>
            <div class="stat"><span class="dot k-bottle_breast">🥛</span>瓶餵母乳<b>${t.bottle_breast} ml</b></div>
            <div class="stat"><span class="dot k-breast">🤱</span>親餵<b>${t.breastCount} 次 · ${t.breastMin} 分</b></div>
            <div class="stat"><span class="dot" style="background:var(--butter)">⭐</span>共餵<b>${t.count} 次</b></div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">📝 餵奶紀錄<span class="sub">點一下可以修改</span></div>
        ${rows.length ? `<ul class="timeline">${rows.slice().reverse().map((r, i, arr) => rowHtml(r, arr[i + 1])).join('')}</ul>`
          : `<div class="empty"><span class="e">🐥</span>${isToday ? '今天還沒有紀錄，按下面的按鈕開始吧' : '這天沒有紀錄'}</div>`}
      </section>

      <section class="card">
        <div class="card-title">📊 近 7 天奶量<button class="link-btn" id="month-view">📅 月份總覽 ›</button></div>
        <div class="chart">
          <div class="goal" style="bottom:${(goal / maxMl) * 100 * 0.72 + 14}%"><span>目標 ${goal}</span></div>
          ${week.map((w) => `
            <div class="bar ${sameDay(w.d, new Date()) ? 'today' : ''}" data-day="${w.d.getTime()}">
              <div class="v">${w.ml || ''}</div>
              <div class="fill" style="height:${(w.ml / maxMl) * 72}%"></div>
              <div class="d">${sameDay(w.d, new Date()) ? '今' : WEEKDAYS[w.d.getDay()]}</div>
            </div>`).join('')}
        </div>
        <p class="hint" style="margin:8px 0 0">平均 ${weekAvg} ml / 天</p>
      </section>

      <div class="fab-row">
        <button class="fab k-formula" data-kind="formula"><span class="e">🍼</span>配方奶</button>
        <button class="fab k-bottle_breast" data-kind="bottle_breast"><span class="e">🥛</span>瓶餵母乳</button>
        <button class="fab k-breast" data-kind="breast"><span class="e">🤱</span>親餵</button>
      </div>
      ${tabbarHtml()}`;
    bindChrome();

    bindDaynav();
    $app.querySelector('#month-view').addEventListener('click', () => openMonth(state.day));
    $app.querySelectorAll('.fab').forEach((b) => b.addEventListener('click', () => openFeeding({ kind: b.dataset.kind })));
    $app.querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => {
      const r = state.rows.find((x) => x.id === el.dataset.id);
      if (r) openFeeding(r);
    }));
    $app.querySelectorAll('.bar').forEach((el) => el.addEventListener('click', () => {
      state.day = new Date(Number(el.dataset.day)); loadData();
    }));
  }

  // ---------- 月份總覽 ----------

  async function openMonth(anyDay) {
    const first = new Date(anyDay.getFullYear(), anyDay.getMonth(), 1);
    const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    const now = new Date();
    const isThisMonth = first.getFullYear() === now.getFullYear() && first.getMonth() === now.getMonth();
    const goal = state.family.daily_goal_ml || 600;

    const head = `<h2>${first.getFullYear()} 年 ${first.getMonth() + 1} 月</h2>`;
    if ($sheet.hidden) openSheet(`${head}<div class="empty"><span class="e">🍼</span>載入中…</div>`);
    else setSheetHtml(`${head}<div class="empty"><span class="e">🍼</span>載入中…</div>`);

    const { data, error } = await sb.from('feedings').select('fed_at, kind, amount_ml, left_min, right_min')
      .eq('family_id', state.family.id).gte('fed_at', first.toISOString()).lt('fed_at', next.toISOString());
    if ($sheet.hidden) return;
    if (error) { setSheetHtml(`${head}<p class="err">${esc(errText(error))}</p>`); return; }

    const byDay = {};
    for (const r of data || []) {
      const k = dayKey(new Date(r.fed_at));
      (byDay[k] = byDay[k] || []).push(r);
    }
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first.getDay(); i += 1) cells.push('<div class="mc blank"></div>');
    let sum = 0; let daysWith = 0; let best = null;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dt = new Date(first.getFullYear(), first.getMonth(), day);
      const k = dayKey(dt);
      const rows = byDay[k] || [];
      const t = totals(rows);
      const future = dt > now;
      if (rows.length) { daysWith += 1; sum += t.ml; if (!best || t.ml > best.ml) best = { day, ml: t.ml }; }
      const lvl = !rows.length ? 0 : t.ml >= goal ? 4 : t.ml >= goal * 0.75 ? 3 : t.ml >= goal * 0.5 ? 2 : 1;
      cells.push(`<button type="button" class="mc l${lvl} ${sameDay(dt, now) ? 'today' : ''} ${sameDay(dt, state.day) ? 'sel' : ''}"
        data-mday="${k}" ${future ? 'disabled' : ''}>
        <span class="dn">${day}</span><span class="ml">${rows.length ? t.ml || '' : ''}</span>
        ${t.breastCount ? '<span class="bf">🤱</span>' : ''}</button>`);
    }
    const avg = daysWith ? Math.round(sum / daysWith) : 0;

    setSheetHtml(`
      <div class="mnav">
        <button type="button" id="m-prev" aria-label="上個月">‹</button>
        ${head}
        <button type="button" id="m-next" aria-label="下個月" ${isThisMonth ? 'disabled' : ''}>›</button>
      </div>
      <div class="mstats">
        <div><b>${sum}</b><small>本月總量 ml</small></div>
        <div><b>${avg}</b><small>平均 ml / 天</small></div>
        <div><b>${best ? `${best.day} 日` : '－'}</b><small>喝最多${best ? `（${best.ml}）` : ''}</small></div>
      </div>
      <div class="mgrid">${WEEKDAYS.map((w) => `<div class="mw">${w}</div>`).join('')}${cells.join('')}</div>
      <div class="mlegend"><span><i class="l1"></i>未達一半</span><span><i class="l2"></i>一半以上</span><span><i class="l3"></i>75% 以上</span><span><i class="l4"></i>達到目標 ${goal}</span></div>
      <p class="hint">點一天就會跳到那天的紀錄；🤱 表示那天有親餵（親餵不計 ml）</p>
      <button class="btn ghost" id="m-close">回到首頁</button>`);
    $sheet.querySelector('#m-prev').addEventListener('click', () => openMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1)));
    $sheet.querySelector('#m-next').addEventListener('click', () => { if (!isThisMonth) openMonth(next); });
    $sheet.querySelector('#m-close').addEventListener('click', closeSheet);
    $sheet.querySelectorAll('[data-mday]').forEach((b) => b.addEventListener('click', () => {
      state.day = new Date(b.dataset.mday + 'T00:00:00');
      closeSheet();
      loadData();
    }));
  }

  function rowHtml(r, prev) {
    const k = KINDS[r.kind];
    const at = new Date(r.fed_at);
    const main = k.usesMl
      ? `${k.label} ${r.amount_ml ?? 0} ml`
      : `${k.label} 左 ${r.left_min || 0} 分 · 右 ${r.right_min || 0} 分`;
    const meta = [r.created_by_name && `by ${r.created_by_name}`, r.note].filter(Boolean).join(' · ');
    const gap = prev ? `+${shortDuration(at - new Date(prev.fed_at))}` : '';
    return `<li data-id="${r.id}" style="cursor:pointer">
      <span class="time">${hhmm(at)}</span>
      <span class="bubble k-${r.kind}">${k.emoji}</span>
      <span class="info"><div class="main">${esc(main)}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</span>
      <span class="gap">${gap}</span>
    </li>`;
  }

  // ---------- 新增 / 編輯 ----------

  function openFeeding(existing) {
    const isEdit = !!existing.id;
    const lastMl = lsGet('lastMl', {});
    const v = {
      kind: existing.kind,
      fed_at: isEdit ? new Date(existing.fed_at) : defaultTime(),
      amount_ml: isEdit ? existing.amount_ml ?? 0 : lastMl[existing.kind] ?? 90,
      left_min: isEdit ? existing.left_min ?? 0 : 10,
      right_min: isEdit ? existing.right_min ?? 0 : 10,
      note: isEdit ? existing.note ?? '' : '',
    };

    function html() {
      const k = KINDS[v.kind];
      return `
        <h2>${isEdit ? '修改紀錄' : '新增紀錄'}</h2>
        <div class="field">
          <div class="seg">${Object.entries(KINDS).map(([key, kk]) =>
            `<button type="button" data-k="${key}" class="${v.kind === key ? 'on' : ''}"><span class="e">${kk.emoji}</span>${kk.label}</button>`).join('')}</div>
        </div>
        <div class="field"><label>時間</label>
          <input class="input" type="datetime-local" id="f-time" value="${toLocalInput(v.fed_at)}"></div>
        ${k.usesMl ? `
          <div class="field"><label>奶量</label>
            <div class="amount">
              <button type="button" class="step" data-step="-10">−</button>
              <div class="val"><input id="f-ml" type="number" inputmode="numeric" min="0" max="1000" value="${v.amount_ml}"><small>ml</small></div>
              <button type="button" class="step" data-step="10">＋</button>
            </div>
            <div class="chips">${QUICK_ML.map((n) => `<button type="button" class="chip ${n === v.amount_ml ? 'on' : ''}" data-ml="${n}">${n}</button>`).join('')}</div>
          </div>` : `
          <div class="field"><label>親餵時間（分鐘）</label>
            <div class="sides">
              ${['left', 'right'].map((s) => `
                <div class="side"><div class="t">${s === 'left' ? '左邊' : '右邊'}</div>
                  <div class="n"><button type="button" data-side="${s}" data-d="-1">−</button>
                    <input id="f-${s}" type="number" inputmode="numeric" min="0" max="180" value="${v[s + '_min']}">
                    <button type="button" data-side="${s}" data-d="1">＋</button></div></div>`).join('')}
            </div>
          </div>`}
        <div class="field"><label>備註</label>
          <textarea class="input" id="f-note" placeholder="例如：有點吐奶、喝得很慢…">${esc(v.note)}</textarea></div>
        <button class="btn" id="f-save">${isEdit ? '儲存' : '記錄下來'}</button>
        ${isEdit ? '<button class="btn danger" id="f-del">刪除這筆</button>' : ''}
        <button class="btn ghost" id="f-cancel">取消</button>`;
    }

    function collect() {
      const t = $sheet.querySelector('#f-time');
      if (t && t.value) v.fed_at = new Date(t.value);
      const ml = $sheet.querySelector('#f-ml');
      if (ml) v.amount_ml = clampInt(ml.value, 0, 1000);
      const l = $sheet.querySelector('#f-left');
      if (l) v.left_min = clampInt(l.value, 0, 180);
      const r = $sheet.querySelector('#f-right');
      if (r) v.right_min = clampInt(r.value, 0, 180);
      const n = $sheet.querySelector('#f-note');
      if (n) v.note = n.value;
    }

    function mount() {
      $sheet.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
        collect();
        v.kind = b.dataset.k;
        if (!isEdit && KINDS[v.kind].usesMl) v.amount_ml = lastMl[v.kind] ?? v.amount_ml;
        rerender();
      }));
      $sheet.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        collect(); v.amount_ml = clampInt(v.amount_ml + Number(b.dataset.step), 0, 1000); rerender();
      }));
      $sheet.querySelectorAll('[data-ml]').forEach((b) => b.addEventListener('click', () => {
        collect(); v.amount_ml = Number(b.dataset.ml); rerender();
      }));
      $sheet.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => {
        collect(); const key = b.dataset.side + '_min';
        v[key] = clampInt(v[key] + Number(b.dataset.d), 0, 180); rerender();
      }));
      $sheet.querySelector('#f-cancel').addEventListener('click', closeSheet);
      $sheet.querySelector('#f-save').addEventListener('click', save);
      const del = $sheet.querySelector('#f-del');
      if (del) del.addEventListener('click', remove);
    }

    function rerender() {
      const top = $sheet.scrollTop;
      setSheetHtml(html());
      mount();
      $sheet.scrollTop = top;
    }

    async function save(ev) {
      collect();
      if (isNaN(v.fed_at)) return toast('請選擇時間');
      ev.target.disabled = true;
      const usesMl = KINDS[v.kind].usesMl;
      const payload = {
        kind: v.kind,
        fed_at: v.fed_at.toISOString(),
        amount_ml: usesMl ? v.amount_ml : null,
        left_min: usesMl ? null : v.left_min,
        right_min: usesMl ? null : v.right_min,
        note: v.note.trim() || null,
      };
      let res;
      if (isEdit) {
        res = await sb.from('feedings').update(payload).eq('id', existing.id);
      } else {
        res = await sb.from('feedings').insert({
          ...payload,
          family_id: state.family.id,
          created_by: state.session.user.id,
          created_by_name: state.member.display_name,
        });
      }
      if (res.error) { ev.target.disabled = false; return toast(errText(res.error)); }
      if (usesMl) { lastMl[v.kind] = v.amount_ml; lsSet('lastMl', lastMl); }
      closeSheet();
      toast(isEdit ? '已更新 ✨' : '記錄好了 🍼');
      if (!sameDay(v.fed_at, state.day) && v.fed_at <= new Date()) state.day = startOfDay(v.fed_at);
      loadData();
    }

    async function remove(ev) {
      if (!confirm('確定要刪除這筆紀錄嗎？')) return;
      ev.target.disabled = true;
      const { error } = await sb.from('feedings').delete().eq('id', existing.id);
      if (error) { ev.target.disabled = false; return toast(errText(error)); }
      closeSheet();
      toast('已刪除');
      loadData();
    }

    openSheet(html(), mount);
  }

  function defaultTime() {
    // 看過去某天時，預設時間放在那天，方便補記
    const now = new Date();
    if (sameDay(state.day, now)) return now;
    const d = new Date(state.day); d.setHours(12, 0, 0, 0); return d;
  }

  function clampInt(x, lo, hi) {
    const n = Math.round(Number(x));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  }

  // ---------- 尿布 ----------

  const DIAPER_KINDS = {
    pee: { label: '尿尿', emoji: '💧' },
    poop: { label: '大便', emoji: '💩' },
    both: { label: '尿尿＋大便', emoji: '💧💩' },
  };
  // 顏色參考兒童健康手冊的嬰兒大便辨識卡
  const POOP_COLORS = {
    yellow: { label: '黃色', css: '#F2C94C' },
    golden: { label: '金黃', css: '#D9A13B' },
    green: { label: '綠色', css: '#7FA650' },
    brown: { label: '褐色', css: '#9B6A43' },
    pale: { label: '淡黃／灰白', css: '#EDE6C8', warn: '淡黃、灰白或白色的大便可能是膽道閉鎖的警訊，請對照兒童健康手冊的「嬰兒大便辨識卡」，並盡快帶寶寶給兒科醫師看。' },
    red: { label: '帶血／紅色', css: '#C8504A', warn: '大便帶血或呈紅色，建議拍照記錄並諮詢兒科醫師。' },
    black: { label: '黑色', css: '#3B302A', warn: '出生頭幾天的黑綠色胎便是正常的；如果之後還是黑色，建議諮詢兒科醫師。' },
  };

  function diaperCounts(rows) {
    const c = { pee: 0, poop: 0, count: rows.length };
    for (const r of rows) {
      if (r.kind === 'pee' || r.kind === 'both') c.pee += 1;
      if (r.kind === 'poop' || r.kind === 'both') c.poop += 1;
    }
    return c;
  }
  function diaperRows(d) {
    const k = dayKey(d);
    return state.diapers.filter((r) => dayKey(new Date(r.changed_at)) === k);
  }

  function renderDiapers() {
    const rows = diaperRows(state.day);
    const c = diaperCounts(rows);
    const isToday = sameDay(state.day, new Date());
    const since = state.lastDiaper ? duration(Date.now() - new Date(state.lastDiaper.changed_at)) : null;

    const week = [];
    for (let i = 6; i >= 0; i -= 1) {
      const dd = addDays(state.day, -i);
      week.push({ d: dd, ...diaperCounts(diaperRows(dd)) });
    }
    const maxC = Math.max(8, ...week.map((w) => Math.max(w.pee, w.poop))) * 1.15;
    const warnRow = rows.find((r) => r.poop_color && POOP_COLORS[r.poop_color] && POOP_COLORS[r.poop_color].warn);

    const list = rows.slice().reverse().map((r, i, arr) => {
      const k = DIAPER_KINDS[r.kind];
      const at = new Date(r.changed_at);
      const col = r.poop_color && POOP_COLORS[r.poop_color];
      const prev = arr[i + 1];
      const meta = [r.created_by_name && `by ${r.created_by_name}`, r.note].filter(Boolean).join(' · ');
      return `<li data-did="${r.id}" style="cursor:pointer">
        <span class="time">${hhmm(at)}</span>
        <span class="bubble ${r.kind === 'pee' ? 'k-formula' : 'dk-poop'}">${r.kind === 'both' ? '💩' : k.emoji}</span>
        <span class="info"><div class="main">${k.label}${col ? ` <span class="pc" style="background:${col.css}"></span>${col.label}` : ''}</div>
          ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}</span>
        <span class="gap">${prev ? `+${shortDuration(at - new Date(prev.changed_at))}` : ''}</span>
      </li>`;
    }).join('');

    $app.innerHTML = `${headerHtml()}
      ${since ? `<div class="card" style="display:flex;align-items:center;gap:10px;padding:12px 16px">
        <span style="font-size:22px">🧷</span><span>距離上次換尿布 <b>${since}</b></span>
        <span class="live ${state.live ? '' : 'off'}" style="margin-left:auto">同步</span></div>` : ''}
      ${daynavHtml()}
      <section class="card">
        <div class="dsum">
          <div class="dbox pee"><span class="e">💧</span><b>${c.pee}</b><small>尿尿次數</small></div>
          <div class="dbox poop"><span class="e">💩</span><b>${c.poop}</b><small>大便次數</small></div>
          <div class="dbox all"><span class="e">🧷</span><b>${c.count}</b><small>換尿布</small></div>
        </div>
        ${warnRow ? `<p class="gnote warn">${esc(POOP_COLORS[warnRow.poop_color].warn)}</p>` : ''}
        ${isToday && c.pee < 6 && new Date().getHours() >= 20 ? '<p class="hint" style="margin:10px 0 0">滿月後的寶寶通常一天會有 6 片以上的濕尿布，可以多留意喝奶量喔。</p>' : ''}
      </section>
      <section class="card">
        <div class="card-title">📝 尿布紀錄<span class="sub">點一下可以修改</span></div>
        ${list ? `<ul class="timeline">${list}</ul>` : `<div class="empty"><span class="e">🧷</span>${isToday ? '今天還沒有紀錄' : '這天沒有紀錄'}</div>`}
      </section>
      <section class="card">
        <div class="card-title">📊 近 7 天次數</div>
        <div class="chart dchart">
          ${week.map((w) => `
            <div class="bar ${sameDay(w.d, new Date()) ? 'today' : ''}" data-day="${w.d.getTime()}">
              <div class="pair">
                <div class="col"><div class="v">${w.pee || ''}</div><div class="fill pee" style="height:${(w.pee / maxC) * 85}%"></div></div>
                <div class="col"><div class="v">${w.poop || ''}</div><div class="fill poop" style="height:${(w.poop / maxC) * 85}%"></div></div>
              </div>
              <div class="d">${sameDay(w.d, new Date()) ? '今' : WEEKDAYS[w.d.getDay()]}</div>
            </div>`).join('')}
        </div>
        <div class="glegend"><span><i style="background:#8CC3EA"></i>尿尿</span><span><i style="background:#D9A13B"></i>大便</span></div>
      </section>
      <div class="fab-row">
        <button class="fab k-formula" data-dkind="pee"><span class="e">💧</span>尿尿</button>
        <button class="fab dk-poop" data-dkind="poop"><span class="e">💩</span>大便</button>
        <button class="fab dk-both" data-dkind="both"><span class="e">💧💩</span>都有</button>
      </div>
      ${tabbarHtml()}`;
    bindChrome();
    bindDaynav();
    $app.querySelectorAll('[data-dkind]').forEach((b) => b.addEventListener('click', () => openDiaper({ kind: b.dataset.dkind })));
    $app.querySelectorAll('[data-did]').forEach((el) => el.addEventListener('click', () => {
      const r = state.diapers.find((x) => x.id === el.dataset.did);
      if (r) openDiaper(r);
    }));
    $app.querySelectorAll('.bar').forEach((el) => el.addEventListener('click', () => {
      state.day = new Date(Number(el.dataset.day)); loadData();
    }));
  }

  function openDiaper(existing) {
    const isEdit = !!existing.id;
    const v = {
      kind: existing.kind,
      at: isEdit ? new Date(existing.changed_at) : defaultTime(),
      color: isEdit ? existing.poop_color : lsGet('lastPoopColor', null),
      note: isEdit ? existing.note || '' : '',
    };
    function html() {
      const hasPoop = v.kind !== 'pee';
      const warn = hasPoop && v.color && POOP_COLORS[v.color] && POOP_COLORS[v.color].warn;
      return `
        <h2>${isEdit ? '修改尿布紀錄' : '換尿布'}</h2>
        <div class="field"><div class="seg">${Object.entries(DIAPER_KINDS).map(([k, kk]) =>
          `<button type="button" data-dk="${k}" class="${v.kind === k ? 'on' : ''}"><span class="e">${kk.emoji}</span>${kk.label}</button>`).join('')}</div></div>
        <div class="field"><label>時間</label>
          <input class="input" type="datetime-local" id="d-time" value="${toLocalInput(v.at)}"></div>
        ${hasPoop ? `<div class="field"><label>大便顏色（可不選）</label>
          <div class="colors">${Object.entries(POOP_COLORS).map(([k, c]) =>
            `<button type="button" class="cchip ${v.color === k ? 'on' : ''}" data-pc="${k}"><span class="pc" style="background:${c.css}"></span>${c.label}</button>`).join('')}</div>
          ${warn ? `<p class="gnote warn">${esc(warn)}</p>` : ''}</div>` : ''}
        <div class="field"><label>備註</label>
          <textarea class="input" id="d-note" placeholder="例如：有點稀、紅屁屁…">${esc(v.note)}</textarea></div>
        <button class="btn" id="d-save">${isEdit ? '儲存' : '記錄下來'}</button>
        ${isEdit ? '<button class="btn danger" id="d-del">刪除這筆</button>' : ''}
        <button class="btn ghost" id="d-cancel">取消</button>`;
    }
    function collect() {
      const t = $sheet.querySelector('#d-time'); if (t && t.value) v.at = new Date(t.value);
      const n = $sheet.querySelector('#d-note'); if (n) v.note = n.value;
    }
    function rerender() { const top = $sheet.scrollTop; setSheetHtml(html()); mount(); $sheet.scrollTop = top; }
    function mount() {
      $sheet.querySelectorAll('[data-dk]').forEach((b) => b.addEventListener('click', () => { collect(); v.kind = b.dataset.dk; rerender(); }));
      $sheet.querySelectorAll('[data-pc]').forEach((b) => b.addEventListener('click', () => {
        collect(); v.color = v.color === b.dataset.pc ? null : b.dataset.pc; rerender();
      }));
      $sheet.querySelector('#d-cancel').addEventListener('click', closeSheet);
      $sheet.querySelector('#d-save').addEventListener('click', async (ev) => {
        collect();
        if (isNaN(v.at)) return toast('請選擇時間');
        ev.target.disabled = true;
        const color = v.kind === 'pee' ? null : v.color || null;
        const payload = { kind: v.kind, changed_at: v.at.toISOString(), poop_color: color, note: v.note.trim() || null };
        const res = isEdit
          ? await sb.from('diapers').update(payload).eq('id', existing.id)
          : await sb.from('diapers').insert({ ...payload, family_id: state.family.id, created_by: state.session.user.id, created_by_name: state.member.display_name });
        if (res.error) { ev.target.disabled = false; return toast(errText(res.error)); }
        if (color) lsSet('lastPoopColor', color);
        closeSheet();
        toast(isEdit ? '已更新 ✨' : '記錄好了 🧷');
        if (!sameDay(v.at, state.day) && v.at <= new Date()) state.day = startOfDay(v.at);
        loadData();
      });
      const del = $sheet.querySelector('#d-del');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('確定要刪除這筆尿布紀錄嗎？')) return;
        const { error } = await sb.from('diapers').delete().eq('id', existing.id);
        if (error) return toast(errText(error));
        closeSheet(); toast('已刪除'); loadData();
      });
    }
    openSheet(html(), mount);
  }

  // ---------- 成長曲線（WHO 兒童生長標準，年齡別體重） ----------

  const BANDS = [
    { p: 3, z: -1.880794 }, { p: 15, z: -1.036433 }, { p: 50, z: 0 }, { p: 85, z: 1.036433 }, { p: 97, z: 1.880794 },
  ];

  function lmsAt(sex, day) {
    const t = (window.WHO_WFA || {})[sex];
    if (!t || day < 0 || day > t[t.length - 1][0]) return null;
    let lo = 0; let hi = t.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid][0] <= day) lo = mid; else hi = mid; }
    const a = t[lo]; const b = t[hi];
    const f = b[0] === a[0] ? 0 : (day - a[0]) / (b[0] - a[0]);
    return { L: a[1] + (b[1] - a[1]) * f, M: a[2] + (b[2] - a[2]) * f, S: a[3] + (b[3] - a[3]) * f };
  }
  function weightAtZ(lms, z) { return lms.M * Math.pow(1 + lms.L * lms.S * z, 1 / lms.L); }
  function zOf(lms, x) {
    // WHO 方法：|z| > 3 時改用線性延伸
    let z = (Math.pow(x / lms.M, lms.L) - 1) / (lms.L * lms.S);
    if (z > 3) { const sd3 = weightAtZ(lms, 3); const sd23 = sd3 - weightAtZ(lms, 2); z = 3 + (x - sd3) / sd23; }
    else if (z < -3) { const sd3 = weightAtZ(lms, -3); const sd23 = weightAtZ(lms, -2) - sd3; z = -3 + (x - sd3) / sd23; }
    return z;
  }
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }
  function ageDays(birthday, dateStr) {
    return Math.round((new Date(dateStr + 'T00:00:00') - new Date(birthday + 'T00:00:00')) / 86400000);
  }
  function ageLabel(days) {
    if (days < 0) return '出生前';
    const b = new Date(state.family.baby_birthday + 'T00:00:00');
    const d = addDays(b, days);
    let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
    if (d.getDate() < b.getDate()) months -= 1;
    const anchor = new Date(b); anchor.setMonth(b.getMonth() + months);
    const rest = Math.round((d - anchor) / 86400000);
    if (months <= 0) return `${days} 天`;
    return rest ? `${months} 個月 ${rest} 天` : `${months} 個月`;
  }
  function assess(g) {
    const fam = state.family;
    if (!fam.baby_birthday) return null;
    const days = ageDays(fam.baby_birthday, g.measured_on);
    const lms = lmsAt(fam.baby_gender === 'girl' ? 'girl' : 'boy', days);
    if (!lms) return { days };
    const z = zOf(lms, Number(g.weight_kg));
    return { days, z, pct: normCdf(z) * 100 };
  }
  function pctText(pct) {
    if (pct < 0.1) return '低於第 0.1 百分位';
    if (pct > 99.9) return '高於第 99.9 百分位';
    return `第 ${pct < 1 || pct > 99 ? pct.toFixed(1) : Math.round(pct)} 百分位`;
  }
  function pctComment(pct) {
    if (pct < 3) return { cls: 'warn', text: '低於第 3 百分位，建議下次健兒門診時和醫師聊聊，或持續觀察幾次測量的趨勢。' };
    if (pct > 97) return { cls: 'warn', text: '高於第 97 百分位，建議下次健兒門診時和醫師聊聊，或持續觀察幾次測量的趨勢。' };
    if (pct < 15) return { cls: 'ok', text: '在正常範圍內（第 3～97 百分位），屬於偏小一點的寶寶，持續沿著自己的曲線長大就很好。' };
    if (pct > 85) return { cls: 'ok', text: '在正常範圍內（第 3～97 百分位），屬於偏大一點的寶寶，持續沿著自己的曲線長大就很好。' };
    return { cls: 'ok', text: '在正常範圍內（第 3～97 百分位），長得很棒！' };
  }

  function growthChartSvg() {
    const fam = state.family;
    const sex = fam.baby_gender === 'girl' ? 'girl' : 'boy';
    const pts = state.growth.map((g) => ({ g, a: assess(g) })).filter((x) => x.a && x.a.days >= 0 && x.a.days <= 1826);
    const todayDays = ageDays(fam.baby_birthday, dayKey(new Date()));
    const lastDay = Math.max(todayDays, ...pts.map((x) => x.a.days), 0);
    // 顯示到目前年齡再往後 2 個月，至少 6 個月
    const months = Math.min(60, Math.max(6, Math.ceil(lastDay / 30.4375) + 2));
    const maxDay = Math.min(1826, Math.round(months * 30.4375));

    const W = 340; const H = 250; const pl = 30; const pr = 26; const pt = 20; const pb = 28;
    const curve = (z) => { const out = []; for (let d = 0; d <= maxDay; d += Math.max(1, Math.round(maxDay / 80))) out.push([d, weightAtZ(lmsAt(sex, d), z)]); out.push([maxDay, weightAtZ(lmsAt(sex, maxDay), z)]); return out; };
    const c3 = curve(BANDS[0].z); const c97 = curve(BANDS[4].z);
    const yMin = Math.floor(Math.min(c3[0][1], ...pts.map((x) => Number(x.g.weight_kg))) - 0.5);
    const yMax = Math.ceil(Math.max(c97[c97.length - 1][1], ...pts.map((x) => Number(x.g.weight_kg))) + 0.5);
    const X = (d) => pl + (d / maxDay) * (W - pl - pr);
    const Y = (w) => pt + (1 - (w - Math.max(0, yMin)) / (yMax - Math.max(0, yMin))) * (H - pt - pb);
    const path = (c) => c.map(([d, w], i) => `${i ? 'L' : 'M'}${X(d).toFixed(1)},${Y(w).toFixed(1)}`).join('');
    const area = (lo, hi) => `${path(hi)}${lo.slice().reverse().map(([d, w]) => `L${X(d).toFixed(1)},${Y(w).toFixed(1)}`).join('')}Z`;
    const c15 = curve(BANDS[1].z); const c50 = curve(0); const c85 = curve(BANDS[3].z);

    const yStep = yMax - yMin > 12 ? 2 : 1;
    let grid = '';
    for (let w = Math.max(0, yMin); w <= yMax; w += yStep) {
      grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(w)}" y2="${Y(w)}" class="gl"/><text x="${pl - 5}" y="${Y(w) + 3.5}" class="ax" text-anchor="end">${w}</text>`;
    }
    const mStep = months <= 12 ? 1 : months <= 24 ? 3 : 6;
    for (let m = 0; m <= months; m += mStep) {
      const d = Math.round(m * 30.4375); if (d > maxDay) break;
      grid += `<line x1="${X(d)}" x2="${X(d)}" y1="${pt}" y2="${H - pb}" class="gl v"/><text x="${X(d)}" y="${H - pb + 14}" class="ax" text-anchor="middle">${m}</text>`;
    }
    const labels = [[c3, 3], [c15, 15], [c50, 50], [c85, 85], [c97, 97]]
      .map(([c, p]) => `<text x="${W - pr + 3}" y="${Y(c[c.length - 1][1]) + 3.5}" class="pl">${p}</text>`).join('');
    const line = pts.length > 1 ? `<path d="${pts.map((x, i) => `${i ? 'L' : 'M'}${X(x.a.days).toFixed(1)},${Y(Number(x.g.weight_kg)).toFixed(1)}`).join('')}" class="baby-line"/>` : '';
    const dots = pts.map((x) => `<circle cx="${X(x.a.days).toFixed(1)}" cy="${Y(Number(x.g.weight_kg)).toFixed(1)}" r="4.5" class="baby-dot"/>`).join('');

    return `<svg viewBox="0 0 ${W} ${H}" class="gchart ${sex}" role="img" aria-label="體重成長曲線">
      ${grid}
      <path d="${area(c3, c97)}" class="band1"/>
      <path d="${area(c15, c85)}" class="band2"/>
      <path d="${path(c3)}" class="pline"/><path d="${path(c97)}" class="pline"/>
      <path d="${path(c15)}" class="pline thin"/><path d="${path(c85)}" class="pline thin"/>
      <path d="${path(c50)}" class="pline mid"/>
      ${labels}${line}${dots}
      <text x="${pl - 5}" y="${pt - 9}" class="ax" text-anchor="end">kg</text>
      <text x="${W - pr}" y="${H - 3}" class="ax" text-anchor="end">月齡</text>
    </svg>`;
  }

  function renderGrowth() {
    const fam = state.family;
    const sexLabel = fam.baby_gender === 'girl' ? '女孩' : '男孩';
    const latest = state.growth[state.growth.length - 1];
    const la = latest ? assess(latest) : null;
    let summary;
    if (!fam.baby_birthday) {
      summary = `<div class="empty"><span class="e">🎂</span>先到右上角「設定」填寫寶寶的生日，才能對照成長曲線喔</div>`;
    } else if (!latest) {
      summary = `<div class="empty"><span class="e">⚖️</span>還沒有體重紀錄，按下面的按鈕記錄第一筆吧</div>`;
    } else if (!la || la.z == null) {
      summary = `<div class="empty"><span class="e">📏</span>最新一筆 ${Number(latest.weight_kg)} kg，但不在 0～5 歲的對照範圍內</div>`;
    } else {
      const c = pctComment(la.pct);
      summary = `
        <div class="gsum">
          <div class="gw"><b>${Number(latest.weight_kg)}</b><small>kg</small></div>
          <div class="gi">
            <div class="gp">${pctText(la.pct)}</div>
            <div class="gm">${latest.measured_on.replace(/-/g, '/')}・${ageLabel(la.days)}</div>
          </div>
        </div>
        <p class="gnote ${c.cls}">${c.text}</p>`;
    }
    const list = state.growth.slice().reverse().map((g) => {
      const a = assess(g);
      return `<li data-gid="${g.id}" style="cursor:pointer">
        <span class="time">${g.measured_on.slice(5).replace('-', '/')}</span>
        <span class="bubble" style="background:var(--butter)">⚖️</span>
        <span class="info"><div class="main">${Number(g.weight_kg)} kg</div>
          <div class="meta">${esc([a && fam.baby_birthday ? ageLabel(a.days) : '', g.created_by_name && `by ${g.created_by_name}`, g.note].filter(Boolean).join(' · '))}</div></span>
        <span class="gap">${a && a.pct != null ? `P${a.pct < 1 ? a.pct.toFixed(1) : Math.round(a.pct)}` : ''}</span>
      </li>`;
    }).join('');

    $app.innerHTML = `${headerHtml()}
      <section class="card">
        <div class="card-title">📈 目前體重<span class="sub">對照 WHO ${sexLabel}標準</span></div>
        ${summary}
      </section>
      ${fam.baby_birthday ? `<section class="card">
        <div class="card-title">🌈 體重成長曲線</div>
        ${growthChartSvg()}
        <div class="glegend"><span><i class="lg1"></i>3～97 百分位</span><span><i class="lg2"></i>15～85 百分位</span><span><i class="lg3"></i>${esc(fam.baby_name)}</span></div>
      </section>` : ''}
      <section class="card">
        <div class="card-title">📝 體重紀錄<span class="sub">點一下可以修改</span></div>
        ${list ? `<ul class="timeline">${list}</ul>` : '<div class="empty">還沒有紀錄</div>'}
      </section>
      <p class="hint" style="margin:0 8px 14px">曲線依據世界衛生組織（WHO）兒童生長標準，和台灣兒童健康手冊使用的相同。百分位只是參考，寶寶是否健康請以兒科醫師的評估為準。性別依設定裡的頭像（小男生／小女生）。</p>
      <div class="fab-row">
        <button class="fab wide" id="add-weight" style="background:var(--butter)"><span class="e">⚖️</span>記錄體重</button>
      </div>
      ${tabbarHtml()}`;
    bindChrome();
    $app.querySelector('#add-weight').addEventListener('click', () => openWeight({}));
    $app.querySelectorAll('[data-gid]').forEach((el) => el.addEventListener('click', () => {
      const g = state.growth.find((x) => x.id === el.dataset.gid);
      if (g) openWeight(g);
    }));
  }

  function openWeight(existing) {
    const isEdit = !!existing.id;
    openSheet(`
      <h2>${isEdit ? '修改體重' : '記錄體重'}</h2>
      <div class="field"><label>測量日期</label>
        <input class="input" type="date" id="w-date" value="${esc(existing.measured_on || dayKey(new Date()))}" max="${dayKey(new Date())}"></div>
      <div class="field"><label>體重（公斤）</label>
        <div class="amount"><div class="val"><input id="w-kg" type="number" inputmode="decimal" step="0.01" min="0.5" max="39"
          placeholder="0.00" value="${existing.weight_kg != null ? Number(existing.weight_kg) : ''}"><small>kg</small></div></div>
        <p class="hint" style="margin-top:4px">例如 4250 公克請輸入 4.25</p></div>
      <div class="field"><label>備註</label>
        <textarea class="input" id="w-note" placeholder="例如：健兒門診量的">${esc(existing.note || '')}</textarea></div>
      <button class="btn" id="w-save">${isEdit ? '儲存' : '記錄下來'}</button>
      ${isEdit ? '<button class="btn danger" id="w-del">刪除這筆</button>' : ''}
      <button class="btn ghost" id="w-cancel">取消</button>
    `, () => {
      const kgInput = $sheet.querySelector('#w-kg');
      if (!isEdit) setTimeout(() => kgInput.focus(), 250);
      $sheet.querySelector('#w-cancel').addEventListener('click', closeSheet);
      $sheet.querySelector('#w-save').addEventListener('click', async (ev) => {
        let kg = Number(kgInput.value);
        if (kg > 100) kg /= 1000; // 輸入成公克時自動換算
        const date = $sheet.querySelector('#w-date').value;
        if (!date) return toast('請選擇日期');
        if (!(kg > 0.5 && kg < 40)) return toast('請輸入正確的體重（公斤）');
        ev.target.disabled = true;
        const payload = { measured_on: date, weight_kg: Math.round(kg * 1000) / 1000, note: $sheet.querySelector('#w-note').value.trim() || null };
        const res = isEdit
          ? await sb.from('growth').update(payload).eq('id', existing.id)
          : await sb.from('growth').insert({ ...payload, family_id: state.family.id, created_by: state.session.user.id, created_by_name: state.member.display_name });
        if (res.error) { ev.target.disabled = false; return toast(errText(res.error)); }
        closeSheet();
        toast(isEdit ? '已更新 ✨' : '記錄好了 ⚖️');
        loadData();
      });
      const del = $sheet.querySelector('#w-del');
      if (del) del.addEventListener('click', async () => {
        if (!confirm('確定要刪除這筆體重紀錄嗎？')) return;
        const { error } = await sb.from('growth').delete().eq('id', existing.id);
        if (error) return toast(errText(error));
        closeSheet();
        toast('已刪除');
        loadData();
      });
    });
  }

  // ---------- 設定 ----------

  function openSettings() {
    const fam = state.family;
    const me = state.session.user;
    openSheet(`
      <h2>設定</h2>
      <div class="card">
        <div class="card-title">🎀 寶寶頭像</div>
        <div class="avatar-edit">
          ${avatarHtml('avatar big')}
          <div class="avatar-actions">
            <div class="seg two">
              <button type="button" data-g="boy" class="${fam.baby_gender !== 'girl' ? 'on' : ''}">👦 小男生</button>
              <button type="button" data-g="girl" class="${fam.baby_gender === 'girl' ? 'on' : ''}">👧 小女生</button>
            </div>
            <label class="btn ghost small" for="s-photo">📷 ${fam.avatar_path ? '換一張照片' : '上傳照片'}</label>
            <input type="file" id="s-photo" accept="image/*" hidden>
            ${fam.avatar_path ? '<button type="button" class="btn danger small" id="s-photo-del">移除照片</button>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">👶 寶寶資料</div>
        <div class="field"><label>名字</label><input class="input" id="s-name" value="${esc(fam.baby_name)}"></div>
        <div class="field"><label>生日</label><input class="input" type="date" id="s-bday" value="${esc(fam.baby_birthday || '')}"></div>
        <div class="field"><label>每日目標奶量（ml）</label><input class="input" type="number" inputmode="numeric" id="s-goal" value="${fam.daily_goal_ml}"></div>
        <div class="field"><label>我的稱呼</label><input class="input" id="s-me" value="${esc(state.member.display_name)}"></div>
        <button class="btn" id="s-save">儲存</button>
      </div>
      <div class="card">
        <div class="card-title">💌 邀請家人</div>
        <p style="margin:0;font-size:14px">請家人打開這個網站、註冊帳號後，輸入這組邀請碼：</p>
        <div class="code">${esc(fam.invite_code)}</div>
        <button class="btn ghost" id="s-share">分享邀請</button>
      </div>
      <div class="card">
        <div class="card-title">👨‍👩‍👧 家庭成員</div>
        <ul class="members">${state.members.map((m) => `<li><span class="m">🧸</span>${esc(m.display_name)}${m.user_id === me.id ? '（我）' : ''}</li>`).join('')}</ul>
      </div>
      <p class="hint">登入帳號：${esc((me.user_metadata && me.user_metadata.username) || me.email)}</p>
      <button class="btn" id="s-back">回到首頁</button>
      <button class="btn ghost" id="s-logout">登出</button>
      <button class="btn danger" id="s-leave">離開這個家庭</button>
    `, () => {
      $sheet.querySelector('#s-save').addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        const goal = clampInt($sheet.querySelector('#s-goal').value, 50, 3000);
        const [a, b] = await Promise.all([
          sb.from('families').update({
            baby_name: $sheet.querySelector('#s-name').value.trim() || '寶寶',
            baby_birthday: $sheet.querySelector('#s-bday').value || null,
            daily_goal_ml: goal,
          }).eq('id', fam.id),
          sb.from('family_members').update({ display_name: $sheet.querySelector('#s-me').value.trim() || '家人' })
            .eq('user_id', me.id),
        ]);
        const err = a.error || b.error;
        if (err) { ev.target.disabled = false; return toast(errText(err)); }
        state.member.display_name = $sheet.querySelector('#s-me').value.trim() || '家人';
        await loadFamily();
        closeSheet();
        toast('已儲存 ✨');
        renderMain();
      });
      $sheet.querySelector('#s-share').addEventListener('click', async () => {
        const url = location.origin + location.pathname;
        const text = `一起記錄${fam.baby_name}的喝奶紀錄吧！\n打開 ${url} 註冊後，輸入邀請碼：${fam.invite_code}`;
        try {
          if (navigator.share) await navigator.share({ title: '寶寶喝奶日記', text });
          else { await navigator.clipboard.writeText(text); toast('已複製邀請訊息'); }
        } catch { /* 使用者取消分享 */ }
      });
      $sheet.querySelector('#s-back').addEventListener('click', closeSheet);
      const refreshAvatarUi = () => {
        // 只更新頭像區塊，保留其他欄位正在輸入的內容
        const old = $sheet.querySelector('.avatar-edit');
        const tmp = document.createElement('div');
        tmp.innerHTML = `${avatarHtml('avatar big')}`;
        old.replaceChild(tmp.firstElementChild, old.querySelector('.avatar'));
        $sheet.querySelectorAll('[data-g]').forEach((x) => x.classList.toggle('on', x.dataset.g === (state.family.baby_gender === 'girl' ? 'girl' : 'boy')));
        $sheet.querySelector('label[for="s-photo"]').textContent = `📷 ${state.family.avatar_path ? '換一張照片' : '上傳照片'}`;
        let del = $sheet.querySelector('#s-photo-del');
        if (state.family.avatar_path && !del) {
          del = document.createElement('button');
          del.type = 'button'; del.className = 'btn danger small'; del.id = 's-photo-del'; del.textContent = '移除照片';
          del.addEventListener('click', removePhoto);
          $sheet.querySelector('.avatar-actions').appendChild(del);
        } else if (!state.family.avatar_path && del) del.remove();
        renderMain();
      };
      $sheet.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => {
        const { error } = await sb.from('families').update({ baby_gender: b.dataset.g }).eq('id', fam.id);
        if (error) return toast(errText(error));
        state.family.baby_gender = b.dataset.g;
        refreshAvatarUi();
      }));
      $sheet.querySelector('#s-photo').addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        toast('照片上傳中…');
        try {
          const blob = await squareJpeg(file);
          const path = `${fam.id}/${Date.now()}.jpg`;
          const up = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
          if (up.error) throw up.error;
          const oldPath = state.family.avatar_path;
          const { error } = await sb.from('families').update({ avatar_path: path }).eq('id', fam.id);
          if (error) throw error;
          if (oldPath) sb.storage.from('avatars').remove([oldPath]);
          state.family.avatar_path = path;
          await refreshAvatarUrl();
          refreshAvatarUi();
          toast('照片換好了 📸');
        } catch (e) { toast(errText(e)); }
      });
      async function removePhoto() {
        if (!confirm('要移除寶寶的照片嗎？')) return;
        const oldPath = state.family.avatar_path;
        const { error } = await sb.from('families').update({ avatar_path: null }).eq('id', fam.id);
        if (error) return toast(errText(error));
        if (oldPath) sb.storage.from('avatars').remove([oldPath]);
        state.family.avatar_path = null;
        await refreshAvatarUrl();
        refreshAvatarUi();
      }
      const delBtn = $sheet.querySelector('#s-photo-del');
      if (delBtn) delBtn.addEventListener('click', removePhoto);
      $sheet.querySelector('#s-logout').addEventListener('click', async () => { closeSheet(); await sb.auth.signOut(); });
      $sheet.querySelector('#s-leave').addEventListener('click', async () => {
        if (!confirm('離開後就看不到這個家庭的紀錄了，確定嗎？')) return;
        const { error } = await sb.rpc('leave_family');
        if (error) return toast(errText(error));
        closeSheet();
        teardownRealtime();
        state.family = state.member = null;
        route();
      });
    });
  }

  boot();
})();
