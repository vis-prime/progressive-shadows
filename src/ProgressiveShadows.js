import { Scene } from "@gltf-transform/core"
import { Camera, DirectionalLight, Group, Mesh, MeshBasicMaterial, PlaneGeometry, WebGLRenderer } from "three"

export class ProgressiveShadows extends Group {
  /**
   * Generate Progressive shadows
   * @param {WebGLRenderer} renderer
   * @param {Scene} scene
   * @param {Camera} camera
   * @param {Object} [userParams]
   * @param {Number} [userParams.size]
   */
  constructor(
    renderer,
    scene,
    camera,
    {
      resolution = 1024,
      shadowMapRes = 512,
      lightCount = 8,
      size = 4,
      frames = 100,
      blendWindow = 100,
      lightRadius = 2,
      ambientWeight = 0.5,
      alphaTest = 0.95,
      helpers = false,
    } = userParams
  ) {
    super()
    this.renderer = renderer
    this.userScene = scene
    this.camera = camera
    this.enable = true
    this.params = {
      size,
      resolution,
      size,
      frames,
      blendWindow,
      lightRadius,
      ambientWeight,
      alphaTest,
      helpers,
    }
    this.dirLights = []

    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    this.materialShadowCatcher = new MeshBasicMaterial({ name: "shadow catcher" })

    this.meshShadowCatcher = new Mesh(geometry, this.materialShadowCatcher)
    this.meshShadowCatcher.name = "shadow catcher"
    this.meshShadowCatcher.scale.setScalar(this.params.size)
    this.add(this.meshShadowCatcher)

    this.lightOrigin = new Group()

    // create 8 directional lights to speed up the convergence
    const shadowRadius = this.params.size / 2
    for (let i = 0; i < lightCount; i++) {
      const dirLight = new DirectionalLight(0xffffff, 1.0 / lightCount)
      dirLight.name = "DirLight_" + i
      dirLight.position.set(2, 2, 2)
      dirLight.castShadow = true
      //   dirLight.shadow.bias = 0.1
      dirLight.shadow.camera.near = 0.1
      dirLight.shadow.camera.far = 100
      dirLight.shadow.camera.right = shadowRadius
      dirLight.shadow.camera.left = -shadowRadius
      dirLight.shadow.camera.top = shadowRadius
      dirLight.shadow.camera.bottom = -shadowRadius
      dirLight.shadow.mapSize.width = shadowMapRes
      dirLight.shadow.mapSize.height = shadowMapRes
      this.dirLights.push(dirLight)
    }
    this.add(...this.dirLights)
  }

  // Private

  // Public

  /**
   * Put this function inside the request animation frame loop
   */
  updateShadows() {
    if (!this.enable) return
  }
}

const release = new ProgressiveShadows(1, 1, 1, { size: 3 })

console.log({ release })
