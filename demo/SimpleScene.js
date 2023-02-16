import { MeshStandardMaterial, SphereGeometry, Mesh } from "three"
import { PSM } from "../ProgressiveShadowMap"
import logoUrl from "../public/logo.glb"
let logo,
  shadowMapObjects = []
export class SimpleScene {
  /**
   * A
   * @param {Object} param0
   */
  constructor({ mainObjects, gltfLoader, renderer, camera, scene, gui, psm }) {
    const sphere = new Mesh(
      new SphereGeometry(0.5),
      new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0, metalness: 1 })
    )
    sphere.name = "sphere"
    sphere.castShadow = true
    sphere.receiveShadow = true
    sphere.position.set(2.5, 0.5, 0)
    mainObjects.add(sphere)
    shadowMapObjects.push(sphere)

    psm.lightOrigin.position.set(5, 5, -5)

    gltfLoader.loadAsync(logoUrl).then((gltf) => {
      logo = gltf.scene
      logo.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
          shadowMapObjects.push(child)
        }
      })
      mainObjects.add(logo)
      psm.addObjectsToLightMap(shadowMapObjects)
    })

    console.log(mainObjects)
    const folder = gui.addFolder("Progressive Shadows")
    folder.open()

    folder.add(psm.params, "enable")
    folder.add(psm.params, "frames", 10, 500, 1)
    folder.add(psm.params, "updateDelay", 1, 100, 1)
    folder.add(psm.params, "blendWindow", 1, 500, 1)
    folder.add(psm.params, "lightRadius", 0, 30, 0.1)
    folder.add(psm.params, "ambientWeight", 0, 1, 0.1)
    folder.addColor(psm.shadowCatcherMaterial, "color").listen()

    folder.add(psm.shadowCatcherMaterial, "blend", 0, 2, 0.01)
    folder.add(psm.shadowCatcherMaterial, "opacity", 0, 1, 0.01)

    folder
      .add(psm.params, "alphaTest", 0, 1, 0.01)

      .onChange((v) => {
        psm.shadowCatcherMaterial.alphaTest = v
      })

    folder.add(psm.params, "debugMap").onChange((v) => {
      psm.showDebugLightmap(v)
    })
    folder.add(psm, "update")
    folder.add(psm, "progress", 0, 100, 1).listen().disable()
  }
}
