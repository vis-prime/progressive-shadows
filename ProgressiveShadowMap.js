import { AddEquation, ShaderMaterial, ShadowMaterial } from "three"
import { ReverseSubtractEquation } from "three"
import { Color } from "three"
import { MathUtils } from "three"
import { SubtractEquation } from "three"
import { MinEquation } from "three"
import {
  OneFactor,
  ZeroFactor,
  SrcColorFactor,
  OneMinusSrcAlphaFactor,
  OneMinusDstAlphaFactor,
  OneMinusDstColorFactor,
  DstColorFactor,
  DstAlphaFactor,
  OneMinusSrcColorFactor,
  MaxEquation,
  SrcAlphaFactor,
  CustomBlending,
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
  MeshStandardMaterial,
} from "three"
import { shaderMaterial } from "./shaderMaterial"

const params = {
  enable: true,
  frames: 100,
  blendWindow: 100,
  lightRadius: 2,
  ambientWeight: 0.5,
  opacity: 0.8,
  debugMap: false,
  updateDelay: 10,
}

export class PSM {
  /**
   * PSM
   * @param {WebGLRenderer} renderer
   */
  constructor(renderer, camera, scene, res = 1024) {
    this.params = params
    this.realScene = scene
    this.camera = camera
    this.renderer = renderer
    this.res = res
    this.lightMapContainers = []
    this.compiled = false
    this.scene = new Scene()
    this.scene.background = null
    this.tinyTarget = new WebGLRenderTarget(1, 1)
    this.buffer1Active = false
    this.firstUpdate = true
    this.warned = false
    this.dirLights = []
    this.lightCount = 8
    this.shadowMapRes = 512
    this.killCompute = false
    this.isComputing = false
    this.shadowColor = new Color(1, 0, 0)
    this.clearColor = new Color()
    this.clearAlpha = 0
    this.progress = 0

    // create 8 directional lights to speed up the convergence
    for (let l = 0; l < this.lightCount; l++) {
      const dirLight = new DirectionalLight(0xffffff, 1.0 / this.lightCount)
      dirLight.name = "Dir. Light " + l
      dirLight.position.set(2, 2, 2)
      dirLight.castShadow = true
      dirLight.shadow.bias = 0.1
      dirLight.shadow.camera.near = 0.1
      dirLight.shadow.camera.far = 100
      dirLight.shadow.camera.right = 5
      dirLight.shadow.camera.left = -5
      dirLight.shadow.camera.top = 5
      dirLight.shadow.camera.bottom = -5
      dirLight.shadow.mapSize.width = this.shadowMapRes
      dirLight.shadow.mapSize.height = this.shadowMapRes
      this.dirLights.push(dirLight)
      this.scene.add(dirLight)
    }

    /**
     * light position control
     * @type {Group}
     */
    this.lightOrigin = new Group()
    this.lightOrigin.name = "lightOrigin"
    this.lightOrigin.position.set(5, 5, 3)
    this.scene.add(this.lightOrigin)

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

    // create plane to catch shadows
    this.shadowCatcherMesh = new Mesh(
      new PlaneGeometry(6, 6),
      new SoftShadowMaterial({
        color: this.shadowColor,
        map: this.progressiveLightMap2.texture,
      })
    )

    this.shadowCatcherMesh.renderOrder = 1000

    this.shadowCatcherMesh.rotation.x = -Math.PI / 2
    this.shadowCatcherMesh.name = "shadow_catcher_mesh"
    this.shadowCatcherMesh.receiveShadow = true
    this.realScene.add(this.shadowCatcherMesh)
    this.lightMapContainers.push({
      basicMat: this.shadowCatcherMesh.material,
      object: this.shadowCatcherMesh,
    })

    // Inject some spicy new logic into a standard phong material
    this.targetMat = new MeshLambertMaterial({ fog: false })
    this.previousShadowMap = { value: this.progressiveLightMap1.texture }
    this.averagingWindow = { value: 100 }
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
      shader.uniforms.averagingWindow = { value: 100 }

      this.targetMat.uniforms = shader.uniforms

      // Set the new Shader to this
      this.targetMat.userData.shader = shader
      this.compiled = true
    }
  }

  /**
   * Sets these objects' materials' lightmaps and modifies their uv2's.
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
   * @param {number} blendWindow When >1, samples will accumulate over time.
   */
  renderOnLightMap(camera, blendWindow = 100) {
    // Steal the Object3D from the real world to our special dimension
    for (let l = 0; l < this.lightMapContainers.length; l++) {
      this.lightMapContainers[l].object.oldScene = this.lightMapContainers[l].object.parent
      this.scene.attach(this.lightMapContainers[l].object)
    }

    // Render once normally to initialize everything
    if (this.firstUpdate) {
      this.renderer.setRenderTarget(this.tinyTarget) // Tiny for Speed
      this.renderer.render(this.scene, camera)
      this.firstUpdate = false
    }

    // Set each object's material to the UV Unwrapped Surface Mapping Version
    for (let l = 0; l < this.lightMapContainers.length; l++) {
      this.targetMat.uniforms.averagingWindow = { value: blendWindow }
      this.lightMapContainers[l].object.material = this.targetMat
      this.lightMapContainers[l].object.oldFrustumCulled = this.lightMapContainers[l].object.frustumCulled
      this.lightMapContainers[l].object.frustumCulled = false
    }

    // Ping-pong two surface buffers for reading/writing
    const activeMap = this.buffer1Active ? this.progressiveLightMap1 : this.progressiveLightMap2
    const inactiveMap = this.buffer1Active ? this.progressiveLightMap2 : this.progressiveLightMap1

    // Render the object's surface maps
    this.renderer.setRenderTarget(activeMap)
    this.targetMat.uniforms.previousShadowMap = { value: inactiveMap.texture }

    this.buffer1Active = !this.buffer1Active
    this.renderer.render(this.scene, camera)

    // Restore the object's Real-time Material and add it back to the original world
    for (let l = 0; l < this.lightMapContainers.length; l++) {
      this.lightMapContainers[l].object.frustumCulled = this.lightMapContainers[l].object.oldFrustumCulled
      this.lightMapContainers[l].object.material = this.lightMapContainers[l].basicMat
      this.lightMapContainers[l].object.oldScene.attach(this.lightMapContainers[l].object)
    }

    // Restore the original Render Target
    this.renderer.setRenderTarget(null)
  }

  /** DEBUG
   * Draw the lightmap in the main scene.  Call this after adding the objects to it.
   * @param {boolean} visible Whether the debug plane should be visible
   * @param {Vector3} position Where the debug plane should be drawn
   */
  showDebugLightmap(visible, position = undefined) {
    if (this.lightMapContainers.length == 0) {
      if (!this.warned) {
        console.warn("Call this after adding the objects!")
        this.warned = true
      }

      return
    }

    if (this.labelMesh == null) {
      this.labelMaterial = new MeshBasicMaterial({
        map: this.progressiveLightMap1.texture,
        side: DoubleSide,
      })
      this.labelPlane = new PlaneGeometry(1, 1)
      this.labelMesh = new Mesh(this.labelPlane, this.labelMaterial)
      this.labelMesh.position.y = 3
      this.realScene.add(this.labelMesh)
    }

    if (position != undefined) {
      this.labelMesh.position.copy(position)
    }

    this.labelMesh.visible = visible
  }

  randomiseLights() {
    const length = this.lightOrigin.position.length()
    // Manually Update the Directional Lights
    for (let l = 0; l < this.dirLights.length; l++) {
      // Sometimes they will be sampled from the target direction
      // Sometimes they will be uniformly sampled from the upper hemisphere
      if (Math.random() > params.ambientWeight) {
        this.dirLights[l].position.set(
          this.lightOrigin.position.x + Math.random() * params.lightRadius,
          this.lightOrigin.position.y + Math.random() * params.lightRadius,
          this.lightOrigin.position.z + Math.random() * params.lightRadius
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
    }
  }

  async update() {
    if (!params.enable) return

    this.clear()
    this.accumulate()
    console.log("Accumulate end")
  }

  async accumulate() {
    // Accumulate Surface Maps
    const date = Date.now()
    this.isComputing = true
    for (let index = 0; index < params.frames; index++) {
      console.log(date, "index")
      this.shadowCatcherMesh.material.opacity = Math.max(
        0,
        MathUtils.mapLinear(index, params.frames / 1.5, params.frames - 1, 0, params.opacity)
      )

      await sleep(params.updateDelay)

      this.renderOnLightMap(this.camera, params.blendWindow)
      this.randomiseLights()
      this.progress = MathUtils.mapLinear(index, 0, params.frames - 1, 0, 100)
    }
    this.isComputing = false
  }

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

    this.shadowCatcherMesh.material.opacity = 0
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Create a new custom material
var shadowOnlyMaterial = shaderMaterial(
  {
    transparent: true,
    map: null,
    // alphaTest: 0.5,
  },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  `
   uniform sampler2D map;
    varying vec2 vUv;
    void main() {
      float grey = texture2D(map, vUv).g;
      gl_FragColor = vec4(grey, grey, grey, 1.0 - grey);
    }
  `
)

const SoftShadowMaterial = shaderMaterial(
  {
    transparent: true,
    color: null,
    alphaTest: 1.0,
    opacity: 0.0,
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
