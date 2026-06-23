# カテキョ通知プレビュー管理画面 アーキテクチャレビュー依頼

作成日: 2026-06-19  
対象: `preview-manager` MVP  
前提: 現在はローカル実行だが、将来的に社内向けの動的ポータルとしてサーバー/クラウドへ移行する

## 1. レビュー目的

ホリエモンAI学校株式会社のCS向けに、受講企業ごとのOneStream視聴状況を確認し、Slack/Chatworkへの進捗通知案を作成・確認・送信する管理画面を作っています。

今回レビューしてほしいのは、現状のMVPが将来的なサーバー移行、複数人利用、200社規模の定期運用、Slack/Chatwork投稿に耐えられる設計になっているかです。

## 2. 業務要件

- 受講企業名または企業一覧から、直近の受講履歴を確認できる
- 受講者ごとに「誰が何本見たか」「どの講義を見たか」を把握できる
- 受講履歴から関連性の高そうな講義をおすすめ候補として出す
- SlackまたはChatwork向けの通知本文をプレビューできる
- 人間が確認してから投稿できる
- 将来的には毎営業日20社程度を処理し、200社規模を無理なく回す
- 受講開始日ベースで「開始1か月」「開始6か月」「終了前」などの節目グループを扱う
- 面談情報として「前回の面談日」「総合面談実施回数」「次回面談予定日」を表示したい

## 3. 現在できていること

- ローカルサーバーでHTML管理画面を起動できる
- Notionの受講企業マスターから契約中企業を取り込める
- 企業ごとにOneStreamグループID、契約期間、通知先などを保持できる
- OneStream APIから視聴履歴を取得し、企業別プレビューに反映できる
- 企業ごとの通知本文ドラフトを表示・編集できる
- 受講者別サマリーを表示できる
- おすすめ講義候補を表示できる
- Slack/Chatwork接続確認ができる
- 投稿は初期状態OFFで、承認後のみ送信できる設計にしている
- 投稿成功時に送信日時・操作者・送信履歴を残す
- 操作ユーザーを選択式で記録できる
- 受講開始日から受講ステージを自動判定し、画面で絞り込める
- 面談3項目をデータ構造・画面表示に追加済み

## 4. 現在の構成

```text
Notion 受講企業マスター
        ↓
import-notion-companies.cjs
        ↓
preview-manager/data/previews.json
        ↓
update-watch-reports.cjs
        ↓
OneStream API
        ↓
通知プレビュー生成
        ↓
server.js
        ↓
HTML管理画面
        ↓
承認後にSlack / Chatwork投稿
```

## 5. 主なファイル

```text
preview-manager/
├─ server.js
├─ public/
│  ├─ index.html
│  ├─ app.js
│  └─ styles.css
├─ scripts/
│  ├─ import-notion-companies.cjs
│  ├─ update-watch-reports.cjs
│  ├─ sync-chatwork-room-ids.cjs
│  └─ seed-previews.cjs
├─ data/
│  └─ previews.json
├─ .env.example
└─ start-preview-manager.cmd
```

注意: `.env` と実データ入りの `data/previews.json` はレビュー共有物から除外してください。APIキー、トークン、クライアント企業名、個人名が含まれる可能性があります。

## 6. 現在のデータモデル

現状はMVPのため、主に `preview-manager/data/previews.json` に集約しています。

各企業プレビューはおおむね以下を持ちます。

```text
id
company
notionPageId
contract.start
contract.end
group.id
group.name
delivery.type
delivery.destination
delivery.roomId
delivery.channelId
stats
learners
recommendations
risks
message
notes
meeting.lastDate
meeting.totalCount
meeting.nextDate
activity
status
sentAt
sentBy
```

将来のDB化では、少なくとも以下のテーブル/コレクションへ分離したいです。

```text
companies
contracts
notification_destinations
watch_report_runs
watch_report_summaries
notification_previews
notification_send_logs
meeting_summaries
daily_processing_queue
operators
audit_logs
```

## 7. 外部連携

### Notion

- 受講企業マスターを正台帳として扱う
- 契約期間中の企業のみ対象
- 現状はローカルへ取り込み
- Notionレコード削除は行わない

### OneStream

利用予定API:

```text
GET /api/v1/team/{teamId}/groups
GET /api/v1/team/{teamId}/groups/{groupId}
GET /api/v1/team/{teamId}/users
GET /api/v1/team/{teamId}/videos
POST /api/v1/team/{teamId}/analytics/video_watch_logs
```

懸念:

- 全社一括取得は重い
- 200社規模では毎営業日20社程度の分割処理にしたい
- タイムアウト、再試行、差分取得、レート制限対策が必要

### Chatwork

- 投稿専用アカウントのAPIトークンを利用する前提
- 誤投稿時は投稿者本人しか削除できないため、投稿専用アカウント化は重要
- 初期状態は `CHATWORK_ENABLE_POSTING=false`

### Slack

- Slack Bot Tokenを利用
- 初期状態は `SLACK_ENABLE_POSTING=false`
- Botを対象チャンネルに参加させる必要がある

## 8. セキュリティ前提

- APIキーやトークンは `.env` または将来のSecret Managerで管理する
- ブラウザへトークンを出さない
- Slack/Chatwork投稿はサーバー側で実行する
- 画面側は承認操作と投稿リクエストだけを行う
- 本番投稿は必ず操作者・日時・投稿先・本文・結果を記録する
- 外部サービスへの本番投稿は事前確認または明示的な承認フローを必須にする
- クライアント企業名・個人名を含むため、公開リポジトリや外部AIサービスへの貼り付けに注意する
- 将来の社内ポータル化時は認証と権限管理が必須

