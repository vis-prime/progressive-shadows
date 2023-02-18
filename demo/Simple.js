import gltfUrl from "../public/monkey.glb"
import Stats from "three/examples/jsm/libs/stats.module"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import hdriUrl from "/public/aristea_wreck_1k.hdr?url"
import * as fflate from "three/examples/jsm/libs/fflate.module"

import {
  ACESFilmicToneMapping,
  EquirectangularReflectionMapping,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  sRGBEncoding,
  WebGLRenderer,
  Vector2,
  Raycaster,
  Group,
  BoxGeometry,
  Color,
  Vector3,
} from "three"
import { PSM } from "../ProgressiveShadowMap"
import { MathUtils } from "three"

let stats,
  renderer,
  raf,
  camera,
  scene,
  controls,
  gui,
  /**
   * @type {PSM}
   */
  psm,
  pointer = new Vector2()

const params = {
  printCam: () => {},
}
const mainObjects = new Group()
const rgbeLoader = new RGBELoader()
const gltfLoader = new GLTFLoader()
const draco = new DRACOLoader()
let transformControls
// draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.5/")
draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
gltfLoader.setDRACOLoader(draco)
const raycaster = new Raycaster()
const intersects = []
let sceneGui

export async function initSimple(mainGui) {
  gui = mainGui
  sceneGui = gui.addFolder("Scene")
  stats = new Stats()
  app.appendChild(stats.dom)
  // renderer
  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.outputEncoding = sRGBEncoding
  renderer.toneMapping = ACESFilmicToneMapping

  app.appendChild(renderer.domElement)

  // camera
  camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200)
  camera.position.set(6, 3, 6)
  camera.name = "Camera"
  camera.position.set(2.0404140991899564, 2.644387886134694, 3.8683136783076355)
  // scene
  scene = new Scene()
  scene.backgroundBlurriness = 0.8

  rgbeLoader.load(hdriUrl, (texture) => {
    texture.mapping = EquirectangularReflectionMapping
    scene.background = texture
    scene.environment = texture
  })
  scene.add(mainObjects)

  // controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true // an animation loop is required when either damping or auto-rotation are enabled
  controls.dampingFactor = 0.05
  controls.minDistance = 0.1
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI / 1.5
  controls.target.set(0, 0, 0)
  controls.target.set(0, 0, 0)

  psm = new PSM(renderer, camera, scene, { shadowCatcherSize: 8 })
  psm.lightOrigin.position.set(-3, 3, 3)
  addPsmGUI()
  // light position gizmo
  const lightControl = new TransformControls(camera, renderer.domElement)
  lightControl.name = "lightOrigin control"
  lightControl.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
    if (!event.value) {
      psm.update()
    }
  })
  lightControl.size = 0.5

  const size = psm.shadowCatcherSize / 2
  const clampMin = new Vector3(-size, 0, -size),
    clampMax = new Vector3(size, size, size)
  lightControl.addEventListener("change", () => {
    psm.lightOrigin.position.clamp(clampMin, clampMax)
  })
  lightControl.showY = false

  scene.add(lightControl)
  lightControl.attach(psm.lightOrigin)

  transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
    if (!event.value) {
      psm.update()
    }
  })

  transformControls.addEventListener("change", () => {
    if (transformControls.object) {
      if (transformControls.object.position.y < 0) {
        transformControls.object.position.y = 0
      }
    }
  })
  scene.add(transformControls)

  window.addEventListener("resize", onWindowResize)
  document.addEventListener("pointermove", onPointerMove)

  let downTime = Date.now()
  document.addEventListener("pointerdown", () => {
    downTime = Date.now()
  })
  document.addEventListener("pointerup", (e) => {
    if (Date.now() - downTime < 200) {
      onPointerMove(e)
      raycast()
    }
  })

  sceneGui.add(transformControls, "mode", ["translate", "rotate", "scale"])
  sceneGui.add(scene, "backgroundBlurriness", 0, 1, 0.01)

  // folder.add(record, "recordFrames")
  // sceneGui.add(params, "printCam").onChange(() => {
  //   console.log(camera.position.toArray())
  //   console.log(controls.target.toArray())
  // })

  await loadModels()
  animate()
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function render() {
  stats.update()
  // Update the inertia on the orbit controls
  controls.update()

  // Render Scene
  psm.renderInAnimateLoop()

  renderer.render(scene, camera)
}

