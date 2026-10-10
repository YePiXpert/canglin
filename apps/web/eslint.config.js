import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'dev-dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
    },
    rules: {
      // Badge / Dialog / Button 这类 UI 基元是刻意的单词命名，目录结构已表达归属
      'vue/multi-word-component-names': 'off',
      // 下面是一组纯模板排版规则：与既有的紧凑单行风格冲突，
      // 重排会生成 2000+ 行无语义 diff，交给 Prettier 之类再议
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      // TS 的 ? 可选标注已表达意图，不强制每条可选 prop 都写 default
      'vue/require-default-prop': 'off',
      'vue/attributes-order': 'off',
    },
  },
);
