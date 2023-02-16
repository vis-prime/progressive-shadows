import "./style.css"

import { version } from "./package.json"
import Stats from "three/examples/jsm/libs/stats.module"
import { GUI } from "lil-gui"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import hdriUrl from "/public/aristea_wreck_1k.hdr?url"
import monkeyURL from "./public/monkey.glb"
import rx7URL from "./public/rx7.glb"

const app = document.getElementById("app")

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
  Vector3,
  Vector2,
  MathUtils,
  Raycaster,
  AxesHelper,
  Group,
} from "three"
import { PSM } from "./ProgressiveShadowMap"
import { AccumulativeShadows } from "./AccumulativeShadows"
import { ProgressiveShadows } from "./src/ProgressiveShadows"
import * as fflate from "three/examples/jsm/libs/fflate.module"
import { PostProcess } from "./demo/Postprocess"

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
   * @type {PSM}
   */
  psm,
  pointer = new Vector2(),
  rendererSize = new Vector2()

let sphere, monkeyObj, rx7, rx7Car
let wheelSpin = () => {}
let wheelSteer = () => {}

const params = {
  postProcess: true,
  envMapIntensity: 1,
  recordFrames,
  downloadRender,
  printCam: () => {},
}
const axesHelper = new AxesHelper(0.1)

const loader = new GLTFLoader()
const draco = new DRACOLoader()
// draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.5/")
draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/")
loader.setDRACOLoader(draco)
const raycaster = new Raycaster()
let shadowMapObjects = []
const intersects = []

const mainObjects = new Group()
init()

// doAccumulate()
doPSM()

animate()

// shaderMaterialTest()
async function doAccumulate() {
  const accShadows = new AccumulativeShadows(renderer, camera, scene, gui)

  // Sphere
  sphere = new Mesh(
    new SphereGeometry(0.5, 16, 16),
    new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0.1, metalness: 1 })
  )
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.position.set(2, 0.6, 2)
  mainObjects.add(sphere)

  // Monkey !

  const gltf = await loader.loadAsync(monkeyURL)
  monkeyObj = gltf.scene
  monkeyObj.name = "monkey"
  monkeyObj.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  mainObjects.add(monkeyObj)

  console.log({ accShadows, scene })
}

function init() {
  gui = new GUI({ title: "PSM " + version, closeFolders: true })
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
  camera.position.fromArray([-2.4022655965146082, 1.3692585919407683, 2.9337697398369182])

  // scene
  scene = new Scene()
  scene.backgroundBlurriness = 0.8
  const rgbeLoader = new RGBELoader()
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
  controls.target.fromArray[(-0.03252440077259709, -0.25907995684395363, 0.12217438610846955)]

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
  const folder = gui.addFolder("Scene")
  folder.add(params, "envMapIntensity", 0, 1, 0.01).onChange(setEnvIntensity)
  folder.add(scene, "backgroundBlurriness", 0, 1, 0.01)

  // folder.add(params, "recordFrames")
  // folder.add(params, "downloadRender")
  folder.add(params, "printCam").onChange(() => {
    console.log(camera.position.toArray())
    console.log(controls.target.toArray())
  })
  postProcess.addGui(folder)

  scene.add(axesHelper)
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
  if (psm) psm.renderInAnimateLoop()

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
  console.log(postProcess.focus)
  intersects.length = 0
}

function setEnvIntensity() {
  scene.backgroundIntensity = params.envMapIntensity
  scene.traverse((node) => {
    if (node.material && node.material.isMeshStandardMaterial) {
      node.material.envMapIntensity = params.envMapIntensity
    }
  })
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
  wheelSteer(pointer)
}