function animate() {
  raf = requestAnimationFrame(animate)
  render()
}

function raycast() {
  // update the picking ray with the camera and pointer position
  raycaster.setFromCamera(pointer, camera)

  // calculate objects intersecting the picking ray
  raycaster.intersectObject(mainObjects, true, intersects)

  if (!intersects.length) {
    transformControls.detach()
    return
  }

  transformControls.attach(intersects[0].object)

  intersects.length = 0
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
}

async function loadModels() {
  // sphere
  const sphere = new Mesh(
    new SphereGeometry(0.5).translate(0, 0.5, 0),
    new MeshStandardMaterial({ color: getRandomHexColor(), roughness: 0, metalness: 1 })
  )
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.position.set(2, 0, -1.5)
  mainObjects.add(sphere)

  const cube = new Mesh(
    new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new MeshStandardMaterial({ color: getRandomHexColor(), roughness: 0.3, metalness: 0 })
  )
  cube.name = "cube"
  cube.castShadow = true
  cube.receiveShadow = true
  cube.position.set(-1.5, 0, 1.5)
  mainObjects.add(cube)

  const gltf = await gltfLoader.loadAsync(gltfUrl)
  const model = gltf.scene
  model.name = "suzanne"
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  mainObjects.add(model)
  psm.updateMeshList()
}

function addPsmGUI() {
  const folder = gui.addFolder("Progressive Shadows")
  folder.open()

  folder.add(psm.params, "enable")
  folder.add(psm.params, "frames", 10, 500, 1)
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

  folder.add(psm.params, "debugHelpers").onChange((v) => {
    psm.showDebugHelpers(v)
  })
  folder.add(psm, "update")
  folder.add(psm, "clear")

  folder.add(psm, "progress", 0, 100, 1).listen().disable()
  // folder.add(psm, "saveShadowsAsImage")
}

const color = new Color()
function getRandomHexColor() {
  return "#" + color.setHSL(Math.random(), 0.5, 0.5).getHexString()
}

const record = { recordFrames }
async function recordFrames() {
  const fac = 2
  const w = 1920 * fac,
    h = 1080 * fac

  // const w = window.innerWidth,
  // h = window.innerHeight
  params.autoResize = false
  cancelAnimationFrame(raf)
  const fps = 30
  const duration = 8
  const frames = duration * fps
  controls.autoRotate = true
  renderer.setPixelRatio(1)
  const distance = controls.getDistance()

  camera.aspect = w / h
  camera.updateProjectionMatrix()

  let zipCounter = 0
  const zipLimit = 20
  let blobDict = {}
  let zipCount = 0

  const zipBlobDict = async () => {
    const files = {}

    for (const [name, blob] of Object.entries(blobDict)) {
      files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
    }

    const zip = new Blob([fflate.zipSync(files)])
    await save(zip, zipCount + ".zip")

    zipCount++
  }

  for (let i = 0; i < frames; i++) {
    const tt = MathUtils.mapLinear(i, 0, frames - 1, 0, Math.PI * 2)
    camera.position.set(Math.sin(tt) * distance, camera.position.y, Math.cos(tt) * distance)

    renderer.setSize(w, h)

    console.log(i, "/", frames)

    render()

    // await sleep(10)
    blobDict["img_" + i + ".png"] = await new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"))
    if (zipCounter === zipLimit) {
      await zipBlobDict()
      blobDict = {}
      zipCounter = 0
    }
    zipCounter++
  }

  // save leftover files
  if (Object.keys(blobDict).length) {
    console.log("saving leftover")
    await zipBlobDict()
    blobDict = {}
  }
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
