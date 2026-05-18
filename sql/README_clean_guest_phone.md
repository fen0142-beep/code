# 訪客電話自動清除（Supabase pg_cron）

> 對應檔：`clean_guest_phone_cron.sql`
> 建立日期：2026-05-17

## 它是什麼

幫您派一位「住在 Supabase 雲端機房的小工人」，每天凌晨 3:00 自動去檢查：

> 「有沒有任何活動已經結束超過 7 天，且該活動的訪客報名裡還留著電話？」

如果有，就把那筆訪客 reg 的 `answers.guest_phone` 欄位刪掉，只留電話消失，姓名、報名內容、跟誰代報的關係都保留。

小工人住雲端 → 良師父輪調換電腦也不會影響。

## 一次性設定步驟（5 分鐘）

1. 打開 https://supabase.com/dashboard
2. 進入 puyi-signup 專案 → 左欄 **SQL Editor**
3. 點 **+ New query**
4. 把 `clean_guest_phone_cron.sql` 整份貼進去
5. 按右下角 **Run**（或 Ctrl+Enter）
6. 看到 Step 4 那段 SELECT 結果出現一筆 `clean-guest-phone, 0 19 * * *, active=true` → 完成

## 確認它真的在跑

設好之後可以隨時回 SQL Editor 跑這句看最近執行紀錄：

```sql
SELECT * FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'clean-guest-phone')
 ORDER BY start_time DESC LIMIT 5;
```

`status=succeeded` 表示成功跑完。`return_message` 會寫清了幾筆。

## 想立刻試跑一次（不等到凌晨 3:00）

把 `clean_guest_phone_cron.sql` 檔尾備忘區的「立刻手動跑一次」那段 SQL 取消註解貼進 SQL Editor 跑就行，會用 RETURNING 印出清掉哪幾筆。

## 萬一要停掉它

```sql
SELECT cron.unschedule('clean-guest-phone');
```

## 輪調換電腦該注意什麼

**完全不用注意。** 這個小工人住 Supabase 雲端，跟良師父的電腦無關。

唯一要做的事是：未來如果整個 Supabase 專案搬家了，再跑一次這份 SQL 即可。
