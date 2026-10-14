/** 下拉选项：Select.vue（reka 弹层）与 NativeSelect.vue（原生皮肤）共用 */
export interface SelectOption {
  label: string;
  value: string;
}

/** 下拉菜单项：Menu.vue 用 */
export interface MenuItem {
  label: string;
  icon?: string;
  /** 危险动作（删除、撤销）：朱砂字；动作本身仍要走确认弹窗 */
  danger?: boolean;
  disabled?: boolean;
  /** 选中后执行；菜单会先自己关上 */
  onSelect?: () => void;
}

/** Notice 的列表用法（items）：每条一行，可以各带图标；不传 icon 用 Notice 自己的图标 */
export interface NoticeItem {
  text: string;
  icon?: string;
}
