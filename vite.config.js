import { prune, dedup, textureCompress, draco } from "@gltf-transform/functions"
import viteCompression from "vite-plugin-compression"
import gltf from "vite-plugin-gltf"
import sharp from "sharp"

const resolution = 1024
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
  plugins: [
    gltf({
      transforms: [
        // remove unused resources
        prune(),

        // combine duplicated resources
        dedup(),

        textureCompress({
          targetFormat: "webp",
          encoder: sharp,
          resize: [resolution, resolution],
        }),

        // compress mesh geometry
        draco(),
      ],
    }),

    viteCompression(),
  ],
}