## 9. 投稿事故防止の現状

現状のガード:

- 投稿機能は環境変数でOFFが初期値
- 企業ごとに `送信OK` 状態へ変更する必要がある
- 投稿先IDが未設定なら投稿できない
- 投稿時に確認ダイアログを出す
- 投稿後に `sentAt` / `sentBy` / activity log を残す

レビューしてほしい点:

- これで十分か
- 本番サーバー化時に二重投稿防止のためDB制約や冪等性キーが必要か
- 承認者と実行者を分けるべきか
- 送信前プレビュー本文の固定化、編集履歴、差分履歴が必要か

## 10. 毎営業日20社処理の構想

月2回全社一括ではなく、毎営業日20社程度を処理する予定です。

想定フロー:

```text
毎営業日
↓
契約中企業から処理候補を選定
↓
今日の20社をキュー化
↓
対象20社だけOneStream履歴取得
↓
通知プレビュー生成
↓
管理画面で確認
↓
承認済みだけSlack/Chatwork投稿
↓
投稿履歴を保存
```

選定ロジック候補:

- 最終投稿日が古い企業
- まだ一度も投稿していない企業
- 受講ステージが節目の企業
- エラーがない企業
- 通知先設定済みの企業

受講ステージ:

```text
開始直後
開始2週間前後
開始1か月前後
開始3か月前後
開始6か月前後
開始9か月前後
終了1か月前
終了直前
通常フォロー
開始日未設定
```

## 11. 将来サーバー移行の前提

現在はローカルMVPですが、今後の設計・実装はすべてサーバー移行を前提にします。

移行時に必要なもの:

- 社内メンバー向け認証
- 権限管理
- Secret管理
- DB化
- スケジューラー
- バックグラウンドジョブ
- キュー管理
- 監査ログ
- エラー通知
- バックアップ
- ステージング環境

候補:

```text
Frontend: 現在のHTML/JSを段階的にReact等へ移行、またはサーバーレンダリング
Backend: Node.js
DB: PostgreSQL / Supabase / Cloud SQL / SQLite on server
Scheduler: cron / Cloud Scheduler / GitHub Actions / Windows Task Scheduler
Secrets: Secret Manager / 環境変数
Auth: Google Workspace / Microsoft Entra ID / 社内SSO
```

## 12. 既知の課題

- 現状は認証なし
- 現状はJSONファイル保存のため複数人同時操作に弱い
- 送信履歴・承認履歴のDB設計が未確定
- OneStream取得のレート制限・再試行・差分取得が未完成
- エラー時の自動再実行や通知が未完成
- Notionとローカルデータの同期方針が未確定
- Slack/Chatwork投稿先IDの管理が未完成
- 受講履歴に基づくおすすめ講義の精度向上が必要
- 面談情報の正データソース確認が必要
- サーバー移行時の認証・権限・監査ログが未実装
- 一部スクリプトにローカルPC前提の絶対パスが残っているため、サーバー移行前に設定値化または環境変数化が必要

## 13. レビューしてほしい観点

1. 将来サーバー移行しやすい構成か
2. MVPとしてローカルJSON保存を続ける場合のリスクはどこか
3. DB化するならどの粒度で分けるべきか
4. 200社規模・毎営業日20社取得に耐えられるか
5. OneStream API取得の負荷・タイムアウト対策は妥当か
6. Slack/Chatwork誤投稿防止は十分か
7. 承認フロー、送信履歴、監査ログに不足がないか
8. 認証・権限設計はどう分けるべきか
9. Secret管理に問題がないか
10. 複数人同時利用時の競合対策はどうすべきか
11. Notion/OneStream/Slack/Chatwork連携の責務分離は妥当か
12. 事故時のリカバリー方針に不足がないか
13. 将来的に自動投稿へ進める場合、どこまで人間承認を残すべきか

## 14. レビュー時に見てほしいコード

優先順:

```text
preview-manager/server.js
preview-manager/public/app.js
preview-manager/public/index.html
preview-manager/scripts/import-notion-companies.cjs
preview-manager/scripts/update-watch-reports.cjs
preview-manager/scripts/sync-chatwork-room-ids.cjs
preview-manager/.env.example
preview-manager/README.md
```

実データ入りファイルは共有しないでください。

除外推奨:

```text
preview-manager/.env
preview-manager/.env.txt
preview-manager/data/previews.json
preview-manager/data/watch-reports/
preview-manager/data/chatwork-room-id-sync-report.csv
preview-manager/data/watch-report-run.json
work/
outputs/
```

## 15. レビュー依頼メッセージ例

```text
CS向けの受講履歴通知botのMVPを作っています。
現在はローカルサーバーで動くHTML管理画面ですが、将来的には社内向けサーバー/クラウドに移行予定です。

Notionの受講企業マスター、OneStream視聴履歴、Slack/Chatwork投稿を連携し、
毎営業日20社程度の通知プレビュー作成と承認後投稿を目指しています。

特に、サーバー移行、DB設計、認証/権限、投稿事故防止、API取得負荷、監査ログの観点でレビューしてほしいです。
実データやAPIキーは共有していません。
```
