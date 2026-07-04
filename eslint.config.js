import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // eslint-plugin-react-hooks v7 の recommended には React Compiler 世代の
      // 実験的ルール群が含まれる。本プロジェクトはコンパイラ非対応の巨大ページ
      // コンポーネントで書かれており、これらは誤検知が大半（例: rules-of-hooks は
      // useItem/useBloodBox/useStatReset のような「アイテムを使う」系ゲーム関数を
      // フックと誤認する）。コンパイラ導入までは無効化する。
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      // 先頭 _ の変数・引数は「意図的に未使用」の慣習。未使用catch束縛も許容する。
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 日本語UIでは全角スペース(U+3000)を表示テキストの区切りとして意図的に使う。
      // コード中の紛れ込みは検出しつつ、表示文字列(JSXテキスト/テンプレート)は許可する。
      'no-irregular-whitespace': ['error', {
        skipStrings: true,
        skipTemplates: true,
        skipJSXText: true,
        skipComments: true,
        skipRegExps: true,
      }],
    },
  },
  {
    // Game.jsx は戦闘ロジック(executeSkill/AREAS/各種計算)を他ページと共有する
    // モジュールを兼ねており、ScarecrowGuard は制限フックとガード画面をペアで公開する。
    // fast-refresh 専用ルールのため本番挙動に影響はなく、意図的な同居を許容する。
    files: ['src/pages/Game.jsx', 'src/components/ScarecrowGuard.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
