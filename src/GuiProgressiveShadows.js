import { Color } from "three"
import { ProgressiveShadows } from "./ProgressiveShadows"

/**
 * Pass Lil or Dat gui to create control folder
 * @param {ProgressiveShadows} ps
 * @param {GUI} gui
 */
export function guiProgressiveShadows(ps, gui) {
  const custom = {
    save: () => {
      saveShadowsAsImage(ps)
    },
  }
  const folder = gui.addFolder("Progressive Shadows")
  folder.open()
  folder.add(ps.params, "enabled")
  folder.add(ps.params, "frames", 10, 500, 1).onFinishChange(() => {
    ps.recalculate()
  })
  folder.add(ps.params, "lightRadius", 0, 30, 0.1).onFinishChange(() => {
    ps.recalculate()
  })
  folder.add(ps.params, "ambientWeight", 0, 1, 0.1).onFinishChange(() => {
    ps.recalculate()
  })

  folder.addColor(ps.shadowCatcherMaterial, "color")
  folder.add(ps.shadowCatcherMaterial, "blend", 0, 2, 0.01)
  folder.add(ps.shadowCatcherMaterial, "opacity", 0, 1, 0.01)
  folder.add(ps.params, "alphaTest", 0, 1, 0.01).onChange((v) => {
    ps.shadowCatcherMaterial.alphaTest = v
  })
  folder.add(ps.params, "debugHelpers").onChange((v) => {
    ps.showDebugHelpers(v)
  })
  folder.add(ps, "recalculate")
  folder.add(ps, "clear")
  folder.add(custom, "save").name("Save Shadow Image")
  folder.add(ps, "progress", 0, 100, 1).listen().disable()
}

let canvas
let uint8ClampedArray
let color
/**
 * Save Shadows as As Image
 * @param {ProgressiveShadows} ps
 */
function saveShadowsAsImage(ps) {
  if (!canvas) {
    canvas = document.createElement("canvas")
    color = new Color()
  }

  const renderTarget = ps.progressiveLightMap1
  const width = renderTarget.width
  const height = renderTarget.height
  console.log(renderTarget)
  const pixels = new Float32Array(width * height * 4)
  ps.renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)
  const shadowColor = ps.shadowCatcherMaterial.color
  const blend = ps.shadowCatcherMaterial.blend

  let min = 100000,
    max = 0
  for (let i = 0; i < pixels.length; i += 4) {
    min = Math.min(min, pixels[i])
    max = Math.max(max, pixels[i])
  }

  const range = max - min
  const alphaScale = 1 / range

  for (let i = 0; i < pixels.length; i += 4) {
    color.fromArray(pixels, i)
    const diffuse = color.r
    const invertedValue = max - diffuse
    const alphaValue = invertedValue * alphaScale
    pixels[i + 3] = alphaValue
    color.setRGB(diffuse * shadowColor.r * blend, diffuse * shadowColor.g * blend, diffuse * shadowColor.b * blend)
    color.convertLinearToSRGB()
    color.toArray(pixels, i)
  }

  if (!uint8ClampedArray || uint8ClampedArray.length !== pixels.length) {
    uint8ClampedArray = new Uint8ClampedArray(pixels.length)
  }

  for (let i = 0; i < pixels.length; i++) {
    uint8ClampedArray[i] = Math.round(pixels[i] * 255)
  }

  // setup canvas to draw the image data onto
  canvas.width = width
  canvas.height = height

  // Draw the image data onto the canvas
  const context = canvas.getContext("2d")
  const imageData = new ImageData(uint8ClampedArray, width, height)
  context.putImageData(imageData, 0, 0)

  // Create a data URL for the image
  const pngUrl = canvas.toDataURL("image/png")

  // Create a new anchor element
  const link = document.createElement("a")

  // Set the href attribute of the anchor element to the PNG data URL
  link.href = pngUrl

  // Set the download attribute of the anchor element to the desired file name
  link.download = "ground_shadows.png"

  // Simulate a click on the anchor element to download the image
  link.click()
}
