const app = document.getElementById("app")
import Stats from "three/examples/jsm/libs/stats.module"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import hdriUrl from "/public/aristea_wreck_1k.hdr?url"
import rx7URL from "../public/rx7.glb"

import {
  ACESFilmicToneMapping,
  EquirectangularReflectionMapping,
  PerspectiveCamera,
  Scene,
  sRGBEncoding,
  WebGLRenderer,
  Vector3,
  Vector2,
  MathUtils,
  Raycaster,
  AxesHelper,
  Group,
  Color,
} from "three"
import { PostProcess } from "./Postprocess"
import { ProgressiveShadows } from "../src/ProgressiveShadows"
import { guiProgressiveShadows } from "../src/GuiProgressiveShadows"

let stats,
  raf,
  renderer,
  camera,
  scene,
  /**
   * a
   * @type {PostProcess}
   */
  postProcess,
  controls,
  gui,
  /**
   * @type {ProgressiveShadows}
   */
  progressiveShadows,
  pointer = new Vector2(),
  rendererSize = new Vector2()

let rx7, rx7Car
let wheelSpin = () => {}
let wheelSteer = () => {}

const params = {
  postProcess: true,
  bgColor: new Color(),
  envMapIntensity: 1,

  printCam: () => {},
}
const axesHelper = new AxesHelper(0.05)
const rgbeLoader = new RGBELoader()
const gltfLoader = new GLTFLoader()
const draco = new DRACOLoader()
// draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.5/")
draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
gltfLoader.setDRACOLoader(draco)
const raycaster = new Raycaster()

const intersects = []

const mainObjects = new Group()

export async function initRx7(mainGui) {
  gui = mainGui
  stats = new Stats()
  app.appendChild(stats.dom)
  // renderer
  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.getSize(rendererSize)
  renderer.shadowMap.enabled = true
  renderer.outputEncoding = sRGBEncoding
  renderer.toneMapping = ACESFilmicToneMapping

  app.appendChild(renderer.domElement)

  // camera
  camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300)
  camera.position.set(-6, 4, 4)
  camera.name = "Camera"
  camera.position.fromArray([-2.4, 1.36, 2.93])

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
  // controls.screenSpacePanning = true
  controls.minDistance = 0.1
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI / 1.5
  controls.target.set(0, 0, 0)
  controls.target.fromArray([-0.032, -0.259, 0.122])

  postProcess = new PostProcess(scene, camera, renderer)

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

  gui.add(params, "postProcess")
  const sceneGui = gui.addFolder("Scene")
  sceneGui.add(scene, "backgroundBlurriness", 0, 1, 0.01)
  sceneGui.addColor(params, "bgColor").onChange(() => {
    scene.background = params.bgColor
  })
  postProcess.addGui(sceneGui)

  scene.add(axesHelper)

  initProgressiveShadows()
  await loadModels()

  animate()
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  if (params.postProcess) {
    postProcess.setSize(window.innerWidth, window.innerHeight)
  } else {
    renderer.setSize(window.innerWidth, window.innerHeight)
  }

  renderer.getSize(rendererSize)
}

function render() {
  stats.update()
  // Update the inertia on the orbit controls
  controls.update()

  wheelSpin()

  // Render Scene
  progressiveShadows.update(camera)

  if (params.postProcess) {
    postProcess.render()
  } else {
    renderer.render(scene, camera)
  }
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

  if (!intersects.length) return

  postProcess.focus.copy(intersects[0].point)

  axesHelper.position.copy(postProcess.focus)
  // console.log(postProcess.focus)
  intersects.length = 0
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
  wheelSteer(pointer)
}

function initProgressiveShadows() {
  progressiveShadows = new ProgressiveShadows(renderer, scene, { size: 6 })
  progressiveShadows.lightOrigin.position.set(5, 4, 3)

  guiProgressiveShadows(progressiveShadows, gui)
}

async function loadModels() {
  // rx7 !
  const gltf = await gltfLoader.loadAsync(rx7URL)
  rx7 = gltf.scene
  rx7.name = "rx7 scene"

  rx7.traverse((child) => {
    if (child.isMesh) {
      if (!child.name.includes("road")) {
        child.castShadow = true
        child.receiveShadow = true
      }
    }
  })
  mainObjects.add(rx7)

  // fancy stuff

  postProcess.focus.set(-0.875, 0.388, 1.416)

  const FL = rx7.getObjectByName("wheel_front_L"),
    FR = rx7.getObjectByName("wheel_front_R"),
    RL = rx7.getObjectByName("wheel_rear_L"),
    RR = rx7.getObjectByName("wheel_rear_R"),
    ST_L = FL.parent,
    ST_R = FR.parent,
    road = rx7.getObjectByName("road")

  rx7Car = rx7.getObjectByName("rx7")

  const roadMat = road.material
  const tex = roadMat.map
  const bodyMat = rx7Car.material
  const hsl = {}
  bodyMat.color.getHSL(hsl)

  const wheelSpeed = 0.01
  let additionalSpeed = 0

  if (FL && FR && RL && RR) {
    wheelSpin = () => {
      FL.rotateY(-wheelSpeed)
      FR.rotateY(wheelSpeed)
      RL.rotateY(wheelSpeed + additionalSpeed * 2)
      RR.rotateY(-wheelSpeed - additionalSpeed * 2)
      tex.offset.x -= 0.0007
      bodyMat.color.setHSL((hsl.h += 1 / 3500), hsl.s, hsl.l)
    }

    const tiltAngle = MathUtils.degToRad(0.8)
    wheelSteer = (p) => {
      rx7Car.rotation.z = MathUtils.mapLinear(p.x, -1, 1, -tiltAngle, tiltAngle)
    }
  }

  const control2 = new TransformControls(camera, renderer.domElement)
  control2.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
    if (!event.value) {
      progressiveShadows.recalculate()
    }
  })

  const xLimit = 1
  const clampMin = new Vector3(-xLimit, 0, -2),
    clampMax = new Vector3(xLimit, 5, 2)

  const steerAngle = MathUtils.degToRad(30)
  const driftAngle = MathUtils.degToRad(-45)
  control2.addEventListener("change", () => {
    if (control2.object) {
      control2.object.position.clamp(clampMin, clampMax)
      control2.object.rotation.y = MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, -driftAngle, driftAngle)
      additionalSpeed = Math.abs(MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, -0.01, 0.01))
      ST_L.rotation.y = MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, -steerAngle, steerAngle)
      ST_R.rotation.y = MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, steerAngle, -steerAngle)
    }
  })
  control2.name = "control_rx7"
  control2.showY = false
  control2.showZ = false
  scene.add(control2)
  control2.attach(rx7Car)

  progressiveShadows.clear()
}
