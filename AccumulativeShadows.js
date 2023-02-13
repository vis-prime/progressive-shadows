import {
  Color,
  DirectionalLight,
  FloatType,
  Group,
  HalfFloatType,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
} from "three"
import { shaderMaterial } from "./shaderMaterial"
import { DiscardMaterial } from "./DiscardMaterial"

let renderer, camera, scene, gPlane, gLights, plm, gui

let amount = 8,
  shadowMapRes = 512,
  radius = 1,
  ambient = 0.5

export class AccumulativeShadows {
  constructor(mRenderer, mCamera, mScene, mGui) {
    renderer = mRenderer
    camera = mCamera
    scene = mScene
    gui = mGui
    plm = new ProgressiveLightMap(mRenderer, mScene)
    console.log({ plm })

    gPlane = new Mesh(
      new PlaneGeometry(6, 6).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({
        color: 0xffffff,
        map: plm.progressiveLightMap2.texture,
      })

      //   new SoftShadowMaterial({
      //     transparent: true,
      //     depthWrite: false,
      //     toneMapped: true,
      //     blend: 20,
      //     map: plm.progressiveLightMap2.texture,
      //   })
    )
    gPlane.receiveShadow = true

    plm.configure(gPlane)

    gLights = new Group()
    // create 8 directional lights to speed up the convergence
    for (let i = 0; i < amount; i++) {
      const dirLight = new DirectionalLight(0xffffff, 1.0 / amount)
      dirLight.name = "Dir. Light " + i
      dirLight.position.set(2, 2, 2)
      dirLight.castShadow = true
      dirLight.shadow.camera.near = 0.1
      dirLight.shadow.camera.far = 100
      dirLight.shadow.camera.right = 5
      dirLight.shadow.camera.left = -5
      dirLight.shadow.camera.top = 5
      dirLight.shadow.camera.bottom = -5
      dirLight.shadow.mapSize.width = shadowMapRes
      dirLight.shadow.mapSize.height = shadowMapRes
      gLights.add(dirLight)
    }

    const randomiseGLights = () => {
      let light
      const length = gLights.position.length()
      for (let l = 0; l < gLights.children.length; l++) {
        light = gLights.children[l]
        if (Math.random() > ambient) {
          light.position.set(
            gLights.position.x + MathUtils.randFloatSpread(radius),
            gLights.position.y + MathUtils.randFloatSpread(radius),
            gLights.position.z + MathUtils.randFloatSpread(radius)
          )
        } else {
          let lambda = Math.acos(2 * Math.random() - 1) - Math.PI / 2.0
          let phi = 2 * Math.PI * Math.random()
          light.position.set(
            Math.cos(lambda) * Math.cos(phi) * length,
            Math.abs(Math.cos(lambda) * Math.sin(phi) * length),
            Math.sin(lambda) * length
          )
        }
      }
    }

    scene.add(gPlane, gLights)

    const api = {
      //   children,
      temporal: false,
      frames: 40,
      limit: Infinity,
      blend: 20,
      scale: 10,
      opacity: 1,
      alphaTest: 0.75,
      color: "black",
      colorBlend: 2,
      resolution: 1024,
      toneMapped: true,
      reset: () => {
        // Clear buffers, reset opacities, set frame count to 0
        plm.clear()
        const material = gPlane.material
        material.opacity = 0
        material.alphaTest = 0
        api.count = 0
      },
      update: async (frames = 100) => {
        // Adapt the opacity-blend ratio to the number of frames
        const material = gPlane.material
        if (!api.temporal) {
          material.opacity = api.opacity
          material.alphaTest = api.alphaTest
        } else {
          material.opacity = Math.min(api.opacity, material.opacity + api.opacity / api.blend)
          material.alphaTest = Math.min(api.alphaTest, material.alphaTest + api.alphaTest / api.blend)
        }

        // Switch accumulative lights on
        gLights.visible = true
        // Collect scene lights and meshes
        plm.prepare()

        // Update the lightmap and the accumulative lights
        for (let i = 0; i < frames; i++) {
          //   api.lights.forEach((light) => light.update())
          randomiseGLights()
          plm.update(camera, api.blend)
          await sleep(10)
          console.log("update")
        }
        // Switch lights off
        gLights.visible = false
        // Restore lights and meshes
        plm.finish()
      },
    }

    gui.add(api, "reset")
    gui.add(api, "update")
  }
}

