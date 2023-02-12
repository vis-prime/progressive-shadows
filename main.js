import "./style.css"
import monkeyURL from "./public/monkey.glb?url"

const app = document.getElementById("app")
import { version } from "./package.json"
import Stats from "three/addons/libs/stats.module"
import { GUI } from "lil-gui"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader"

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls"
import { TransformControls } from "three/examples/jsm/controls/TransformControls"
import moonless_golf_1k from "/public/moonless_golf_1k.hdr?url"

import {
  Color,
  EquirectangularReflectionMapping,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  sRGBEncoding,
  WebGLRenderer,
} from "three"
import { PSM } from "./ProgressiveShadowMap"

let stats, renderer, camera, scene, controls, gui

let groundMesh, sphere, monkeyObj

let shadowMapObjects = []

init()

animate()

function init() {
  gui = new GUI({ title: "PSM " + version })
  stats = new Stats()
  app.appendChild(stats.dom)
  // renderer
  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.outputEncoding = sRGBEncoding

  app.appendChild(renderer.domElement)

  // camera
  camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 300)
  camera.position.set(0, 5, 5)
  camera.name = "Camera"

  // scene
  scene = new Scene()
  scene.background = new Color(0x949494)

  const rgbeLoader = new RGBELoader()
  rgbeLoader.load(moonless_golf_1k, (texture) => {
    texture.mapping = EquirectangularReflectionMapping
    scene.background = texture
    // scene.backgroundBlurriness = 0.2
    scene.environment = texture
  })

  // controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true // an animation loop is required when either damping or auto-rotation are enabled
  controls.dampingFactor = 0.05
  // controls.screenSpacePanning = true
  controls.minDistance = 0.1
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI / 1.5
  controls.target.set(0, 0, 0)
  window.addEventListener("resize", onWindowResize)

  addModels()
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
  renderer.render(scene, camera)
}

function animate() {
  requestAnimationFrame(animate)
  render()
}

async function addModels() {
  // ground plane
  groundMesh = new Mesh(
    new PlaneGeometry(6, 6),
    new MeshStandardMaterial({
      color: 0xffffff,
      name: "groundMat",
    })
  )
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.name = "groundMesh"
  groundMesh.receiveShadow = true
  scene.add(groundMesh)

  // Sphere
  sphere = new Mesh(
    new SphereGeometry(0.5, 12, 12),
    new MeshStandardMaterial({ name: "sphereMat", color: 0xc0ffee, roughness: 0, metalness: 1 })
  )
  sphere.name = "sphere"
  sphere.castShadow = true
  sphere.receiveShadow = true

  sphere.position.set(1, 0.6, 1)
  scene.add(sphere)

  // Monkey !
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(monkeyURL)
  monkeyObj = gltf.scene
  monkeyObj.name = "monkey"
  monkeyObj.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
      child.material.roughness = 0.2
      shadowMapObjects.push(child)
    }
  })
  scene.add(monkeyObj)

  shadowMapObjects.push(groundMesh)
  shadowMapObjects.push(sphere)

  initProgressiveShadows()
}

async function initProgressiveShadows() {
  // light position gizmo
  const control = new TransformControls(camera, renderer.domElement)
  control.name = "lightOrigin control"
  control.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
  })
  scene.add(control)

  // sphere position gizmo
  const control2 = new TransformControls(camera, renderer.domElement)
  control2.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value
  })
  control2.name = "control sphere"
  scene.add(control2)
  control2.attach(sphere)
  control2.size = 0.3

  // psm stuff
  const psm = new PSM(renderer, camera)
  control.attach(psm.lightOrigin)
  psm.addGui(gui)
  psm.object = sphere
  psm.addObjectsToLightMap(shadowMapObjects)
  console.log({ psm })
}
