import { MeshLambertMaterial } from "three"
import {
  DirectionalLight,
  DoubleSide,
  FloatType,
  Group,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three"
import { potpack } from "three/examples/jsm/libs/potpack.module"
import { DiscardMaterial } from "./DiscardMaterial"

const params = {
  Enable: true,
  blurEdges: true,
  blendWindow: 100,
  lightRadius: 2,
  ambientWeight: 0.5,
  debugMap: false,
}

export class PSM {
  /**
   * PSM
   * @param {WebGLRenderer} renderer
   */
  constructor(renderer, camera, res = 1024) {
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

    this.object = null

    // create 8 directional lights to speed up the convergence
    for (let l = 0; l < this.lightCount; l++) {
      const dirLight = new DirectionalLight(0xffffff, 1.0 / this.lightCount)
      dirLight.name = "Dir. Light " + l
      dirLight.position.set(2, 2, 2)
      dirLight.castShadow = true
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
    this.lightOrigin.position.set(5, 5, 5)
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

    // Inject some spicy new logic into a standard phong material
    this.discardMat = new DiscardMaterial()
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
    // Prepare list of UV bounding boxes for packing later...
    this.uv_boxes = []
    const padding = 3 / this.res

    for (let ob = 0; ob < objects.length; ob++) {
      const object = objects[ob]
      console.log(object.name)
      // If this object is a light, simply add it to the internal scene
      if (object.isLight) {
        this.scene.attach(object)
        continue
      }

      if (!object.geometry.hasAttribute("uv")) {
        console.warn("All lightmap objects need UVs!")
        continue
      }

      if (this.blurringPlane == null) {
        this._initializeBlurPlane(this.res, this.progressiveLightMap1)
      }

      // Apply the lightmap to the object
      if (object.name === "groundMesh") {
        object.material.lightMap = this.progressiveLightMap2.texture
        object.material.dithering = true
        object.castShadow = true
        object.receiveShadow = true
        object.renderOrder = 1000 + ob
        const uv = object.geometry.getAttribute("uv")
        object.geometry.setAttribute("uv2", uv)
        object.geometry.getAttribute("uv2").needsUpdate = true
        // Prepare UV boxes for potpack
        // TODO: Size these by object surface area

        this.uv_boxes.push({
          w: 1 + padding * 2,
          h: 1 + padding * 2,
          index: ob,
        })
      }

      this.lightMapContainers.push({
        basicMat: object.material,
        object: object,
      })

      this.compiled = false
    }
  }

  /**
   * INTERNAL Creates the Blurring Plane
   * @param {number} res The square resolution of this object's lightMap.
   * @param {WebGLRenderTexture} lightMap The lightmap to initialize the plane with.
   */
  _initializeBlurPlane(res, lightMap = null) {
    const blurMaterial = new MeshBasicMaterial()
    blurMaterial.uniforms = {
      previousShadowMap: { value: null },
      pixelOffset: { value: 1.0 / res },
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: 3.0,
    }
    blurMaterial.onBeforeCompile = (shader) => {
      // Vertex Shader: Set Vertex Positions to the Unwrapped UV Positions
      shader.vertexShader = "#define USE_UV\n" + shader.vertexShader.slice(0, -1) + "	gl_Position = vec4((uv - 0.5) * 2.0, 1.0, 1.0); }"

      // Fragment Shader: Set Pixels to 9-tap box blur the current frame's Shadows
      const bodyStart = shader.fragmentShader.indexOf("void main() {")
      shader.fragmentShader =
        "#define USE_UV\n" +
        shader.fragmentShader.slice(0, bodyStart) +
        "	uniform sampler2D previousShadowMap;\n	uniform float pixelOffset;\n" +
        shader.fragmentShader.slice(bodyStart - 1, -1) +
        `	gl_FragColor.rgb = (
									texture2D(previousShadowMap, vUv + vec2( pixelOffset,  0.0        )).rgb +
									texture2D(previousShadowMap, vUv + vec2( 0.0        ,  pixelOffset)).rgb +
									texture2D(previousShadowMap, vUv + vec2( 0.0        , -pixelOffset)).rgb +
									texture2D(previousShadowMap, vUv + vec2(-pixelOffset,  0.0        )).rgb +
									texture2D(previousShadowMap, vUv + vec2( pixelOffset,  pixelOffset)).rgb +
									texture2D(previousShadowMap, vUv + vec2(-pixelOffset,  pixelOffset)).rgb +
									texture2D(previousShadowMap, vUv + vec2( pixelOffset, -pixelOffset)).rgb +
									texture2D(previousShadowMap, vUv + vec2(-pixelOffset, -pixelOffset)).rgb)/8.0;
				}`

      // Set the LightMap Accumulation Buffer
      shader.uniforms.previousShadowMap = { value: lightMap.texture }
      shader.uniforms.pixelOffset = { value: 0.5 / res }
      blurMaterial.uniforms = shader.uniforms

      // Set the new Shader to this
      blurMaterial.userData.shader = shader

      this.compiled = true
    }

    this.blurringPlane = new Mesh(new PlaneGeometry(1, 1), blurMaterial)
    this.blurringPlane.name = "Blurring Plane"
    this.blurringPlane.frustumCulled = false
    this.blurringPlane.renderOrder = 0
    this.blurringPlane.material.depthWrite = false
    this.scene.add(this.blurringPlane)
  }

  /**
   * This function renders each mesh one at a time into their respective surface maps
   * @param {Camera} camera Standard Rendering Camera
   * @param {number} blendWindow When >1, samples will accumulate over time.
   * @param {boolean} blurEdges  Whether to fix UV Edges via blurring
   */
  update(camera, blendWindow = 100, blurEdges = true) {
    if (this.blurringPlane == null) {
      return
    }

    // Store the original Render Target
    const oldTarget = this.renderer.getRenderTarget()

    // The blurring plane applies blur to the seams of the lightmap
    this.blurringPlane.visible = blurEdges

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
    this.blurringPlane.material.uniforms.previousShadowMap = {
      value: inactiveMap.texture,
    }
    this.buffer1Active = !this.buffer1Active
    this.renderer.render(this.scene, camera)

    // Restore the object's Real-time Material and add it back to the original world
    for (let l = 0; l < this.lightMapContainers.length; l++) {
      this.lightMapContainers[l].object.frustumCulled = this.lightMapContainers[l].object.oldFrustumCulled
      this.lightMapContainers[l].object.material = this.lightMapContainers[l].basicMat
      this.lightMapContainers[l].object.oldScene.attach(this.lightMapContainers[l].object)
    }

    // Restore the original Render Target
    this.renderer.setRenderTarget(oldTarget)
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
      this.lightMapContainers[0].object.parent.add(this.labelMesh)
    }

    if (position != undefined) {
      this.labelMesh.position.copy(position)
    }

    this.labelMesh.visible = visible
  }

  addGui(gui) {
    gui.add(params, "Enable")
    gui.add(params, "blurEdges")
    gui.add(params, "blendWindow", 1, 500).step(1)
    gui.add(params, "lightRadius", 0, 10).step(0.1)
    gui.add(params, "ambientWeight", 0, 1).step(0.1)
    gui.add(params, "debugMap").onChange(() => {
      this.showDebugLightmap(params.debugMap)
    })
    gui.add(this, "accumulate")
    gui.add(this, "clear")
  }

  async accumulate() {
    if (!params.Enable) return
    // Accumulate Surface Maps
    console.log("Accumulate start...")
    for (let index = 0; index < 600; index++) {
      await sleep(2)

      this.update(this.camera, params.blendWindow, params.blurEdges)

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
            Math.cos(lambda) * Math.cos(phi) * 3 + this.object.position.x,
            Math.abs(Math.cos(lambda) * Math.sin(phi) * 3) + this.object.position.y + 2,
            Math.sin(lambda) * 3 + this.object.position.z
          )
        }
      }
    }
    console.log("Accumulate end")
  }

  clear() {
    this.progressiveLightMap1.dispose()
    this.progressiveLightMap2.dispose()
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
