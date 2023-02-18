import gltfUrl from "../public/monkey.glb"
import Stats from "three/examples/jsm/libs/stats.module"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import hdriUrl from "/public/aristea_wreck_1k.hdr?url"
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
  AxesHelper,
  Group,
  BoxGeometry,
  Color,
  ConeGeometry,
  OctahedronGeometry,
  CylinderGeometry,
  Vector3,
} from "three"
import { PSM } from "../ProgressiveShadowMap"
let shadowMapObjects = []

let stats,
  renderer,
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

  const size = psm.shadowCatcherSize / 2
  const clampMin = new Vector3(-size, 0, -size),
    clampMax = new Vector3(size, size, size)
  lightControl.addEventListener("change", () => {
    psm.lightOrigin.position.clamp(clampMin, clampMax)
  })

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
  requestAnimationFrame(animate)
  render()
}

function raycast() {
  // update the picking ray with the camera and pointer position
  raycaster.setFromCamera(pointer, camera)

  // calculate objects intersecting the picking ray
  raycaster.intersectObject(mainObjects, true, intersects)

  if (!intersects.length) return

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
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.position.set(2.5, 0, 0)
  mainObjects.add(sphere)
  shadowMapObjects.push(sphere)

  const cube = new Mesh(
    new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new MeshStandardMaterial({ color: getRandomHexColor(), roughness: 0.3, metalness: 0 })
  )
  cube.castShadow = true
  cube.receiveShadow = true
  cube.position.set(-2.5, 0, 0)
  mainObjects.add(cube)
  shadowMapObjects.push(cube)

  const gltf = await gltfLoader.loadAsync(gltfUrl)
  const model = gltf.scene
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
      shadowMapObjects.push(child)
    }
  })
  mainObjects.add(model)
  psm.addObjectsToLightMap(shadowMapObjects)
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
  folder.add(psm, "progress", 0, 100, 1).listen().disable()
  folder.add(psm, "saveShadowsAsImage")
}

const color = new Color()
function getRandomHexColor() {
  return "#" + color.setHSL(Math.random(), 0.5, 0.5).getHexString()
}
