import { resolve } from "path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Icons from "unplugin-icons/vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
    resolve: {
      alias: {
        "@main": resolve(__dirname, "electron/main"),
        "@shared": resolve(__dirname, "shared"),
        "@splayer/smtc-lyric": resolve(__dirname, "native/smtc-lyric"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "shared"),
      },
    },
  },
  renderer: {
    root: ".",
    server: {
      port: 14568,
      watch: {
        ignored: ["**/native/**/target/**"],
      },
    },
    build: {
      rollupOptions: {
        input: {
          "taskbar-lyric": resolve(__dirname, "windows/taskbar-lyric/index.html"),
          "settings": resolve(__dirname, "windows/settings/index.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@shared": resolve(__dirname, "shared"),
        "@windows": resolve(__dirname, "windows"),
      },
    },
    plugins: [
      vue(),
      AutoImport({
        imports: ["vue"],
        dts: "./src/types/auto-imports.d.ts",
      }),
      Icons({
        compiler: "vue3",
        scale: 1,
        autoInstall: false,
      }),
    ],
  },
});