async function doPSM() {
  // Sphere
  sphere = new Mesh(new SphereGeometry(0.5), new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0, metalness: 1 }))
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true
  sphere.position.set(2.5, 0.5, 0)
  // mainObjects.add(sphere)
  // shadowMapObjects.push(sphere)

  // Monkey !
  const gltf = await loader.loadAsync(rx7URL)
  rx7 = gltf.scene
  rx7.name = "monkey"

  rx7.traverse((child) => {
    if (child.isMesh) {
      if (!child.name.includes("road")) {
        child.castShadow = true
        child.receiveShadow = true
      }

      shadowMapObjects.push(child)
    }
  })

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
  console.log(hsl)
  if (FL && FR && RL && RR) {
    wheelSpin = () => {
      FL.rotateY(-0.01)
      FR.rotateY(0.01)
      RL.rotateY(0.01)
      RR.rotateY(-0.01)
      tex.offset.x -= 0.0007
      bodyMat.color.setHSL((hsl.h += 0.0002), hsl.s, hsl.l)
    }

    const tiltAngle = MathUtils.degToRad(0.8)
    wheelSteer = (p) => {
      rx7Car.rotation.z = MathUtils.mapLinear(p.x, -1, 1, -tiltAngle, tiltAngle)
    }
  }

  mainObjects.add(rx7)
  postProcess.focus.set(-0.8759789188822028, 0.388037334209497, 1.4161579000981126)

  /// PSM
  // psm stuff
  psm = new PSM(renderer, camera, scene)

  // light position gizmo
  // const control = new TransformControls(camera, renderer.domElement)
  // control.name = "lightOrigin control"
  // control.addEventListener("dragging-changed", (event) => {
  //   controls.enabled = !event.value
  //   if (!event.value) {
  //     // psm.shadowCatcherMaterial.color.setHSL(Math.random(), 0.5, 0.5)
  //     psm.update()
  //   }
  // })
  // scene.add(control)
  // control.attach(psm.lightOrigin)

  // sphere position gizmo
  const control2 = new TransformControls(camera, renderer.domElement)
  control2.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
    if (!event.value) {
      // psm.shadowCatcherMaterial.color.setHSL(Math.random(), 0.5, 0.5)
      psm.update()
    }
  })
  const xLimit = 1
  const clampMin = new Vector3(-xLimit, 0, -2),
    clampMax = new Vector3(xLimit, 5, 2)

  const steerAngle = MathUtils.degToRad(30)
  const driftAngle = MathUtils.degToRad(-45)
  control2.addEventListener("change", (event) => {
    if (control2.object) {
      control2.object.position.clamp(clampMin, clampMax)
      control2.object.rotation.y = MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, -driftAngle, driftAngle)

      ST_L.rotation.y = MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, -steerAngle, steerAngle)
      ST_R.rotation.y = MathUtils.mapLinear(control2.object.position.x, clampMin.x, clampMax.x, steerAngle, -steerAngle)
    }
  })
  control2.name = "control sphere"
  control2.showY = false
  control2.showZ = false
  scene.add(control2)
  control2.attach(rx7Car)

  psm.addObjectsToLightMap(shadowMapObjects)
  console.log({ psm })
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

  // setTimeout(() => {
  //   psm.update()
  // }, 5000)
}

async function recordFrames() {
  const w = 1920 * 2,
    h = 1080 * 2
  params.autoResize = false
  cancelAnimationFrame(raf)
  const fps = 30
  const duration = 8
  const frames = duration * fps
  controls.autoRotate = false
  renderer.setPixelRatio(1)

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
    renderer.setSize(w, h)

    console.log(i, "/", frames)
    // curveHandler.timeline = MathUtils.mapLinear(i, 0, frames, 0, 1)
    // curveHandler.scrub()

    render()
    // await saveImage("img_" + i)

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

async function downloadRender() {
  return new Promise(async (resolve, reject) => {
    controls.autoRotate = false
    renderer.setSize(1920 * 2, 1080 * 2)
    renderer.setPixelRatio(1)
    camera.aspect = 1920 / 1080
    camera.updateProjectionMatrix()
    render()
    var dataURL = renderer.domElement.toDataURL()

    var link = document.createElement("a")
    link.download = "render" + ".png"
    link.href = dataURL
    link.target = "_blank"
    link.click()

    onWindowResize()

    // const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"))
    // const zip = new Blob([
    //   fflate.zipSync({
    //     ["render" + ".png"]: [new Uint8Array(await blob.arrayBuffer()), { level: 0 }],
    //   }),
    // ])

    // console.log({ zip })
    // save(zip, "success.zip")
    resolve()
  })
}

async function saveImage(name) {
  return new Promise((resolve, reject) => {
    var dataURL = renderer.domElement.toDataURL()
    var link = document.createElement("a")
    link.download = name + ".png"
    link.href = dataURL
    link.target = "_blank"
    link.click()

    resolve()
  })
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
