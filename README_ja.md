# Dashboard Hub

[English](README.md) | [日本語](README_ja.md)

**Vaultをひとつの画面に。大切な作業の履歴も、そこに。**

Dashboard Hubは、ひとつの考えを中心に作られたObsidianプラグインです。それは、
作業に使うツールがその足跡を残すべきだということ。Kanbanカードを移動する、予定を
変更する、読書メモを保存する。Dashboard HubはそれらをTimelineへ記録します。
Timelineは日付ごとのプレーンなMarkdownで構成され、あなたのVaultに残り続けます。

その履歴を中心に、Obsidian Bases、Kanban、Calendar、PDF・EPUBの読書環境、
Webページの埋め込み、そして日常的に使う認証情報のためのパスワード保護された
Secret Managerが並びます。

![Kanban、Calendar、Timelineウィジェットを配置したDashboard Hub](docs/images/dashboard-overview.png)

Dashboard Hubは単体で動作します。AIアカウント、APIキー、外部データベースは不要です。

## Timelineが中心です

多くのダッシュボードが表示するのは現在だけです。Timelineウィジェットは過去を
積み重ねます。タグ、Wikiリンク、ピン留め、フィルター、画像添付に対応した時系列の
フィードへ直接投稿できるだけでなく、作業に応じて自動的に記録が増えていきます。

| 操作 | Timelineに記録される内容 |
| --- | --- |
| Kanbanカードを別の列へ移動 | ボード名、ノートへのリンク、`変更前の状態` → `変更後の状態` |
| Calendarの予定日を変更 | 予定の概要、`変更前の日付` → `変更後の日付` |
| 読書メモを作成・編集・削除 | 操作、元文書へのリンク、引用を含むメモ |
| 自分で投稿を書く | メモ、取り組んでいること、考えを変えた理由など、書いた内容そのもの |

![Calendarの予定と自動記録された読書メモを表示するTimeline](docs/images/dashboard-timeline.png)

各項目はObsidianのcalloutとして
`<Base directory>/Timeline/<name>/YYYY-MM-DD.md` に追記されます。1日1ファイルで、
項目同士は `---` で区切られます。データベースの中に隠されるものはありません。
先週火曜日の記録をテキストエディターで読み、grepし、バックアップし、通常のノート
として開けます。

ここから、次の2つの特徴が生まれます。

- **Calendarは独立した保存先ではなく、Timelineのビューです。** 指定したTimelineの
  予定とアクティビティを、日ごとの詳細を持つ月間表示へまとめます。
