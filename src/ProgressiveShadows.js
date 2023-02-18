import {
  PlaneHelper,
  Plane,
  Vector3,
  Color,
  Camera,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  WebGLRenderer,
  Scene,
  WebGLRenderTarget,
  MathUtils,
  ShaderMaterial,
  UniformsUtils,
  MeshLambertMaterial,
  DoubleSide,
  FloatType,
  HalfFloatType,
  DirectionalLightHelper,
} from "three"

export class ProgressiveShadows {
  /**
   * Generate Progressive shadows
   * @param {WebGLRenderer} renderer For rendering shadows
   * @param {Scene} scene To get list of shadow mesh
   * @param {Camera} camera For rendering to renderTarget
   * @param {Object} [userParams] Custom options
   * @param {Number} [userParams.resolution = 1024] RenderTarget resolution
   * @param {Number} [userParams.shadowMapRes = 512] DirectionLight ShadowMap resolution
   * @param {Number} [userParams.lightCount = 8] DirectionLight count
   * @param {Number} [userParams.size = 4] meshShadowCatcher size
   * @param {Number} [userParams.frames = 100] Number of frames to run accumulate shadows
   * @param {Number} [userParams.lightRadius = 2] DirectionLight spread , smaller values gives sharper shadows
   * @param {Number} [userParams.ambientWeight = 0.5] Ratio between directional light vs ambient light
   * @param {Number} [userParams.alphaTest = 0.95] Alpha test value to be performed on materialShadowCatcher
   * @param {Number} [userParams.showHelpers = false] show line showHelpers to visualize all hidden objects & renderTarget
   */
  constructor(
    renderer,
    scene,
    camera,
    {
      resolution = 1024,
      shadowMapRes = 512,
      shadowBias = 0,
      lightCount = 8,
      size = 4,
      frames = 100,
      // blendWindow = 100,
      lightRadius = 2,
      ambientWeight = 0.5,
      alphaTest = 0.98,
    } = {}
  ) {
    console.log("constructor", {
      renderer,
      scene,
      camera,

      resolution,
      shadowMapRes,
      shadowBias,
      lightCount,
      size,
      frames,
      // blendWindow ,
      lightRadius,
      ambientWeight,
      alphaTest,
    })

    /**
     * WebGLRenderer
     * @private
     */
    this.renderer = renderer

    /**
     * Scene
     * @private
     */
    this.scene = scene

    /**
     * Camera
     * @private
     */
    this.camera = camera

    /**
     * Main toggle
     */
    this.enabled = true

    /**
     * Params , these can be edited directly , next update will reflect the changes
     */
    this.params = {
      frames,
      lightRadius,
      ambientWeight,
      alphaTest,
      progress: 0,
    }

    /**
     * Internal Params
     * @private
     */
    this.internalParams = {
      showHelpers: false,
      compiled: false,
      buffer1Active: false,
      firstUpdate: true,
      framesRendered: 0,
    }

    /**
     * All directional lights to cast shadows
     * @type {Group}
     * @private
     */
    this.mainGroup = new Group()
    this.mainGroup.name = "progressive_shadows"
    this.scene.add(this.mainGroup)

    /**
     * All directional lights to cast shadows are in this group
     * @type {Group<DirectionalLight>}
     * @private
     */
    this.dirLightsGroup = new Group()
    this.dirLightsGroup.name = "dir_lights"
    this.mainGroup.add(this.dirLightsGroup)

    // create the directional lights to speed up the convergence
    const shadowRadius = size / 2
    for (let i = 0; i < lightCount; i++) {
      const dirLight = new DirectionalLight(0xffffff, 1.0 / lightCount)
      dirLight.name = "dir_light_" + i
      dirLight.position.set(2, 2, 2)
      dirLight.castShadow = true
      dirLight.shadow.bias = shadowBias
      dirLight.shadow.camera.near = 0.1
      dirLight.shadow.camera.far = 100
      dirLight.shadow.camera.right = shadowRadius
      dirLight.shadow.camera.left = -shadowRadius
      dirLight.shadow.camera.top = shadowRadius
      dirLight.shadow.camera.bottom = -shadowRadius
      dirLight.shadow.mapSize.width = shadowMapRes
      dirLight.shadow.mapSize.height = shadowMapRes
      this.dirLightsGroup.add(dirLight)
    }

    /**
     * Light position control
     * Move this object to where you want the light to cast from
     * @type {Group}
     */
    this.lightOrigin = new Group()
    this.lightOrigin.name = "light_origin"
    this.lightOrigin.position.set(5, 3, 1)
    this.mainGroup.add(this.lightOrigin)

    const format = /(Android|iPad|iPhone|iPod)/g.test(navigator.userAgent) ? HalfFloatType : FloatType // to combat phone issue

    /**
     * Render target 1
     * @private
     */
    this.progressiveLightMap1 = new WebGLRenderTarget(resolution, resolution, { type: format, encoding: this.renderer.outputEncoding })
    /**
     * Render target 2
     * @private
     */
    this.progressiveLightMap2 = new WebGLRenderTarget(resolution, resolution, { type: format, encoding: this.renderer.outputEncoding })

    /**
     * Material used by meshShadowCatcher
     * @type {SoftShadowMaterial}
     * @private
     */
    this.materialShadowCatcher = new SoftShadowMaterial({
      map: this.progressiveLightMap2.texture,
    })

    /**
     * Mesh for shadow catching
     * @type {Mesh}
     */
    this.meshShadowCatcher = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), this.materialShadowCatcher)
    this.meshShadowCatcher.name = "shadow_catcher"
    this.meshShadowCatcher.position.y = 0.001 // avoid z-flicker
    this.mainGroup.add(this.meshShadowCatcher)

    /**
     * Helper lines and stuff
     * @private
     */
    this.helperObjects = new Group()
    this.helperObjects.name = "helper_items"

    const lineShadowPlane = new PlaneHelper(new Plane(new Vector3(0, 1, 0), 0), size, 0x808080)
    for (const light of this.dirLightsGroup.children) {
      this.helperObjects.add(new DirectionalLightHelper(light))
    }

    this.helperObjects.add(lineShadowPlane)
    this.mainGroup.add(this.helperObjects)
    console.log(this.mainGroup)

    /**
     * Material will be ignored by renderTarget render
     * @private
     */
    this.discardMaterial = new DiscardMaterial()

    /**
     * Backup of user's settings
     * @private
     */
    this.backups = {
      clearColor: new Color(),
      clearAlpha: 0,
      background: null,

      lights: [],
      meshes: [],
      objectsToHide: [],
    }

    /**
     * Backup of user's settings
     * @private
     */
    // Inject some spicy new logic into a standard Lambert material
    this.targetMat = new MeshLambertMaterial({ fog: false })
    // this.previousShadowMap = { value: this.progressiveLightMap1.texture }
    // this.averagingWindow = { value: 100 }
    this.targetMat.uniforms = {}
    this.targetMat.onBeforeCompile = (shader) => {
      // Vertex Shader: Set Vertex Positions to the Unwrapped UV Positions
      shader.vertexShader =
        "varying vec2 vUv;\n" + shader.vertexShader.slice(0, -1) + "vUv = uv; gl_Position = vec4((uv - 0.5) * 2.0, 1.0, 1.0); }"

      // Fragment Shader: Set Pixels to average in the Previous frame's Shadows
      const bodyStart = shader.fragmentShader.indexOf("void main() {")
      shader.fragmentShader =
        "varying vec2 vUv;\n" +
        shader.fragmentShader.slice(0, bodyStart) +
        "uniform sampler2D previousShadowMap;\n	uniform float averagingWindow;\n" +
        shader.fragmentShader.slice(bodyStart - 1, -1) +
        `\nvec3 texelOld = texture2D(previousShadowMap, vUv).rgb;
        gl_FragColor.rgb = mix(texelOld, gl_FragColor.rgb, 1.0/ averagingWindow);
      }`

      // Set the Previous Frame's Texture Buffer and Averaging Window
      shader.uniforms.previousShadowMap = {
        value: this.progressiveLightMap1.texture,
      }
      shader.uniforms.averagingWindow = { value: frames }

      this.targetMat.uniforms = shader.uniforms

      // Set the new Shader to this
      this.targetMat.userData.shader = shader
      // this.compiled = true
    }
  }

  // Public
  updateShadowObjectsList() {
    console.log("updateShadowObjectsList")
  }

  showDebugHelpers() {}

  /**
   * Put this function inside the request animation frame loop
   */
  recalculate() {
    console.log("updateShadowObjectsList")
  }
  randomiseLights() {}
  prepare() {}
  finish() {}
  /**
   * Call this in the requestAnimationFrame loop
   */
  update() {}
  clear() {}
}

