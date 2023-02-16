import {
  EffectComposer,
  EffectPass,
  RenderPass,
  DotScreenEffect,
  BlendFunction,
  SelectiveBloomEffect,
  DepthOfFieldEffect,
} from "postprocessing"
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three"
import { SSREffect } from "screen-space-reflections"

let scene, camera, renderer

/**
 * @type {EffectComposer}
 */
let composer // global

const EFFECTS = {
  bloom: null,
  dotScreen: null,
  dof: null,
}

const PASSES = {
  RENDER: null,
}

const GUI_FUNCTIONS = {
  bloom: null,
  ssr: null,
  ssao: null,
}

const PARAMS = {
  dof: { enabled: true },
  dotScreen: { enabled: false },

  bloom: {
    enabled: true,
    luminanceThreshold: 0.5,
    luminanceSmoothing: 0.3,
    mipmapBlur: true,
    intensity: 3.5,
    radius: 0.5,
  },
}

export class PostProcess {
  /**
   *
   * @param {Scene} _scene
   * @param {PerspectiveCamera} _camera
   * @param {WebGLRenderer} _renderer
   */
  constructor(_scene, _camera, _renderer) {
    scene = _scene
    camera = _camera
    renderer = _renderer

    this.focus = new Vector3()

    this.effects = EFFECTS
    this.init()
  }
  init() {
    composer = new EffectComposer(renderer, {
      multisampling: Math.min(4, renderer.capabilities.maxSamples),
    })

    // shortcut to render
    this.render = () => {
      composer.render()
    }

    PASSES.RENDER = new RenderPass(scene, camera)
    composer.addPass(PASSES.RENDER)
    this.setSize()

    this.setupBloom()

    this.setupDOTScreen()

    this.setupDOF()
    this.updateEffectPasses()
  }
  setSize(x = window.innerWidth, y = window.innerHeight) {
    composer.setSize(x, y)
  }

  setupDOTScreen() {
    EFFECTS.dotScreen = new DotScreenEffect()
  }

  setupBloom() {
    const effect = new SelectiveBloomEffect(scene, camera, PARAMS.bloom)

    effect.inverted = true
    EFFECTS.bloom = effect
    effect.blendMode.opacity["value"] = 0.2
    effect.ignoreBackground = true
    GUI_FUNCTIONS.bloom = (gui) => {
      const folder = gui.addFolder("Bloom")
      folder.add(effect, "intensity", 0, 10, 0.01)
      folder.add(effect.mipmapBlurPass, "radius", 0, 1, 1e-3)
      folder.add(effect.mipmapBlurPass, "levels", 1, 9, 1)

      let subfolder = folder.addFolder("Luminance Filter")
      subfolder.add(effect.luminancePass, "enabled")
      subfolder.add(effect.luminanceMaterial, "threshold", 0, 1, 0.01)
      subfolder.add(effect.luminanceMaterial, "smoothing", 0, 1, 0.01)

      subfolder = folder.addFolder("Selection")
      subfolder.add(effect, "inverted")
      subfolder.add(effect, "ignoreBackground")

      folder.add(effect.blendMode.opacity, "value", 0, 1, 0.01)
      folder.add(effect.blendMode, "blendFunction", BlendFunction)
    }
  }

  setupDOF() {
    const effect = new DepthOfFieldEffect(camera, { bokehScale: 3, worldFocusRange: 5 })
    effect.target = this.focus
    EFFECTS.dof = effect
    console.log(effect)
    effect.resolution["scale"] = 0.6
    GUI_FUNCTIONS.dof = (gui) => {
      const folder = gui.addFolder("dof")

      folder.add(effect.resolution, "scale", 0.1, 1, 0.05)

      //   folder.add(effect.blurPass, "kernelSize", KernelSize)
      //   folder.add(effect.cocMaterial, "worldFocusDistance", 0, 50, 0.1)
      folder.add(effect.cocMaterial, "worldFocusRange", 0, 20, 0.1)
      folder.add(effect, "bokehScale", 0, 7, 1e-2)
      //   folder.add(effect.blendMode.opacity, "value", 0, 1, 0.01)
      //   folder.add(effect.blendMode, "blendFunction", BlendFunction)
    }
  }

  disableAllEffects() {
    composer.removeAllPasses()
    composer.addPass(PASSES.RENDER)
  }

  updateEffectPasses() {
    // remove all passes
    if (this.effectPass) {
      composer.removeAllPasses()
      composer.addPass(PASSES.RENDER) // add render pass
      this.effectPass.dispose()

      this.removedItems.length = 0
    }

    // check params and find all enabled passes
    const enabledEffects = [] // array of passes to add
    for (const [name, params] of Object.entries(PARAMS)) {
      if (params.enabled) {
        if (EFFECTS[name]) {
          enabledEffects.push(EFFECTS[name])
        }
      }
    }
    this.updateEffectsGui()
    if (!enabledEffects.length) {
      // No Effects enabled
      return
    }

    this.effectPass = new EffectPass(camera, ...enabledEffects)
    composer.addPass(this.effectPass)
    console.log("UPDATED", composer.passes, this.effectPass.effects)
  }

  addGui(gui) {
    const folder = (this.gui = gui.addFolder("POST"))
    // folder.add(this, "disableAllEffects").name("Disable all Effects")

    this.toggleGui = this.gui.addFolder("TOGGLE")
    this.effectsGui = this.gui.addFolder("EFFECTS")
    for (const [name, params] of Object.entries(PARAMS)) {
      this.toggleGui
        .add(params, "enabled")
        .name(name)
        .onChange(() => {
          this.updateEffectPasses()
        })
    }

    this.updateEffectsGui()
  }

  updateEffectsGui() {
    if (!this.effectsGui) {
      return
    }

    for (const child of [...this.effectsGui.children]) {
      child.destroy()
    }

    for (const [key, guiFunc] of Object.entries(GUI_FUNCTIONS)) {
      if (PARAMS[key]?.enabled && guiFunc) {
        guiFunc(this.effectsGui)
      }
    }
  }
}
