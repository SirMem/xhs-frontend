import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 1. 关键配置：飞书插件必须使用相对路径 './'，否则部署后找不到资源
  base: './',
  css: {
    preprocessorOptions: {
      less: {
        // 2. 关键配置：Semi UI 需要开启 JavaScript 支持
        javascriptEnabled: true,
      },
    },
  },
  server: {
    // 3. 关键配置：开启 HTTPS (虽然是自签名)，这是飞书插件本地调试的最佳实践
    // 如果你只想用 HTTP 也可以，但记得端口最好固定
    port: 3000,
    host: true
  }
})