/**
 * r3f shader material which makes editing uniforms easy
 * @param {Object} uniforms
 * @param {String} vertexShader
 * @param {String} fragmentShader
 * @param {Function} onInit
 * @returns
 */
function shaderMaterial(uniforms = {}, vertexShader, fragmentShader, onInit = (material) => {}) {
  const material = class extends ShaderMaterial {
    constructor(parameters = {}) {
      const entries = Object.entries(uniforms)
      // Create uniforms and shaders
      super({
        uniforms: entries.reduce((acc, [name, value]) => {
          const uniform = UniformsUtils.clone({ [name]: { value } })
          return {
            ...acc,
            ...uniform,
          }
        }, {}),
        vertexShader,
        fragmentShader,
      })
      // Create getter/setters
      entries.forEach(([name]) =>
        Object.defineProperty(this, name, {
          get: () => this.uniforms[name].value,
          set: (v) => (this.uniforms[name].value = v),
        })
      )

      // Assign parameters, this might include uniforms
      Object.assign(this, parameters)
      // Call onInit
      if (onInit) onInit(this)
    }
  }
  material.key = MathUtils.generateUUID()
  return material
}

/**
 * r3f shadow material
 */
const SoftShadowMaterial = shaderMaterial(
  {
    transparent: true,
    color: new Color(0, 0, 0),
    alphaTest: 0.0,
    opacity: 1.0,
    map: null,
    depthWrite: false,
    toneMapped: false,
    blend: 2.0,
  },
  `varying vec2 vUv;
   void main() {
     gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.);
     vUv = uv;
   }`,
  `varying vec2 vUv;
   uniform sampler2D map;
   uniform vec3 color;
   uniform float opacity;
   uniform float alphaTest;
   uniform float blend;
   void main() {
     vec4 sampledDiffuseColor = texture2D(map, vUv);
     gl_FragColor = vec4(color * sampledDiffuseColor.r * blend, max(0.0, (1.0 - (sampledDiffuseColor.r + sampledDiffuseColor.g + sampledDiffuseColor.b) / alphaTest)) * opacity);
     #include <tonemapping_fragment>
     #include <encodings_fragment>
   }`
)

/**
 * r3f Discard material which helps ignore materials when rendering
 */
const DiscardMaterial = shaderMaterial({}, "void main() { }", "void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); discard;  }")
