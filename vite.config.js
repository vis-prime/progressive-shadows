import viteCompression from "vite-plugin-compression"

export default {
  build: {
    outDir: "./docs/",
    chunkSizeWarningLimit: 1000,
  },
  publicDir: "assets",
  base: "./",
  server: {
    port: 3000,
  },
  plugins: [viteCompression()],
}
