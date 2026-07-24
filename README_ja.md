# Dashboard Hub

[English](README.md) | [日本語](README_ja.md)

**Obsidian Vaultを、「見る」だけでなく「その場で動かせる」ワークスペースに。**

Dashboard Hubは、Obsidian Bases、ノートやPDFに紐づくメモ、Kanban、Calendar、
Timeline、Webページ、パスワードで保護したシークレットを、ひとつのダッシュボードに
まとめられるObsidianプラグインです。プロジェクトボードとカレンダーを並べたり、
タイムラインの横に関連資料を置いたり、PDFやEPUBを読みながら引用付きのメモを残したり。
Obsidianから離れることなく、情報を見る場所と作業する場所をひとつにできます。

![Kanban、Calendar、Timelineを配置したDashboard Hub](docs/images/dashboard-overview.png)

Dashboard Hubは単体で動作します。AIアカウント、APIキー、外部データベースは必要ありません。

## Vaultを、自分の仕事場に

- **Vaultのホーム画面を作る。** Obsidian Bases、ノート、ドキュメント、Webサイト、
  タスク、予定、個人用ツールを、ひとつの画面に自由に配置できます。
- **ダッシュボードから直接操作する。** Kanbanカードを動かせば、元ノートの
  frontmatterも更新されます。テキストファイルの編集、Timelineへの投稿、
  Calendarへの予定追加も、その場で完結します。
- **用途に合わせてレイアウトする。** ウィジェットはドラッグ、リサイズ、最大化、
  個別設定が可能です。Undo・Redoに加え、全体を見やすい行や列へ自動整列できます。
  小さな画面向けのレイアウトも自動生成されます。
- **データを自分の手元に残す。** ダッシュボードは読みやすいYAML形式です。
  Timelineの投稿、読書メモ、Kanban定義、暗号化したシークレットもVault内の
  ファイルとして保存されます。独自データベースや常時稼働する外部サービスは不要です。
- **各ツールを単体でも使う。** フルダッシュボードが必要ないときは、ランチャーから
  Workflow、Timeline、Calendar、Kanban、MemoList、Secret Managerを直接開けます。

![ダッシュボード上でウィジェットを並べ替える](docs/images/dashboard-arrange.gif)

## 内蔵ウィジェット

| ウィジェット | できること |
| --- | --- |
| **Base** | Obsidian標準のBasesをテーブル、カード、リスト形式で表示。最初のビューはDashboard Hubから編集できます。 |
| **File** | Markdown、テキスト、HTML、画像、PDF、EPUB、コード、CSVなどを表示。プレーンテキスト形式はその場で編集できます。 |
| **Web Embed** | 埋め込み可能なHTTP／HTTPSページを表示。ブラウザで開くためのショートカットも備えています。 |
| **Kanban** | frontmatterのステータスごとにノートをカード表示。カードの移動は元ノートへ反映され、ボード定義は複数のダッシュボードで再利用できます。 |
| **Timeline** | タグ、Wikiリンク、ピン留め、絞り込み、画像添付に対応した、自分用の時系列フィードです。 |
| **Calendar** | Timelineに登録した予定とアクティビティを月表示で確認し、日ごとの詳細を開けます。 |
| **MemoList** | ダッシュボード内のファイルから集めた読書メモを、横断検索できる一覧です。 |
| **Secret Manager** | パスワードで保護された `.encrypted` ファイルを検索、解除、コピー、編集できます。 |
| **Workflow** | 接続したHubのWorkflowを実行し、MarkdownまたはHTMLの結果をダッシュボードに表示します。 |

## 読み、メモし、元の場所へ戻る

Fileウィジェットを使えば、ダッシュボードは単なる一覧ではなく、読書のための
ワークスペースになります。PDF、EPUB、MarkdownなどのVault内ファイルを開き、
文章を選択して、引用箇所の文脈と一緒にメモを保存できます。メモパネルを開いている間は
保存済みの範囲がハイライトされ、リンクから引用元へ戻ることもできます。
MemoListは、複数の資料に残したメモをひとつの検索可能な一覧にまとめます。

![PDFから引用付きの読書メモを作成する](docs/images/dashboard-memos.gif)

## はじめかた

1. Dashboard Hubをインストールして有効にします。
2. コマンドパレットから **Dashboard Hub: Create dashboard** を実行するか、
   リボンのロケットアイコンからランチャーを開きます。
3. **Add widget** でウィジェットを追加し、設定後にドラッグやリサイズで配置します。

変更内容は自動保存されます。既定の **Base directory** は `Dashboards` で、
Dashboard Hubの設定から変更できます。新しいダッシュボードと関連ファイルは、
このディレクトリ以下の次の場所に作られます。

```text
Dashboards/
├── *.dashboard             # YAML形式のダッシュボード定義
├── Bases/                  # Obsidianの.baseファイル
├── Kanbans/                # 再利用可能な.kanban定義
├── Memos/                  # 読書メモ
└── Timeline/<name>/        # Timelineの投稿と添付ファイル
```

Secret Managerは、標準では `Secrets/` 以下に `.encrypted` ファイルを保存します。
各ファイルがパスワード保護された秘密鍵とsaltを内包するため、解除に必要なのは
パスワードだけです。Base directoryを変更しても、既存ファイルは移動されません。

## オプション：AI機能を追加する

Dashboard Hubは単体ですべての基本機能を利用できます。互換性のあるObsidian
プラグインを追加すると、ダッシュボードの管理主体を移すことなくAI機能を利用できます。
Obsidianのコミュニティプラグインで **Gemini Helper** または **Local LLM Hub** を
検索し、いずれかをインストールしてください。

連携したプラグインを使うと、選択範囲や読書メモについての質問、Baseの生成・編集、
Timeline投稿の書き換え、Workflowの作成・編集・実行が可能になります。モデル選択、
キャンセル、検証、変更前後のレビュー、適用フローはDashboard Hubが担当し、連携した
プラグインがモデルの提供とリクエストの実行を担当します。

**[LLM Hub](https://github.com/takeshy/obsidian-llm-hub)** にも対応しています。
LLM HubはObsidianのコミュニティプラグインでは配布されていないため、GitHub
リポジトリから別途インストールしてください。

## ソースからインストール

Dashboard HubにはObsidian 1.10.0以降が必要です。

```bash
npm install
npm run build
```

`main.js`、`manifest.json`、`styles.css` を次のフォルダへコピーします。

```text
<your-vault>/.obsidian/plugins/dashboard-hub/
```

Obsidianを再読み込みし、コミュニティプラグインの設定から **Dashboard Hub** を
有効にしてください。

## 開発

```bash
npm test
npm run build
```