- **アクティビティログは検索可能なファイルツリーです。** 「12日に何をした？」の答えは
  1つのファイルにあります。この構造は、Vaultを読み取れるAIプラグインへの自然な入力に
  なります（[オプション：AI機能を追加する](#オプションai機能を追加する)）。

メモ、Kanban、Calendarの自動アクティビティは、既定では `Timeline` という1つの
Timelineへ集約されます。別のログを使う場合は、Dashboard Hubの全体設定にある
**Activity Timeline name** を変更します。

## Secret Managerへ、最短でアクセス

日常的に使うAPIキー、トークン、ログイン情報は、標準では `Secrets/` 以下の
`.encrypted` ファイルに保存されます。

リボンのロケットランチャーから **Secret Manager** を開き、IDの一部を入力して値を
コピーできます。一度解除すると、同じパスワードで保護されたsecretは、そのセッション中
に再度パスワードを入力する必要がありません。それぞれに独自のメタデータフィールドを
追加でき、値はその場で編集できます。

**仕組み。** 各 `.encrypted` ファイルは、パスワードで保護された秘密鍵とsaltを
内包します。失う可能性のあるプラグイン単位のキーチェーンやVault全体のマスターファイルは
ありません。secretの値はAES-GCMで暗号化し、ランダムなデータ鍵をRSA-OAEPでラップします。
これにより書き込み権限と解除権限を分離し、パスワード保護された秘密鍵を解除しなくても、
公開鍵だけでデータを暗号化できます。

新規ファイルは暗号形式version 1を明記し、PBKDF2-SHA256を600,000回適用して秘密鍵を
保護します。バージョン情報のない従来ファイルも、元の100,000回のパラメータで引き続き
読み取れます。セッションパスワードはメモリだけに保持し、プラグインの無効化または
Obsidianの終了時に消去します。復号した秘密鍵は復号処理中にだけ一時的に使用します。
機密情報をプラグイン設定へ書き込むことはありません。

Secret Managerは、Vault内の情報をすばやく取り出すための機能です。十分な監査を受けた
堅牢なパスワードマネージャーの代わりではありません。ファイルの安全性は、設定した
パスワードの安全性に依存します。

## 読み、注釈を残し、元の場所へ戻る

Fileウィジェットは、ダッシュボードを眺めるだけでなく読むための場所にします。PDF、
EPUB、Markdownノートを開き、文章を選択して引用コンテキスト付きのメモを保存できます。
メモパネルを開いている間は保存した範囲がハイライトされ、リンクから引用元へ戻れます。
MemoListはそれらの注釈を検索可能な一覧にまとめます。各メモはTimelineにも記録されるため、
1か月後でも、何をハイライトしたかだけでなく、いつ読んでいたかを確認できます。

![PDFからリンク付き読書メモを作成](docs/images/dashboard-memos.gif)

## 必要な画面を組み立てる

Obsidian Bases、ノート、文書、Webサイト、タスク、予定をひとつの画面に配置できます。
ウィジェットの移動、リサイズ、最大化、設定、元に戻す・やり直すに対応し、レイアウト全体を
均等な行または列へ整列できます。小さな画面向けのレイアウトは自動生成され、編集内容は
その都度保存されます。

![ダッシュボード上のウィジェットを再配置](docs/images/dashboard-arrange.gif)

各ダッシュボードは、仕様が文書化された読みやすいYAMLの `.dashboard` ファイルです。
一般的なツールで内容を確認し、バージョン管理し、検索し、バックアップできます。
動かし続ける必要のある外部データベースやサービスはありません。

## ウィジェット

| ウィジェット | ダッシュボードに追加される機能 |
| --- | --- |
| **Timeline** | 他のウィジェットによる自動記録と自分の投稿をまとめたアクティビティログ。タグ、Wikiリンク、ピン留め、フィルター、画像添付に対応します。 |
| **Calendar** | Timelineの予定とアクティビティを月間表示へまとめます。予定日の変更もTimelineへ記録します。 |
| **Kanban** | frontmatterのステータスでノートを分類します。カードの移動は元ノートを更新し、変更を記録します。ボード定義は複数のダッシュボードで再利用できます。 |
| **Secret Manager** | パスワード保護された `.encrypted` ファイルを検索、解除、コピー、その場で編集できます。secretごとのメタデータにも対応します。 |
| **File** | Markdown、テキスト、HTML、画像、PDF、EPUB、コード、CSVなどを表示します。プレーンテキストは直接編集でき、PDF、EPUB、Markdownでは引用と結び付いたメモを作成できます。 |
| **MemoList** | 設定したBase directory以下に保存された読書メモの検索可能な一覧です。 |
| **Base** | Obsidian標準のBasesをテーブル、カード、リストで表示し、先頭ビューを編集できます。 |
| **Web Embed** | 埋め込み可能なHTTPまたはHTTPSページを表示し、ブラウザーで開くリンクも提供します。 |
| **Workflow** | 連携したHubのWorkflowを実行し、MarkdownまたはHTMLの出力をダッシュボードへ保持します。 |

主要なアクティビティツールは単体でも利用できます。ランチャーからDashboard、Workflow、
Timeline、Calendar、MemoList、Kanban、Secret Managerを直接開けるため、完全な
ダッシュボードを作る必要はありません。

![各アクティビティツールを直接開くDashboard Hubランチャー](docs/images/dashboard-launcher.png)

## はじめる

1. Dashboard Hubをインストールして有効にします。Obsidian 1.10.0以降が必要です。
2. リボンのロケットランチャーを開くか、コマンドパレットから
   **Dashboard Hub: Create dashboard** を実行します。
3. **Add widget** を選択して設定し、目的の場所へ移動またはリサイズします。

標準の **Base directory** は `Dashboards` です。Dashboard Hubの設定から変更できます。
メモ、Kanban、Calendarの自動アクティビティは、既定では `Timeline` という名前の
1つのTimelineへ集約され、この名前も同じ設定画面から全体で変更できます。新しい
ダッシュボードと関連ファイルは、そのディレクトリ以下へ次のように保存されます。

```text
Dashboards/
├── *.dashboard             # YAML形式のダッシュボード定義
├── Bases/                  # Obsidianの.baseファイル
├── Kanbans/                # 再利用可能な.kanban定義
├── Memos/                  # 読書メモ
└── Timeline/<name>/        # 1日1ファイルのアクティビティログと添付ファイル
```

Secret Managerは標準では `Secrets/` 以下の `.encrypted` ファイルを使用します。
Base directoryを変更しても既存ファイルは移動されません。

インターフェースは英語、日本語、スペイン語、フランス語、中国語、韓国語、ポルトガル語、
イタリア語、ドイツ語に対応しています。

## オプション：AI機能を追加する

Dashboard Hubは単体ですべての基本機能を利用できます。互換性のあるObsidianプラグインを
追加すると、ダッシュボードの管理主体を移すことなくAI機能を利用できます。
Obsidianのコミュニティプラグインで
**[Gemini Helper](https://github.com/takeshy/obsidian-gemini-helper)**、
**[Local LLM Hub](https://github.com/takeshy/obsidian-local-llm-hub)**、または
**[LLM Hub](https://github.com/takeshy/obsidian-llm-hub)** を検索し、環境に合うものを
インストールしてください。

連携したプラグインを使うと、選択範囲や読書メモについての質問、Baseの生成・編集、
Timeline投稿の書き換え、Workflowの作成・編集・実行が可能になります。モデル選択、
キャンセル、検証、変更前後のレビュー、ApplyフローはDashboard Hubが担当し、連携した
プラグインがモデルの提供とリクエストの実行を担当します。

設定したアクティビティTimelineはVault内の日付付きプレーンMarkdownなので、Vaultへ
アクセスできるAIプラグインは直接読み取れます。Dashboard HubはBase directoryと
Timeline名を連携プラグインへ公開するため、日付に基づく質問では履歴全体を走査せず、
指定日のファイルだけを読み取れます。

## ソースからインストール

```bash
npm install
npm run build
```

`main.js`、`manifest.json`、`styles.css` を次のディレクトリへコピーします。

```text
<your-vault>/.obsidian/plugins/dashboard-hub/
```

Obsidianを再読み込みし、コミュニティプラグインから **Dashboard Hub** を有効にします。

## 開発

```bash
npm test     # vitest
npm run build
```

## ライセンス

MIT