const SoftShadowMaterial = shaderMaterial(
  {
    color: new Color(),
    blend: 2.0,
    alphaTest: 0.75,
    opacity: 0,
    map: null,
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

// Based on "Progressive Light Map Accumulator", by [zalo](https://github.com/zalo/)
class ProgressiveLightMap {
  constructor(renderer, scene, res = 1024) {
    this.renderer = renderer
    this.res = res
    this.scene = scene
    this.buffer1Active = false
    this.lights = []
    this.meshes = []
    this.object = null
    this.clearColor = new Color()
    this.clearAlpha = 0

    // Create the Progressive LightMap Texture
    const format = /(Android|iPad|iPhone|iPod)/g.test(navigator.userAgent) ? HalfFloatType : FloatType
    this.progressiveLightMap1 = new WebGLRenderTarget(this.res, this.res, {
      type: format,
      encoding: renderer.outputEncoding,
    })

    this.progressiveLightMap2 = new WebGLRenderTarget(this.res, this.res, {
      type: format,
      encoding: renderer.outputEncoding,
    })

    // Inject some spicy new logic into a standard phong material
    this.discardMat = new DiscardMaterial()

    this.targetMat = new MeshLambertMaterial({ fog: false })
    this.previousShadowMap = { value: this.progressiveLightMap1.texture }
    this.averagingWindow = { value: 100 }
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

  clear() {
    this.renderer.getClearColor(this.clearColor)
    this.clearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.setRenderTarget(this.progressiveLightMap1)
    this.renderer.clear()
    this.renderer.setRenderTarget(this.progressiveLightMap2)
    this.renderer.clear()
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(this.clearColor, this.clearAlpha)

    this.lights = []
    this.meshes = []
    this.scene.traverse((object) => {
      if (isGeometry(object)) {
        this.meshes.push({ object, material: object.material })
      } else if (isLight(object)) {
        this.lights.push({ object, intensity: object.intensity })
      }
    })

    console.log("clear", this.lights, this.meshes)
  }

  prepare() {
    this.lights.forEach((light) => (light.object.intensity = 0))
    this.meshes.forEach((mesh) => (mesh.object.material = this.discardMat))
  }

  finish() {
    this.lights.forEach((light) => (light.object.intensity = light.intensity))
    this.meshes.forEach((mesh) => (mesh.object.material = mesh.material))
  }

  configure(object) {
    this.object = object
  }

  update(camera, blendWindow = 100) {
    if (!this.object) return
    // Set each object's material to the UV Unwrapped Surface Mapping Version
    this.averagingWindow.value = blendWindow
    this.object.material = this.targetMat
    // Ping-pong two surface buffers for reading/writing
    const activeMap = this.buffer1Active ? this.progressiveLightMap1 : this.progressiveLightMap2
    const inactiveMap = this.buffer1Active ? this.progressiveLightMap2 : this.progressiveLightMap1
    // Render the object's surface maps
    const oldBg = this.scene.background
    this.scene.background = null
    this.renderer.setRenderTarget(activeMap)
    this.previousShadowMap.value = inactiveMap.texture
    this.buffer1Active = !this.buffer1Active
    this.renderer.render(this.scene, camera)
    this.renderer.setRenderTarget(null)
    this.scene.background = oldBg
  }
}

function isLight(object) {
  return object.isLight
}

function isGeometry(object) {
  return !!object.geometry
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
