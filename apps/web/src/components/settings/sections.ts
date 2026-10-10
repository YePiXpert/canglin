import type { InjectionKey } from 'vue';

/**
 * /settings 里的区块：SettingsLayout 子导航「系统」一组的锚点，和 SettingsView 里各面板的 id 共用这一份。
 * id 也是地址里的 #hash（/settings#ai），书签与新标签页打开时直接定位到区块。
 */
export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: '外观' },
  { id: 'account', label: '账号安全' },
  { id: 'status', label: '系统状态' },
  { id: 'ai', label: 'AI 助手' },
  { id: 'auto-backup', label: '自动备份' },
  { id: 'backups', label: '备份管理' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

export function isSettingsSection(id: string): id is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === id);
}

/**
 * SettingsLayout 提供：把 <main> 滚到某个区块，并在子导航里把它标为当前项。
 * SettingsView 载入完成后按地址里的 #hash 调用一次（从别的子页点锚点过来、或直接打开带 # 的地址）。
 */
export const SETTINGS_JUMP: InjectionKey<(id: SettingsSectionId, smooth?: boolean) => void> = Symbol('settings-jump');
