/** 静态资源模块声明（vite 处理的资源导入） */
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.ico" {
  const src: string;
  export default src;
}
declare module "*.woff2" {
  const src: string;
  export default src;
}

/** unplugin-icons 虚拟模块（编译期由插件解析） */
declare module "~icons/lucide/skip-back" {
  const component: import("vue").DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
declare module "~icons/lucide/skip-forward" {
  const component: import("vue").DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
declare module "~icons/lucide/play" {
  const component: import("vue").DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
declare module "~icons/lucide/pause" {
  const component: import("vue").DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
