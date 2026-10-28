import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { bindRouter, onUnauthorized, apiError } from './api/client';
import { useAuthStore } from './stores/auth';
import { useThemeStore } from './stores/theme';
import { useToastStore } from './stores/toast';
import { registerSW } from 'virtual:pwa-register';
import { setupAutoUpdate } from './pwa';
import './styles/main.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
bindRouter(router);

// 主题要在挂载前就位：.dark 类决定整站令牌取值（index.html 已预置，这里校准并接管后续切换）
useThemeStore(pinia).init();

// 会话过期：清除登录态再跳登录页，避免守卫依据旧状态把用户弹回工作台
onUnauthorized(() => {
  useAuthStore(pinia).loggedIn = false;
});

// 全局兜底：未捕获的组件错误与 Promise 拒绝以 toast 呈现，而不是白屏/静默
app.config.errorHandler = (err) => {
  console.error(err);
  useToastStore(pinia).error('页面出现异常，请刷新重试');
};
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  useToastStore(pinia).error(apiError(e.reason));
});

app.use(router);

// 首屏骨架由 index.html 提供，等首个路由解析完再撤掉，避免闪一帧空白
void router.isReady().finally(() => {
  document.documentElement.classList.add('app-ready');
  document.getElementById('boot')?.remove();
});

app.mount('#app');

// 新版本在下次切换页面时载入（见 pwa.ts）；旧页面加载已被新版本删掉的分片会失败，这时直接刷新。
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});
setupAutoUpdate(router, registerSW);
