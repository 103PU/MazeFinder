# Maze Competition - Quickstart

## 1) Chay server

```powershell
node .\competition_server.js
```

Mo trinh duyet:

```text
http://localhost:3000
```

## 2) Cho ban be nop bai

Moi nguoi submit code co `class MazeFinder` qua API:

```powershell
curl -X POST http://localhost:3000/api/submit `
  -H "Content-Type: application/json" `
  -d "{\"teamName\":\"TeamA\",\"code\":\"class MazeFinder { constructor(noOfBot){} nextMove(status){ return status.map(() => 0); } } module.exports = MazeFinder;\"}"
```

Hoac submit truc tiep tren web form.

## 3) Xem bang xep hang

- Web: `GET /`
- JSON: `GET /api/leaderboard`

## 4) Cau hinh benchmark

Co the thay doi bang bien moi truong:

- `PORT` (mac dinh `3000`)
- `TRIALS_PER_CONFIG` (mac dinh `3`)
- `BASE_SEED` (mac dinh `20260301`)

Vi du:

```powershell
$env:TRIALS_PER_CONFIG=5
node .\competition_server.js
```

## 5) Ghi chu an toan

Ban demo nay phu hop cho nhom ban nho va trusted users.
Neu mo internet cong khai, can bo sung sandbox an toan (process isolation/container) truoc khi nhan code tu nguoi la.
