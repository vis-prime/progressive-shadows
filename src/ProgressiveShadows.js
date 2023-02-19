import {
  Color,
  DirectionalLightHelper,
  Plane,
  PlaneHelper,
  Vector3,
  MeshLambertMaterial,
  DirectionalLight,
  DoubleSide,
  FloatType,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
  ShaderMaterial,
  MathUtils,
  UniformsUtils,
} from "three"

export class ProgressiveShadows {
  /**
   * Generate Progressive shadows
   * @param {WebGLRenderer} renderer For rendering shadows
   * @param {Scene} scene To get list of shadow mesh
   * @param {Object} [userParams] Custom options
   * @param {Number} [userParams.resolution] RenderTarget resolution
   * @param {Number} [userParams.shadowMapRes] DirectionLight ShadowMap resolution
   * @param {Number} [userParams.lightCount] DirectionLight count
   * @param {Number} [userParams.size] meshShadowCatcher size
   * @param {Number} [userParams.frames] Number of frames to run accumulate shadows
   * @param {Number} [userParams.lightRadius] DirectionLight spread , smaller values gives sharper shadows
   * @param {Number} [userParams.ambientWeight] Ratio between directional light vs ambient light
   * @param {Number} [userParams.alphaTest] Alpha test value to be performed on materialShadowCatcher
   * @param {Number} [userParams.showHelpers] show line showHelpers to visualize all hidden objects & renderTarget
   */
  constructor(
    renderer,
    scene,
    {
      resolution = 1024,
      shadowMapRes = 512,
      shadowBias = 0,
      lightCount = 8,
      size = 4,
      frames = 100,
      blendWindow = 100,
      lightRadius = 2,
      ambientWeight = 0.5,
      alphaTest = 0.98,
    } = {}
  ) {
    this.params = {
      enable: true,
      frames,
      blendWindow,
      lightRadius,
      ambientWeight,
      alphaTest,
      debugHelpers: false,
      size,
    }
    this.scene = scene
    this.renderer = renderer
    this.res = resolution
    this.lightMapContainers = []
    this.compiled = false
    this.tinyTarget = new WebGLRenderTarget(1, 1)
    this.buffer1Active = false
    this.firstUpdate = true
    this.warned = false
    this.dirLights = []
    this.dirLightsHelpers = []

    this.killCompute = false
    this.isComputing = false
    this.clearColor = new Color()
    this.clearAlpha = 0
    this.progress = 0
    this.discardMaterial = new DiscardMaterial()
    this.lights = []
    this.meshes = []
    this.objectsToHide = []
    this.framesDone = 0
    /**
     * light position control
     * @type {Group}
     */
    this.lightOrigin = new Group()
    this.lightOrigin.name = "lightOrigin"
    this.lightOrigin.position.set(5, 3, 1)
    this.scene.add(this.lightOrigin)

    this.lightGroup = new Group()
    this.scene.add(this.lightGroup)

    // create 8 directional lights to speed up the convergence
    for (let l = 0; l < lightCount; l++) {
      const dirLight = new DirectionalLight(0xffffff, 1 / lightCount)
      dirLight.name = "Dir. Light " + l
      dirLight.castShadow = true
      dirLight.shadow.bias = 0.001
      dirLight.shadow.camera.near = 0.1
      dirLight.shadow.camera.far = 50
      dirLight.shadow.camera.right = size / 2
      dirLight.shadow.camera.left = -size / 2
      dirLight.shadow.camera.top = size / 2
      dirLight.shadow.camera.bottom = -size / 2
      dirLight.shadow.mapSize.width = shadowMapRes
      dirLight.shadow.mapSize.height = shadowMapRes
      this.dirLights.push(dirLight)
      this.lightGroup.add(dirLight)
      const helpers = new DirectionalLightHelper(dirLight)
      this.dirLightsHelpers.push(helpers)
    }

    // make all lights point to a single source
    const lightTarget = new Group()
    lightTarget.position.set(0, 0, 0)
    for (let l = 0; l < this.dirLights.length; l++) {
      this.dirLights[l].target = lightTarget
    }
    this.scene.add(lightTarget)

    // Create the Progressive LightMap Texture
    const format = /(Android|iPad|iPhone|iPod)/g.test(navigator.userAgent) ? HalfFloatType : FloatType
    this.progressiveLightMap1 = new WebGLRenderTarget(this.res, this.res, { type: format, encoding: this.renderer.outputEncoding })
    this.progressiveLightMap2 = new WebGLRenderTarget(this.res, this.res, { type: format, encoding: this.renderer.outputEncoding })

    this.shadowCatcherMaterial = new SoftShadowMaterial({
      map: this.progressiveLightMap2.texture,
    })

    // create plane to catch shadows
    this.shadowCatcherMesh = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), this.shadowCatcherMaterial)
    this.shadowCatcherMesh.position.y = 0.001 // avoid z-flicker
    // this.shadowCatcherMesh.renderOrder = 1000

    const plane = new Plane(new Vector3(0, 1, 0), 0)
    this.shadowCatcherMeshHelper = new PlaneHelper(plane, size, 0xffff00)

    this.shadowCatcherMesh.name = "shadowCatcherMesh"
    this.shadowCatcherMesh.receiveShadow = true
    this.scene.add(this.shadowCatcherMesh)

    this.lightMapContainers.push({
      basicMat: this.shadowCatcherMesh.material,
      object: this.shadowCatcherMesh,
    })

    // Inject some spicy new logic into a standard phong material
    this.targetMat = new MeshLambertMaterial({ fog: false })
    this.previousShadowMap = { value: this.progressiveLightMap1.texture }
    this.averagingWindow = { value: frames }
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
      shader.uniforms.previousShadowMap = this.previousShadowMap
      shader.uniforms.averagingWindow = this.averagingWindow
    }
  }

  /**
   * Sets these objects' materials' lightMaps and modifies their uv2's.
   * @param {Object3D} objects An array of objects and lights to set up your lightmap.
   */
  addObjectsToLightMap(objects) {
    for (let ob = 0; ob < objects.length; ob++) {
      const object = objects[ob]
      console.log(object.name)

      if (!object.geometry.hasAttribute("uv")) {
        console.warn("All lightmap objects need UVs!")
        continue
      }

      this.lightMapContainers.push({
        basicMat: object.material,
        object: object,
      })

      this.compiled = false
    }
  }

  /**
   * This function renders each mesh one at a time into their respective surface maps
   * @param {Camera} camera Standard Rendering Camera
   */
  renderOnLightMap(camera, blendWindow) {
    // Steal the Object3D from the real world to our special dimension
    // for (let l = 0; l < this.lightMapContainers.length; l++) {
    //   this.lightMapContainers[l].object.oldScene = this.lightMapContainers[l].object.parent
    //   this.scene.attach(this.lightMapContainers[l].object)
    // }

    // Render once normally to initialize everything
    // if (this.firstUpdate) {
    //   this.renderer.setRenderTarget(this.tinyTarget) // Tiny for Speed
    //   this.renderer.render(this.scene, camera)
    //   this.firstUpdate = false
    // }

    // Set each object's material to the UV Unwrapped Surface Mapping Version
    // for (let l = 0; l < this.lightMapContainers.length; l++) {
    //
    //   this.lightMapContainers[l].object.material = this.discardMaterial
    //   this.lightMapContainers[l].object.oldFrustumCulled = this.lightMapContainers[l].object.frustumCulled
    //   this.lightMapContainers[l].object.frustumCulled = false
    // }

    this.prepare()
    // this.targetMat.uniforms.averagingWindow = { value: this.params.blendWindow }
    this.averagingWindow.value = this.params.frames

    // Ping-pong two surface buffers for reading/writing
    const activeMap = this.buffer1Active ? this.progressiveLightMap1 : this.progressiveLightMap2
    const inactiveMap = this.buffer1Active ? this.progressiveLightMap2 : this.progressiveLightMap1

    // Render the object's surface maps
    this.renderer.setRenderTarget(activeMap)
    // this.targetMat.uniforms.previousShadowMap = { value: inactiveMap.texture }
    this.previousShadowMap.value = inactiveMap.texture

    this.buffer1Active = !this.buffer1Active
    this.renderer.render(this.scene, camera)

    // Restore the object's Real-time Material and add it back to the original world
    // for (let l = 0; l < this.lightMapContainers.length; l++) {
    //   this.lightMapContainers[l].object.frustumCulled = this.lightMapContainers[l].object.oldFrustumCulled
    //   this.lightMapContainers[l].object.material = this.lightMapContainers[l].basicMat
    // this.lightMapContainers[l].object.oldScene.attach(this.lightMapContainers[l].object)
    // }
    this.finish()

    // Restore the original Render Target
    this.renderer.setRenderTarget(null)
  }

  /** DEBUG
   * Draw the lightmap in the main scene.  Call this after adding the objects to it.
   * @param {boolean} visible Whether the debug plane should be visible
   * @param {Vector3} position Where the debug plane should be drawn
   */
  showDebugHelpers(visible, position = undefined) {
    if (this.debugMesh == null) {
      this.debugMesh = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({
          map: this.progressiveLightMap1.texture,
          side: DoubleSide,
        })
      )
      this.debugMesh.position.y = 3
    }

    if (position != undefined) {
      this.debugMesh.position.copy(position)
    }
    if (visible) {
      this.scene.add(this.debugMesh, this.shadowCatcherMeshHelper, ...this.dirLightsHelpers)
      this.dirLightsHelpers.forEach((h) => {
        h.update()
      })
    } else {
      this.scene.remove(this.debugMesh, this.shadowCatcherMeshHelper, ...this.dirLightsHelpers)
    }
  }

  /**
   * randomise lights
   * @private
   */
  randomiseLights() {
    const length = this.lightOrigin.position.length()
    // Manually Update the Directional Lights
    for (let l = 0; l < this.dirLights.length; l++) {
      // Sometimes they will be sampled from the target direction
      // Sometimes they will be uniformly sampled from the upper hemisphere
      if (Math.random() > this.params.ambientWeight) {
        this.dirLights[l].position.set(
          this.lightOrigin.position.x + MathUtils.randFloatSpread(this.params.lightRadius),
          this.lightOrigin.position.y + MathUtils.randFloatSpread(this.params.lightRadius),
          this.lightOrigin.position.z + MathUtils.randFloatSpread(this.params.lightRadius)
        )
      } else {
        // Uniform Hemispherical Surface Distribution for Ambient Occlusion
        const lambda = Math.acos(2 * Math.random() - 1) - 3.14159 / 2.0
        const phi = 2 * 3.14159 * Math.random()
        this.dirLights[l].position.set(
          Math.cos(lambda) * Math.cos(phi) * length,
          Math.abs(Math.cos(lambda) * Math.sin(phi) * length),
          Math.sin(lambda) * length
        )
      }

      if (this.params.debugHelpers) this.dirLightsHelpers[l].update()
    }
  }

  /**
   * Trigger an update
   */
  async recalculate() {
    if (!this.params.enable) return
    this.clear()
    this.framesDone = 0
  }

  /**
   * Prepare all meshes/lights
   */
  prepare() {
    this.lights.forEach((l) => (l.object.intensity = 0))
    this.meshes.forEach((m) => (m.object.material = this.discardMaterial))
    this.objectsToHide.forEach((m) => (m.object.visible = false))

    this.lightGroup.visible = true
    this.shadowCatcherMesh.material = this.targetMat
    if (this.params.debugHelpers) this.showDebugHelpers(false)
  }

  /**
   * Restore all meshes/lights
   */
  finish() {
    this.lights.forEach((l) => (l.object.intensity = l.intensity))
    this.meshes.forEach((m) => (m.object.material = m.material))
    this.objectsToHide.forEach((m) => (m.object.visible = m.visible))
    this.lightGroup.visible = false
    this.shadowCatcherMesh.material = this.shadowCatcherMaterial
    if (this.params.debugHelpers) this.showDebugHelpers(true)
  }

  /**
   * Clear the shadow Target & update mesh list
   *
   */
  clear() {
    console.log("clear")

    this.renderer.getClearColor(this.clearColor)
    this.clearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor("black", 1) // setting to any other color/alpha will decrease shadow's impact when accumulating
    this.renderer.setRenderTarget(this.progressiveLightMap1)
    this.renderer.clear()
    this.renderer.setRenderTarget(this.progressiveLightMap2)
    this.renderer.clear()
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(this.clearColor, this.clearAlpha)

    this.shadowCatcherMesh.material.alphaTest = 0.0

    this.updateShadowObjectsList()
  }

  /**
   * Update list of meshes which need to be hidden
   */
  updateShadowObjectsList() {
    this.lights.length = 0
    this.meshes.length = 0
    this.objectsToHide.length = 0
    this.scene.traverse((object) => {
      if (object.isMesh && object !== this.shadowCatcherMesh) {
        if (object.castShadow) {
          this.meshes.push({ object, material: object.material })
        } else {
          this.objectsToHide.push({ object, visible: object.visible })
        }
      } else if (object.isTransformControls) {
        this.objectsToHide.push({ object, visible: object.visible })
      } else if (object.isLight && object.parent !== this.lightGroup) {
        this.lights.push({ object, intensity: object.intensity })
      }
    })

    // console.log({ meshes: this.meshes, lights: this.lights, objectsToHide: this.objectsToHide })
  }

  /**
   * Add this function to animate loop
   */
  update(camera) {
    if (!this.params.enable || this.framesDone >= this.params.frames) return

    this.shadowCatcherMesh.material.alphaTest = MathUtils.clamp(
      MathUtils.mapLinear(this.framesDone, 2, this.params.frames - 1, 0, this.params.alphaTest),
      0,
      1
    )

    this.renderOnLightMap(camera)
    this.randomiseLights()
    this.progress = MathUtils.mapLinear(this.framesDone, 0, this.params.frames - 1, 0, 100)

    this.framesDone++
  }

  addGui(gui) {
    const folder = gui.addFolder("Progressive Shadows")
    folder.open()

    folder.add(this.params, "enable")
    folder.add(this.params, "frames", 10, 500, 1)
    folder.add(this.params, "blendWindow", 1, 500, 1)
    folder.add(this.params, "lightRadius", 0, 30, 0.1)
    folder.add(this.params, "ambientWeight", 0, 1, 0.1)
    folder.addColor(this.shadowCatcherMaterial, "color").listen()

    folder.add(this.shadowCatcherMaterial, "blend", 0, 2, 0.01)
    folder.add(this.shadowCatcherMaterial, "opacity", 0, 1, 0.01)

    folder
      .add(this.params, "alphaTest", 0, 1, 0.01)

      .onChange((v) => {
        this.shadowCatcherMaterial.alphaTest = v
      })

    folder.add(this.params, "debugHelpers").onChange((v) => {
      this.showDebugHelpers(v)
    })
    folder.add(this, "recalculate")
    folder.add(this, "clear")

    folder.add(this, "progress", 0, 100, 1).listen().disable()
    // folder.add(psm, "saveShadowsAsImage")
  }

  /**
   * Not working
   * @returns
   */
  saveShadowsAsImage() {
    return new Promise(async (resolve) => {
      console.log(this.progressiveLightMap1)
      const imageArray = new Uint8Array(this.progressiveLightMap1.width * this.progressiveLightMap1.height * 4)
      this.renderer.readRenderTargetPixels(
        this.progressiveLightMap1,
        0,
        0,
        this.progressiveLightMap1.width,
        this.progressiveLightMap1.height,
        imageArray
      )
      console.log({ imageArray })
      var link = document.createElement("a")
      link.download = "render" + ".png"

      let pixelHasValue = false
      for (let index = 0; index < imageArray.length; index++) {
        if (imageArray[index] !== 0) {
          pixelHasValue = true
          console.log("Pixel has value", imageArray[index])
          break
        }
      }

      if (!pixelHasValue) {
        return
      }

      // render the equirectangular image
      const imageData = new ImageData(new Uint8ClampedArray(imageArray), this.progressiveLightMap1.width, this.progressiveLightMap1.height)
      console.log({ imageData })

      // paste image on canvas
      const canvas = document.createElement("canvas")
      canvas.width = imageData.width
      canvas.height = imageData.height
      const ctx = canvas.getContext("2d")
      ctx.putImageData(imageData, 0, 0)

      // create image blob from canvas

      // download image file to system
      link.href = canvas.toDataURL("image/png")

      link.target = "_blank"
      link.click()

      resolve()
    })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const link = document.createElement("a")

async function save(blob, filename) {
  console.log("Save", filename)
  if (link.href) {
    URL.revokeObjectURL(link.href)
  }

  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.dispatchEvent(new MouseEvent("click"))
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
