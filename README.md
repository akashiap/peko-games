# 🎮 ペコせんぱいのミニゲーセン

スマホでさくっと遊べる、こども向け無料ミニゲーム集です。
親子・家族で楽しめます。インストール不要、ブラウザですぐに遊べます（PWA対応）。

## 🌐 あそぶ

**👉 [https://akashiap.github.io/peko-games/](https://akashiap.github.io/peko-games/)**

## 🕹 ゲーム一覧

| ゲーム | 人数 | あそびかた |
|--------|------|------------|
| [リバーシ](https://akashiap.github.io/peko-games/games/reversi/) | 1〜2人 | くろとしろ、はさんでひっくりかえそう。CPUは10段階のつよさ |
| [五目ならべ](https://akashiap.github.io/peko-games/games/gomoku/) | 1〜2人 | タテ・ヨコ・ナナメに5つそろえたらかち！ |
| [しんけいすいじゃく](https://akashiap.github.io/peko-games/games/memory/) | 1〜2人 | おなじカードを2まいみつけよう。きおくりょくでしょうぶ！ |
| [ポーカー](https://akashiap.github.io/peko-games/games/poker/) | 1人 | いいてふだそろえてやくをつくろう！ |
| [すごろく](https://akashiap.github.io/peko-games/games/sugoroku/) | 2〜4人 | サイコロをふってゴールをめざそう。なかまといっしょに！ |
| [ピンボール](https://akashiap.github.io/peko-games/games/pinball/) | 1人 | フリッパーでたまをはじいてハイスコアをめざせ！ |
| [ぶんしょうスロット](https://akashiap.github.io/peko-games/games/slot/) | 1〜3人 | ことばをそろえておかしなぶんしょうをつくろう！ |
| [わだいルーレット](https://akashiap.github.io/peko-games/games/roulette/) | 2人〜 | ドラムをまわして、みんなでおはなしするわだいを決めよう！ |
| [オカメラン](https://akashiap.github.io/peko-games/games/okameran/) | 1人 | おでかけしたオカメインコはおうちにかえれるかな？ |

## 🛠 技術メモ

- バニラ JavaScript / CSS / HTML のみ（外部ライブラリ・フレームワーク不使用）
- 効果音は Web Audio API で動的生成（音源ファイルなし）
- PWA（オフライン対応・ホーム画面に追加可能）
- GitHub Actions により `src/` を GitHub Pages へ自動デプロイ

## 📁 構成

```
src/            公開ディレクトリ（GitHub Pages の配信対象）
├── index.html  トップ（ゲーム一覧）
├── games/      各ゲーム（reversi, gomoku, memory, poker, sugoroku,
│               pinball, slot, roulette, okameran）
├── icon/ img/  アイコン・画像
└── manifest.webmanifest / sw.js  PWA 関連
```

---

© 2026 ペコせんぱい
