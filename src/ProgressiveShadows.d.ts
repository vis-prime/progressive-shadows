import { WebGLRenderer, Scene, Camera, Group } from "three"

export declare class ProgressiveShadows {
  /**
   * Generate Progressive shadows
   *
   * Based on LightMapping example by Zalo https://threejs.org/examples/?q=prog#webgl_shadowmap_progressive
   * & r3F drei's Accumulative Shadows https://github.com/pmndrs/drei/blob/master/src/core/AccumulativeShadows.tsx
   * Forum post https://discourse.threejs.org/t/progressive-lightmap-as-floor-shadow-catcher/41429
   * Big thanks to drcmda/OxcaOa & r3f
   * @param renderer For rendering shadows
   * @param scene To get list of shadow mesh
   * @param userParams Custom options
   * @param userParams.resolution RenderTarget resolution
   * @param userParams.shadowMapRes DirectionLight ShadowMap resolution
   * @param userParams.shadowBias ShadowBias of dir lights
   * @param userParams.lightCount DirectionLight count
   * @param userParams.size meshShadowCatcher size
   * @param userParams.frames Number of frames to run accumulate shadows
   * @param userParams.lightRadius DirectionLight spread , smaller values gives sharper shadows
   * @param userParams.ambientWeight Ratio between directional light vs ambient light
   * @param userParams.alphaTest Alpha test value to be performed on materialShadowCatcher
   * @param userParams.blendWindow Number of frames to blend shadows
   * @param userParams.showHelpers Show line showHelpers to visualize all hidden objects & renderTarget
   */
  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    {
      resolution,
      shadowMapRes,
      shadowBias,
      lightCount,
      size,
      frames,
      blendWindow,
      lightRadius,
      ambientWeight,
      alphaTest,
      showHelpers,
    }?: {
      resolution?: number
      shadowMapRes?: number
      shadowBias?: number
      lightCount?: number
      size?: number
      frames?: number
      blendWindow?: number
      lightRadius?: number
      ambientWeight?: number
      alphaTest?: number
      showHelpers?: boolean
    }
  )

  /**
   * Update this object's position to change shadow casting direction
   */
  lightOrigin: Group

  /**
   * Call this once after all the models are loaded
   * Clears the renderTargets and refreshes the lights/meshes list
   */
  clear(): void

  /**
   * Trigger fresh calculation of shadows
   */
  recalculate(): void

  /**
   * Add this function to animate loop
   * @param camera camera to render with
   */
  update(camera: Camera): void
}
