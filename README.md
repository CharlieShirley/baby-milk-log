# 寶寶喝奶日記

給全家一起用的寶寶喝奶紀錄網站。手機打開就能用，不同手機登入同一個家庭，紀錄會即時同步。

## 功能

- 三種餵奶：配方奶（ml）、瓶餵母乳（ml）、親餵（左右各幾分鐘），可加備註
- 今日總奶量與目標進度圈、距離上次喝奶多久
- 時間軸列出每一筆，點一下可修改或刪除，可切換前後天補記
- 近 7 天奶量長條圖
- 家庭邀請碼：第一位家人建立家庭，其他人註冊後輸入邀請碼加入
- 可「加入主畫面」，像 App 一樣全螢幕開啟

## 架構

- 純靜態網頁（HTML / CSS / JavaScript），放在 GitHub Pages
- 資料與帳號用 Supabase（Postgres + Auth + Realtime）
- 資料權限由 Row Level Security 控管：每個帳號只能看到、修改自己家庭的紀錄

## 設定步驟

1. 在 [Supabase](https://supabase.com) 建立一個新專案。
2. 打開專案的 **SQL Editor**，把 `supabase/schema.sql` 整段貼上並執行。
3. 到 **Authentication → URL Configuration**，把 Site URL 設成網站網址（例如 `https://charlieshirley.github.io/baby-milk-log/`），Redirect URLs 也加上同一個網址，註冊確認信的連結才會回到網站。
4. 到 **Project Settings → API**，複製 Project URL 和 anon public key，填進 `config.js`。
5. 推上 GitHub，在 repo 的 **Settings → Pages** 選 `main` 分支、根目錄。

## 本機預覽

```sh
python3 -m http.server 8000
```

然後打開 http://localhost:8000 。
